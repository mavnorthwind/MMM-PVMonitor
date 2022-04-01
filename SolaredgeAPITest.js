const siteId = "InsertSiteID";
const apikey = "InsertApiKey";

const SolaredgeAPI = require("./SolaredgeAPI.js");
const api = new SolaredgeAPI(siteId, apikey);

(async () => {
    var details = await api.siteDetails;
    console.log("Site details: '" + JSON.stringify(details, null, 2));

    var powerFlow = await api.fetchCurrentPowerFlow();
    console.log("Power flow: '" + JSON.stringify(powerFlow, null, 2));

    console.log("Battery charge: " + powerFlow.STORAGE.chargeLevel);
})();