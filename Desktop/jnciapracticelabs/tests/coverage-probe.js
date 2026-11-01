'use strict';
/* Coverage probe: every command referenced by the UI (command ref + guides)
   must dispatch without caret/unknown errors. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const base = path.join(__dirname, '../public/js');
for (const f of ['junos/util.js', 'junos/db.js', 'junos/model.js', 'junos/derive.js', 'junos/schema.js', 'junos/machine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
}
const JJ = global.JJ;
JJ._rts = {}; JJ._devsAll = null;

let fails = 0, total = 0;
function isErr(lines) {
  const s = (lines || []).join('\n');
  return /\^|^% |% Unknown|% Ambiguous|syntax error|Invalid|invalid input|Invalid EXP|invalid exp|not valid|undefined/i.test(s.replace(/error: system alarm/g, '').replace(/error: device does not have irb configured/, '')) === false ? false : s;
}
function runOne(name, rtKey, setup, cmd, mode) {
  total++;
  const rt = rtKey === 'R1' ? rtR1 : (rtKey === 'SW1' ? rtSW1 : rtR2);
  const sess = rtKey === 'R1' ? s1 : (rtKey === 'SW1' ? s2 : s3);
  if (sess.mode === 'cli-cfg') JJ.machine.feed(sess, 'quit');
  if (setup && sess.mode !== 'cli-cfg') JJ.machine.feed(sess, 'configure');
  JJ.machine.feed(sess, 'configure');
  if (setup) { for (const l of setup) { const o = JJ.machine.feed(sess, l); const e = isErr(o.lines); if (e) { fails++; console.log('SETUP-FAIL ' + name + ' :: ' + l); return; } } }
  if (mode === 'op') { if (sess.mode === 'cli-cfg') JJ.machine.feed(sess, 'quit'); }
  const out = JJ.machine.feed(sess, cmd);
  const bad = isErr(out.lines);
  if (bad) { fails++; console.log('FAIL: ' + name + ' [' + rtKey + ']\n   ' + (out.lines || []).join('\n   ')); }
  if (sess.mode === 'cli-cfg') JJ.machine.feed(sess, 'quit');
}

// build the three device runtimes
JJ._rts = {}; JJ._devsAll = null;
const rtR1 = JJ.machine.createDeviceRuntime('R1');
const s1 = JJ.machine.createSession(rtR1, JJ.machine.getWorld());
JJ.machine.feed(s1, 'user');
const rtR2 = JJ.machine.createDeviceRuntime('R2');
const s3 = JJ.machine.createSession(rtR2, JJ.machine.getWorld());
JJ.machine.feed(s3, 'user');
const rtSW1 = JJ.machine.createDeviceRuntime('SW1');
const s2 = JJ.machine.createSession(rtSW1, JJ.machine.getWorld());
JJ.machine.feed(s2, 'user');

// R1 fixture (scenario from smoke, + BGP/AS + irb +岀 static)
const cfgR1 = [
  'set interfaces ge-0/0/1 unit 0 description HOSTS-LAN',
  'set interfaces ge-0/0/1 unit 0 family inet address 192.168.10.1/24 vrrp-group 1 virtual-address 192.168.10.254',
  'set interfaces irb unit 10 family inet address 192.168.10.10/24',
  'set security zones security-zone TRUST interfaces ge-0/0/1',
  'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS match source-address any',
  'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS match destination-address 203.0.113.0/24',
  'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS match application any',
  'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS then permit',
  'set security policies default-policy deny-all',
  'set security nat source rule-set SNAT from zone TRUST to zone UNTRUST rule SR-1 match source-address 192.168.10.0/24',
  'set security nat source rule-set SNAT from zone TRUST to zone UNTRUST rule SR-1 then source-nat interface',
  'set security ike gateway GW-1 address 203.0.113.2',
  'set security ipsec vpn VPN-1 ike-gateway GW-1',
  'set protocols ospf area 0 interface ge-0/0/0 bfd-liveness-detection minimum-interval 300 multiplier 5',
  'set protocols isis interface ge-0/0/0 level 2',
  'set protocols mpls interface ge-0/0/0',
  'set protocols ldp interface ge-0/0/0',
  'set routing-options autonomous-system 65001',
  'set protocols bgp group EBGP type external',
  'set protocols bgp group EBGP neighbor 10.0.12.2 peer-as 65002',
  'set policy-options policy-statement EXPORT-C term T1 from protocol direct',
  'set protocols bgp group EBGP export EXPORT-C',
  'set routing-options static route 10.99.99.0/24 next-hop 192.0.2.99 bfd-liveness-detection minimum-interval 300'
];
JJ.machine.feed(s1, 'configure');
for (const l of cfgR1) JJ.machine.feed(s1, l);
JJ.machine.feed(s1, 'commit');
JJ.machine.feed(s1, 'exit');
JJ.machine.feed(s1, 'show configuration | save /var/tmp/base.set');

// SW1 switch rows need nothing extra (ex platform baseline)

// ---- operational rows (R1 unless named) ----
const opR1 = [
  ['show version'], ['show system information'], ['show system uptime'], ['show system alarms'],
  ['show chassis hardware'], ['show interfaces terse'], ['show interfaces descriptions'],
  ['show interfaces extensive ge-0/0/0'], ['show arp'], ['show route'], ['show configuration'],
  ['show lldp neighbors'], ['show route table inet.0 summary'], ['show route protocol static'],
  ['show route protocol bgp'], ['show route hidden'], ['show ospf neighbor'], ['show ospf interface'],
  ['show ospf database'], ['show bgp summary'], ['show bgp neighbor'], ['show bfd session'],
  ['show bfd session detail'], ['show ldp neighbor'], ['show mpls interface'], ['show isis adjacency'],
  ['show vrrp'], ['show security zones'], ['show security policies'], ['show security policies hit-count'],
  ['show security flow session'], ['show security nat source summary'], ['show system commit'],
  ['file show /var/tmp/base.set'], ['monitor traffic interface ge-0/0/0'], ['ping 10.0.23.2'], ['traceroute 3.3.3.3'],
  ['show interfaces irb'], ['show interfaces irb terse']
];
const opSW1 = [
  ['show ethernet-switching table'], ['show vlans'], ['show ethernet-switching interfaces'],
  ['show spanning-tree bridge'], ['show lldp neighbors'], ['show interfaces terse']
];
const opR2 = [['show version'], ['show bgp summary']];
opR1.forEach(c => runOne(c[0], 'R1', null, c[0], 'op'));
opSW1.forEach(c => runOne(c[0], 'SW1', null, c[0], 'op'));
opR2.forEach(c => runOne(c[0], 'R2', null, c[0], 'op'));

// ---- configuration rows ----
const cfgRows = [
  ['set system host-name R1', null],
  ['set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30', null],
  ['set protocols ospf area 0.0.0.0 interface ge-0/0/0.0', null],
  ['set routing-options autonomous-system 65001', null],
  ['set protocols bgp group EBGP type external', null],
  ['set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT match source-address any', null],
  ['show | compare', null],
  ['show configuration | display set', null],
  ['show configuration | save /var/tmp/base.set', null],
  ['replace pattern OLDNAME NEWNAME', ['set interfaces ge-0/0/9 description OLDNAME']],
  ['wildcard delete interfaces ge-9/*', ['set interfaces ge-9/0/0 description WILDCARD-A', 'set interfaces ge-9/0/1 description WILDCARD-B']],
  ['protect interfaces ge-0/0/1', null],
  ['unprotect interfaces ge-0/0/1', null],
  ['commit check', null],
  ['commit', null],
  ['commit comment "baseline"', null],
  ['commit at 23:30', null],
  ['commit confirmed 5', null],
  ['commit synchronize', null]
];
cfgRows.forEach(r => runOne(r[0], 'R1', r[1], r[0], 'cfg'));
runOne('delete interfaces ge-0/0/9', 'R1', null, 'delete interfaces ge-0/0/9', 'cfg');

// ---- terminal/script loads (pending flows) ----
runOne('load merge terminal', 'R1', null, 'load merge terminal', 'cfg');
JJ.machine.feed(s1, '}'); JJ.machine.feed(s1, ''); // abort-safe EOF? actually load merge needs valid script; pending accept empty = load complete with no change? it should end pend mode
if (s1.mode === 'cli-cfg') { /* still fine */ }

JJ.machine.feed(s1, 'exit');
const finalState = { r1mode: s1.mode, r2mode: s3.mode, swmode: s2.mode };
console.log('modes: ' + JSON.stringify(finalState));
console.log('COVERAGE: ' + (total - fails) + '/' + total + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
