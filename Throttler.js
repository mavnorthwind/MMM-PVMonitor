// module Throttler.js

class Throttler {
    #totalCallCount = 0;
    #totalThrottledCallCount = 0;
    #lastCallTimestamp;
    #callsToday = 0;
    #throttleHours = undefined;
    #overrideThrottleCallback = undefined; // function(Throttler throttler, string throttleReason): bool

    constructor() {
        this.maxCalls = undefined;
        this.maxCallsPerDay = undefined;
        this.minimumTimeBetweenCalls = undefined;
    }

    get totalCallCount() {
        return this.#totalCallCount;
    }

    get totalThrottledCallCount() {
        return this.#totalThrottledCallCount;
    }
    
    get todaysCallCount() {
        return this.#callsToday;
    }

    get throttleHours() { 
        return this.#throttleHours;
    }
    
    setOverrideThrottleCallback(cb) {
        this.#overrideThrottleCallback = cb;
    }
    
    setThrottleHours(start, end) {
        this.#throttleHours = [start, end];
    }

    reset() {
        this.#totalCallCount = 0;
        this.#totalThrottledCallCount = 0;
        this.#callsToday = 0;
        this.#lastCallTimestamp = undefined;
        this.#throttleHours = undefined;
        this.#overrideThrottleCallback = undefined;
    }

    forceExecute(func) {
        this.#totalCallCount++;
        this.#callsToday++;
        this.#lastCallTimestamp = Date.now();

        func();

        return true;
    }

    execute(func, throttleCallback) {
        var throttleReason = undefined;
        var throttleCall = false;

        if (this.maxCalls &&
            this.#totalCallCount >= this.maxCalls) {
            
            throttleReason = "Over max calls";
            throttleCall = true;
        }

        if (this.minimumTimeBetweenCalls &&
            this.#lastCallTimestamp &&
            Date.now()-this.#lastCallTimestamp < this.minimumTimeBetweenCalls) {

            throttleReason = "Too soon after last call";
            throttleCall = true;
        }

        if (this.maxCallsPerDay) {
            if (this.#lastCallTimestamp) {
                if (new Date().getDate() != new Date(this.#lastCallTimestamp).getDate())
                    this.#callsToday = 0;
            }

            if (this.#callsToday >= this.maxCallsPerDay) {
                
                throttleReason = "Over max calls today";
                throttleCall = true;
            }
        }

        if (this.#throttleHours) {
            var currentHour = new Date().getHours();
            if (currentHour >= this.#throttleHours[0] &&
                currentHour <= this.#throttleHours[1]) {
                
                throttleReason = "Within throttling hours";
                throttleCall = true;
            }
        }

        if (throttleCall && this.#overrideThrottleCallback) {
            var overrideThrottle = this.#overrideThrottleCallback(this, throttleReason);
            if (overrideThrottle) {
                throttleReason = undefined;
                throttleCall = false;
            }
        }

        if (throttleCall) {
            this.#totalThrottledCallCount++;
            if (throttleCallback) throttleCallback(throttleReason);
            return false;
        } else {
            this.#totalCallCount++;
            this.#callsToday++;
            this.#lastCallTimestamp = Date.now();

            func();

            return true;
        }
    }

    logThrottlingConditions() {
        var limitations = [];

        if (this.maxCalls)
            limitations = limitations.concat(`A maximum of ${this.maxCalls} calls in total`);
        
        if (this.maxCallsPerDay)
            limitations = limitations.concat(`A maximum of ${this.maxCallsPerDay} calls per day`);

        if (this.minimumTimeBetweenCalls)
            limitations = limitations.concat(`At least ${this.minimumTimeBetweenCalls/1000}s between calls`);
        
        if (this.#throttleHours)
            limitations = limitations.concat(`No calls between ${this.#throttleHours[0]}:00 and ${this.#throttleHours[1]}:00`);

        if (this.#overrideThrottleCallback)
            limitations = limitations.concat(`Throttling can be overriden by calls to ${this.#overrideThrottleCallback}`);

        if (limitations.length > 0)
        {
            console.log(limitations);
        } else {
            console.log("No limitations");
        }
    }
}

module.exports = Throttler;