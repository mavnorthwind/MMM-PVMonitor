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
        var siteDetailsUrl = `https://monitoringapi.solaredge.com/site/${this.#siteId}/details`;

		var ret = await axios.get(siteDetailsUrl, {
			params: {
				format: "application/json",
				api_key: this.#apiKey,
			}})
		.then(res => {
			console.debug(`Got SiteDetail data: ${JSON.stringify(res.data)}`);

			var details = res.data.details;

            return {
				name: details.name,
				peakPower: details.peakPower,
				maxPower: this.#maxPower
			};
		})
		.catch(err => {
			console.error(`Request for powerflow on ${this.#siteId} returned error  ${err}`);
		});

        return ret;
    }

    //
    //
    // powerFlow {
    //  
    // }
    //
    //
    //
    async fetchCurrentPowerFlow() {
        var powerFlowUrl = `https://monitoringapi.solaredge.com/site/${this.#siteId}/currentPowerFlow`;

		var ret = await axios.get(powerFlowUrl, {
			params: {
				format: "application/json",
				api_key: this.#apiKey,
			}})
		.then(res => {
			console.debug(`Got powerFlow data: ${JSON.stringify(res.data)}`);

			var currentPowerflow = res.data.siteCurrentPowerFlow;

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
		})
		.catch(err => {
			console.error(`Request for powerflow returned error  ${err}`);
            return undefined;
		});

        return ret;
    }
}

module.exports = SolaredgeAPI;