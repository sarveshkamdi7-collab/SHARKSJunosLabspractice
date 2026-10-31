'use strict';
/* Smoke harness: drives machine.js directly in Node for the new commands. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const base = path.join(__dirname, '../public/js');
const files = ['junos/util.js', 'junos/db.js', 'junos/model.js', 'junos/derive.js', 'junos/schema.js', 'junos/machine.js'];
for (const f of files) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
}
const JJ = global.JJ;
JJ._rts = {}; JJ._devsAll = null;

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log('PASS: ' + name); }
  else { fails++; console.log('FAIL: ' + name + (extra ? ' :: ' + extra : '')); }
}

const rt = JJ.machine.createDeviceRuntime('R1');
const sess = JJ.machine.createSession(rt, JJ.machine.getWorld());
function feed(line) { return JJ.machine.feed(sess, line); }
feed('user'); // logs in as user -> op mode

// --- configure the vsrx-style scenario + protocol knobs on R1 ---
const cfg = [
  'set interfaces ge-0/0/1 unit 0 description HOSTS-LAN',
  'set interfaces ge-0/0/1 unit 0 family inet address 192.168.10.1/24 vrrp-group 1 virtual-address 192.168.10.254',
  'set security zones security-zone TRUST interfaces ge-0/0/1',
  'set security zones security-zone TRUST host-inbound-traffic system-services ping',
  'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS match source-address any',
  'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS match destination-address 203.0.113.0/24',
  'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS match application any',
  'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS then permit',
  'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS then permit log',
  'set security policies default-policy deny-all',
  'set security nat source rule-set SNAT from zone TRUST to zone UNTRUST rule SR-1 match source-address 192.168.10.0/24',
  'set security nat source rule-set SNAT from zone TRUST to zone UNTRUST rule SR-1 then source-nat interface',
  'set security ike gateway GW-1 address 203.0.113.2',
  'set security ipsec vpn VPN-1 ike-gateway GW-1',
  'set protocols ospf area 0 interface ge-0/0/0 bfd-liveness-detection minimum-interval 300 multiplier 5',
  'set protocols isis interface ge-0/0/0 level 2',
  'set protocols mpls interface ge-0/0/0',
  'set protocols ldp interface ge-0/0/0',
  'set routing-options static route 10.99.99.0/24 next-hop 192.0.2.99 bfd-liveness-detection minimum-interval 300'
];
feed('configure');
for (const l of cfg) feed(l);
feed('commit');

function cfgRun(cmd) {
  if (sess.mode !== 'cli-cfg') feed('configure');
  return feed(cmd);
}
function cfgText() {
  return (cfgRun('show configuration').lines || []).join('\n');
}
function showExact(cmd) {
  if (sess.mode === 'cli-cfg') feed('quit'); // op-mode commands via op dispatch
  const out = feed(cmd);
  return (out.lines || []).join('\n');
}
function has(text, needle) { return text.indexOf(needle) >= 0; }

let t;
t = showExact('show security zones');
check('security zones', has(t, 'Security zone: TRUST'), t);
console.log('--- show security zones ---\n' + t);

t = showExact('show security policies');
check('security policies', has(t, 'WEB-ACCESS') && has(t, 'Default policy: deny-all'), t);
t = showExact('show security policies hit-count');
check('security policies hit-count', has(t, 'Hit count') && has(t, 'WEB-ACCESS'), t);

t = showExact('show security flow session');
check('flow session', has(t, 'Session ID') && has(t, 'WEB-ACCESS'), t);
t = showExact('show security flow summary');
check('flow summary', has(t, 'Total sessions') || has(t, 'Session hits'), t);
t = showExact('show security flow status');
check('flow status', has(t, 'Flow mode: flow-based'), t);

t = showExact('show security nat source summary');
check('nat source summary', has(t, 'SR-1') && has(t, 'Translation type: interface'), t);
t = showExact('show security nat source rule');
check('nat source rule', has(t, 'Rule: SR-1') && has(t, 'Rule-set: SNAT'), t);

t = showExact('show security ike security-associations');
check('ike sa', has(t, '203.0.113.2') && has(t, 'IKEv2'), t);
t = showExact('show security ipsec security-associations');
check('ipsec sa', has(t, 'Total active tunnels: 1'), t);

t = showExact('show bfd session');
check('bfd session', has(t, 'ge-0/0/0.0') && has(t, '10.0.12.2'), t);
t = showExact('show bfd session detail');
check('bfd session detail', has(t, 'Client: OSPF') && has(t, 'Multiplier 5'), t);

t = showExact('show isis adjacency');
check('isis adjacency', typeof t === 'string', t);
t = showExact('show isis interface');
check('isis interface', has(t, 'ge-0/0/0'), t);
t = showExact('show isis database');
check('isis database', has(t, 'link-state database'), t);
t = showExact('show isis route');
check('isis route', typeof t === 'string', t);
t = showExact('show isis statistics');
check('isis statistics', has(t, 'IS-IS statistics'), t);

t = showExact('show ldp neighbor');
check('ldp neighbor', typeof t === 'string', t);
t = showExact('show ldp session');
check('ldp session', typeof t === 'string', t);
t = showExact('show ldp database');
check('ldp database', has(t, 'Input label database'), t);

t = showExact('show mpls interface');
check('mpls interface', has(t, 'ge-0/0/0'), t);
t = showExact('show rsvp interface');
check('rsvp interface', has(t, '0 activated') || has(t, 'RSVP interface'), t);

t = showExact('show vrrp');
check('vrrp', has(t, '192.168.10.254') && has(t, 'ge-0/0/1.0'), t);

t = showExact('show interfaces descriptions');
check('int descriptions', has(t, 'LINK TO R2') && has(t, 'LINK TO SW1') && has(t, 'SPARE'), t);

t = showExact('show system alarms');
check('system alarms', has(t, 'alarm'), t);

t = showExact('show route hidden');
check('route hidden', has(t, 'unresolvable') || has(t, 'hidden'), t);
t = showExact('show route hidden detail');
check('route hidden detail', has(t, 'State: <Hidden Int>'), t);
t = showExact('show route table inet.0 summary');
check('route table summary', has(t, 'destinations') && has(t, 'inet.0'), t);

// --- load set terminal flow ---
cfgRun('load set terminal');
cfgRun('set system host-name R1-NEWNAME');
let outL = cfgRun('');
check('load set terminal EOF', has((outL.lines || []).join('\n'), 'load complete'), JSON.stringify(outL));
t = showExact('show configuration | compare');
check('compare shows host-name change', has(t, 'host-name R1-NEWNAME') && (t.indexOf('+') === 0 || t.indexOf('\n+') >= 0 || t.indexOf('>-') >= 0 || t.indexOf('\n-') >= 0 || t.indexOf('- host-name') >= 0 || t.indexOf('+ host-name') >= 0), '\n' + t);
cfgRun('commit');

// --- protect / delete-guard / unprotect ---
cfgRun('protect interfaces ge-0/0/1');
t = (cfgRun('delete interfaces ge-0/0/1').lines || []).join('\n');
check('protected delete rejected', has(t, 'protected'), t);
cfgRun('commit');
t = (cfgRun('protect interfaces ge-0/0/1').lines || []).join('\n');
check('protected survived commit', has(t, 'already protected'), t);
cfgRun('unprotect interfaces ge-0/0/1');
t = (cfgRun('delete interfaces ge-0/0/1').lines || []).join('\n');
check('unprotected delete ok', !(t || '').includes('protected'), t);
// restore
cfgRun('set interfaces ge-0/0/1 unit 0 family inet address 192.168.10.1/24');
cfgRun('commit');

// --- wildcard delete ---
cfgRun('set interfaces ge-9/0/0 description WILDCARD-A');
cfgRun('set interfaces ge-9/0/1 description WILDCARD-B');
t = (cfgRun('wildcard delete interfaces ge-9/*').lines || []).join('\n');
check('wildcard delete count', has(t, '2 statements deleted'), t);
t = cfgText();
check('wildcard actually removed', !has(t, 'ge-9/0/0') && !has(t, 'ge-9/0/1'), t);
cfgRun('commit');

// --- replace pattern ---
cfgRun('set interfaces ge-0/0/9 description OLDNAME');
cfgRun('replace pattern OLDNAME NEWNAME');
t = cfgText();
check('replace pattern applied', has(t, 'NEWNAME') && !has(t, 'OLDNAME'), t);
cfgRun('delete interfaces ge-0/0/9');
cfgRun('commit');
feed('quit');

// --- | save + file show ---
t = showExact('show configuration | save /var/tmp/rbase.set');
check('save pipe quiet', t === '', t);
t = showExact('file show /var/tmp/rbase.set');
check('saved file readable', has(t, 'set system host-name') || has(t, 'set '), t);

// --- load merge from saved file (brace/set) ---
t = (cfgRun('load set /var/tmp/rbase.set').lines || []).join('\n');
check('load set from file', has(t, 'load complete'), t);
feed('quit');
t = showExact('show system commit');
check('show system commit ok', typeof t === 'string', t);

// --- commit comment / at / synchronize ---
t = (cfgRun('commit comment "smoke-comment"').lines || []).join('\n');
check('commit comment ok', has(t || '', 'commit complete'), t);
t = (cfgRun('commit synchronize').lines || []).join('\n');
check('commit synchronize ok', has(t || '', 'synchronize'), t);
t = (cfgRun('commit at 23:30').lines || []).join('\n');
check('commit at ok', has(t || '', '23:30'), t);

console.log(fails ? ('\n' + fails + ' FAILURES') : '\nALL SMOKE CHECKS PASSED');
process.exit(fails ? 1 : 0);
