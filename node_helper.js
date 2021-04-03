'use strict';

const NodeHelper = require('node_helper');
const request = require('request');
const axios = require('axios');

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
	productionSpan: {
		day: -1,
		firstProduction: '-',
		lastProduction: '-'
	},
	timerDiagram: undefined,

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
					self.fetchEnergyDetails();
				}, 60*60*1000); // Update production every hour

				self.timerDiagram = setInterval(function() {
					self.fetchDiagramData();
				}, 15*60*1000); // Update diagram every 15 minutes

				// run request 1st time
				self.fetchSiteDetails();
				self.throttler.forceExecute(() => self.fetchPowerFlow());
				self.fetchProduction();
				self.fetchEnergyDetails();
				self.fetchDiagramData();
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

	sumValuesFor: function(meter, meters) {
		var res = 0;
		for (var m=0; m<meters.length; m++){
			if (meters[m].type.toLocaleLowerCase() == meter.toLocaleLowerCase()) {
				for (var i=0; i<meters[m].values.length; i++){
					res += meters[m].values[i].value;
				}
				break;
			}
		}

		return res;
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

					var d = new Date();
					if (self.productionSpan.day != d.getDay()) {
						self.productionSpan.day = d.getDay();
						self.productionSpan.firstProduction = "-";
						self.productionSpan.lastProduction = "-";
					}
					if (self.productionSpan.firstProduction == "-" &&
					    powerflow.PV.currentPower > 0) {
						self.productionSpan.firstProduction = `${d.toLocaleTimeString()}`;
					}
					if (self.productionSpan.firstProduction != "-" &&
					    self.productionSpan.lastProduction == "-" &&
						powerflow.PV.currentPower <= 0 &&
						d.getHours() > 10) { // avoid initial jitter
						self.productionSpan.lastProduction = `${d.toLocaleTimeString()}`;
					}

					var powerflowReply = {
						powerflow: powerflow,
						productionSpan: self.productionSpan,
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

		if (!self.config){
			console.error(`node_helper ${self.name}:Configuration has not been set!`);
			return;
		}

		var siteDetailsUrl = `https://monitoringapi.solaredge.com/site/${self.config.siteId}/details`;

		axios.get(siteDetailsUrl, {
			params: {
				format: "application/json",
				api_key: self.config.apiKey,
			}})
		.then(res => {
			console.log(`node_helper ${self.name}: got SiteDetail data: ${JSON.stringify(res.data)}`);

			var reply = res.data;
			var details = reply.details;

			var siteDetailsReply = {
				name: details.name,
				peakPower: details.peakPower,
				maxPower: self.maxPower
			};

			self.sendSocketNotification("SITEDETAILS", siteDetailsReply);
			console.log(`node_helper ${self.name}: sent SiteDetails ${JSON.stringify(siteDetailsReply)}`);

		})
		.catch(err => {
			console.error(`node_helper ${self.name}: request returned error  ${err}`);
			self.sendSocketNotification("PVERROR", err);
		});
	},

	fetchEnergyDetails: function() {
		var self = this;

		if (!self.config){
			console.error(`node_helper ${self.name}:Configuration has not been set!`);
			return;
		}

		var today = new Date();
		var lastMonth = new Date(today - 30*24*60*60000);
		var startTime = lastMonth.toJSON().substr(0,10)+" 00:00:00";
		var endTime = new Date(today-24*60*60000).toJSON().substr(0,10)+" 23:59:59";
		var energyDetailsUrl = `https://monitoringapi.solaredge.com/site/${self.config.siteId}/energyDetails`;

		axios.get(energyDetailsUrl, {
			params: {
				format: "application/json",
				api_key: self.config.apiKey,
				timeUnit: "DAY",
				startTime: startTime,
				endTime: endTime
			}})
		.then(res => {

			console.log(`node_helper ${self.name}: got energy details data: ${JSON.stringify(res.data)}`);

			var reply = res.data;
			var energyDetails = reply.energyDetails;
			var selfConsumption = self.sumValuesFor("SelfConsumption", energyDetails.meters);
			var totalConsumption = self.sumValuesFor("Consumption", energyDetails.meters);

			var autarchyReply = {
				from: startTime,
				to: endTime,
				percentage: selfConsumption/totalConsumption
			};

			console.log(`node_helper ${self.name}: sent autarchy ${JSON.stringify(autarchyReply)}`);
			self.sendSocketNotification("AUTARCHY", autarchyReply);
		})
		.catch(err => {
			console.error(`node_helper ${self.name}: request returned error  ${err}`);
			self.sendSocketNotification("PVERROR", err);
		});
	},

	fetchDiagramData: function(){
		var self = this;

		var startTime = self.formatDateTimeForAPI(new Date(Date.now() - 24*60*60000)); // now - 24h
		var endTime = self.formatDateTimeForAPI(new Date());
		var inverterDataUrl = `https://monitoringapi.solaredge.com/equipment/${self.config.siteId}/${self.config.inverterId}/data`;
		var storageDataUrl = `https://monitoringapi.solaredge.com/site/${self.config.siteId}/storageData`;

		Promise.all([
			axios.get(inverterDataUrl, {
				params: {
					format: "application/json",
					api_key: self.config.apiKey,
					startTime: startTime,
					endTime: endTime
				}}),
			axios.get(storageDataUrl, {
				params: {
					format: "application/json",
					api_key: self.config.apiKey,
					startTime: startTime,
					endTime: endTime
				}}),
		])
		.then(res => {

			var inverterData = res[0].data;
			var storageData = res[1].data;

			var diagramReply = self.buildDiagramData(inverterData, storageData);

			console.log(`node_helper ${self.name}: sent diagram data ${JSON.stringify(diagramReply)}`);
			self.sendSocketNotification("DIAGRAMDATA", diagramReply);

		})
		.catch(err => {
			console.error(`node_helper ${self.name}: request returned error  ${err}`);
			self.sendSocketNotification("PVERROR", err);
		});
	},

	buildDiagramData: function(inverterData, storageData) {
		var self=this;

		var storageTimes = [];
		var storageValues = [];
		var tempTimes = [];
		var tempValues = [];

		for (var i=0; i<inverterData.data.telemetries.length; i++) {
			var telemetry = inverterData.data.telemetries[i];
			var roundedTime = self.roundApiTime(telemetry.date, 5); // Round to 5 Minute intervals
			tempTimes.push(roundedTime);
			tempValues.push(telemetry.temperature);
		}

		for (var i=0; i<storageData.storageData.batteries[0].telemetries.length; i++) {
			var telemetry = storageData.storageData.batteries[0].telemetries[i];
			var roundedTime = self.roundApiTime(telemetry.timeStamp, 5);
			storageTimes.push(roundedTime);
			storageValues.push(telemetry.batteryPercentageState);
		}

		// var tempStart = 40;
		// var storageStart = 100;

		// var resolution = 15;
		// for (var t=0; t <= 24 * 60; t+=resolution){
		// 	var h = Math.floor(t/60);
		// 	var m = t-h*60;
		// 	h = (h<10) ? `0${h}` : `${h}`;
		// 	m = (m<10) ? `0${m}` : `${m}`;
		// 	storageTimes.push(`${h}:${m}`);
		// 	tempTimes.push(`${h}:${m}`);

		// 	var dTemp = Math.random();
		// 	tempStart += (dTemp > 0.5) ? 1 : -1;
		// 	var dStorage = Math.random();
		// 	storageStart += (dStorage > 0.5) ? 5 : -5;

		// 	storageStart = Math.min(100, Math.max(0, storageStart));
		// 	storageValues.push(storageStart);
		// 	tempStart = Math.min(60, Math.max(15, tempStart));
		// 	tempValues.push(tempStart);
		// }

		var diagramReply = {
			storageTimes: storageTimes,
			storageValues: storageValues,
			tempTimes: tempTimes,
			tempValues: tempValues
		};

		return diagramReply;
	},

	formatDateTimeForAPI: function(date) {
		var year = date.getFullYear();
		var month = date.getMonth()+1;
		month = month<10 ? `0${month}`:`${month}`;
		var day = date.getDate();
		day = day<10 ? `0${day}`:`${day}`;
		var hour = date.getHours();
		hour = hour<10 ? `0${hour}`:`${hour}`;
		var min = date.getMinutes();
		min = min<10 ? `0${min}`:`${min}`;

		return `${year}-${month}-${day} ${hour}:${min}:00`;
	},

	roundApiTime(apiDateTime, interval) {
		// apiDateTime is in the format "2021-04-02 02:37:41"
		var time = apiDateTime.substr(11,5);
		var hour = parseInt(time.substr(0,2));
		var min = parseInt(time.substr(3));
		var rounded = Math.floor(min/interval)*interval;

		return (rounded<10) ? `${hour}:0${rounded}` : `${hour}:${rounded}`;
	},
});
