'use strict';

const SpotPrices = require("./SpotPrices.js");
const spotPrices = new SpotPrices();

(async function main() {
    if (!spotPrices.hasPrices) {
        console.log("Prices undefined; first update");
        await spotPrices.updateSpotPrices();
    }

    console.log(`Updated at: ${spotPrices.updateTimestamp}`);
    console.log(`Spot prices from ${spotPrices.minDate} to ${spotPrices.maxDate}`);
    console.log(`${spotPrices.prices.length} price data points`);
    console.log(`Lowest price ${spotPrices.minPrice} ${spotPrices.unit} at ${spotPrices.minPriceDate}`);
    console.log(`Highest price ${spotPrices.maxPrice} ${spotPrices.unit} at ${spotPrices.maxPriceDate}`);
})();