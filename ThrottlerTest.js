const Throttler = require("./Throttler.js");

const throttlerMirror = new Throttler();
throttlerMirror.minimumTimeBetweenCalls = 100;
throttlerMirror.maxCallsPerDay = 30;
throttlerMirror.setThrottleHours(22,8);
throttlerMirror.logThrottlingConditions();

for (var i=0; i<100000; i++){
    throttlerMirror.execute(() => console.log("Called"), (r) => console.log("Throttled: "+r));
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
    var executed = throttler2.execute(() => {console.log("Executed"); i++;}, () => console.log("Throttled"));
}

console.log(`throttler2 handled ${throttler2.totalCallCount} calls and throttled ${throttler2.totalThrottledCallCount}`);

const throttler3 = new Throttler();
throttler3.logThrottlingConditions();
var currentHour = new Date().getHours();
throttler3.setThrottleHours(currentHour, currentHour+1);
throttler3.logThrottlingConditions();
throttler3.execute(() => console.log("Executed"), () => console.log("Throttled"));

throttler3.setThrottleHours(currentHour+1, currentHour-1);
throttler3.execute(() => console.log("Executed"), () => console.log("Throttled"));
throttler3.maxCallsPerDay = 42;
throttler3.logThrottlingConditions();

