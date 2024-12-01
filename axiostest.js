const axios = require("axios");
// Take environment from file .env.local (not inside the repo)
const dotenv = require('dotenv').config({path: '.env.local'});

function getEnvVar(varName) {
    const value = process.env[varName];
    if (!value) {
        throw new Error(`Environment variable ${varName} is not set!`);
    }
    return value;
}

var config = {
    siteId: getEnvVar("SOLAREDGE_SITEID"),
    inverterId: getEnvVar("SOLAREDGE_INVERTERID"),
    apiKey: getEnvVar("SOLAREDGE_APIKEY")
};

function formatDateTimeForAPI(date) {
    var jsonDate = date.toJSON();
    jsonDate = jsonDate.substr(0, 19); // Cut after seconds
    jsonDate = jsonDate.replace("T", " ");
    return jsonDate;
}


var today = new Date();
var lastMonth = new Date(today - 30*24*60*60000);
var startTime = lastMonth.toJSON().substr(0,10)+" 00:00:00";
var endTime = new Date(today-24*60*60000).toJSON().substr(0,10)+" 23:59:59";
var energyDetailsUrl = `https://monitoringapi.solaredge.com/site/${config.siteId}/energyDetails`;

axios.get(energyDetailsUrl, {
    params: {
        format: "application/json",
        api_key: config.apiKey,
        timeUnit: "DAY",
        startTime: startTime,
        endTime: endTime
    }})
.then(res => {

    console.log(res.data);

    var reply = res.data;
    var energyDetails = reply.energyDetails;
    var selfConsumption = 123;//self.sumValuesFor("SelfConsumption", energyDetails.meters);
    var totalConsumption = 456;//self.sumValuesFor("Consumption", energyDetails.meters);

    var autarchyReply = {
        from: startTime,
        to: endTime,
        percentage: selfConsumption/totalConsumption
    };

    console.log(`node_helper: sent autarchy ${JSON.stringify(autarchyReply)}`);
})
.catch(err => {
    console.error(`node_helper: request returned error  ${err}`);
});

return;

var startTime = formatDateTimeForAPI(new Date(Date.now() - 24*60*60000)); // now - 24h
var endTime = formatDateTimeForAPI(new Date());
var inverterDataUrl = `https://monitoringapi.solaredge.com/equipment/${config.siteId}/${config.inverterId}/data`;
var storageDataUrl = `https://monitoringapi.solaredge.com/site/${config.siteId}/storageData`;
console.log(`InverterUrl: ${inverterDataUrl}`);
console.log(`StorageUrl: ${storageDataUrl}`);


Promise.all([
    axios.get(inverterDataUrl, {
        params: {
            format: "application/json",
            api_key: config.apiKey,
            startTime: startTime,
            endTime: endTime
        }}),
    axios.get(storageDataUrl, {
        params: {
            format: "application/json",
            api_key: config.apiKey,
            startTime: startTime,
            endTime: endTime
        }}),
])
.then(res => {
    console.log("===============================================================");
    console.log(res[0].data);
    console.log("===============================================================");
    console.log(res[1].data);
})
.catch(err => {
    console.error(err);
});

console.log("after call");