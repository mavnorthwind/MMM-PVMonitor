'use strict';

const NodeHelper = require('node_helper');
const request = require('request');
const Throttler = require("./Throttler.js");
const fs = require('fs');

module.exports = NodeHelper.create({
	config: undefined,
	timer: undefined,
	timerEnergy: undefined,
	throttler: undefined,
	maxPower: {
		value: 0.001,
		timestamp: new Date()
	},

	start: function() {
		var self = this;
		console.log(`node_helper ${self.name}: Starting module`);

		self.throttler = new Throttler();
		self.throttler.minimumTimeBetweenCalls = 60000;
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
	},
	
	socketNotificationReceived: function(notification, payload)	{
		var self = this;
		// console.log(`node_helper ${self.name}: socketNotification ${notification} received`);

		switch (notification) {
			case "CONFIG":
				self.config = payload;
				
				if (self.timer)
					clearInterval(self.timer);

				self.timer = setInterval(function() {
					self.throttler.execute(() => self.fetchPowerFlow(), (r) => console.log("PowerFlow update throttled:"+r));
				}, self.config.interval);
				console.log(`node_helper ${self.name}: interval set to ${self.config.interval}`);

				self.timerEnergy = setInterval(function() {
					self.fetchProduction();
				}, 60*60*1000); // Update production every hour

				// run request 1st time
				self.fetchSiteDetails();
				self.throttler.forceExecute(() => self.fetchPowerFlow());
				self.fetchProduction();
				break;
			case "USER_PRESENCE":
				console.log(`node_helper ${self.name}: USER_PRESENCE ${payload}`);
				if (payload)
					self.throttler.execute(() => self.fetchPowerFlow(), (r) => console.log("PowerFlow update throttled:"+r));
				break;
		}
	},

	findProductionForDay: function(day, values) {
		var prod = 0;

		values.forEach(v => {
			if (v.date.indexOf(day) >= 0)
				prod = v.value;
		});

		return prod;
	},

	fetchPowerFlow: function() {
		var self = this;
		//console.log(`node_helper ${self.name}: trying to get powerFlow`);

		try{
			if (!self.config)
				console.error(`node_helper ${self.name}:Configuration has not been set!`);

			var monitoringUrl = `https://monitoringapi.solaredge.com/site/${self.config.siteId}/currentPowerFlow?format=application/json&api_key=${self.config.apiKey}`;
			//console.log(`node_helper ${self.name}: get powerFlow from ${monitoringUrl}`);

			request({
				url: monitoringUrl,
				method: 'GET'
			}, function (error, response, body) {
				if (error) {
					console.error(`node_helper ${self.name}: Could not get PowerFlow: ${error}`);
					self.sendSocketNotification("PVERROR", error);
					return;
				}
				if (response.statusCode >= 400 && response.statusCode < 500) {
					console.error(`node_helper ${self.name}: request returned status ${response.statusCode}`);
					self.sendSocketNotification("PVERROR", body);
					return;
				}
				if (response.statusCode == 200) {
					console.log(`node_helper ${self.name}: got powerFlow data: ${JSON.stringify(response)}`);

					var reply = JSON.parse(body);
					var powerflow = reply.siteCurrentPowerFlow;

					if (self.maxPower.value < powerflow.PV.currentPower) {
						self.maxPower.value = powerflow.PV.currentPower;
						self.maxPower.timestamp = Date.now();
						fs.writeFileSync("maxPower.json", JSON.stringify(self.maxPower));
					}

					var powerflowReply = {
						powerflow: powerflow,
						requestCount: self.throttler.todaysCallCount
					};

					self.sendSocketNotification("POWERFLOW", powerflowReply);
					// console.log(`node_helper ${self.name}: sent powerflow ${JSON.stringify(powerflowReply)}`);
				}
			});
		} catch(ex)
		{
			console.error(`node_helper ${self.name}: error ${ex}`);
			self.sendSocketNotification("PVERROR", ex);
		}
	},

	fetchProduction: function() {
		var self = this;

		try{
			if (!self.config)
				console.error(`node_helper ${self.name}:Configuration has not been set!`);

			var today = new Date();
			var yesterday = new Date(Date.now() - 24*60*60000);
			var startDate = yesterday.toJSON().substr(0,10);
			var endDate = today.toJSON().substr(0,10);
			var monitoringUrl = `https://monitoringapi.solaredge.com/site/${self.config.siteId}/energy?format=application/json&api_key=${self.config.apiKey}&timeUnit=DAY&startDate=${startDate}&endDate=${endDate}`;

			request({
				url: monitoringUrl,
				method: 'GET'
			}, function (error, response, body) {
				if (error) {
					console.error(`node_helper ${self.name}: Could not get Production: ${error}`);
					self.sendSocketNotification("PVERROR", error);
					return;
				}
				if (response.statusCode >= 400 && response.statusCode < 500) {
					console.error(`node_helper ${self.name}: request returned status ${response.statusCode}`);
					self.sendSocketNotification("PVERROR", body);
					return;
				}
				if (response.statusCode == 200) {
					console.log(`node_helper ${self.name}: got energy data: ${JSON.stringify(response)}`);

					var reply = JSON.parse(body);
					var energy = reply.energy;
					var prodYesterday = self.findProductionForDay(startDate, energy.values);
					var prodToday = self.findProductionForDay(endDate, energy.values);

					var productionReply = {
						unit: energy.unit,
						productionToday: prodToday,
						productionYesterday: prodYesterday
					};

					self.sendSocketNotification("PRODUCTION", productionReply);
					// console.log(`node_helper ${self.name}: sent production ${JSON.stringify(productionReply)}`);
				}
			});
		} catch(ex)
		{
			console.error(`node_helper ${self.name}: error ${ex}`);
			self.sendSocketNotification("PVERROR", ex);
		}
	},

	fetchSiteDetails: function() {
		var self = this;

		try{
			if (!self.config)
				console.error(`node_helper ${self.name}:Configuration has not been set!`);

			var monitoringUrl = `https://monitoringapi.solaredge.com/site/${self.config.siteId}/details?format=application/json&api_key=${self.config.apiKey}`;

			request({
				url: monitoringUrl,
				method: 'GET'
			}, function (error, response, body) {
				if (error) {
					console.error(`node_helper ${self.name}: Could not get SiteDetails: ${error}`);
					self.sendSocketNotification("PVERROR", error);
					return;
				}
				if (response.statusCode >= 400 && response.statusCode < 500) {
					console.error(`node_helper ${self.name}: request returned status ${response.statusCode}`);
					self.sendSocketNotification("PVERROR", body);
					return;
				}
				if (response.statusCode == 200) {
					console.log(`node_helper ${self.name}: got SiteDetail data: ${JSON.stringify(response)}`);

					var reply = JSON.parse(body);
					var details = reply.details;

					var siteDetailsReply = {
						name: details.name,
						peakPower: details.peakPower,
						maxPower: self.maxPower
					};

					self.sendSocketNotification("SITEDETAILS", siteDetailsReply);
					console.log(`node_helper ${self.name}: sent SiteDetails ${JSON.stringify(siteDetailsReply)}`);
				}
			});
		} catch(ex)
		{
			console.error(`node_helper ${self.name}: error ${ex}`);
			self.sendSocketNotification("PVERROR", ex);
		}
	}

});
