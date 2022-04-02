const siteId = "InsertSiteID";
const apikey = "InsertApiKey";
const inverterId = "InsertConverterID";

const SolaredgeAPI = require("./SolaredgeAPI.js");
const api = new SolaredgeAPI(siteId, apikey, inverterId);

(async function main() {
    var details = await api.fetchSiteDetails();
    console.log(`Site details: ${JSON.stringify(details, null, 2)}`);

    var powerFlow = await api.fetchCurrentPowerFlow();
    console.log(`Power flow: ${JSON.stringify(powerFlow, null, 2)}`);
    console.log(`Battery charge: ${powerFlow.STORAGE.chargeLevel}`);

    var production = await api.fetchProduction();
    console.log(`Production: ${JSON.stringify(production,null,2)}`);

    var autarchy = await api.fetchAutarchy();
    console.log(`Autarchy: ${JSON.stringify(autarchy,null,2)}`);

    var diagramData = await api.fetchDiagramData();
    console.log(`DiagramData: ${JSON.stringify(diagramData,null,2)}`);
})();