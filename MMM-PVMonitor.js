/* global Module */
Module.register("MMM-PVMonitor",{
	// Default module config.
	defaults: {
		siteId: "123456",
		inverterId: "12345678-9A",
		apiKey: "INSERT-API-KEY-HERE",
		interval: 1000*60*15
	},

	powerFlow: undefined,
	energy: undefined,
	autarchy: undefined,
	timestamp: undefined,
	requestCount: 0,
	lastError: undefined,
	html: "Loading...",
	siteDetails: {
		name: "Unknown",
		peakPower: 1.0,
		maxPower: {
			value: 0.001,
			timestamp: Date.now()
		}
	},
	
	productionSpan: {
		day: new Date(),
		firstProduction: "unknown",
		lastProduction: "unknown"
	},

	// diagram data
	storageTimes: [],
	storageValues: [],
	tempTimes: [],
	tempValues: [],
	
	// Tesla data
	teslaData: undefined,

	// SpotPrice
	spotPrice: undefined,


	start: function() {

		// var config = {
		// 	siteId: "INSERTSITEID",
		// 	inverterId: "INSERTINVERTERID",
		// 	apiKey: "INSERTAPIKEY",
		// 	interval: 30*60*1000, // update each 30 minutes
		// 	pMax: 7.945, // nominal power (kWp)
		// 	teslaOAuthToken: "Bearer INSERTOAUTHBEARERTOKEN",
		//	teslaVehicleId: "INSERTVEHICLEID"
		// };

		var self = this;
		console.log(`Starting module: ${self.name} with config ${JSON.stringify(self.config)}`);
		
		self.sendSocketNotification('CONFIG', self.config);
	},
	
	notificationReceived: function(notification, payload, sender) {
		var self = this;

		if (notification === "USER_PRESENCE") { // relay to node_helper to update data
			console.log(`Module ${self.name}: socketNotification ${notification} received - relay to helper`);
			self.sendSocketNotification("USER_PRESENCE", payload)
		}
	},

	socketNotificationReceived: function(notification, payload) {
		var self = this;
		console.log(`Module ${self.name}: socketNotification ${notification} with payload ${JSON.stringify(payload)} received`);

		if (notification === "SITEDETAILS") {
			self.siteDetails = payload;
		}

		if (notification === "POWERFLOW") {
			self.lastError = undefined;
			self.powerFlow = payload.powerflow;
			self.requestCount = payload.requestCount;
			self.productionSpan = payload.productionSpan;
			self.timestamp = new Date();
			if (self.powerFlow.PV.currentPower >= self.siteDetails.maxPower.value) {
				self.siteDetails.maxPower.value = self.powerFlow.PV.currentPower;
				self.siteDetails.maxPower.timestamp = Date.now();
				console.log(`Module ${self.name}: New max power ${self.siteDetails.maxPower.value} ${self.powerFlow.unit} at ${new Date(self.siteDetails.maxPower.timestamp).toLocaleString()}`);
			}
			self.updateDom(0);
		}

		if (notification === "PRODUCTION") {
			self.lastError = undefined;
			self.energy = payload;
			self.updateDom(0);
		}

		if (notification === "AUTARCHY") {
			self.lastError = undefined;
			self.autarchy = payload;
			self.updateDom(0);
		}

		if (notification === "DIAGRAMDATA") {
			self.lastError = undefined;
			self.tempTimes = payload.tempTimes;
			self.tempValues = payload.tempValues;
			self.storageTimes = payload.storageTimes;
			self.storageValues = payload.storageValues;
			self.updateDom(0);
		}
		
		if (notification === "TESLA") {
			//console.log("TESLA Data received: "+JSON.stringify(payload));
			self.teslaData = payload;
			self.updateDom(0);
		}
				
		if (notification === "SPOTPRICE") {
			self.spotPrice = payload;
			self.updateDom(0);
		}

		if (notification === "USER_RESENCE" && payload == true) {
			self.updateDom(500);
		}

		if (notification === "PVERROR" ||
			notification === "TESLAERROR") {
			//self.powerFlow = undefined;
			self.lastError = payload;
			//self.timestamp = new Date();
			self.updateDom(0);
		}
	},

	getComponentImage: function(component, powerFlow) {
		var self = this;
		var status = "";
		switch (component) {
			case "PV":
				status = powerFlow.PV.status;
				if (status === "Active") {
					var amount = powerFlow.PV.currentPower / self.siteDetails.maxPower.value;
					if (amount < 0.1) status = "Active_0";
					else if (amount < 0.25) status = "Active_25";
					else if (amount < 0.5) status = "Active_50";
					else if (amount < 0.75) status = "Active_75";
					else status = "Active_100";
				}
				break;
			case "Load":
				status = powerFlow.LOAD.status;
				break;
			case "Grid":
				status = powerFlow.GRID.status;
				break;
			default:
				console.error(`Unknown component ${component}`);
		}

		return self.file(`Images/${component}${status}.svg`);
	},

	getStorageImage: function(powerFlow) {
		var self = this;
		var file;
		if (powerFlow.STORAGE) {
			var level = Math.round(powerFlow.STORAGE.chargeLevel/10) * 10;
			if (level == 0)
				level = "00";
			file = `Images/EL_${level}`;
		} else {
			file = "Images/Empty";
		}

		// if (self.hasFlow(powerFlow, "PV", "STORAGE") ||
		// 	self.hasFlow(powerFlow, "GRID", "STORAGE"))
		// 	file += "_charge";
		// else if (self.hasFlow(powerFlow, "STORAGE", "LOAD") ||
		// 		 self.hasFlow(powerFlow, "STORAGE", "GRID"))
		// 	file += "_discharge";
		
		file += ".svg";

		return self.file(file);
	},

	hasFlow: function(powerFlow, from, to) {
		var i;
		
		from = from.toLocaleLowerCase();
		to = to.toLocaleLowerCase();

		for (i=0; i<powerFlow.connections.length; i++) {
			if (powerFlow.connections[i].from.toLocaleLowerCase() === from &&
				powerFlow.connections[i].to.toLocaleLowerCase() === to)
				return true;
		}
		return false;
	},

	beautifyPower(value, unit) {
		if (unit.toLocaleLowerCase() === "kw" && value < 1.0) {
			value = value * 1000;
			unit = "W";
		}

		return `${value} ${unit}`;
	},

	beautifyEnergy(value, unit) {
		if (unit.toLocaleLowerCase() === "wh" && value > 1000) {
			value = Math.round(value/100)/10;
			unit = "kWh";
		}

		return `${value} ${unit}`;
	},

	fillTableTemplate: function(powerFlow) {
		var self = this;

		// as a test, add a STORAGE object
		// powerFlow.STORAGE = {
		// 	"status": "Idle",
		// 	"currentPower": 0.3,
		// 	"chargeLevel": 27,
		// 	"critical": false
		// };

		var hasStorage = false;
		if (powerFlow.STORAGE) hasStorage = true;
		var storageClass = hasStorage ? "on" : "off";
		var storageCharge = hasStorage ? powerFlow.STORAGE.chargeLevel : "n/a";
		var storagePower = hasStorage ? self.beautifyPower(powerFlow.STORAGE.currentPower, powerFlow.unit) : "0";
		var pvImage = self.getComponentImage("PV", powerFlow);
		var loadImage = self.getComponentImage("Load", powerFlow);
		var gridImage = self.getComponentImage("Grid", powerFlow);
		var storageImage = self.getStorageImage(powerFlow);
		var chargingImage = self.file("Images/Battery_Charging.svg");
		var chargingClass = "discharging";
		if (hasStorage && powerFlow.STORAGE.status === "Charging")
			chargingClass = "chargingImage";
		var arrowDownImage = self.file("Images/Arrow_Down_G.svg");
		var arrowLeftImage = self.file("Images/Arrow_Left_O.svg");
		var arrowRightImage = self.file("Images/Arrow_Right_G.svg");
		var arrowRightDownImage = self.file("Images/Arrow_RightDown_G.svg");
		var arrowRightUpImage = self.file("Images/Arrow_RightUp_G.svg");

		var flowPV2STORAGE = self.hasFlow(powerFlow, "PV", "STORAGE") ? "" : "off";
		var flowPV2LOAD = self.hasFlow(powerFlow, "PV", "Load") ? "" : "off";
		var flowGRID2LOAD = self.hasFlow(powerFlow, "GRID", "Load") ? "" : "off";
		var flowLOAD2GRID = self.hasFlow(powerFlow, "Load", "GRID") ? "" : "off";
		var flowSTORAGE2LOAD = self.hasFlow(powerFlow, "STORAGE", "LOAD") ? "" : "off";

		var productionToday = self.energy ? `${self.beautifyEnergy(self.energy.productionToday, self.energy.unit)}` : "?";
		var productionYesterday = self.energy ? `${self.beautifyEnergy(self.energy.productionYesterday, self.energy.unit)}` : "?";

		var autarchy = self.autarchy ? Math.round(self.autarchy.percentage * 100) : "?";

		var teslaImage = self.file("Images/Tesla_Model3_red.svg");
		const milesToKm = 1.609344;
		var teslaBatteryLevel = self.teslaData ? self.teslaData.batteryLevel : "?";
		var teslaBatteryRange = self.teslaData ? Math.round(self.teslaData.batteryRange * milesToKm) : "?";
		var teslaEstimatedBatteryRange = self.teslaData ? Math.round(self.teslaData.estimatedBatteryRange * milesToKm) : "?";
		var teslaTimestamp = self.teslaData ? new Date(self.teslaData.timestamp).toLocaleTimeString() : "?";
		var teslaChargingState = self.teslaData ? self.teslaData.chargingState : "?";
		var teslaState = self.teslaData ? self.teslaData.state : "?";
		var teslaMinutesToFullCharge = self.teslaData ? self.teslaData.minutesToFullCharge : 0;
		var teslaChargePower = self.teslaData ? self.teslaData.chargerPower : 0;
		var teslaChargeCurrent = self.teslaData ? self.teslaData.chargerActualCurrent : 0;
		var lasterror = self.lastError ? self.lastError.message : "";
		var teslaChargeClass = self.teslaData ? (self.teslaData.chargingState=="Charging" ? "" : "off") : "off";

		// Format Spot Prices
		var spotPriceText = "UNKNOWN";
		try{
			spotPriceText = `${self.spotPrice.currentSpotPrice} ${self.spotPrice.priceUnit} (${new Date(self.spotPrice.lastUpdate).toLocaleTimeString()})`;
		} catch (err) {
			console.error("Error updating spot price:",err);
			spotPriceText = err;
		}


		var template = 
		`<table>
            <tr>
                <th class="MMPV_TH">${self.beautifyPower(powerFlow.PV.currentPower, powerFlow.unit)}</th>
                <th class="MMPV_TH">${self.beautifyPower(powerFlow.LOAD.currentPower, powerFlow.unit)}</th>
                <th class="MMPV_TH">${self.beautifyPower(powerFlow.GRID.currentPower, powerFlow.unit)}</th>
            </tr>
            <tr>
                <td class="MMPV_TD">
                    <span class="${flowPV2STORAGE} overlayBelow"><img src="${arrowDownImage}" /></span>
                    <span class="${flowPV2LOAD} overlayRight"><img src="${arrowRightDownImage}" /></span>
                    <img src="${pvImage}" />
                </td>
                <td class="MMPV_TD"><img src="${loadImage}" /></td>
                <td class="MMPV_TD" rowspan="2">
                    <span class="${flowGRID2LOAD} overlayLeft"><img src="${arrowLeftImage}" /></span>
                    <span class="${flowLOAD2GRID} overlayLeft"><img src="${arrowRightImage}" /></span>
                    <img src="${gridImage}" />
					<span class="spotPrice">${spotPriceText}</span>
                </td>
            </tr>
            <tr>
                <td class="MMPV_TD ${storageClass}">
					<span class="${flowSTORAGE2LOAD} overlayRight"><img src="${arrowRightUpImage}" /></span>
					<img class="storageImage" src="${storageImage}" />
					<img class="${chargingClass}" src="${chargingImage}" />
					<div class="percentage">${storageCharge} %</div>
					<div class="storagePower">${storagePower}</div>
                </td>
				<td class="MMPV_TD">
					<span class="${teslaChargeClass} chargeAbove teslaCharge">Charge ${teslaChargeCurrent}A/${teslaChargePower}kW</span>
					<img src="${teslaImage}" width="96px"/>
					<span class="teslaCharge">${teslaBatteryLevel}% / ${teslaBatteryRange}(${teslaEstimatedBatteryRange})km</span>
				</td>
            </tr>
        </table>
		<div id="diagram" class="diagram">
		</div>
		<div class="summary">
			Stand: ${self.timestamp.toLocaleTimeString()}; Produktion heute: ${productionToday} (gestern ${productionYesterday})
		</div>
		<div class="summary" style="display:none">
			PeakPower ${self.siteDetails.peakPower} kW (max ${self.siteDetails.maxPower.value} kW am ${new Date(self.siteDetails.maxPower.timestamp).toLocaleString()})
		</div>
		<div class="summary" style="display:none">
			Produktion heute von ${self.productionSpan.firstProduction} bis ${self.productionSpan.lastProduction}
		</div>
		<div class="summary">
			Autarkie der letzten 30 Tage: ${autarchy} %
		</div>
		<div class="summary">
			Ladestatus: ${teslaChargingState}; noch ${teslaMinutesToFullCharge} Min. (Stand: ${teslaTimestamp})
		</div>
		<div class="lasterror">
			${lasterror}
		</div>
		`;

		return template;
	},

	getStyles: function() {
		return [ "MMM-PVMonitor.css" ];
	},

	// Override dom generator.
	getDom: function() {
		var self = this;
		var wrapper = document.createElement("div");
		
		// wrapper.innerHTML = `<div class="error">Last error: ${JSON.stringify(self.lastError)}</div><div class="error">Received ${self.timestamp}</div>`;
		if (self.powerFlow) {
			self.html = self.fillTableTemplate(self.powerFlow);
			wrapper.innerHTML = self.html;
			// We must defer drawing the diagram until the DOM has been updated to contain the target div!
			setTimeout(() => self.drawDiagram(), 100);
		} else {
			wrapper.innerHTML = "Loading... ";
		}
		return wrapper;
	},

	getScripts: function() {
		return [
			"https://cdn.plot.ly/plotly-latest.min.js"
		];
	},

	drawDiagram: function() {
		var self = this;

		var dia = document.getElementById("diagram");
		if (dia) {
			var storage = {
				x: self.storageTimes,
				y: self.storageValues,
				type: 'scatter',
				name: "SoC",
				fill: 'tozeroy',
				line: {
				  color: "1F77B4",
				  shape: "spline"
				}
			  };
			  var temp = {
				x: self.tempTimes,
				y: self.tempValues,
				type: 'scatter',
				name: "Temp",
				mode: 'lines',
				line: {
				  color: '#F80',
				  width: 2,
				  shape: "spline" 
				},
				yaxis: "y2"
			  };
			  
			  var data = [storage, temp];
			  
			  var layout = {
				plot_bgcolor:"#111",
				paper_bgcolor:"#000",
				  showlegend: true,
				legend: {
				  x: 0,
				  xanchor: 'left',
				  y: 1,
				  bgcolor: '#0008',
				  font: {
					  size: 8
				  }
				},
				margin: {
				  l: 20,
				  r: 20,
				  t: 10,
				  b: 20
				},
				font: {
				  color: "#AAA"
				},
				xaxis: {
					tickmode: "array", // If "array", the placement of the ticks is set via `tickvals` and the tick text is `ticktext`.
					tickvals: [0, 12*3, 24*3, 36*3, 48*3, 60*3, 72*3, 84*3, 95*3],
				},
				yaxis: {
				  range: [0,100],
				  tickmode: "array", // If "array", the placement of the ticks is set via `tickvals` and the tick text is `ticktext`.
				  tickvals: [0, 10, 25, 50, 75, 100],
				  tickfont: {color:'#1F77B4', size:8},
				  ticksuffix: "%",
				//   gridcolor: '#88F',
				},
				yaxis2: {
					range: [20,60],
					overlaying: 'y',
					tickfont: {color:'#F80', size:8},
					side: "right",
					ticksuffix: "°C",
				  },
				shapes: [
					{ // Threshold for 10% battery
						type: 'line',
						xref: 'paper',
						x0: 0,
						y0: 10.0,
						x1: 1,
						y1: 10.0,
						line:{
							color: '#F008',
							width: 3,
							dash:'dash'
						}
					}
				]
			  };
			  
			  
			  Plotly.newPlot('diagram', data, layout, {staticPlot: true});
		}
	}
});
