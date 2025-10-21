'use strict';

const NodeHelper = require('node_helper');
const request = require('request');
const axios = require('axios');

const Throttler = require("./Throttler.js");
const fs = require('fs');
const SolaredgeAPI = require("./SolaredgeAPI.js");
const SpotPrices = require("./SpotPrices.js");
const { execFile, spawn } = require('child_process');
const schedule = require('node-schedule');

module.exports = NodeHelper.create({
	config: undefined,
	timerPowerFlow: undefined,
	timerEnergy: undefined,
	throttlerPowerFlow: undefined,
	teslaThrottler: undefined,
	teslaTimer: undefined,
	teslaData: undefined,
	maxPower: {
		value: 0.001,
		timestamp: new Date()
	},
	productionSpan: {
		day: -1,
		firstProduction: '-',
		lastProduction: '-'
	},
	timerDiagram: undefined,
	solarEdgeApi: undefined,
	spotPrices: undefined,
	userPresenceThrottler: undefined,


	start: function() {
		
		console.log(`node_helper ${this.name}: Starting module`);

		this.throttlerPowerFlow = new Throttler();
		this.throttlerPowerFlow.minimumTimeBetweenCalls = 5*60*1000;
		this.throttlerPowerFlow.maxCallsPerDay = 300;
		this.throttlerPowerFlow.setThrottleHours(22, 5);

		// this.throttlerPowerFlow.logThrottlingConditions();

		try {
			if (fs.existsSync("maxPower.json")) {
				this.maxPower = JSON.parse(fs.readFileSync("maxPower.json"));
			}
		} catch (ex)
		{
			console.error(`Error reading maxPower.json: ${ex}`);
			this.maxPower = { value: 0.001, timestamp: Date.now() };
		}
		
		this.teslaThrottler = new Throttler();
//		this.teslaThrottler.minimumTimeBetweenCalls = 60*60*1000; // Once every 60 minutes
		this.teslaThrottler.setThrottleHours(22, 6);
		this.teslaThrottler.setOverrideThrottleCallback((t, reason) => {
			// Don't throttle while charging
			return (this.teslaData && this.teslaData.chargingState=="Charging");
		});
		// this.teslaThrottler.logThrottlingConditions();

		this.userPresenceThrottler = new Throttler();
		this.userPresenceThrottler.minimumTimeBetweenCalls = 5*60*1000; // Once every 5 minutes

		console.log(`node_helper ${this.name}: Started module`);
	},
	
	socketNotificationReceived: async function(notification, payload)	{
		switch (notification) {
			case "ENERGYCONFIG":
				if (this.config) {
					console.log(`node_helper ${this.name}: Re-configuring module`);
					if (this.timerPowerFlow)
						clearInterval(this.timerPowerFlow);
					if (this.timerEnergy)
						clearInterval(this.timerEnergy);
					if (this.timerDiagram)
						clearInterval(this.timerDiagram);
					if (this.teslaTimer)
						clearInterval(this.teslaTimer);
				}

				this.config = payload;
				
				this.setupSolarEdgeApi();

				await this.setupSpotPricesAsync();

				this.setupTeslaApi();

				await this.fetchSiteDetailsAsync();
				this.throttlerPowerFlow.forceExecute(() => this.fetchPowerFlowAsync());
				this.fetchProductionAsync();
				this.fetchAutarchyAsync();
				
				this.teslaThrottler.forceExecute(() => this.fetchTeslaChargeAsync());
				break;


			case "GETSTORAGEDATA":
				console.log(`node_helper ${this.name}: GETSTORAGEDATA`);
				await this.fetchStorageDataAsync();
				break;


			case "GETSPOTPRICES": // payload: boolean - whether to update prices
				console.log(`node_helper ${this.name}: GETSPOTPRICES Update: ${payload}`);
				if (payload && payload===true) {
					try {
						await this.updateSpotPricesAsync();
					} catch (error) {
						console.error(`Error updating spot prices: ${error}`);
					}
				}
				this.sendSpotPrices();
				break;

			case "GETSITEDETAILS":
				console.log(`node_helper ${this.name}: GETSITEDETAILS`);
				await this.fetchSiteDetailsAsync();
				break;

			case "GETAUTARCHY":
				console.log(`node_helper ${this.name}: GETAUTARCHY`);
				await this.fetchAutarchyAsync();
				break;

			case "GETTESLACHARGE": // payload: boolean - whether to wake up Tesla
				console.log(`node_helper ${this.name}: GETTESLACHARGE`);
				this.teslaThrottler.execute(async() => await this.fetchTeslaChargeAsync(payload),
											(r) => console.error("TeslaCharge update throttled:"+r));
				break;

			case "USER_PRESENCE":
				console.log(`node_helper ${this.name}: USER_PRESENCE ${payload}`);
				if (payload) // User is present
				{
					this.userPresenceThrottler.execute( async () => await this.sendSpotPrices(),
														(r) => console.error("User presence spot price update throttled:"+r)
													);
				}
				break;
		}
	},

	/**
	 * Setup SolarEdge API: create instance, setup periodic storage data fetch
	 */
	setupSolarEdgeApi: function() {
		try {
			console.log(`node_helper ${this.name}: Creating SolaredgeAPI instance`);
			this.solarEdgeApi = new SolaredgeAPI(this.config.siteId, this.config.apiKey, this.config.inverterId);

			// Schedule power flow fetch according to config interval
			this.timerPowerFlow = setInterval(() => {
				this.throttlerPowerFlow.execute(() => this.fetchPowerFlowAsync(),
												(r) => console.log("PowerFlow update throttled:"+r));
			}, this.config.interval);
			console.log(`node_helper ${this.name}: interval set to ${this.config.interval}`);

			// Schedule production and autarchy fetch every hour
			this.timerEnergy = setInterval(() => {
				this.fetchProductionAsync();
				this.fetchAutarchyAsync();
			}, 60*60*1000);


			// Schedule storage data fetch every 15 minutes
			this.timerStorage = setInterval(async () => {
				console.log(`node_helper ${this.name}: Scheduled job: Fetching storage data at ${new Date().toLocaleTimeString()}`);
				await this.fetchStorageDataAsync();
			}, 15*60*1000);
		} catch (error) {
			console.error(`Error creating SolaredgeAPI instance: ${error}`);
		}
	},

	/**
	 * Setup Tesla API: setup periodic charge status fetch
	 */
	setupTeslaApi: function() {
		this.teslaTimer = setInterval(() => {
			this.teslaThrottler.execute( () => this.fetchTeslaChargeAsync(),
										 (r) => console.log("TeslaCharge update throttled:"+r));
		}, 5*60*1000);

		this.fetchTeslaChargeAsync();
	},

	/**
	 * Setup spot prices: create instance, fetch initial data, setup periodic update
	 */
	setupSpotPricesAsync: async function() {
		try {
			console.log("Creating SpotPrices instance");
			this.spotPrices = new SpotPrices();

			if (!this.spotPrices.hasPrices ||
				this.spotPrices.maxDate < new Date()) // No prices for today
			{
				console.log("Fetching spot prices (no prices for today)");
				await this.updateSpotPricesAsync();
				await this.sendSpotPrices();
			}
			
			schedule.scheduleJob('3 21 * * *', async () => { // Every day at 21:03
				console.log("Scheduled job: Fetching spot prices at " + new Date().toLocaleTimeString());
				await this.updateSpotPricesAsync();
				await this.sendSpotPrices();
			});
			
			// send spot prices to module every 15 minutes - cheap since we do caching
			setInterval(async () => {
				await this.sendSpotPrices();
			}, 15*60*1000);

		} catch(error) {
			console.error(`Request for spotPrice returned error  ${error}`);
		}
	},

	fetchPowerFlowAsync: async function() {
	
		if (!this.config){
			console.error(`node_helper ${this.name}:Configuration has not been set!`);
			return;
		}

		const powerFlow = await this.solarEdgeApi.fetchCurrentPowerFlow();

		var d = new Date();
		this.productionSpan.day = d.getDay();
		this.productionSpan.firstProduction =
		this.productionSpan.lastProduction = "-";

		const powerflowReply = {
			powerflow: powerFlow,
			productionSpan: this.productionSpan,
			requestCount: this.throttlerPowerFlow.todaysCallCount
		};

		this.sendSocketNotification("POWERFLOW", powerflowReply);
	},

	fetchProductionAsync: async function() {
		if (!this.config){
			console.error(`node_helper ${this.name}:Configuration has not been set!`);
			return;
		}

		const production = await this.solarEdgeApi.fetchProduction();
		this.sendSocketNotification("PRODUCTION", production);
	},

	fetchSiteDetailsAsync: async function() {
		if (!this.config){
			console.error(`node_helper ${this.name}:Configuration has not been set!`);
			return;
		}

		const siteDetails = await this.solarEdgeApi.fetchSiteDetails();
		this.sendSocketNotification("SITEDETAILS", siteDetails);
	},

	fetchAutarchyAsync: async function() {
		console.log(`node_helper ${this.name}: fetchAutarchyAsync()`);

		if (!this.config){
			console.error(`node_helper ${this.name}:Configuration has not been set!`);
			return;
		}

		try{
			const autarchy = await this.solarEdgeApi.fetchAutarchy();
			this.sendSocketNotification("AUTARCHY", autarchy);
			console.log(`node_helper ${this.name}: sent AUTARCHY`);
		} catch (err) {
			console.error("Error fetching autarchy data:", err);
		}
	},

	/**
	 * Fetches the current Tesla charge status.
	 * If the car is sleeping, it is woken up by the QueryTesla command, so make sure that
	 * the minimum time between calls is respected to avoid excessive wake-ups.
	 * @param {boolean} wakeUp Whether to wake up the car if it is sleeping.
	 * @return {Promise<void>}
	 */
	async fetchTeslaChargeAsync(wakeUp = false) {
		console.log(`node_helper ${this.name}: fetchTeslaChargeAsync(${wakeUp})`);

		if (!this.config){
			console.error(`node_helper ${this.name}:Configuration has not been set!`);
			return;
		}

		try{
			const isAwake = JSON.parse((await this.callQueryTesla('-isAwake')).trim().toLowerCase());

			if (wakeUp == false && !isAwake) {
				console.log(`node_helper ${this.name}: Tesla is sleeping, not fetching charge status`);
				return;
			} else {
				const teslaData = JSON.parse(await this.callQueryTesla('-getCharge'));
				this.teslaData = teslaData;
				this.sendSocketNotification("TESLA", teslaData);
				console.log(`node_helper ${this.name}: sent TESLA`);
			}
		} catch (err) {
			console.error("Error fetching Tesla charge status:", err);
		}
	},

	/**
	 * Calls the QueryTesla command with the given parameters, waits for the process to finish,
	 * and returns the output.
	 * @param {string} parameters parameters for QueryTesla
	 * @returns Output from QueryTesla
	 */
	async callQueryTesla(parameters) {
		console.log(`node_helper ${this.name}: callQueryTesla(${parameters})`);

		return new Promise((resolve, reject) => {
			execFile('/home/mav/tesla/QueryTesla', [parameters], (err, stdout, stderr) => {
				if (err) {
					console.error('Error calling QueryTesla:', err);
					return reject(err);
				}
				if (stderr)
					console.error('QueryTesla stderr:', stderr);

				resolve(stdout);
			});
		});
	},

	/**
	 * Update spot prices with retries
	 * @param {Number} maxAttempts Max. number of retries
	 * @returns true if update was successful, false else
	 */
	updateSpotPricesAsync: async function(maxAttempts = 5) {
		var attempt;
		for (attempt=1; attempt <= maxAttempts; attempt++) {
			try {
				console.log(`Try #${attempt} fetching spot prices at ${new Date().toLocaleTimeString()}`);
				await this.spotPrices.updateSpotPricesAsync(0,1);
				console.log(`Successfully updated spot prices on attempt #${attempt}`);
				return true;
			} catch (error) {
				console.error(`Error updating spot prices: ${error}`);
				await new Promise(resolve => setTimeout(resolve, attempt * 10000)); // Wait longer between attempts
			}
		}
		console.error(`Giving up after ${maxAttempts} attempts to update spot prices`);
		return false;
	},

	/**
	 * Sends current spot price data to the module.
	 * Does NOT fetch new data; update is done periodically elsewhere.
	 */
	sendSpotPrices: function() {
		console.log(`node_helper ${this.name}: sendSpotPrices()`);

		try {
			this.sendSocketNotification("SPOTPRICES", {
				currentPrice: this.spotPrices.currentPrice,
				currentPriceDate: this.spotPrices.currentPriceDate,
				minTodayPrice: this.spotPrices.minTodayPrice,
				minTodayPriceDate: this.spotPrices.minTodayPriceDate,
				maxTodayPrice: this.spotPrices.maxTodayPrice,
				maxTodayPriceDate: this.spotPrices.maxTodayPriceDate,
				prices: this.spotPrices.prices,
				dates: this.spotPrices.dates,
				unit: this.spotPrices.unit,
				updateTimestamp: this.spotPrices.updateTimestamp,
			});
			console.log(`node_helper ${this.name}: sent SPOTPRICES`);
		} catch(error) {
			console.error(`Request for spotPrice returned error  ${error}`);
		}
	},

	fetchStorageDataAsync: async function() {
		console.log(`node_helper ${this.name}: fetchStorageDataAsync()`);

		if (!this.config){
			console.error(`node_helper ${this.name}:Configuration has not been set!`);
			return;
		}
		try{
			const now = new Date();
			// Create "today 00:00:00"
			const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);

			const storageData = await this.solarEdgeApi.fetchStorageData(startOfDay, now);
			this.sendSocketNotification("STORAGEDATA", storageData);
			console.log(`node_helper ${this.name}: sent STORAGEDATA`);
		} catch (err) {
			console.error("Error fetching storage data:", err);
		}
	},
});
