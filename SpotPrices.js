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

    #minTodayPriceIndex = undefined;
    #maxTodayPriceIndex = undefined;

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

    get minTodayPrice() { return this.#prices[this.#minTodayPriceIndex]; }
    get maxTodayPrice() { return this.#prices[this.#maxTodayPriceIndex]; }

    get minTodayPriceDate() { return this.#dates[this.#minTodayPriceIndex]; }
    get maxTodayPriceDate() { return this.#dates[this.#maxTodayPriceIndex]; }

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
            const res = await axios.get(spotPricesUrl, { timeout: 30000 }); // Spot prices API can be slow
            console.debug(`Got spot price data`);

            res.data.updateTimestamp = now;

            await this.#writeCachedPricesAsync(res.data);

            this.#readCachedPrices();
        } catch(error) {
            console.error(`Request for spot prices from ${spotPricesUrl} returned error:`, error);
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
     * Get index of minimum and maximum value of today's prices
     * @param {Date[]} dates 
     * @param {Number[]} prices 
     * @returns {minIndex, maxIndex}
     */
    #getTodayHighLowIndex(dates, prices) {
        if (!Array.isArray(dates) || !Array.isArray(prices)) {
            throw new TypeError('dates und prices müssen Arrays sein');
        }
        if (dates.length !== prices.length) {
            throw new Error('dates und prices müssen die gleiche Länge haben');
        }

        // heutiges Datum (lokal)
        const now = new Date();
        const today = now.getFullYear() + '-' + now.getMonth() + '-' + now.getDate();

        let highestIndex = -1;
        let lowestIndex = -1;
        let highestPrice = -Infinity;
        let lowestPrice = Infinity;

        for (let i = 0; i < dates.length; i++) {
            const d = dates[i];
            if (!(d instanceof Date) || isNaN(d)) {
                throw new Error(`Ungültiges Datum an Index ${i}`);
            }

            const key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
            if (key === today) {
                const p = prices[i];
                if (typeof p !== 'number' || isNaN(p)) {
                    throw new Error(`Ungültiger Preis an Index ${i}`);
                }

                if (p > highestPrice) {
                    highestPrice = p;
                    highestIndex = i;
                }
                if (p < lowestPrice) {
                    lowestPrice = p;
                    lowestIndex = i;
                }
            }
        }

        return { highestIndex, lowestIndex };
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

                const { highestIndex, lowestIndex } = this.#getTodayHighLowIndex(this.#dates, this.#prices);

                this.#minTodayPriceIndex = lowestIndex;
                this.#maxTodayPriceIndex = highestIndex;

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