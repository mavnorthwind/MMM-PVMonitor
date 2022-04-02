'use strict';
// Module SolaredgeAPI.js

const axios = require('axios');
const fs = require('fs');

class SolaredgeAPI {
    #siteId = undefined;
    #apiKey = undefined;
    #siteDetails = undefined;
    #maxPower = undefined;

    constructor(siteId, apiKey) {
        this.#siteId = siteId;
        this.#apiKey = apiKey;

        this.#siteDetails = undefined;

        try {
            this.#maxPower = JSON.parse(fs.readFileSync("maxPower.json"));
		} catch (ex)
		{
			console.error(`Error reading maxPower.json: ${ex}`);
			this.#maxPower = { value: 0.001, timestamp: Date.now() };
		}
    }


    get siteId() {
        return this.#siteId;
    }

    get siteDetails() {
        if (!this.#siteDetails)
            this.#siteDetails = this.fetchSiteDetails();

        return this.#siteDetails;
    }

    get maxPower() {
        return this.#maxPower;
    }

    set maxPower(power) {
        this.#maxPower.timestamp = Date.now();
        this.#maxPower.value = power;

        fs.writeFileSync("maxPower.json", JSON.stringify(this.#maxPower));
    }

    //
    // siteDetails {
    // 	name: "SITENAME"
	// 	peakPower: 0.0,
	//  maxPower: { value: 0.0, timestamp: 1648818482783 }
    // }
    //
    async fetchSiteDetails() {
        const siteDetailsUrl = `https://monitoringapi.solaredge.com/site/${this.#siteId}/details`;

		try {
			const res = await axios.get(siteDetailsUrl, {
				params: {
					format: "application/json",
					api_key: this.#apiKey,
				}});

			console.debug(`Got SiteDetail data: ${JSON.stringify(res.data)}`);

			const details = res.data.details;

			return {
				name: details.name,
				peakPower: details.peakPower,
				maxPower: this.#maxPower
			};
		} catch(error) {
			console.error(`Request for powerflow on ${this.#siteId} returned error  ${error}`);
		}
    }

    //
    // powerFlow {
    // 	unit: "kW",
	//	connections: [{from:"PV", to:"Load"},...],
	//	GRID:	{status:"active", currentPower:0.01},
	//	LOAD:	{status:"active", currentPower:0.01},
	//	PV: 	{status:"active", currentPower:0.01},
	//	STORAGE:{status:"active", currentPower:0.01, chargeLevel:14, critical: false},
    // }
    //
    async fetchCurrentPowerFlow() {
        const powerFlowUrl = `https://monitoringapi.solaredge.com/site/${this.#siteId}/currentPowerFlow`;

		try {
			const res = await axios.get(powerFlowUrl, {
				params: {
					format: "application/json",
					api_key: this.#apiKey,
				}});

			console.debug(`Got powerFlow data: ${JSON.stringify(res.data)}`);

			const currentPowerflow = res.data.siteCurrentPowerFlow;

			if (this.maxPower.value < currentPowerflow.PV.currentPower) {
				this.maxPower = currentPowerflow.PV.currentPower;
			}

            // productionSpan erst mal rauslassen
            //
			// var d = new Date();
			// if (self.productionSpan.day != d.getDay()) {
			// 	self.productionSpan.day = d.getDay();
			// 	self.productionSpan.firstProduction = "-";
			// 	self.productionSpan.lastProduction = "-";
			// }
			// if (self.productionSpan.firstProduction == "-" &&
			// 	powerflow.PV.currentPower > 0) {
			// 	self.productionSpan.firstProduction = `${d.toLocaleTimeString()}`;
			// }
			// if (self.productionSpan.firstProduction != "-" &&
			// 	self.productionSpan.lastProduction == "-" &&
			// 	powerflow.PV.currentPower <= 0 &&
			// 	d.getHours() > 10) { // avoid initial jitter
			// 	self.productionSpan.lastProduction = `${d.toLocaleTimeString()}`;
			// }

			 return currentPowerflow;
		} catch (error) {
			console.error(`Request for powerflow returned error  ${error}`);
		}
    };

	#findProductionForDay(day, values) {
		var prod = 0;

		values.forEach(v => {
			if (v.date.indexOf(day) >= 0)
				prod = v.value;
		});

		return prod;
	};

	//
	//	production: {
	//		
	//	}
	//
	async fetchProduction() {
		const today = new Date();
		const yesterday = new Date(Date.now() - 24*60*60000);
		const startDate = yesterday.toJSON().substr(0,10);
		const endDate = today.toJSON().substr(0,10);
		const energyUrl = `https://monitoringapi.solaredge.com/site/${this.#siteId}/energy`;

		try{
			const res = await axios.get(energyUrl, {
				params: {
					format: "application/json",
					api_key: this.#apiKey,
					timeUnit: "DAY",
					startDate: startDate,
					endDate: endDate
				}});
			console.log(`got production data: ${JSON.stringify(res.data)}`);

			const energy = res.data.energy;
			const prodYesterday = this.#findProductionForDay(startDate, energy.values);
			const prodToday = this.#findProductionForDay(endDate, energy.values);

			const productionReply = {
				unit: energy.unit,
				productionToday: prodToday,
				productionYesterday: prodYesterday
			};

			return productionReply;
		} catch(error) {
			console.error(`Request for energy returned error  ${error}`);
		};
	}
}

module.exports = SolaredgeAPI;