'use strict';

const NodeHelper = require('node_helper');
const request = require('request');
const axios = require('axios');

const Throttler = require("./Throttler.js");
const fs = require('fs');
const SolaredgeAPI = require("./SolaredgeAPI.js");
const SpotPrices = require("./SpotPrices.js");
const spawn = require('child_process').spawn;
const schedule = require('node-schedule');

module.exports = NodeHelper.create({
	config: undefined,
	timer: undefined,
	timerEnergy: undefined,
	throttler: undefined,
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


	start: function() {
		
		console.log(`node_helper ${this.name}: Starting module`);

		this.throttler = new Throttler();
		this.throttler.minimumTimeBetweenCalls = 5*60*1000;
		this.throttler.maxCallsPerDay = 300;
		this.throttler.setThrottleHours(22, 8);

		this.throttler.logThrottlingConditions();

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
		this.teslaThrottler.minimumTimeBetweenCalls = 60*60*1000; // Once every 60 minutes
		this.teslaThrottler.setThrottleHours(22, 6);
		this.teslaThrottler.setOverrideThrottleCallback((t, reason) => {
			// Don't throttle while charging
			return (this.teslaData && this.teslaData.chargingState=="Charging");
		});
		this.teslaThrottler.logThrottlingConditions();

		console.log(`node_helper ${this.name}: Started module`);
	},
	
	socketNotificationReceived: async function(notification, payload)	{
		switch (notification) {
			case "ENERGYCONFIG":
				this.config = payload;
				
				try {
					console.log("Creating SolaredgeAPI instance");
					this.solarEdgeApi = new SolaredgeAPI(this.config.siteId, this.config.apiKey, this.config.inverterId);

					setInterval(async () => {
						console.log("Scheduled job: Fetching storage data at " + new Date().toLocaleTimeString());
						await this.fetchStorageDataAsync();
					}, 15*60*1000);
				} catch (error) {
					console.error(`Error creating SolaredgeAPI instance: ${error}`);
				}

				try {
					console.log("Creating SpotPrices instance");
					this.spotPrices = new SpotPrices();

					if (!this.spotPrices.hasPrices || this.spotPrices.maxDate < new Date()) // No or old prices
					{
						console.log("Fetching spot prices");
						await this.spotPrices.updateSpotPricesAsync();
					}

					
					schedule.scheduleJob('3 17 * * *', async () => { // Every day at 17:03
						console.log(`Scheduled job: Fetching spot prices at ${new Date().toLocaleTimeString()}`);
						await this.spotPrices.updateSpotPricesAsync(0,1);
					});
					
					// update spot prices every 15 minutes - cheap since we do caching
					setInterval(async () => {
					 	await this.fetchSpotPriceAsync();
					}, 15*60*1000);

				} catch(error) {
					console.error(`Request for spotPrice returned error  ${error}`);
				}
/*
				if (this.timer)
					clearInterval(this.timer);

				this.timer = setInterval(function() {
					this.throttler.execute(() => this.fetchPowerFlow(), (r) => console.log("PowerFlow update throttled:"+r));
				}, this.config.interval);
				console.log(`node_helper ${this.name}: interval set to ${this.config.interval}`);

				this.timerEnergy = setInterval(function() {
					this.fetchProduction();
					this.fetchEnergyDetails();
				}, 60*60*1000); // Update production every hour

				this.timerDiagram = setInterval(function() {
					this.fetchDiagramData();
				}, 15*60*1000); // Update diagram every 15 minutes

				this.teslaTimer = setInterval(function() {
					this.teslaThrottler.execute(() => this.fetchTeslaCharge(), (r) => console.log("TeslaCharge update throttled:"+r));
				}, 5*60*1000);

				setInterval(function() {
					this.fetchSpotPrice();
				}, 4*60*60*1000); // Update spot prices every 4 hours - enough since we do caching

				// run request 1st time
				this.fetchSiteDetails();
				this.throttler.forceExecute(() => this.fetchPowerFlow());
				this.fetchProduction();
				this.fetchEnergyDetails();
				this.fetchDiagramData();
				this.fetchSpotPrice();
				this.teslaThrottler.forceExecute(() => this.fetchTeslaCharge());
*/
				break;

			case "GETSTORAGEDATA":
				console.log(`node_helper ${this.name}: GETSTORAGEDATA`);
				await this.fetchStorageDataAsync();
				break;
			case "GETSPOTPRICE":
				console.log(`node_helper ${this.name}: GETSPOTPRICE`);
				await this.fetchSpotPriceAsync();
				break;
			case "GETSITEDETAILS":
				console.log(`node_helper ${this.name}: GETSITEDETAILS`);
				await this.fetchSiteDetailsAsync();
				break;

			case "USER_PRESENCE":
				console.log(`node_helper ${this.name}: USER_PRESENCE ${payload}`);
				if (payload) // User is present
				{
					// Will be too often
					//await this.fetchStorageDataAsync();
					await this.fetchSpotPriceAsync();
				}
				break;
		}
	},



	fetchPowerFlow: async function() {
		

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
			requestCount: this.throttler.todaysCallCount
		};

		this.sendSocketNotification("POWERFLOW", powerflowReply);
	},

	fetchProduction: async function() {
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

	fetchDiagramDataAsync: async function() {
		console.log(`node_helper ${this.name}: fetchDiagramDataAsync()`);

		if (!this.config){
			console.error(`node_helper ${this.name}: Configuration has not been set!`);
			return;
		}

		try {
			const diagramData = await this.solarEdgeApi.fetchDiagramData();
			this.sendSocketNotification("DIAGRAMDATA", diagramData);
			console.log(`node_helper ${this.name}: sent DIAGRAMDATA`);
		} catch (err) {
			console.error("Error fetching diagram data:", err);
		}
	},
	
	fetchTeslaCharge: function() {
		console.log(`node_helper ${this.name}: fetchTeslaCharge()`);

		if (!this.config){
			console.error(`node_helper ${this.name}:Configuration has not been set!`);
			return;
		}

		try{
			var proc = spawn('/home/mav/tesla/QueryTesla', ['-getCharge']); // create a symbolic link in ~/tesla to the output folder from the QueryTesla project!
			var out = "";
			var err = "";
			proc.stdout.on('data', function(data) { out += data; });
			proc.stderr.on('data', function(data) { console.error(data); err += data; });
			proc.on('exit', function() {
				if (err != "") {
					throw err;
				} else {
					var teslaData = JSON.parse(out);
					this.teslaData = teslaData;
					this.sendSocketNotification("TESLA", teslaData);
					console.log(`node_helper ${this.name}: sent TESLA`);
				}
			});
		} catch (err) {
			console.error("Error fetching Tesla charge status:", err);
		}
	},
	
	/**
	 * Sends current spot price data to the module.
	 * Does NOT fetch new data; update is done periodically elsewhere.
	 */
	fetchSpotPriceAsync: async function() {
		console.log(`node_helper ${this.name}: fetchSpotPriceAsync()`);

		try {
			this.sendSocketNotification("SPOTPRICE", {
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
			console.log(`node_helper ${this.name}: sent SPOTPRICE`);
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
