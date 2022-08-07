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

				// run request 1st time
				self.fetchSiteDetails();
				self.throttler.forceExecute(() => self.fetchPowerFlow());
				self.fetchProduction();
				self.fetchEnergyDetails();
				self.fetchDiagramData();
				
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
	
	// fetchTeslaState: function() {
		// var self = this;

		// var vehiclesUrl = "https://owner-api.teslamotors.com/api/1/vehicles";
		// var oauthBearer = self.config.teslaOAuthToken;
		// var vehicleId = self.config.teslaVehicleId;

		// var state = "undefined";
		
		// axios.get(vehiclesUrl, {
			// params: {
				// format: "application/json"
			// },
			// headers: {
				// "Authorization": oauthBearer
			// }})
		// .then(res => {
			// console.log(`node_helper ${self.name}: got vehicle data: ${JSON.stringify(res.data)}`);

			// var reply = res.data;
			// for (var vehicle of reply.response) {
				// if (vehicle.id == vehicleId)
				// {
					// state = vehicle.state;
				// }
			// }
			// return state;
		// })
		// .catch(err => {
			// console.error(`node_helper ${self.name}: request for vehicleData returned error  ${err}`);
			// state = err;
			// return state;
		// });
		
// //		return state;
	// },
	
	fetchTeslaCharge: function() {
		var self = this;

		if (!self.config){
			console.error(`node_helper ${self.name}:Configuration has not been set!`);
			return;
		}

		var proc = spawn('/home/pi/tmp/tesla/bin/Debug/net5.0/QueryTesla', [], { cwd: '/home/pi/tmp/tesla/bin/Debug/net5.0' });
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
	},
});
