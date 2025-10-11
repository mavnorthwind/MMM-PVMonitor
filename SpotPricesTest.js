'use strict';
const SpotPrices = require("./SpotPrices.js");
const spotPrices = new SpotPrices();
const fs = require('fs');

// ---------- Ensure a date‑fns adapter is available ----------
const dateFns = require('date-fns');
global.dateFns = dateFns;
if (!dateFns.parseISO) {
    // Fallback: simple ISO parser that works with the Chart.js adapter
    dateFns.parseISO = (isoString) => new Date(isoString);
}

// ---------- Load Chart.js before the adapter ----------
const Chart = require('chart.js');
global.Chart = Chart;

// ---------- Load the date‑fns adapter ----------
require('chartjs-adapter-date-fns');

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

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
    console.log(`Has tomorrow's prices: ${spotPrices.hasTomorrowsPrices}`);
    console.log(`spotPrices.dates are Date values: ${spotPrices.dates[0] instanceof Date}`);
    console.log(`spotPrices.updateTimestamp is Date value: ${spotPrices.updateTimestamp instanceof Date}`);
    console.log(`Lowest price ${spotPrices.minPrice} ${spotPrices.unit} at ${spotPrices.minPriceDate.toLocaleString()}`);
    console.log(`Highest price ${spotPrices.maxPrice} ${spotPrices.unit} at ${spotPrices.maxPriceDate.toLocaleString()}`);
    console.log(`Current price ${spotPrices.currentPrice} ${spotPrices.unit} (since ${spotPrices.currentPriceDate.toLocaleString()})`);
    console.log(`Future minimum price ${spotPrices.minFuturePrice} at ${spotPrices.minFuturePriceDate}`);

    // --- Generate chart image using Chart.js -------------------------------
    const width = 800;   // px
    const height = 600;  // px
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

    const spotPricesDataset = spotPrices.dates.map((d,i) => ({x: d, y:spotPrices.prices[i]}));
    const currentPriceDataset = [{x: spotPrices.currentPriceDate, y:spotPrices.currentPrice}];

    const configuration = {
        type: 'line',
        data: {
            datasets: [
                {
                    label: `Current Price ${spotPrices.currentPrice} ${spotPrices.unit}`,
                    data: currentPriceDataset,
                    borderColor: 'rgba(255,0,0,1)', // Red
                    backgroundColor: 'rgba(255,0,0,0.8)', // 80% transparent
                    fill: false,
                    tension: 0.1
                },
                {
                    label: `Spot Prices (${spotPrices.unit})`,
                    data: spotPricesDataset,
                    borderColor: 'rgba(75,192,192,0.8)', // 80% transparent
                    backgroundColor: 'rgba(75,192,192,0.2)', // 20% transparent
                    fill: true,
                    tension: 0.1
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
                        }
                    },
                    title: {
                        display: true,
                        text: 'Date & Time'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: `Price (${spotPrices.unit})`
                    }
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: 'Spot Prices Over Time'
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        filter: function(legendItem, chartData) {
                            return legendItem.text !== 'HIDDEN';
                        }
                    }
                }
            }
        }
    };

    const stemData = [];
    currentPriceDataset.forEach(pt => {
        stemData.push({x: spotPrices.minDate, y: pt.y});
        stemData.push({x: pt.x, y: pt.y});
        stemData.push({x: pt.x, y: 0});
        stemData.push({x: null, y: null}); // break the line
    }); 

    configuration.data.datasets.unshift({ // use unshift instead of push to have the stem in front
        data: stemData,
        label: 'HIDDEN',
        borderColor: 'rgba(255,0,0,0.5)',
        showLine: true,
        pointRadius: 0
    });

    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('spotPricesChart.png', imageBuffer);
    console.log('Chart image saved as spotPricesChart.png');
})();