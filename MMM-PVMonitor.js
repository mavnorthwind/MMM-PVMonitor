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

	// Tesla data
	teslaData: undefined,

	// SpotPrices
	spotPrices: undefined,
	
	storageData: undefined,

	// The SoC/spot price diagram
	diagram: undefined,
	
	// Diagram wrapper
	wrapper: undefined,

	start: function() {
		
		console.log(`Starting module: ${this.name} with config ${JSON.stringify(this.config)}`);
		
		this.sendSocketNotification('ENERGYCONFIG', this.config);
	},
	
	notificationReceived: function(notification, payload, sender) {
		
		if (notification === "DOM_OBJECTS_CREATED") {

			const dia = document.getElementById("diagramWrapper");
			const canvas = document.createElement("canvas");
			canvas.id = "diagram";
			dia.appendChild(canvas);

			this.createDiagram();
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
			this.updateDom(0);
		}

		if (notification === "PRODUCTION") {
			this.lastError = undefined;
			this.energy = payload;
			this.updateDom(0);
		}

		if (notification === "AUTARCHY") {
			this.lastError = undefined;
			this.autarchy = payload;
			this.updateDom(0);
		}

		// if (notification === "DIAGRAMDATA") {
		// 	this.lastError = undefined;
		// 	this.tempTimes = payload.tempTimes;
		// 	this.tempValues = payload.tempValues;
		// 	this.storageTimes = payload.storageTimes;
		// 	this.storageValues = payload.storageValues;
		// 	this.updateDom(0);
		// }
		
		if (notification === "TESLA") {
			//console.log("TESLA Data received: "+JSON.stringify(payload));
			this.teslaData = payload;
			this.updateDom(0);
		}
				
		if (notification === "SPOTPRICE") {
			this.spotPrices = payload;
			console.log("SPOTPRICE received:", this.spotPrices);

			this.updateDiagram();
			this.updateDom(0);
		}

		if (notification === "STORAGEDATA") {
			this.storageData = payload;
			console.log("STORAGEDATA received");

			this.updateDiagram();
		}

		if (notification === "USER_RESENCE" && payload == true) {
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

	fillTableTemplate: function(powerFlow) {
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

		var productionToday = this.energy ? `${this.beautifyEnergy(this.energy.productionToday, this.energy.unit)}` : "?";
		var productionYesterday = this.energy ? `${this.beautifyEnergy(this.energy.productionYesterday, this.energy.unit)}` : "?";

		var autarchy = this.autarchy ? Math.round(this.autarchy.percentage * 100) : "?";

		var teslaImage = this.file("Images/Tesla_Model3_red.svg");
		const milesToKm = 1.609344;
		var teslaBatteryLevel = this.teslaData ? this.teslaData.batteryLevel : "?";
		var teslaBatteryRange = this.teslaData ? Math.round(this.teslaData.batteryRange * milesToKm) : "?";
		var teslaEstimatedBatteryRange = this.teslaData ? Math.round(this.teslaData.estimatedBatteryRange * milesToKm) : "?";
		var teslaTimestamp = this.teslaData ? new Date(this.teslaData.timestamp).toLocaleTimeString() : "?";
		var teslaChargingState = this.teslaData ? this.teslaData.chargingState : "?";
		var teslaState = this.teslaData ? this.teslaData.state : "?";
		var teslamaxutesToFullCharge = this.teslaData ? this.teslaData.maxutesToFullCharge : 0;
		var teslaChargePower = this.teslaData ? this.teslaData.chargerPower : 0;
		var teslaChargeCurrent = this.teslaData ? this.teslaData.chargerActualCurrent : 0;
		var lasterror = this.lastError ? this.lastError.message : "";
		var teslaChargeClass = this.teslaData ? (this.teslaData.chargingState=="Charging" ? "" : "off") : "off";

		// Format Spot Prices
		var spotPriceText = "UNKNOWN";
		try{
			if (this.spotPrices) {
				var curr = this.spotPrices.currentSpotPrice;
				var unit = this.spotPrices.priceUnit;
				var update = new Date(this.spotPrices.updateTimestamp);
				spotPriceText = `${curr} ${unit} (${update.toLocaleTimeString()})`;
			}
		} catch (err) {
			console.error("Error updating spot price:",err);
			spotPriceText = err;
		}


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
		<div id="diagramWrapper" class="diagramWrapper">
		</div>
		<div class="summary">
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
		console.log(`Module ${this.name}: getDom() called`);

		if (this.wrapper == undefined) {
			this.wrapper = this.buildDom();
		}
		// if (this.powerFlow) {
		// 	this.html = this.fillTableTemplate(this.powerFlow);
		// 	this.wrapper.innerHTML = this.html;
		// 	// We must defer drawing the diagram until the DOM has been updated to contain the target div!
		// 	setTimeout(() => this.updateDiagram(), 100);
		// } else {
		// 	this.wrapper.innerHTML = `<p>Loading... </p>
		// 			<div id="diagramWrapper" class="diagramWrapper"></div>`;
		// }
		return this.wrapper;
	},

	buildDom: function() {
		const html = `<div id='powerflowTable' class='powerflow'>Loading Powerflow Table...</div>
			<div id="batteryDiagram" class="battery"><canvas id="batteryChart"></canvas>Loading Battery Diagram...</div>
			<p id="summary">Loading Summary</p>`;

		var wrapper = document.createElement("div");
		wrapper.id = "MMM-PVMonitorWrapper";
		wrapper.innerHTML = html;

		const ctx = wrapper.getElementById("batteryChart").getContext('2d');
		const config = buildChartConfig();
		const chart = new Chart(ctx, config);

		return wrapper;
	},

	buildChartConfig: function() {
		return {
			type: 'line',
          data: {
            datasets: [
              {
                label: 'Beispielwerte',
                data: [],
                tension: 0.25,
                borderWidth: 2,
                pointRadius: 4,
                pointHoverRadius: 6,
                fill: false,
                // Styling (kann angepasst werden)
                borderColor: 'rgb(37,99,235)'
              }
            ]
          },
          options: {
            maintainAspectRatio: false,
            plugins: {
            },
            scales: {
              x: {
                type: 'time', // WICHTIG: Zeitachse
                time: {
                  // 'unit' legt das Raster/Labeling nahe. Die Adapter übernimmt Parsing/Formatting.
                  unit: 'hour',
                  displayFormats: {
                    hour: 'HH:mm'
                  }
                },
                title: {
                  display: true,
                  text: 'Datum'
                }
              },
              y: {
                beginAtZero: false,
                title: {
                  display: true,
                  text: 'Wert'
                }
              }
            }
          }
		};
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


	
	createDiagram: function() {
		try {
			if (!window.Chart) {
				console.error("Chart.js not loaded yet!");
				return;
			}

			if (Chart._adapters && Chart._adapters._date && !Chart._adapters.date) {
				Chart._adapters.date = Chart._adapters._date;
				console.warn("Manually registered Chart.js date adapter:", Chart._adapters.date);
			}

			if (!Chart._adapters?.date?.parse) {
				console.error("Date adapter missing — Chart.js adapters:", Chart._adapters);
				return;
			}


			console.log("Creating diagram");
			const ctx = document.getElementById("diagram").getContext('2d');

			const currentPriceDataset = [];
			const minPriceDataset = [];
			const maxPriceDataset = [];
			const spotPricesDataset = [];
			const storageDataset = [];

			const now = new Date();
			// Create "today 00:00:00"
			const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
			// Create "tomorrow 00:00:00"
			const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 0);

			const backgroundPlugin = {
				id: 'customCanvasBackgroundColor',
				beforeDraw: (chart) => {
					const { ctx, chartArea } = chart;
					ctx.save();
					ctx.fillStyle = '#111';
					ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
					ctx.restore();
				}
	    	};

			const configuration = {
				type: 'line',
				data: {
					datasets: [
						{
							label: `Current: ???`,
							data: currentPriceDataset,
							backgroundColor: '#ff0',
							borderColor: '#ff0',
							borderWidth: 2,
							pointRadius: 6,
							pointStyle: 'star',
						},
						{
							label: `Min: ???`,
							data: minPriceDataset,
							backgroundColor: '#080',
							borderColor: '#080',
							pointStyle: 'triangle',
						},
						{
							label: `Max: ???`,
							data: maxPriceDataset,
							backgroundColor: '#800',
							borderColor: '#800',
							fill: false,
							tension: 0.1
						},
						{
							type: 'line',
							label: `Spot Prices (???)`,
							data: spotPricesDataset,
							borderColor: '#07cf39ff',
							backgroundColor: '#07cf39ff',
							borderWidth: 2,
							pointRadius: 0,
							fill: false,
							tension: 0.1
						},
						{
							label: `SoC %`,
							data: storageDataset,
							borderColor: '#1f77b4',
							backgroundColor: '#184463',
							borderWidth: 2,
							pointRadius: 0,
							fill: true,
							tension: 0.1,
							yAxisID: 'y2'
						}
					]
				},
				options: {
					scales: {
						x: {
							type: 'time',
							time: {
								unit: 'hour',
								tooltipFormat: 'YYYY-MM-DD HH:mm',
								displayFormats: {
									hour: 'HH:mm'
								},
							},
							title: {
								display: false
							},
							ticks: {
								color: '#ccc'
							},
							max: startOfDay,
							max: endOfDay
						},
						y: {
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
							max: 0,
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
					},
					plugins: {
						title: {
							display: true,
							text: 'Spot Prices Over Time',
							font: { size: 14, lineHeight: 0.5 },
							color: '#fff'
						},
						legend: {
							display: true,
							position: 'top',
							labels: {
								color: '#ccc',
								filter: function(legendItem, chartData) {
									return legendItem.text !== 'HIDDEN';
								}
							}
						}
					}
				},
				
				plugins: [backgroundPlugin]
			};

			this.diagram = new Chart(ctx, configuration);
		} catch (err) {
			console.error("Could not create diagram: ",err);
		}
	},

	updateDiagram: function() {
		console.log(`Updating diagram ${this.diagram}`);
		console.log(`SpotPrices = ${this.spotPrices}`);
		console.log(`Storage = ${this.storageData}`);

		try {
			const currentPriceDataset = [{x: this.spotPrices.currentPriceDate, y:this.spotPrices.currentPrice}];
			this.diagram.data.datasets[0].data = currentPriceDataset;
			this.diagram.data.datasets[0].label = `Current: ${this.spotPrices.currentPrice} ${this.spotPrices.unit}`;
		} catch (error) {
			console.error("Error updating currentPrice:", error);
		}

		try {
			const maxPriceDataset = [{x: this.spotPrices.maxPriceDate, y:this.spotPrices.maxPrice}];
			this.diagram.data.datasets[1].data = maxPriceDataset;
			this.diagram.data.datasets[1].label = `Min: ${this.spotPrices.minPrice} ${this.spotPrices.unit}`;
		} catch (error) {
			console.error("Error updating maxPrice:", error);
		}

		try {
			const maxPriceDataset = [{x: this.spotPrices.maxPriceDate, y:this.spotPrices.maxPrice}];
			this.diagram.data.datasets[2].data = maxPriceDataset;
			this.diagram.data.datasets[2].label = `Max: ${this.spotPrices.maxPrice} ${this.spotPrices.unit}`;
		} catch (error) {
			console.error("Error updating maxPrice:", error);
		}

		try {
			const spotPricesDataset = this.spotPrices.dates.map((d,i) => ({x: d, y:this.spotPrices.prices[i]}));
			this.diagram.data.datasets[3].data = spotPricesDataset;
			this.diagram.data.datasets[3].label = `Spot Prices (${this.spotPrices.unit})`;
		} catch (error) {
			console.error("Error updating spotPrices:", error);
		}

		try {
			const storageDataset = this.storageData.map((val) => ({x: val.timeStamp, y:val.socPercent}));
			// this.storageData.forEach((val, index, array) => {
			// 	storageDataset.push({ x: val.timeStamp, y: val.socPercent });
			// });
			this.diagram.data.datasets[4].data = storageDataset;
		} catch (error) {
			console.error("Error updating storage:", error);
		}

		this.diagram.update();
	},
});
