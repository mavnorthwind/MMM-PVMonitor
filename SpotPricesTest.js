'use strict';
const dotenv = require("dotenv");
dotenv.config({path: '.env.local'});

const SpotPrices = require("./SpotPrices.js");
const spotPrices = new SpotPrices();

const SolaredgeAPI = require("./SolaredgeAPI.js");
const solarEdgeApi = new SolaredgeAPI(process.env.SOLAREDGE_SITEID, process.env.SOLAREDGE_APIKEY, process.env.SOLAREDGE_INVERTERID);

const fs = require('fs');

// ---------- Load Chart.js before the adapter ----------
const Chart = require('chart.js');
global.Chart = Chart;

// ---------- Ensure a date‑fns adapter is available ----------
const dateFns = require('date-fns');
global.dateFns = dateFns;

// ---------- Load the date‑fns adapter ----------
require('chartjs-adapter-date-fns');

const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const { posix } = require("path");

(async function main() {
    if (!spotPrices.hasData) {
        console.log("Prices undefined; first update");
        await spotPrices.updateSpotPricesAsync(0,0);
    }

    if (spotPrices.maxDate <= new Date()) { // Old prices
        console.log("Prices too old; update");
        await spotPrices.updateSpotPricesAsync(0,0);
    }

    // // To have today's data only
    // await spotPrices.updateSpotPricesAsync(0,0);

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

    const now = new Date();
    // Create "today 00:00:00"
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    // Create "tomorrow 00:00:00"
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()+1, 0, 0, 0);

    const storageData = await solarEdgeApi.fetchStorageData(startOfDay, now);
    console.log(`SolarEdge diagram data: ${storageData.length} items`);
    const storageDataset = [];
    storageData.forEach((val, index, array) => {
        storageDataset.push({ x: val.timeStamp, y: val.socPercent });
    });

    // --- Generate chart image using Chart.js -------------------------------
    const width = 800;   // px
    const height = 600;  // px
    const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: "#000" });

    const spotPricesDataset = spotPrices.dates.map((d,i) => ({x: d, y:spotPrices.prices[i]}));
    
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

    const currentPriceDataset = [{x: spotPrices.currentPriceDate, y:spotPrices.currentPrice}];

    const configuration = {
        type: 'line',
        data: {
            datasets: [
                {
                    label: `Current: ${spotPrices.currentPrice} ${spotPrices.unit}`,
                    data: currentPriceDataset,
                    backgroundColor: '#ff0',
                    borderColor: '#ff0',
                    borderWidth: 2,
                    pointRadius: 6,
                    pointStyle: 'star',
                },
                {
                    label: `Min: ${spotPrices.minPrice} ${spotPrices.unit}`,
                    data: [{x: spotPrices.minPriceDate, y: spotPrices.minPrice}],
                    backgroundColor: '#080',
                    borderColor: '#080',
                    pointStyle: 'triangle',
                },
                {
                    label: `Max: ${spotPrices.maxPrice} ${spotPrices.unit}`,
                    data: [{x: spotPrices.maxPriceDate, y: spotPrices.maxPrice}],
                    backgroundColor: '#800',
                    borderColor: '#800',
                    fill: false,
                    tension: 0.1
                },
                {
                    type: 'line',
                    label: `Spot Prices (${spotPrices.unit})`,
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
                    data: storageDataset, //soCDataset,
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
                    min: startOfDay,
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
                    min: 0,
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

    // fake data to get lines to the axes
    const currentPriceStemData = [];
    currentPriceStemData.push({x: startOfDay, y: spotPrices.currentPrice});
    currentPriceStemData.push({x: spotPrices.currentPriceDate, y: spotPrices.currentPrice});
    currentPriceStemData.push({x: spotPrices.currentPriceDate, y: 0});
    currentPriceStemData.push({x: null, y: null}); // break the line

    configuration.data.datasets.unshift({ // use unshift instead of push to have the stem in front
        data: currentPriceStemData,
        label: 'HIDDEN',
        borderColor: '#ff08',
        borderWidth: 2,
        showLine: true,
        pointRadius: 0
    });


    // fake data to get lines to the axes
    const minPriceStemData = [];
    minPriceStemData.push({x: startOfDay, y: spotPrices.minPrice});
    minPriceStemData.push({x: spotPrices.minPriceDate, y: spotPrices.minPrice});
    minPriceStemData.push({x: spotPrices.minPriceDate, y: 0});
    minPriceStemData.push({x: null, y: null}); // break the line

    configuration.data.datasets.unshift({ // use unshift instead of push to have the stem in front
        data: minPriceStemData,
        label: 'HIDDEN',
        borderColor: '#0808',
        borderWidth: 2,
        showLine: true,
        pointRadius: 0
    });

    // fake data to get lines to the axes
    const maxPriceStemData = [];
    maxPriceStemData.push({x: startOfDay, y: spotPrices.maxPrice});
    maxPriceStemData.push({x: spotPrices.maxPriceDate, y: spotPrices.maxPrice});
    maxPriceStemData.push({x: spotPrices.maxPriceDate, y: 0});
    maxPriceStemData.push({x: null, y: null}); // break the line

    configuration.data.datasets.unshift({ // use unshift instead of push to have the stem in front
        data: maxPriceStemData,
        label: 'HIDDEN',
        borderColor: '#8008',
        borderWidth: 2,
        showLine: true,
        pointRadius: 0
    });

    // fake data to get 10% SoC line
    const soC10PercentData = [];
    soC10PercentData.push({x: startOfDay, y: 10 });
    soC10PercentData.push({x: endOfDay, y: 10 });

    configuration.data.datasets.unshift({
        data: soC10PercentData,
        label: 'HIDDEN',
        borderColor: '#c00',
        borderDash: [5,10],
        borderWidth: 1,
        showLine: true,
        pointRadius: 0,
        yAxisID: 'y2'
    });


    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync('spotPricesChart.png', imageBuffer);
    console.log('Chart image saved as spotPricesChart.png');
})();