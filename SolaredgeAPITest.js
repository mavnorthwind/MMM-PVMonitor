'use strict';

// Take environment from file .env.local (not inside the repo)
const dotenv = require('dotenv').config({path: '.env.local'});
const SolaredgeAPI = require("./SolaredgeAPI.js");

function getEnvVar(varName) {
    const value = process.env[varName];
    if (!value) {
        throw new Error(`Environment variable ${varName} is not set!`);
    }
    return value;
}

const siteId = getEnvVar("SOLAREDGE_SITEID");
const accessToken = getEnvVar("SOLAREDGE_ACCESSTOKEN");
const refreshToken = getEnvVar("SOLAREDGE_REFRESHTOKEN");
const clientId = getEnvVar("SOLAREDGE_CLIENTID");
const clientSecret = getEnvVar("SOLAREDGE_CLIENTSECRET");

const api = new SolaredgeAPI(siteId, accessToken, refreshToken, clientId, clientSecret);

(async function main() {
    var details = await api.fetchSiteDetails();
    console.log(`Site details: ${JSON.stringify(details, null, 2)}`);

    var powerFlow = await api.fetchCurrentPowerFlow();
    console.log(`Power flow: ${JSON.stringify(powerFlow, null, 2)}`);
    if (powerFlow.STORAGE)
        console.log(`Battery charge: ${powerFlow.STORAGE.chargeLevel}`);

    var production = await api.fetchProduction();
    console.log(`Production: ${JSON.stringify(production,null,2)}`);

    var autarchy = await api.fetchAutarchy();
    console.log(`Autarchy: ${JSON.stringify(autarchy,null,2)}`);

    var now = new Date();
    var storageData = await api.fetchStorageData(new Date(now.getFullYear(), now.getMonth(), now.getDate()), now);
    console.log(`StorageData: ${JSON.stringify(storageData,null,2)}`);
})();