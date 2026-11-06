'use strict';
// Module SolaredgeAPI.js
// Client for the SolarEdge Monitoring API V2 (OAuth2, Site Access)

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://monitoringapi.solaredge.com/v2';
const TOKEN_FILE = path.join(__dirname, 'tokens.json');
const TOKEN_REFRESH_MARGIN_MS = 5*60*1000;
const MAX_QUARTER_HOUR_SPAN_MS = 11.5*60*60*1000; // API limit is 12h

class SolaredgeAPI {
    #siteId = undefined;
	#clientId = undefined;
	#clientSecret = undefined;
	#configRefreshToken = undefined;
	#accessToken = undefined;
	#refreshToken = undefined;
	#expiresAt = undefined; // ms since epoch, undefined if unknown
	#refreshPromise = undefined;
	#http = undefined;
    #maxPower = undefined;
	#storageCache = new Map(); // timestamp (ms) -> { timeStamp, socPercent, power }
	#storagePromise = undefined;
	#loggedMeters = false;

    constructor(siteId, accessToken, refreshToken, clientId, clientSecret) {
        this.#siteId = siteId;
		this.#clientId = clientId;
		this.#clientSecret = clientSecret;
		this.#configRefreshToken = refreshToken;
		this.#accessToken = accessToken;
		this.#refreshToken = refreshToken;

		this.#loadTokens();

		this.#http = axios.create({ baseURL: BASE_URL });
		this.#http.interceptors.request.use(async (config) => {
			await this.#refreshIfExpiring();
			config.headers.Authorization = `Bearer ${this.#accessToken}`;
			return config;
		});
		this.#http.interceptors.response.use(undefined, async (error) => {
			const config = error.config;
			if (error.response && error.response.status === 401 && config && !config._retried) {
				config._retried = true;
				console.warn("SolarEdge API returned 401, refreshing tokens");
				await this.#refreshTokens();
				return this.#http.request(config);
			}
			throw error;
		});

		try {
            this.#maxPower = JSON.parse(fs.readFileSync("maxPower.json"));
		} catch (ex)
		{
			console.error(`Error reading maxPower.json: ${ex}`);
			this.#maxPower = { value: 0.001, timestamp: Date.now() };
		}
    }


    get siteId() {
        return this.#siteId;
    }

    get maxPower() {
        return this.#maxPower;
    }

    set maxPower(power) {
        this.#maxPower.timestamp = Date.now();
        this.#maxPower.value = power;

        fs.writeFileSync("maxPower.json", JSON.stringify(this.#maxPower));
    }

	// Tokens saved in tokens.json win over the config, unless the config's refresh token was changed
	#loadTokens() {
		try {
			if (!fs.existsSync(TOKEN_FILE)) return;
			const saved = JSON.parse(fs.readFileSync(TOKEN_FILE));
			if (saved.configRefreshToken === this.#configRefreshToken && saved.accessToken && saved.refreshToken) {
				this.#accessToken = saved.accessToken;
				this.#refreshToken = saved.refreshToken;
				this.#expiresAt = saved.expiresAt;
			}
		} catch (ex) {
			console.error(`Error reading tokens.json: ${ex}`);
		}
	}

	#saveTokens() {
		try {
			fs.writeFileSync(TOKEN_FILE, JSON.stringify({
				configRefreshToken: this.#configRefreshToken,
				accessToken: this.#accessToken,
				refreshToken: this.#refreshToken,
				expiresAt: this.#expiresAt
			}, null, 2));
		} catch (ex) {
			console.error(`Error writing tokens.json: ${ex}`);
		}
	}

	async #refreshIfExpiring() {
		if (this.#refreshPromise) {
			await this.#refreshPromise;
		} else if (this.#expiresAt && Date.now() > this.#expiresAt - TOKEN_REFRESH_MARGIN_MS) {
			await this.#refreshTokens();
		}
	}

	// The old refresh token is invalidated by a refresh, so make sure only one refresh runs at a time
	#refreshTokens() {
		if (!this.#refreshPromise) {
			this.#refreshPromise = (async () => {
				try {
					const res = await axios.post(`${BASE_URL}/oauth2/token`, {
						grant_type: "refresh_token",
						refresh_token: this.#refreshToken,
						client_id: this.#clientId,
						client_secret: this.#clientSecret
					});
					this.#accessToken = res.data.access_token;
					this.#refreshToken = res.data.refresh_token || this.#refreshToken;
					this.#expiresAt = Date.now() + (res.data.expires_in || 7200)*1000;
					this.#saveTokens();
					console.log("SolarEdge tokens refreshed");
				} catch (error) {
					console.error(`Refreshing SolarEdge tokens failed: ${error}`,
						error.response ? JSON.stringify(error.response.data) : "");
					throw error;
				} finally {
					this.#refreshPromise = undefined;
				}
			})();
		}
		return this.#refreshPromise;
	}

	// Local time with UTC offset, the API rejects date-times without a time zone: 2026-05-01T00:00:00+02:00
	#formatDateTimeForAPI(date) {
		const p = (n) => n<10 ? `0${n}` : `${n}`;
		const offset = -date.getTimezoneOffset();
		const sign = offset < 0 ? "-" : "+";
		const abs = Math.abs(offset);
		return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}${sign}${p(Math.floor(abs/60))}:${p(abs%60)}`;
	}

	#formatDay(date) {
		return this.#formatDateTimeForAPI(date).substring(0,10);
	}

	#startOfDay(date) {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
	}

	#toKw(value, unit) {
		switch ((unit || "W").toUpperCase()) {
			case "MW": return value*1000;
			case "KW": return value;
			default: return value/1000;
		}
	}

	#round(value) {
		return Math.round(value*100)/100;
	}

    //
    // siteDetails {
    // 	name: "SITENAME"
	// 	peakPower: 0.0,
	//  maxPower: { value: 0.0, timestamp: 1648818482783 }
    // }
    //
    async fetchSiteDetails() {
		try {
			const res = await this.#http.get(`/sites/${this.#siteId}`);

			console.debug(`Got SiteDetail data: ${JSON.stringify(res.data)}`);

			return {
				name: res.data.name,
				peakPower: res.data.peakPower,
				maxPower: this.#maxPower
			};
		} catch(error) {
			console.error(`Request for site details on ${this.#siteId} returned error  ${error}`);
			throw error;
		}
    }

	// Last value of each metric over all meters, summed (in the metric's unit)
	#sumLatest(devices, metric) {
		var found = false;
		var sum = 0;
		var unit = undefined;

		for (const serial of Object.keys(devices || {})) {
			const m = devices[serial][metric];
			if (m && m.values && m.values.length > 0) {
				found = true;
				unit = m.unit;
				sum += m.values[m.values.length-1].value;
			}
		}

		return found ? { value: sum, unit: unit } : undefined;
	}

	#logMeters(meters) {
		if (this.#loggedMeters) return;
		this.#loggedMeters = true;
		for (const serial of Object.keys(meters || {})) {
			console.log(`SolarEdge meter ${serial} reports: ${Object.keys(meters[serial]).join(", ")}`);
		}
	}

    //
    // powerFlow {
    // 	"unit": "kW",
	//	"connections": [{"from":"PV", "to":"Load"},...],
	//	"GRID":		{"status":"active", "currentPower":0.71},
	//	"LOAD":		{"status":"active", "currentPower":0.92},
	//	"PV": 		{"status":"active", "currentPower":0.11},
	//	"STORAGE":	{"status":"active", "currentPower":0.10, chargeLevel:14, critical: false},
    // }
	//
	// The V2 power flow endpoint needs the Pro tier, so the flow is assembled from meter and storage telemetry.
    //
    async fetchCurrentPowerFlow() {
		const now = new Date();
		const from = this.#formatDateTimeForAPI(new Date(now.getTime() - 60*60000));
		const to = this.#formatDateTimeForAPI(now);

		try {
			const [meterRes, storage] = await Promise.all([
				this.#http.get(`/sites/${this.#siteId}/meters/telemetry`, {
					params: { resolution: "QUARTER_HOUR", from: from, to: to }
				}),
				this.#refreshStorageCache()
			]);

			console.debug(`Got meter data: ${JSON.stringify(meterRes.data)}`);
			const meters = meterRes.data.meters;
			this.#logMeters(meters);

			const kw = (metric) => {
				const v = this.#sumLatest(meters, metric);
				return v ? this.#toKw(v.value, v.unit) : undefined;
			};

			var pv = kw("productionPower");
			if (pv === undefined) {
				const powerRes = await this.#http.get(`/sites/${this.#siteId}/power`, {
					params: { resolution: "QUARTER_HOUR", unit: "KW", from: from, to: to }
				});
				const values = powerRes.data.values || [];
				pv = values.length > 0 ? this.#toKw(values[values.length-1].value, powerRes.data.unit) : 0;
			}
			const imported = kw("importPower") || 0;
			const exported = kw("exportPower") || 0;

			const latestStorage = storage.length > 0 ? storage[storage.length-1] : undefined;
			const storagePower = latestStorage ? latestStorage.power/1000 : 0; // positive: charging

			var load = kw("consumptionPower");
			if (load === undefined) {
				load = pv + imported - exported - storagePower;
			}

			const grid = imported - exported; // positive: import
			const connections = [];
			if (pv > 0 && storagePower > 0) connections.push({ from: "PV", to: "STORAGE" });
			if (pv > 0 && load > 0) connections.push({ from: "PV", to: "Load" });
			if (grid > 0) connections.push({ from: "GRID", to: "Load" });
			if (grid < 0) connections.push({ from: "Load", to: "GRID" });
			if (storagePower < 0) connections.push({ from: "STORAGE", to: "Load" });

			const currentPowerflow = {
				unit: "kW",
				connections: connections,
				PV: { status: pv > 0 ? "Active" : "Idle", currentPower: this.#round(pv) },
				LOAD: { status: load > 0 ? "Active" : "Idle", currentPower: this.#round(load) },
				GRID: { status: grid != 0 ? "Active" : "Inactive", currentPower: this.#round(Math.abs(grid)) },
			};

			if (latestStorage) {
				currentPowerflow.STORAGE = {
					status: storagePower > 0 ? "Charging" : (storagePower < 0 ? "Discharging" : "Idle"),
					currentPower: this.#round(Math.abs(storagePower)),
					chargeLevel: Math.round(latestStorage.socPercent),
					critical: false
				};
			}

			if (this.maxPower.value < currentPowerflow.PV.currentPower) {
				this.maxPower = currentPowerflow.PV.currentPower;
			}

			return currentPowerflow;
		} catch (error) {
			console.error(`Request for powerflow returned error  ${error}`);
			throw error;
		}
    }

	#findProductionForDay(day, values) {
		var prod = 0;

		values.forEach(v => {
			if (v.timestamp.indexOf(day) == 0)
				prod = v.value;
		});

		return prod;
	}

	//
	//	production: {
	//	"unit": "Wh",
  	//	"productionToday": 2983,
  	//	"productionYesterday": 5280	
	//	}
	//
	async fetchProduction() {
		const today = new Date();
		const yesterday = new Date(today.getTime() - 24*60*60000);
		const startDate = this.#formatDay(yesterday);
		const endDate = this.#formatDay(today);

		try{
			const res = await this.#http.get(`/sites/${this.#siteId}/energy`, {
				params: {
					resolution: "DAY",
					unit: "WH",
					from: this.#formatDateTimeForAPI(this.#startOfDay(yesterday)),
					to: this.#formatDateTimeForAPI(today)
				}});
			console.log(`got production data: ${JSON.stringify(res.data)}`);

			const values = res.data.values || [];

			return {
				unit: res.data.unit === "WH" ? "Wh" : res.data.unit,
				productionToday: this.#findProductionForDay(endDate, values),
				productionYesterday: this.#findProductionForDay(startDate, values)
			};
		} catch(error) {
			console.error(`Request for energy returned error  ${error}`);
			throw error;
		};
	}

	//
	// autarchy: {
	//	"from": "2022-03-03 00:00:00",
	//	"to":	"2022-04-01 23:59:59",
	//	"percentage": 0.84744
	// }
	async fetchAutarchy() {
		const today = new Date();
		const first = new Date(today.getTime() - 30*24*60*60000);
		const last = new Date(today.getTime() - 24*60*60000);
		const startTime = this.#formatDateTimeForAPI(this.#startOfDay(first));
		const endTime = this.#formatDateTimeForAPI(new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59));

		try {
			const res = await this.#http.get(`/sites/${this.#siteId}/overview`, {
				params: { from: startTime, to: endTime }
			});

			const consumption = res.data.consumption;
			const percentage = consumption && consumption.total > 0 ? consumption.fromPv / consumption.total : 0;

			return {
				from: startTime.substring(0,19).replace("T", " "),
				to: endTime.substring(0,19).replace("T", " "),
				percentage: percentage
			};
		} catch(error) {
			console.error(`Request for overview returned error  ${error}`);
			throw error;
		}
	}

	// Fetch storage telemetry of the last hours and merge it into the cache for today
	#refreshStorageCache() {
		if (!this.#storagePromise) {
			this.#storagePromise = (async () => {
				try {
					const now = new Date();
					const midnight = this.#startOfDay(now);
					const from = new Date(Math.max(midnight.getTime(), now.getTime() - MAX_QUARTER_HOUR_SPAN_MS));

					const res = await this.#http.get(`/sites/${this.#siteId}/storage/telemetry`, {
						params: {
							resolution: "QUARTER_HOUR",
							from: this.#formatDateTimeForAPI(from),
							to: this.#formatDateTimeForAPI(now)
						}});

					const buckets = new Map();
					const bucket = (ts) => {
						if (!buckets.has(ts)) buckets.set(ts, { charge: 0, discharge: 0, soc: [] });
						return buckets.get(ts);
					};

					const batteries = res.data.storage || {};
					for (const serial of Object.keys(batteries)) {
						const b = batteries[serial];
						((b.chargePower || {}).values || []).forEach(v => bucket(v.timestamp).charge += v.value);
						((b.dischargePower || {}).values || []).forEach(v => bucket(v.timestamp).discharge += v.value);
						const soe = b.stateOfEnergy || {};
						// Unit PERCENTAGE is a fraction (0..1) in practice, PERCENTAGE_100 is 0..100
						const socFactor = soe.unit === "PERCENTAGE_100" ? 1 : 100;
						(soe.values || []).forEach(v => bucket(v.timestamp).soc.push(v.value * socFactor));
					}

					for (const [ts, b] of buckets) {
						if (b.soc.length == 0) continue;
						const timeStamp = new Date(ts);
						this.#storageCache.set(timeStamp.getTime(), {
							timeStamp: timeStamp,
							socPercent: b.soc.reduce((a, c) => a + c, 0) / b.soc.length,
							power: b.charge - b.discharge // W, positive: charging, negative: discharging
						});
					}

					for (const key of [...this.#storageCache.keys()]) {
						if (key < midnight.getTime()) this.#storageCache.delete(key);
					}
				} finally {
					this.#storagePromise = undefined;
				}

				return this.#sortedStorageCache();
			})();
		}
		return this.#storagePromise;
	}

	#sortedStorageCache() {
		return [...this.#storageCache.values()].sort((a, b) => a.timeStamp - b.timeStamp);
	}

	/**
	 * Fetch storage data. Served from the data collected by the power flow updates;
	 * the API is only called if nothing has been collected yet.
	 * 
	 * @param {Date} from Start storage
	 * @param {Date} to End storage
	 * 
	 * @returns {[{
	 * 				timeStamp: {Date},
	 * 				socPercent: {Number},
	 * 				power: {Number}
	 * 			}]} 
	 */
	async fetchStorageData(from, to) {
		try {
			if (this.#storageCache.size == 0 || this.#storagePromise) {
				await this.#refreshStorageCache();
			}
		} catch (error) {
			console.error("Could not get storage data:", error);
			throw error;
		}

		return this.#sortedStorageCache().filter(e => e.timeStamp >= from && e.timeStamp <= to);
	}
}

module.exports = SolaredgeAPI;
