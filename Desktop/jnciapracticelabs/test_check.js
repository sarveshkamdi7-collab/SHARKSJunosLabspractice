const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = __dirname;
function load(p){ vm.runInThisContext(fs.readFileSync(path.join(root,p),'utf8'), {filename:p}); }
['public/js/junos/util.js','public/js/junos/db.js','public/js/junos/model.js','public/js/junos/derive.js','public/js/junos/schema.js','public/js/junos/machine.js'].forEach(load);
const J = global.JJ;
const devs = {};
devs.R1 = J.machine.createDeviceRuntime('R1');
devs.R2 = J.machine.createDeviceRuntime('R2');
devs.R3 = J.machine.createDeviceRuntime('R3');
devs.SW1 = J.machine.createDeviceRuntime('SW1');
const w = J.net.buildWorld(devs);
console.log(w.devices.R1.ospfNeighbors.length);
console.log(J.net.tracePath(w,'R1','3.3.3.3').ok);
