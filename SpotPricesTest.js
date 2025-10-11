'use strict';

const SpotPrices = require("./SpotPrices.js");
const spotPrices = new SpotPrices();

(async function main() {
    if (!spotPrices.hasData) {
        console.log("Prices undefined; first update");
        await spotPrices.updateSpotPricesAsync();
    }

    if (spotPrices.maxDate < new Date()) { // Old prices
        console.log("Prices too old; update");
        await spotPrices.updateSpotPricesAsync();
    }

    console.log(`Updated at: ${spotPrices.updateTimestamp.toLocaleString()}`);
    console.log(`Spot prices from ${spotPrices.minDate.toLocaleString()} to ${spotPrices.maxDate.toLocaleString()}`);
    console.log(`${spotPrices.prices.length} price data points`);
    console.log(`spotPrices.dates are Date values: ${spotPrices.dates[0] instanceof Date}`);
    console.log(`Lowest price ${spotPrices.minPrice} ${spotPrices.unit} at ${spotPrices.minPriceDate.toLocaleString()}`);
    console.log(`Highest price ${spotPrices.maxPrice} ${spotPrices.unit} at ${spotPrices.maxPriceDate.toLocaleString()}`);
    console.log(`Current price ${spotPrices.currentPrice} ${spotPrices.unit} (since ${spotPrices.currentPriceDate.toLocaleString()})`)
})();