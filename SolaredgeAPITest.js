const siteId = "2068515";
const apikey = "SVMUC54I84FUS20ZW54FLVB1IYJ6VJE0";

const SolaredgeAPI = require("./SolaredgeAPI.js");
const api = new SolaredgeAPI(siteId, apikey);

var siteDetails = api.siteDetails;

(async () => {
    var details = await siteDetails;
    console.log("Site details: '" + details.name + "' " + details.peakPower + " kWp MaxPower " + JSON.stringify(details.maxPower));
})();
