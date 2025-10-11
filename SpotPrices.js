'use strict';

// module SpotPrices.js
const axios = require('axios');
const { error } = require('console');
const fs = require('fs').promises;
const fsSync = require('fs');
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

    /**
     * Create a new SpotPrices instance
     */
    constructor() {
        this.#cachedFilePath = path.join(
                    process.main ? path.dirname(process.main.filename) : __dirname,
                    'spotPricesCache.json');

        this.#readCachedPrices();
    }

    get hasData() { return !(this.#spotpricedata === undefined); }

    /**
     * Array of spot prices (Number)
     */
    get prices() { return this.#prices; }
    /**
     * Array of spot price dates (Date)
     */
    get dates() { return this.#dates; }
    /**
     * Unit of spot prices (usually ct/kWh)
     */
    get unit() { return this.#unit; }

    /**
     * Timestamp when the spot prices were updated (Date)
     */
    get updateTimestamp() { return new Date(this.#updateTimestamp); }


    get minDate() { return this.#minDate; }
    get maxDate() { return this.#maxDate; }

    get minPrice() { return this.#prices[this.#minPriceIndex]; }
    get maxPrice() { return this.#prices[this.#maxPriceIndex]; }

    get minPriceDate() { return this.#dates[this.#minPriceIndex]; }
    get maxPriceDate() { return this.#dates[this.#maxPriceIndex]; }

    /**
     * Find the minimum price in the future of the dataset
     */
    get minFuturePrice() {
        const nowIndex = this.#findIndexOfEntryEarlierOrEqual(this.#dates);
        const minFuturePriceIndex = this.#findIndexOfMinValue(this.#takeEndFrom(this.#prices, nowIndex));
        return this.#prices[nowIndex + minFuturePriceIndex];
    }

    /**
     * Find the Date for the minimum price in the future of the dataset
     */
    get minFuturePriceDate() {
        const nowIndex = this.#findIndexOfEntryEarlierOrEqual(this.#dates);
        const minFuturePriceIndex = this.#findIndexOfMinValue(this.#takeEndFrom(this.#prices, nowIndex));
        return this.#dates[nowIndex + minFuturePriceIndex];
    }

    /**
     * Current spot price
     */
    get currentPrice() {
        const nowIndex = this.#findIndexOfEntryEarlierOrEqual(this.#dates);
        if (nowIndex < 0)
            throw error("Only future prices in dataset");
        return this.#prices[nowIndex];
    }
    /**
     * Date when the current price has been set. (Date)
     */
    get currentPriceDate() {
        const nowIndex = this.#findIndexOfEntryEarlierOrEqual(this.#dates);
        if (nowIndex < 0)
            throw error("Only future prices in dataset");
        return new Date(this.#dates[nowIndex]);
    }


    /**
     * Does the current dataset contain tomorrow's spot prices?
     */
    get hasTomorrowsPrices() {
        // No data → false
        if (!this.#dates || this.#dates.length === 0) return false;

        const now = new Date();

        // Start of tomorrow (00:00:00)
        const tomorrowStart = new Date(now);
        tomorrowStart.setHours(0, 0, 0, 0);
        tomorrowStart.setDate(tomorrowStart.getDate() + 1);

        return this.#maxDate >= tomorrowStart;
    }

    /**
     * Fetch spot prices, save to cache and update internal variables
     * The range of data fetched goes back <daysBack> at 00:00:00 and
     * forward <daysForward> at 23:59:59
     * @param {number} daysBack
     * @param {number} daysForward 
     */
    async updateSpotPricesAsync(daysBack = 1, daysForward = 1) {
        const now = new Date();

        const startDate = new Date(now);
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - daysBack);
        const start = startDate.toISOString();

        const endDate = new Date(now);
        endDate.setHours(23, 59, 59, 999);
        endDate.setDate(endDate.getDate() + daysForward);
        const end = endDate.toISOString();

        const spotPricesUrl = `https://api.energy-charts.info/price?bzn=DE-LU&start=${start}&end=${end}`;

        try {
            const res = await axios.get(spotPricesUrl);
            console.debug(`Got spot price data`);

            res.data.updateTimestamp = now;

            await this.#writeCachedPricesAsync(res.data);

            this.#readCachedPrices();
        } catch(error) {
            console.error(`Request for spot prices from ${spotPricesUrl} returned error:`, error);
            throw error;
        }
    }

    /**
     * Take only the last part of an array from a given index
     * @param {Array} array The array to recude
     * @param {Number} startIdx Start index to start with
     * @returns The end of the array, starting at startIdx
     */
    #takeEndFrom(array, startIdx = 0) {
        if (!Array.isArray(array) || array.length === 0) return -1;
        if (startIdx < 0 || startIdx >= array.length) return -1;

        return array.slice(startIdx);
    }

    /**
     * Find index of the entry with a timestamp closest and below the given date
     * Requires dates to be sorted
     * @param {Array} datesArray 
     * @param {Date} [startingFrom=new Date()] 
     * @returns Index or -1 if not found
     */
    #findIndexOfEntryEarlierOrEqual(datesArray, startingFrom = new Date()) {
        // start with -1 to indicate “none found”
        return datesArray.reduce((bestIdx, date, idx) => {
            if (date < startingFrom && (bestIdx === -1 || date > datesArray[bestIdx])) {
                return idx;          // new best
            }
            return bestIdx;          // keep previous best
        }, -1);
    }

    /**
     * Find the index of the minimum value in array
     * @param {Array} array 
     * @returns Index 
     */
    #findIndexOfMinValue(array) {
        const minIndex = array.reduce(
            (best, current, idx) =>
                current < array[best] ? idx : best,
            0
        );
        return minIndex;
    }

    /**
     * Find the index of the maximum value in array
     * @param {Array} array 
     * @returns Index 
     */
    #findIndexOfMaxValue(array) {
        const maxIndex = array.reduce(
            (best, current, idx) =>
                current > array[best] ? idx : best,
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
            if (fsSync.existsSync(this.#cachedFilePath)) {
                const data = fsSync.readFileSync(this.#cachedFilePath, 'utf8');
                this.#spotpricedata = JSON.parse(data);

                if (this.#spotpricedata.unit != "EUR / MWh")
                    throw "Unit returned by spotprices.info has changes - no longer 'EUR / MWh'";

                this.#unit = "ct/kWh";

                // Convert from EUR/MWh to ct/kWh
                this.#prices = this.#spotpricedata.price.map(p => Math.round(p) / 10);
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
     * @param {*} spotPriceData 
     */
    async #writeCachedPricesAsync(spotPriceData) {
        try {
            await fs.writeFile(this.#cachedFilePath, JSON.stringify(spotPriceData), { encoding: 'utf-8' });
        } catch (error) {
            console.error("Error saving spot prices:", error);
            throw error;
        }
    }
}

module.exports = SpotPrices;