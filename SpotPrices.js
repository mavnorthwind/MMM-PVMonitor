'use strict';

// module SpotPrices.js
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class SpotPrices {
    #cachedFilePath = undefined;

    #spotpricedata = undefined;
    #updateTimestamp = undefined;

    #prices = undefined;
    #dates = undefined;
    #unit = undefined;

    #minDate = undefined;
    #maxDate = undefined;

    #minPriceIndex = undefined;
    #maxPriceIndex = undefined;

    constructor() {
        this.#cachedFilePath = path.join(
                    process.main ? path.dirname(process.main.filename) : __dirname,
                    'spotPricesCache.json');

        this.#readCachedPrices();
    }

    get hasPrices() { return !(this.#spotpricedata === undefined); }

    get prices() { return this.#prices; }
    get dates() { return this.#dates; }
    get unit() { return this.#unit; }
    get updateTimestamp() { return this.#updateTimestamp; }


    get minDate() { return this.#minDate; }
    get maxDate() { return this.#maxDate; }

    get minPrice() { return this.#prices[this.#minPriceIndex]; }
    get maxPrice() { return this.#prices[this.#maxPriceIndex]; }

    get minPriceDate() { return this.#dates[this.#minPriceIndex]; }
    get maxPriceDate() { return this.#dates[this.#maxPriceIndex]; }
    

    // Find index of the first minimal value
    #findIndexOfMinValue(arr) {
        const minIndex = arr.reduce(
            (best, current, idx) =>
                current < arr[best] ? idx : best,
            0
        );
        return minIndex;
    }

    // Find index of the first maximal value
    #findIndexOfMaxValue(arr) {
        const maxIndex = arr.reduce(
            (best, current, idx) =>
                current > arr[best] ? idx : best,
            0
        );
        return maxIndex;
    }

    /**
     * Read cached spot prices
     * @returns true if cached prices were read, else false
     */
    #readCachedPrices() {
        try {
            if (fs.existsSync(this.#cachedFilePath)) {
                const data = fs.readFileSync(this.#cachedFilePath, 'utf8');
                this.#spotpricedata = JSON.parse(data);

                // Convert from EUR/MWh to ct/kWh
                this.#prices = this.#spotpricedata.price.map(p => Math.round(p) / 10);
                this.#unit = "ct / kWh";
                // Convert from unix_seconds to Date
                this.#dates = this.#spotpricedata.unix_seconds.map(d => new Date(d * 1000));

                this.#minDate = new Date(Math.min(...this.#dates));
                this.#maxDate = new Date(Math.max(...this.#dates));
                this.#minPriceIndex = this.#findIndexOfMinValue(this.#prices);
                this.#maxPriceIndex = this.#findIndexOfMaxValue(this.#prices);
                
                this.#updateTimestamp = this.#spotpricedata.updateTimestamp;
                return true;
            }
        } catch (error) {
            console.error("Error reading saved spot prices:", error);
        }
        return false;
    }

    /**
     * Write spot prices to cache
     * @param {*} prices 
     */
    #writeCachedPrices(prices) {
        try {
            fs.writeFileSync(this.#cachedFilePath, JSON.stringify(prices), { encoding: 'utf-8' });
        } catch (error) {
            console.error("Error saving spot prices:", error);
            throw error;
        }
    }

    /**
     * Fetch spot prices, save to cache and update internal variables
     */
    async updateSpotPrices() {
        const start = "2025-10-09";
        const end = "2025-10-11";
        const spotPricesUrl = `https://api.energy-charts.info/price?bzn=DE-LU&start=${start}&end=${end}`;

        try {
            const res = await axios.get(spotPricesUrl);
            console.debug(`Got spot price data`);

            res.data.updateTimestamp = new Date();

            this.#writeCachedPrices(res.data);

            this.#readCachedPrices();
        } catch(error) {
            console.error(`Request for spot prices from ${spotPricesUrl} returned error:`, error);
            throw error;
        }
    }
}

module.exports = SpotPrices;