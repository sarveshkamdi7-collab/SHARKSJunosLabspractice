'use strict';
/* CLI fidelity gate: pins the Junos behaviours that the console promises.
   Runs the real engine in a Node VM, no browser, no network. */

const fs = require('fs'), vm = require('vm'), path = require('path');
const base = path.join(__dirname, '../public/js');
const files = ['junos/util.js', 'junos/db.js', 'junos/model.js', 'junos/derive.js', 'junos/schema.js', 'junos/machine.js'];
for (const f of files) vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });

const J = global.JJ;
J._rts = {};
J._devsAll = null;

let passed = 0, failed = 0;
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('PASS: ' + name); }
  else { failed++; console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}

const rt = J.machine.createDeviceRuntime('R1');
const sess = J.machine.createSession(rt, J.machine.getWorld());
function feed(line) { return J.machine.feed(sess, line); }
function text(line) { return (feed(line).lines || []).join('\n'); }
function prompt() { return J.machine.promptFor(sess); }
function node(p) { return J.db.nodeAt(rt.candidate, p, false); }

feed('user');

// ---------- hierarchy navigation ----------
feed('configure');
ok('configure prompt is [edit]', prompt().indexOf('[edit]\nuser@R1# ') === 0, JSON.stringify(prompt()));

feed('edit interfaces');
ok('edit existing block', prompt().indexOf('[edit interfaces]\n') === 0, JSON.stringify(prompt()));

feed('edit ge-0/0/0 unit 0');
ok('nested edit prompt', prompt().indexOf('[edit interfaces ge-0/0/0 unit 0]\n') === 0, JSON.stringify(prompt()));

feed('exit');
ok('exit steps up one level', sess.mode === 'cli-cfg' && prompt().indexOf('[edit interfaces ge-0/0/0]\n') === 0, JSON.stringify(prompt()));

feed('up 2');
ok('up 2 pops to [edit]', prompt().indexOf('[edit]\n') === 0, JSON.stringify(prompt()));

feed('top');
ok('top resets hierarchy', prompt().indexOf('[edit]\n') === 0, JSON.stringify(prompt()));

// ---------- edit auto-creates, set is relative ----------
const editOut = feed('edit interfaces ge-9/9/9 unit 0 family inet');
ok('edit into missing path has no warning', (editOut.lines || []).length === 0, JSON.stringify(editOut.lines));
ok('edit into missing path updates prompt', prompt().indexOf('[edit interfaces ge-9/9/9 unit 0 family inet]\n') === 0, JSON.stringify(prompt()));
ok('empty hierarchy renders nothing', text('show').trim() === '', JSON.stringify(text('show')));

feed('set address 192.0.2.1/24');
ok('relative set writes candidate', !!node(['interfaces', 'ge-9/9/9', 'unit', '0', 'family', 'inet', 'address', '192.0.2.1/24']));

feed('top');
const newBlock = text('show | compare');
ok('compare shows the new block', newBlock.indexOf('+ ge-9/9/9 {') >= 0 && /\+.*address 192\.0\.2\.1\/24;/.test(newBlock), newBlock);
feed('delete interfaces ge-9/9/9');
ok('delete removes the test block', !node(['interfaces', 'ge-9/9/9']));

// ---------- value diff ----------
feed('set interfaces ge-0/0/0 description FIDELITY');
const descDiff = text('show | compare');
ok('diff header is the parent block', descDiff.indexOf('[edit interfaces ge-0/0/0]') >= 0, descDiff);
ok('diff removes the old value', descDiff.indexOf('- description "LINK TO R2";') >= 0, descDiff);
ok('diff adds the new value', descDiff.indexOf('+ description "FIDELITY";') >= 0, descDiff);

const matched = text('show | compare | match FIDELITY');
ok('match keeps only matching lines', matched.indexOf('FIDELITY') >= 0 && matched.indexOf('LINK TO R2') < 0, matched);
const matchedCount = text('show | compare | match description | count');
ok('chained pipes: match then count', matchedCount.trim() === '2', matchedCount);

// ---------- commit / rollback ----------
ok('commit check', text('commit check').indexOf('configuration check succeeds') >= 0);
ok('commit complete', text('commit').indexOf('commit complete') >= 0);
ok('compare clean after commit', text('show | compare').trim() === '');

ok('rollback 1 loads', text('rollback 1').indexOf('load complete') >= 0);
const rbDiff = text('show | compare');
ok('rollback diff removes the commit', rbDiff.indexOf('- description "FIDELITY";') >= 0, rbDiff);
ok('rollback diff restores the old value', rbDiff.indexOf('+ description "LINK TO R2";') >= 0, rbDiff);
ok('rollback diff keeps the unchanged value', rbDiff.indexOf('- description "LINK TO R2";') < 0, rbDiff);
ok('rollback header has no address value', rbDiff.indexOf('/30]') < 0 && rbDiff.indexOf('/24]') < 0, rbDiff);

// address add/remove must not touch the sibling address
feed('set interfaces ge-0/0/0 unit 0 family inet address 192.168.1.1/24');
const addrDiff = text('show | compare');
ok('address diff adds only the new address', addrDiff.indexOf('+ address 192.168.1.1/24;') >= 0, addrDiff);
ok('address diff keeps the existing address', addrDiff.indexOf('- address 10.0.12.1/30;') < 0, addrDiff);
ok('address diff header excludes the value', addrDiff.indexOf('[edit interfaces ge-0/0/0 unit 0 family inet]') >= 0, addrDiff);

text('rollback 0');
ok('rollback 0 discards the candidate', !node(['interfaces', 'ge-0/0/0', 'unit', '0', 'family', 'inet', 'address', '192.168.1.1/24']));
ok('rollback 0 compare is empty', text('show | compare').trim() === '');
ok('rollback past history errors', text('rollback 2').indexOf('exceeds') >= 0);

// ---------- exit / quit ----------
feed('edit interfaces ge-0/0/0');
feed('quit');
ok('quit leaves configuration mode at once', sess.mode === 'cli-op' && prompt().indexOf('user@R1> ') >= 0, JSON.stringify(prompt()));

feed('configure');
feed('set interfaces ge-0/0/0 description PENDING');
const exitOut = feed('exit');
const exitTxt = (exitOut.lines || []).join('\n');
ok('exit at [edit] warns about uncommitted changes', exitTxt.indexOf('uncommitted') >= 0, exitTxt);
ok('exit confirmation keeps config mode', sess.mode === 'cli-cfg');
feed('no');
ok('answering no stays in config mode', sess.mode === 'cli-cfg');
feed('exit');
feed('yes');
ok('answering yes leaves config mode', sess.mode === 'cli-op' && prompt().indexOf('user@R1> ') >= 0, JSON.stringify(prompt()));

// ---------- operational output ----------
const terse = text('show interfaces terse');
ok('terse header', terse.indexOf('Interface               Admin Link Proto    Local                 Remote') === 0, terse.split('\n')[0]);
ok('terse physical row', /\nge-0\/0\/0\s+up\s+up/.test(terse), terse);
ok('terse unit row has proto and address', /\nge-0\/0\/0\.0\s+up\s+up\s+inet\s+10\.0\.12\.1\/30/.test(terse), terse);
ok('terse loopback points at 0/0', /\nlo0\.0\s+up\s+up\s+inet\s+1\.1\.1\.1\/32\s+--> 0\/0/.test(terse), terse);

const detail = text('show interfaces ge-0/0/0');
ok('detail physical header', detail.indexOf('Physical interface: ge-0/0/0') === 0, detail.split('\n')[0]);
ok('detail MTU 1514', detail.indexOf('MTU: 1514') >= 0, detail);
ok('detail traffic statistics', detail.indexOf('Traffic statistics:') >= 0 && detail.indexOf('Input  bytes') >= 0, detail);
ok('detail logical unit', detail.indexOf('Logical interface ge-0/0/0.0') >= 0, detail);

const route = text('show route');
ok('route table header', /inet\.0: \d+ destinations, \d+ routes \(\d+ active, 0 holddown, 0 hidden\)/.test(route), route.split('\n')[1]);
ok('route direct entry', /\*\[Direct\/0\]/.test(route), route);
ok('route local entry', /\*\[Local\/0\]/.test(route), route);
ok('route local via interface', /Local via ge-0\/0\/0\.0/.test(route), route);
ok('route static default', route.indexOf('0.0.0.0/0') >= 0, route);

const routeDetail = text('show route 10.0.12.0/30 detail');
ok('route detail state line', routeDetail.indexOf('State: <Active Int>') >= 0, routeDetail);
ok('route detail metric line', routeDetail.indexOf('Metric: 0') >= 0, routeDetail);

const summary = text('show route summary');
ok('route summary counts destinations', /inet\.0: \d+ destinations, \d+ routes/.test(summary), summary);
ok('route summary lists protocols', /Direct:\s+\d+ routes,/.test(summary), summary);

const arp = text('show arp');
ok('arp header columns', arp.indexOf('MAC Address       Address         Name                      Interface           Flags') === 0, arp.split('\n')[0]);
ok('arp total entries', /Total entries: \d+/.test(arp), arp);

// ---------- pipes ----------
const mi = text('show interfaces terse | match inet');
ok('match filters lines', mi.length > 0 && mi.split('\n').every(l => l.indexOf('inet') >= 0), mi);
const ex = text('show interfaces terse | except lo');
ok('except drops lines', ex.indexOf('lo0') < 0 && ex.length > 0, ex);
const cnt = text('show interfaces terse | count');
ok('count returns a number', /^\d+$/.test(cnt.trim()), cnt);
const ds = text('show configuration | display set | match interfaces');
ok('display set + match', ds.length > 0 && ds.split('\n').every(l => l.indexOf('set interfaces') === 0), ds);
const dsc = text('show configuration | display set | count');
ok('display set + count', /^\d+$/.test(dsc.trim()), dsc);

// ---------- switch platform ----------
const rtSW = J.machine.createDeviceRuntime('SW1');
const sessSW = J.machine.createSession(rtSW, J.machine.getWorld());
J.machine.feed(sessSW, 'user');
const swTerse = (J.machine.feed(sessSW, 'show interfaces terse').lines || []).join('\n');
ok('switch terse uses eth-switch', swTerse.indexOf('eth-switch') >= 0, swTerse);

// ---------- revision history cap ----------
const rt2 = J.machine.createDeviceRuntime('R2');
const sess2 = J.machine.createSession(rt2, J.machine.getWorld());
J.machine.feed(sess2, 'user');
J.machine.feed(sess2, 'configure');
for (let i = 0; i < 55; i++) {
  J.machine.feed(sess2, 'set system host-name R2-' + i);
  J.machine.feed(sess2, 'commit');
}
ok('revision history caps at 50', (rt2.revisions || []).length === 50, String((rt2.revisions || []).length));
J.machine.feed(sess2, 'rollback 1');
const hn = J.db.nodeAt(rt2.candidate, ['system', 'host-name'], false);
ok('rollback 1 restores the previous commit', hn && hn.values[0] === 'R2-53', hn ? JSON.stringify(hn.values) : 'missing');

console.log('\nCLI FIDELITY: ' + passed + '/' + (passed + failed) + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
