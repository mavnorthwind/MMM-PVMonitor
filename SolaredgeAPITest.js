const siteId = "InsertSiteID";
const apikey = "InsertApiKey";

const SolaredgeAPI = require("./SolaredgeAPI.js");
const api = new SolaredgeAPI(siteId, apikey);

var siteDetails = api.siteDetails;

(async () => {
    var details = await siteDetails;
    console.log("Site details: '" + details.name + "' " + details.peakPower + " kWp MaxPower " + JSON.stringify(details.maxPower));
})();
