// module Throttler.js
/**
 * Throttler class to manage and limit the rate of function calls.
 */
class Throttler {
    #totalCallCount = 0;
    #totalThrottledCallCount = 0;
    #lastCallTimestamp;
    #callsToday = 0;
    #overrideThrottleCallback = undefined; // function(Throttler throttler, string throttleReason): bool

    #maxCalls = undefined;
    #maxCallsPerDay = undefined;
    #minimumTimeBetweenCalls = undefined;
    #throttleHours = undefined;

    constructor() {
    }

    /**
     * Get the total number of calls made.
     */
    get totalCallCount() {
        return this.#totalCallCount;
    }

    /**
     * Get the total number of throttled calls.
     */
    get totalThrottledCallCount() {
        return this.#totalThrottledCallCount;
    }
    
    /**
     * Get the number of calls made today.
     */
    get todaysCallCount() {
        return this.#callsToday;
    }

    /**
     * get/set the maximum number of calls allowed in total
     */
    get maxCalls() { 
        return this.#maxCalls;
    }
    set maxCalls(value) { 
        this.#maxCalls = value;
    }

    /**
     * get/set the maximum number of calls allowed per day
     */
    get maxCallsPerDay() { 
        return this.#maxCallsPerDay;
    }
    set maxCallsPerDay(value) { 
        this.#maxCallsPerDay = value;
    }

    /**
     * get/set the minimum time between calls in milliseconds
     */
    get minimumTimeBetweenCalls() { 
        return this.#minimumTimeBetweenCalls;
    }
    set minimumTimeBetweenCalls(value) { 
        this.#minimumTimeBetweenCalls = value;
    }

    /**
     * Get the throttling hours as [startHour, endHour].
     */
    get throttleHours() { 
        return this.#throttleHours;
    }

    /**
     * Set the throttling hours.
     * @param {Number} start Hour when throttling starts
     * @param {Number} end Hour when throttling ends
     */
    setThrottleHours(start, end) {
        this.#throttleHours = [start, end];
    }
    
    /**
     * Set a callback function to be called when throttling occurs.
     * Can be used to override throttling based on custom logic.
     * @param {function} cb Callback
     */
    setOverrideThrottleCallback(cb) {
        this.#overrideThrottleCallback = cb;
    }
    
    /**
     * Reset all throttling statistics and settings.
     */
    reset() {
        this.#totalCallCount = 0;
        this.#totalThrottledCallCount = 0;
        this.#callsToday = 0;
        this.#lastCallTimestamp = undefined;
        this.#throttleHours = undefined;
        this.#overrideThrottleCallback = undefined;
    }

    /**
     * Forcefully execute a function and bypass throttling.
     * @param {function} func Function to execute
     * @returns {boolean} True
     */
    forceExecute(func) {
        this.#totalCallCount++;
        this.#callsToday++;
        this.#lastCallTimestamp = Date.now();

        func();

        return true;
    }

    /**
     * Execute a function with throttling.
     * @param {function} func Function to execute
     * @param {function(reason)} throttleCallback Callback to call when throttling occurs
     * @returns {boolean} True if the function was executed, false if throttled
     */
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

    /**
     * Log the current throttling conditions to the console.
     */
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