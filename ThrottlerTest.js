const Throttler = require("./Throttler.js");

const throttlerMirror = new Throttler();
throttlerMirror.minimumTimeBetweenCalls = 100;
throttlerMirror.maxCallsPerDay = 30;
throttlerMirror.setThrottleHours(22,8);
throttlerMirror.logThrottlingConditions();

for (var i=0; i<10000; i++){
    throttlerMirror.execute(() => console.log("Called"), (reason) => console.warn("Throttled due to "+reason));
}


const throttler1 = new Throttler();
throttler1.maxCalls = 10;

for (var i=0; i<20; i++) {
    throttler1.execute(() => console.log(`Call ${i}`));
}

throttler1.logThrottlingConditions();

throttler1.reset();
throttler1.maxCalls = 5;

for (var i=0; i<20; i++) {
    throttler1.execute(() => console.log(`Call ${i}`));
}

const throttler2 = new Throttler();
throttler2.minimumTimeBetweenCalls = 100;
throttler2.logThrottlingConditions();

var i=0;
for (; i<5; ) {
    var executed = throttler2.execute(() => {console.log("Executed"); i++;}, (reason) => console.warn("Throttled due to "+reason));
}

console.log(`throttler2 handled ${throttler2.totalCallCount} calls and throttled ${throttler2.totalThrottledCallCount}`);

const throttler3 = new Throttler();
throttler3.logThrottlingConditions();
var currentHour = new Date().getHours();
throttler3.setThrottleHours(currentHour, currentHour+1);
throttler3.logThrottlingConditions();
throttler3.execute(() => console.log("Executed"), (reason) => console.warn("Throttled due to "+reason));

throttler3.setThrottleHours(currentHour+1, currentHour-1);
throttler3.execute(() => console.log("Executed"), (reason) => console.warn("Throttled due to "+reason));
throttler3.maxCallsPerDay = 42;
throttler3.logThrottlingConditions();


const throttler4 = new Throttler();
throttler4.maxCalls = 10;
throttler4.setOverrideThrottleCallback(function(throttler, reason) {
    var override = throttler.totalCallCount<=20; // Unless total call count <=20, override throttling
    console.log("Override "+reason+" ? "+override);
    return override;
});
throttler4.logThrottlingConditions();

for (var x=0; x<100; x++)
{
    throttler4.execute(() => console.log("Excecuted"), (reason) => console.warn("Throttled due to "+reason));
}
