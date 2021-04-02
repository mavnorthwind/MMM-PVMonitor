const axios = require("axios");

var config = {
    siteId: "InsertSiteID",
    inverterId: "InsertConverterID",
    apiKey: "InsertApiKey"
};

function formatDateTimeForAPI(date) {
    var jsonDate = date.toJSON();
    jsonDate = jsonDate.substr(0, 19); // Cut after seconds
    jsonDate = jsonDate.replace("T", " ");
    return jsonDate;
}

var startTime = formatDateTimeForAPI(new Date(Date.now() - 24*60*60000)); // now - 24h
var endTime = formatDateTimeForAPI(new Date());
var inverterDataUrl = `https://monitoringapi.solaredge.com/equipment/${config.siteId}/${config.inverterId}/data?format=application/json&api_key=${config.apiKey}&startTime=${startTime}&endTime=${endTime}`;
var storageDataUrl = `https://monitoringapi.solaredge.com/site/${config.siteId}/storageData?format=application/json&api_key=${config.apiKey}&startTime=${startTime}&endTime=${endTime}`;
console.log(`InverterUrl: ${inverterDataUrl}`);
console.log(`StorageUrl: ${storageDataUrl}`);

Promise.all([
    axios.get(inverterDataUrl),
    axios.get(storageDataUrl)
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