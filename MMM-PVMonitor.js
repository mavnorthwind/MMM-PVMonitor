
// Used to access datasets in the chart
const DataSetIndices = Object.freeze({
	CurrentPrice: 0,
	MinPrice: 1,
	MaxPrice: 2,
	SpotPrices: 3,
	Storage: 4, // Must be behind all others to be drawn in the background
});


/* global Module */
Module.register("MMM-PVMonitor", {
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

	// Tesla data
	teslaData: undefined,

	// SpotPrices
	spotPrices: undefined,
	
	storageData: undefined,

	// Chart wrapper
	chartWrapper: undefined,

	// The SoC/spot price diagram
	chart: undefined,


	// Sent once after module registration.
	// Init state, start times, send first socket notification to node_helper.
	start: function() {
		console.log(`Starting module: ${this.name} with config ${JSON.stringify(this.config)}`);
		
		this.sendSocketNotification('ENERGYCONFIG', this.config);

		this.updateDom(); // Create basic DOM structure

		// Create the diagram after a short delay to ensure the DOM is ready
		setTimeout(() => {
			this.chart = this.buildChart();
			console.log(`Chart created: ${this.chart}`);

			// Initial update
			this.sendSocketNotification("GETSTORAGEDATA"); // Will trigger an update of the diagram when data is received
			this.sendSocketNotification("GETSPOTPRICES"); // Will trigger an update of the diagram when data is received

			this.sendSocketNotification("GETTESLACHARGE");
		}, 1000);

	},
	
	// Global notification from MM itself or other modules.
	notificationReceived: function(notification, payload, sender) {
		
		if (notification === "DOM_OBJECTS_CREATED") { // All modules' initial getDom() completed
		}
		
		if (notification === "USER_PRESENCE") { // relay to node_helper to update data
			console.log(`Module ${this.name}: socketNotification ${notification} received - relay to helper`);
			this.sendSocketNotification("USER_PRESENCE", payload)
		}
	},

	socketNotificationReceived: function(notification, payload) {
		console.log(`Module ${this.name}: socketNotification ${notification} with payload ${JSON.stringify(payload)} received`);

		if (notification === "SITEDETAILS") {
			this.siteDetails = payload;
		}

		if (notification === "POWERFLOW") {
			this.lastError = undefined;
			this.powerFlow = payload.powerflow;
			this.requestCount = payload.requestCount;
			this.productionSpan = payload.productionSpan;
			this.timestamp = new Date();
			if (this.powerFlow.PV.currentPower >= this.siteDetails.maxPower.value) {
				this.siteDetails.maxPower.value = this.powerFlow.PV.currentPower;
				this.siteDetails.maxPower.timestamp = Date.now();
				console.log(`Module ${this.name}: New max power ${this.siteDetails.maxPower.value} ${this.powerFlow.unit} at ${new Date(this.siteDetails.maxPower.timestamp).toLocaleString()}`);
			}

			this.updatePowerFlowTable();
		}

		if (notification === "PRODUCTION") {
			this.lastError = undefined;
			this.energy = payload;
			this.updateDom(0);
		}

		if (notification === "AUTARCHY") {
			this.lastError = undefined;
			this.autarchy = payload;

			this.updateSummary();
		}
		
		if (notification === "TESLA") {
			this.teslaData = payload;
			this.updateDom(0);
		}
				
		if (notification === "SPOTPRICES") {
			this.spotPrices = payload;
			console.log("SPOTPRICES received:", this.spotPrices);

			const spotPriceDataset = [];
			this.spotPrices.prices.forEach((val, index, array) => {
				spotPriceDataset.push({ x:this.spotPrices.dates[index], y: val });
			});

			this.setChartData(DataSetIndices.SpotPrices, spotPriceDataset);

			this.setChartData(DataSetIndices.CurrentPrice, [{ x: this.spotPrices.currentPriceDate, y: this.spotPrices.currentPrice }], `Current: ${this.spotPrices.currentPrice}ct`);
			this.setChartData(DataSetIndices.MinPrice, [{ x: this.spotPrices.minTodayPriceDate, y: this.spotPrices.minTodayPrice }], `Min: ${this.spotPrices.minTodayPrice}ct`);
			this.setChartData(DataSetIndices.MaxPrice, [{ x: this.spotPrices.maxTodayPriceDate, y: this.spotPrices.maxTodayPrice }], `Max: ${this.spotPrices.maxTodayPrice}ct`);
		}

		if (notification === "STORAGEDATA") {
			this.storageData = payload;
			console.log("STORAGEDATA received:", this.storageData);

			const storageDataset = [];
			this.storageData.forEach((val, index, array) => {
				storageDataset.push({ x: new Date(val.timeStamp), y: val.socPercent });
			});

			this.setChartData(DataSetIndices.Storage, storageDataset);
		}

		if (notification === "USER_PRESENCE" && payload == true) {
			this.updateDom(500);
		}

		if (notification === "PVERROR" ||
			notification === "TESLAERROR") {
			//this.powerFlow = undefined;
			this.lastError = payload;
			//this.timestamp = new Date();
			this.updateDom(0);
		}
	},


	getComponentImage: function(component, powerFlow) {
		var status = "";
		switch (component) {
			case "PV":
				status = powerFlow.PV.status;
				if (status === "Active") {
					var amount = powerFlow.PV.currentPower / this.siteDetails.maxPower.value;
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

		return this.file(`Images/${component}${status}.svg`);
	},

	getStorageImage: function(powerFlow) {
		var file;
		if (powerFlow.STORAGE) {
			var level = Math.round(powerFlow.STORAGE.chargeLevel/10) * 10;
			if (level == 0)
				level = "00";
			file = `Images/EL_${level}.svg`;
		} else {
			file = "Images/Empty.svg";
		}

		return this.file(file);
	},

	hasFlow: function(powerFlow, from, to) {
		from = from.toLocaleLowerCase();
		to = to.toLocaleLowerCase();

		for (var i=0; i<powerFlow.connections.length; i++) {
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

	/**
 	* Fills the HTML table template with current power flow data.
	 * @param {*} powerFlow 
	 * @returns The filled HTML table as string.
	 */
	fillTableTemplate: function(powerFlow) {
		try{
			var hasStorage = false;
			if (powerFlow.STORAGE) hasStorage = true;
			var storageClass = hasStorage ? "on" : "off";
			var storageCharge = hasStorage ? powerFlow.STORAGE.chargeLevel : "n/a";
			var storagePower = hasStorage ? this.beautifyPower(powerFlow.STORAGE.currentPower, powerFlow.unit) : "0";
			var pvImage = this.getComponentImage("PV", powerFlow);
			var loadImage = this.getComponentImage("Load", powerFlow);
			var gridImage = this.getComponentImage("Grid", powerFlow);
			var storageImage = this.getStorageImage(powerFlow);
			var chargingImage = this.file("Images/Battery_Charging.svg");
			var chargingClass = "discharging";
			if (hasStorage && powerFlow.STORAGE.status === "Charging")
				chargingClass = "chargingImage";
			var arrowDownImage = this.file("Images/Arrow_Down_G.svg");
			var arrowLeftImage = this.file("Images/Arrow_Left_O.svg");
			var arrowRightImage = this.file("Images/Arrow_Right_G.svg");
			var arrowRightDownImage = this.file("Images/Arrow_RightDown_G.svg");
			var arrowRightUpImage = this.file("Images/Arrow_RightUp_G.svg");

			var flowPV2STORAGE = this.hasFlow(powerFlow, "PV", "STORAGE") ? "" : "off";
			var flowPV2LOAD = this.hasFlow(powerFlow, "PV", "Load") ? "" : "off";
			var flowGRID2LOAD = this.hasFlow(powerFlow, "GRID", "Load") ? "" : "off";
			var flowLOAD2GRID = this.hasFlow(powerFlow, "Load", "GRID") ? "" : "off";
			var flowSTORAGE2LOAD = this.hasFlow(powerFlow, "STORAGE", "LOAD") ? "" : "off";

			var teslaImage = this.file("Images/Tesla_Model3_red.svg");
			const milesToKm = 1.609344;
			var teslaBatteryLevel = this.teslaData ? this.teslaData.batteryLevel : "?";
			var teslaBatteryRange = this.teslaData ? Math.round(this.teslaData.batteryRange * milesToKm) : "?";
			var teslaEstimatedBatteryRange = this.teslaData ? Math.round(this.teslaData.estimatedBatteryRange * milesToKm) : "?";

			var teslaChargePower = this.teslaData ? this.teslaData.chargerPower : 0;
			var teslaChargeCurrent = this.teslaData ? this.teslaData.chargerActualCurrent : 0;
			var teslaChargeClass = this.teslaData ? (this.teslaData.chargingState=="Charging" ? "" : "off") : "off";

			var template = 
			`<table>
				<tr>
					<th class="MMPV_TH">${this.beautifyPower(powerFlow.PV.currentPower, powerFlow.unit)}</th>
					<th class="MMPV_TH">${this.beautifyPower(powerFlow.LOAD.currentPower, powerFlow.unit)}</th>
					<th class="MMPV_TH">${this.beautifyPower(powerFlow.GRID.currentPower, powerFlow.unit)}</th>
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
			</table>`;

			return template;
		} catch (err) {
			console.error("Error building table:", err);
			return `<div class="lastError">Error building table: ${err}</div>`;
		}
	},

	fillSummary: function(powerFlow) {
		try {
			var productionToday = this.energy ? `${this.beautifyEnergy(this.energy.productionToday, this.energy.unit)}` : "?";
			var productionYesterday = this.energy ? `${this.beautifyEnergy(this.energy.productionYesterday, this.energy.unit)}` : "?";

			var autarchy = this.autarchy ? Math.round(this.autarchy.percentage * 100) : "?";

			var teslaTimestamp = this.teslaData ? new Date(this.teslaData.timestamp).toLocaleTimeString() : "?";
			var teslaChargingState = this.teslaData ? this.teslaData.chargingState : "?";
			var teslaState = this.teslaData ? this.teslaData.state : "?";
			var teslamaxutesToFullCharge = this.teslaData ? this.teslaData.maxutesToFullCharge : 0;

			const summary =
			`<div class="summary">
				Stand: ${this.timestamp.toLocaleTimeString()}; Produktion heute: ${productionToday} (gestern ${productionYesterday})
			</div>
			<div class="summary" style="display:none">
				PeakPower ${this.siteDetails.peakPower} kW (max ${this.siteDetails.maxPower.value} kW am ${new Date(this.siteDetails.maxPower.timestamp).toLocaleString()})
			</div>
			<div class="summary" style="display:none">
				Produktion heute von ${this.productionSpan.firstProduction} bis ${this.productionSpan.lastProduction}
			</div>
			<div class="summary">
				Autarkie der letzten 30 Tage: ${autarchy} %
			</div>
			<div class="summary">
				Ladestatus: ${teslaChargingState}; noch ${teslamaxutesToFullCharge} max. (Stand: ${teslaTimestamp})
			</div>`;
			return summary;
		} catch (err) {
			console.error("Error building summary:", err);
			return `<div class="lastError">Error building summary: ${err}</div>`;
		}
	},

	getStyles: function() {
		return [ "MMM-PVMonitor.css" ];
	},

	updatePowerFlowTable: function() {
		console.log(`Module ${this.name}: updatePowerFlowTable() called`);
		if (this.powerFlow) {
			const tableHtml = this.fillTableTemplate(this.powerFlow);
			const tableDiv = document.getElementById("powerflowTable");
			tableDiv.innerHTML = tableHtml;
			
			document.getElementById("powerflowLoading")?.remove();
			
			console.log("Powerflow table updated");
		}
	},

	updateSummary: function() {
		console.log(`Module ${this.name}: updateSummary() called`);
		const summaryHtml = this.fillSummary();
		const summaryDiv = document.getElementById("summary");
		summaryDiv.innerHTML = summaryHtml;
		
		document.getElementById("summaryLoading")?.remove();

		console.log("Summary updated");
	},

	// Called after start(), before DOM_OBJECTS_CREATED notification.
	// After that, whenever you call this.updateDom(), getDom() is called
	getDom: function() {
		console.log(`Module ${this.name}: getDom() called`);

		if (this.wrapper == undefined) {
			const html = `<div id='powerflowTable' class='powerflow'><div id="powerflowLoading">Loading Powerflow Table...</div></div>
				<div id="batteryDiagram" class="battery"><div id="batteryLoading">Loading Battery Diagram...</div><canvas id="batteryChart"></canvas></div>
				<p id="summary"><div id="summaryLoading">Loading Summary...</div></p>`;

			var wrapper = document.createElement("div");
			wrapper.id = "MMM-PVMonitorWrapper";
			wrapper.innerHTML = html;
			this.wrapper = wrapper;

			console.log("Created basic DOM structure");
		}
		return this.wrapper;
	},

	buildChart: function() {
		console.log("Building chart");

		try {
			const ctx = document.getElementById("batteryChart").getContext('2d');
			const config = this.buildChartConfig();
			const chart = new Chart(ctx, config);

			this.chart = chart;
			
			document.getElementById("batteryLoading")?.remove();

			return chart;
		} catch (err) {
			console.error("Error building chart:", err);
			document.getElementById("batteryLoading").innerHTML = `Error loading chart: ${err}`;
			return null;
		}
	},

	buildChartConfig: function() {
		const now = new Date();
		// Create "today 00:00:00" (start of X axis)
		const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
		// Create "tomorrow 00:00:00" (end of X axis)
		const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 0);

        const footerPlugin = {
            id: "footerPlugin",
            afterDraw: (chart) => { // arrow function keeps "this" context
                const { ctx, chartArea: { bottom, left } } = chart;
                ctx.save();
                ctx.font = "10px sans-serif";
                ctx.fillStyle = "#aaa"; // light grey footer text
                ctx.textAlign = "left";
				var timestamp = "Unknown";
				if (this.spotPrices && this.spotPrices.updateTimestamp) {
					timestamp = new Date(this.spotPrices.updateTimestamp).toLocaleTimeString();
				}
                ctx.fillText(`Data updated: ${timestamp}`, left, bottom - 5);
                ctx.restore();
            }
        };

		return {
			type: 'line',
          	data: {
				datasets: [
					{	// Current
						label: `Current`,
						data: [],
						backgroundColor: '#ff0',
						borderColor: '#ff0',
						borderWidth: 1,
						pointRadius: 5,
						pointStyle: 'star',
					},
					{	// Min
						label: `Min`,
						data: [],
						backgroundColor: '#07cf39ff',
						borderColor: '#07cf39ff',
						pointRadius: 5,
						pointStyle: 'rectRot',
					},
					{	// Max
						label: `Max`,
						data: [],
						backgroundColor: '#800',
						borderColor: '#800',
						pointRadius: 5,
						pointStyle: 'rectRot',
					},
					{	// Spot Prices
						label: "HIDDEN",
						data: [],
						borderColor: '#080',
						backgroundColor: '#080',
						borderWidth: 2,
						pointRadius: 0,
						fill: false,
						tension: 0.1
					},
					{	// Storage
						label: "HIDDEN",
						data: [],
						borderColor: '#1f77b4',
						backgroundColor: '#184463',
						borderWidth: 2,
						pointRadius: 0,
						fill: true,
						tension: 0.1,
						yAxisID: 'y2'
					},
				]
          },
          options: {
			responsive: false,
            maintainAspectRatio: false,
            plugins: {
				legend: {
					labels: {
						filter: function(legendItem, chartData) {
							return legendItem.text !== 'HIDDEN';
						}
					}
				}
            },
			scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'hour',
                        displayFormats: {
                            hour: 'HH:mm'
                        },
                    },
                    title: {
                        display: false
                    },
					grid: {
						display: true,
						drawOnChartArea: true,
						color: '#666',
					},
                    ticks: {
                        color: '#ccc',
						font: { size: 10 },
						maxRotation: 0,
                    },
                    min: startOfDay,
                    max: endOfDay
                },
                y: {
					min: 0,
					// max: 30, // Dynamic max is better
                    position: 'left',
                    grid: {
                        drawTicks: true,
                        drawOnChartArea: false,
                        color: '#040'
                    },
                    ticks: {
                        stepSize: 1,
                        color: '#0A0',
                        callback: function(val, idx, ticks) { return val + " ct"; }
                    }
                },
                y2: {
                    min: 0,
                    max: 100,
                    position: 'right',
                    grid: {
                        drawTicks: true,
                        drawOnChartArea: true,
                        color: '#236'
                    },
                    ticks: {
                        stepSize: 25,
                        color: '#1f77b4',
                        callback: function(val, idx, ticks) { return val + "%"; }
                    }
                }
            }
          },
		  plugins: [footerPlugin]
		};
	},

	setChartData: function(dataSetIndex, data, label) {
		console.log(`Setting chart data for dataset ${dataSetIndex} with ${data.length} entries`);
		if (this.chart) {
			this.chart.data.datasets[dataSetIndex].data = data;

			if (label)
				this.chart.data.datasets[dataSetIndex].label = label;
			else
				this.chart.data.datasets[dataSetIndex].label = "HIDDEN"; // this label gets filtered out in legend

			this.chart.update();
		}
	},

	getScripts: function() {
		return [
			// Chart.js (global UMD build)
			"https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js",
			// date-fns (peer dependency for the adapter)
			"https://cdn.jsdelivr.net/npm/date-fns@2.30.0/dist/date-fns.min.js",
			// date-fns adapter for Chart.js
			"https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"
		];
	},
});
