'use strict';

const NodeHelper = require('node_helper');
const request = require('request');
const axios = require('axios');

const Throttler = require("./Throttler.js");
const fs = require('fs');
const SolaredgeAPI = require("./SolaredgeAPI.js");
const spawn = require('child_process').spawn;

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


	start: function() {
		var self = this;
		console.log(`node_helper ${self.name}: Starting module`);

		self.throttler = new Throttler();
		self.throttler.minimumTimeBetweenCalls = 5*60*1000;
		self.throttler.maxCallsPerDay = 300;
		self.throttler.setThrottleHours(22, 8);

		self.throttler.logThrottlingConditions();

		try {
			if (fs.existsSync("maxPower.json")) {
				self.maxPower = JSON.parse(fs.readFileSync("maxPower.json"));
			}
		} catch (ex)
		{
			console.error(`Error reading maxPower.json: ${ex}`);
			self.maxPower = { value: 0.001, timestamp: Date.now() };
		}
		
		self.teslaThrottler = new Throttler();
		self.teslaThrottler.minimumTimeBetweenCalls = 60*60*1000; // Once every 60 minutes
		self.teslaThrottler.setThrottleHours(22, 6);
		self.teslaThrottler.setOverrideThrottleCallback((t, reason) => {
			// Don't throttle while charging
			return (self.teslaData && self.teslaData.chargingState=="Charging");
		});
		self.teslaThrottler.logThrottlingConditions();
	},
	
	socketNotificationReceived: function(notification, payload)	{
		var self = this;

		switch (notification) {
			case "CONFIG":
				self.config = payload;
				
				self.solarEdgeApi = new SolaredgeAPI(self.config.siteId, self.config.apiKey, self.config.inverterId);

				if (self.timer)
					clearInterval(self.timer);

				self.timer = setInterval(function() {
					self.throttler.execute(() => self.fetchPowerFlow(), (r) => console.log("PowerFlow update throttled:"+r));
				}, self.config.interval);
				console.log(`node_helper ${self.name}: interval set to ${self.config.interval}`);

				self.timerEnergy = setInterval(function() {
					self.fetchProduction();
					self.fetchEnergyDetails();
				}, 60*60*1000); // Update production every hour

				self.timerDiagram = setInterval(function() {
					self.fetchDiagramData();
				}, 15*60*1000); // Update diagram every 15 minutes

				self.teslaTimer = setInterval(function() {
					self.teslaThrottler.execute(() => self.fetchTeslaCharge(), (r) => console.log("TeslaCharge update throttled:"+r));
				}, 5*60*1000);

				setInterval(function() {
					self.fetchSpotPrice();
				}, 15*60*1000); // Update spot prices each 15 minutes

				// run request 1st time
				self.fetchSiteDetails();
				self.throttler.forceExecute(() => self.fetchPowerFlow());
				self.fetchProduction();
				self.fetchEnergyDetails();
				self.fetchDiagramData();
				self.fetchSpotPrice();
				self.teslaThrottler.forceExecute(() => self.fetchTeslaCharge());
				break;
			case "USER_PRESENCE":
				console.log(`node_helper ${self.name}: USER_PRESENCE ${payload}`);
				if (payload)
					self.throttler.execute(() => self.fetchPowerFlow(), (r) => console.log("PowerFlow update throttled:"+r));
				break;
		}
	},

	// findProductionForDay: function(day, values) {
	// 	var prod = 0;

	// 	values.forEach(v => {
	// 		if (v.date.indexOf(day) >= 0)
	// 			prod = v.value;
	// 	});

	// 	return prod;
	// },

	// sumValuesFor: function(meter, meters) {
	// 	var res = 0;
	// 	for (var m=0; m<meters.length; m++){
	// 		if (meters[m].type.toLocaleLowerCase() == meter.toLocaleLowerCase()) {
	// 			for (var i=0; i<meters[m].values.length; i++){
	// 				res += meters[m].values[i].value;
	// 			}
	// 			break;
	// 		}
	// 	}

	// 	return res;
	// },

	fetchPowerFlow: async function() {
		var self = this;

		if (!self.config){
			console.error(`node_helper ${self.name}:Configuration has not been set!`);
			return;
		}

		const powerFlow = await self.solarEdgeApi.fetchCurrentPowerFlow();

		var d = new Date();
		self.productionSpan.day = d.getDay();
		self.productionSpan.firstProduction =
		self.productionSpan.lastProduction = "-";

		const powerflowReply = {
			powerflow: powerFlow,
			productionSpan: self.productionSpan,
			requestCount: self.throttler.todaysCallCount
		};

		self.sendSocketNotification("POWERFLOW", powerflowReply);
	},

	fetchProduction: async function() {
		var self = this;

		if (!self.config){
			console.error(`node_helper ${self.name}:Configuration has not been set!`);
			return;
		}

		const production = await self.solarEdgeApi.fetchProduction();
		self.sendSocketNotification("PRODUCTION", production);
	},

	fetchSiteDetails: async function() {
		var self = this;

		if (!self.config){
			console.error(`node_helper ${self.name}:Configuration has not been set!`);
			return;
		}

		const siteDetails = await self.solarEdgeApi.fetchSiteDetails();
		self.sendSocketNotification("SITEDETAILS", siteDetails);
	},

	fetchEnergyDetails: async function() {
		var self = this;

		if (!self.config){
			console.error(`node_helper ${self.name}:Configuration has not been set!`);
			return;
		}

		const autarchy = await self.solarEdgeApi.fetchAutarchy();
		self.sendSocketNotification("AUTARCHY", autarchy);
	},

	fetchDiagramData: async function() {
		var self = this;

		if (!self.config){
			console.error(`node_helper ${self.name}:Configuration has not been set!`);
			return;
		}

		const diagramData = await self.solarEdgeApi.fetchDiagramData();
		self.sendSocketNotification("DIAGRAMDATA", diagramData);
	},
	
	fetchTeslaCharge: function() {
		var self = this;
		
		try{
			if (!self.config){
				console.error(`node_helper ${self.name}:Configuration has not been set!`);
				return;
			}

			var proc = spawn('/home/mav/tesla/QueryTesla', ['-getCharge']); // create a symbolic link in ~/tesla to the output folder from the QueryTesla project!
			var out = "";
			var err = "";
			proc.stdout.on('data', function(data) { out += data; });
			proc.stderr.on('data', function(data) { console.error(data); err += data; });
			proc.on('exit', function() {
				if (err != "") {
					self.sendSocketNotification("TESLAERROR", err);
					console.log(`node_helper ${self.name}: sent error occurred during Tesla query: ${err}`);
				} else {
					var teslaData = JSON.parse(out);
					self.teslaData = teslaData;
					self.sendSocketNotification("TESLA", teslaData);
					console.log(`node_helper ${self.name}: sent teslaData ${JSON.stringify(teslaData)}`);
				}
			});
		} catch (err) {
			console.error("Error fetching Tesla charge status:", err);
		}
	},
	
	fetchSpotPrice: async function() {
		var self = this;
		console.log(`node_helper ${self.name}: fetchSpotPrice()`);

		try {
			const now = new Date();
			let start = new Date(now.setHours(now.getHours()-1)); // 1h ago
			let end = new Date(now.setDate(now.getDate()+1));
			end.setHours(23);
			end.setMinutes(59);
			end.setSeconds(59);
			
			const spotPriceUrl = `https://api.energy-charts.info/price?bzn=DE-LU&start=${start.toISOString()}&end=${end.toISOString()}`;
			console.debug(`Fetch spotPrices from: ${spotPriceUrl}`);
			const res = await axios.get(spotPriceUrl);
			var data = res.data;
			
			// Find current price
			data.price = data.price.map(p => p * 0.1); // Convert from €/MWh to ct/kWh

    		const nowUnixSeconds = Math.floor(Date.now() / 1000);

			let idx = -1;
			console.debug(`Searching through ${data.unix_seconds.length} prices/timestamps`);

			for (let i = 0; i < data.unix_seconds.length; i++) {
				if (data.unix_seconds[i] <= nowUnixSeconds && (idx === -1 || data.unix_seconds[i] > data.unix_seconds[idx])) {
					idx = i;
				}
			}

			data.unix_seconds = data.unix_seconds.map(ts => new Date(ts * 1000).toLocaleString()); // Convert from Unix Seconds to readable local time

			console.debug(`Found current price at ${idx}: ${data.unix_seconds[idx]} ${data.price[idx]}`);

			self.sendSocketNotification("SPOTPRICE", {
				currentSpotPrice: data.price[idx],
				priceUnit: "ct/kWh",
				lastUpdate: new Date()
			});
			
			// return {
				// currentSpotPrice: res.data.currentSpotPrice, // 6.2,
				// priceUnit: res.data.priceUnit, // "ct/kWh",
				// lastUpdate: res.data.lastUpdate // "2025-07-04T15:00:10.835Z"
			// };

		} catch(error) {
			console.error(`Request for spotPrice returned error  ${error}`);
		}
	},
});
