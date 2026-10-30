'use strict';
/* BGP preset engine probe: PURE preset configs (mirrors the UI's resetRuntime
   seeding), fresh world build, then asserts the real CLI outputs on both peers. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const base = path.join(__dirname, '../public/js');
for (const f of ['junos/util.js', 'junos/db.js', 'junos/model.js', 'junos/derive.js', 'junos/schema.js', 'junos/machine.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
}
const JJ = global.JJ;
JJ._rts = {}; JJ._devsAll = null;

let fails = 0;
function check(name, cond, extra) {
  if (cond) { console.log('PASS: ' + name); }
  else { fails++; console.log('FAIL: ' + name + (extra ? ' :: ' + String(extra).replace(/\n/g, ' | ').slice(0, 400) : '')); }
}

// exact set lines from core.js APP.PRESETS.bgp
const CFG = {
  R1: [
    'set system host-name R1',
    'set interfaces ge-0/0/0 description LINK-TO-R2-AS65002',
    'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30',
    'set interfaces ge-0/0/1 description HOST-LAN-A',
    'set interfaces ge-0/0/1 unit 0 family inet address 192.168.10.1/24',
    'set interfaces lo0 unit 0 family inet address 1.1.1.1/32',
    'set routing-options autonomous-system 65001',
    'set routing-options router-id 1.1.1.1',
    'set protocols bgp group EBGP type external',
    'set protocols bgp group EBGP bfd-liveness-detection minimum-interval 300',
    'set protocols bgp group EBGP bfd-liveness-detection multiplier 3',
    'set protocols bgp group EBGP neighbor 10.0.12.2 peer-as 65002',
    'set policy-options policy-statement EXPORT-CONNECTED term DIRECT from protocol direct',
    'set protocols bgp group EBGP export EXPORT-CONNECTED',
    'set policy-options policy-statement EXPORT-STATIC term ST1 from protocol static',
    'set protocols bgp group EBGP export EXPORT-STATIC'
  ],
  R2: [
    'set system host-name R2',
    'set interfaces ge-0/0/0 description LINK-TO-R1-AS65001',
    'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.2/30',
    'set interfaces ge-0/0/1 description HOST-LAN-B',
    'set interfaces ge-0/0/1 unit 0 family inet address 192.168.20.1/24',
    'set interfaces lo0 unit 0 family inet address 2.2.2.2/32',
    'set routing-options autonomous-system 65002',
    'set routing-options router-id 2.2.2.2',
    'set protocols bgp group EBGP type external',
    'set protocols bgp group EBGP bfd-liveness-detection minimum-interval 300',
    'set protocols bgp group EBGP bfd-liveness-detection multiplier 3',
    'set protocols bgp group EBGP neighbor 10.0.12.1 peer-as 65001',
    'set policy-options policy-statement EXPORT-CONNECTED term DIRECT from protocol direct',
    'set protocols bgp group EBGP export EXPORT-CONNECTED',
    'set policy-options policy-statement EXPORT-STATIC term ST1 from protocol static',
    'set protocols bgp group EBGP export EXPORT-STATIC',
    'set routing-options static route 203.0.113.0/24 next-hop discard'
  ]
};

function seed(key, lines) {
  const rt = JJ.machine.createDeviceRuntime(key);
  const fresh = JJ.machine.buildRootFromSetLines(lines);
  const cl = JJ.db.clone ? JJ.db.clone(fresh) : JSON.parse(JSON.stringify(fresh));
  rt.committed = cl;
  rt.config = cl;
  rt.candidate = JJ.db.clone ? JJ.db.clone(fresh) : JSON.parse(JSON.stringify(fresh));
  rt.revisions = [JJ.db.clone ? JJ.db.clone(fresh) : JSON.parse(JSON.stringify(fresh))];
  rt.files = {};
  rt.protectedPaths = [];
  const stamp = Date.now();
  rt.bootAt = stamp - 180000;
  rt.commitCount = 1;
  rt.commitLog = [{ time: stamp, by: 'root', comment: 'preset: EBGP & BFD Peering' }];
  return rt;
}

const rtR1 = seed('R1', CFG.R1);
const rtR2 = seed('R2', CFG.R2);
JJ._devsAll = null; // force a fresh world build from the seeded configs
const world = JJ.machine.getWorld();
function mkSession(rt) {
  const s = JJ.machine.createSession(rt, world);
  JJ.machine.feed(s, 'user');
  s.world = world;
  return s;
}
const s1 = mkSession(rtR1);
const s2 = mkSession(rtR2);

// ---- data-layer asserts (fresh world) ----
const ds1 = world.devices.R1, ds2 = world.devices.R2;
const peer1 = (ds1.bgp && ds1.bgp.peers ? ds1.bgp.peers[0] : null) || (ds1.bgp && ds1.bgp.groups && ds1.bgp.groups[0] && ds1.bgp.groups[0].sessions[0]);
check('R1 peer ip 10.0.12.2', peer1 && peer1.ip === '10.0.12.2', JSON.stringify(peer1));
check('R1 peerAs 65002', peer1 && String(peer1.peerAs) === '65002', peer1 && peer1.peerAs);
check('R1 session Establ', peer1 && peer1.state === 'Establ', peer1 && peer1.state);
const r1bgp = (ds1.routes || []).filter(r => r.proto === 'BGP');
check('R1 learns 203.0.113.0/24 via ge-0/0/0', r1bgp.some(r => r.dest === '203.0.113.0/24' && r.via === 'ge-0/0/0'), JSON.stringify(r1bgp));
check('R1 learns R2 loopback 2.2.2.2/32', r1bgp.some(r => r.dest === '2.2.2.2/32'), JSON.stringify(r1bgp.map(r => r.dest)));
check('R1 keeps its own Direct 10.0.12.0/30', (ds1.routes || []).some(r => r.dest === '10.0.12.0/30' && r.proto === 'Direct'));
const peer2 = (ds2.bgp && ds2.bgp.peers ? ds2.bgp.peers[0] : null) || (ds2.bgp && ds2.bgp.groups && ds2.bgp.groups[0] && ds2.bgp.groups[0].sessions[0]);
check('R2 session Establ peerAs 65001', peer2 && peer2.state === 'Establ' && String(peer2.peerAs) === '65001', JSON.stringify(peer2));
const r2bgp = (ds2.routes || []).filter(r => r.proto === 'BGP');
check('R2 learns 192.168.10.0/24', r2bgp.some(r => r.dest === '192.168.10.0/24'), JSON.stringify(r2bgp.map(r => r.dest)));

// ---- CLI-layer asserts ----
function out(sess, cmd) { return (JJ.machine.feed(sess, cmd).lines || []).join('\n'); }
const sum = out(s1, 'show bgp summary');
check('summary: 10.0.12.2 + 65002 + Establ', sum.indexOf('10.0.12.2') >= 0 && sum.indexOf('65002') >= 0 && sum.indexOf('Establ') >= 0, sum);
check('summary: no 65000 leak', sum.indexOf('65000') < 0, sum);
const rp = out(s1, 'show route protocol bgp');
check('show route protocol bgp: +[BGP/170] 203.0.113.0/24', rp.indexOf('*[BGP/170]') >= 0 && rp.indexOf('203.0.113.0/24') >= 0, rp);
check('show route protocol bgp: via ge-0/0/0', rp.indexOf('via ge-0/0/0') >= 0, rp);
const bfd = out(s1, 'show bfd session');
check('bfd: 10.0.12.2 Up', bfd.indexOf('10.0.12.2') >= 0 && bfd.indexOf('Up') >= 0 && bfd.indexOf('Down') < 0, bfd);
const bsum = out(s1, 'show route table inet.0 summary');
check('route table summary counts BGP', bsum.indexOf('BGP') >= 0, bsum);

// ---- default world no-leak: baseline configs have no export policies ----
JJ._rts = {}; JJ._devsAll = null;
const rtBase = JJ.machine.createDeviceRuntime('R1');
const wBase = JJ.machine.getWorld();
const sBase = JJ.machine.createSession(rtBase, wBase);
JJ.machine.feed(sBase, 'user');
sBase.world = wBase;
const leak = out(sBase, 'show route protocol bgp');
check('default world: no BGP adverts from bare iBGP template', leak.indexOf('0 destinations, 0 routes') >= 0 && leak.indexOf('BGP/') < 0, leak);

console.log('BGP PROBE: ' + fails + ' failures');
process.exit(fails ? 1 : 0);
