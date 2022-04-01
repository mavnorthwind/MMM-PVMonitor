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

    
    async fetchSiteDetails() {
        var siteDetailsUrl = `https://monitoringapi.solaredge.com/site/${this.#siteId}/details`;

		var ret = await axios.get(siteDetailsUrl, {
			params: {
				format: "application/json",
				api_key: this.#apiKey,
			}})
		.then(res => {
			console.debug(`Got SiteDetail data: ${JSON.stringify(res.data)}`);

			var reply = res.data;
			var details = reply.details;

            return {
				name: details.name,
				peakPower: details.peakPower,
				maxPower: this.#maxPower
			};
		})
		.catch(err => {
			console.error(`Request returned error  ${err}`);
		});

        return ret;
    }
}

module.exports = SolaredgeAPI;