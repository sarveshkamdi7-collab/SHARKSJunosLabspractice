(function (global) {
  'use strict';

  var J = global.JJ || {};
  var db = J.db;
  var lab = J.lab;
  var net = J.net;

  // ============================================================
  // JJ.machine — Junos CLI simulator runtime.
  // Op mode + config mode grammar, Junos-style outputs,
  // unique-prefix keyword matching, pipe filters, session switching.
  // ============================================================

  function now() { return Date.now(); }

  function padR(s, n) { s = s == null ? '' : String(s); while (s.length < n) s += ' '; return s; }
  function padL(s, n) { s = s == null ? '' : String(s); while (s.length < n) s = ' ' + s; return s; }
  function det(seed) {
    var h = J.hash('' + seed);
    var v = (h % 3600) / 100;
    if (v < 0.2) v += 0.2;
    return v.toFixed(3);
  }
  function detBig(seed) {
    var h = J.hash('k:' + ('' + seed));
    return (h % 90000) + 4000;
  }
  function z2(x) { return x < 10 ? '0' + x : '' + x; }
  function routeAge(ts) {
    var diff = Math.max(0, Math.floor((now() - (ts || now())) / 1000));
    var h = Math.floor(diff / 3600), m = Math.floor((diff % 3600) / 60), sec = diff % 60;
    return z2(h) + ':' + z2(m) + ':' + z2(sec);
  }
  function utc(ts) {
    var d = new Date(ts);
    return d.getUTCFullYear() + '-' + z2(d.getUTCMonth() + 1) + '-' + z2(d.getUTCDate()) + ' ' +
      z2(d.getUTCHours()) + ':' + z2(d.getUTCMinutes()) + ':' + z2(d.getUTCSeconds()) + ' UTC';
  }
  function dateShort(ts) {
    var d = new Date(ts);
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    return mon + ' ' + z2(d.getUTCDate()) + ' ' + z2(d.getUTCHours()) + ':' + z2(d.getUTCMinutes()) + ':' + z2(d.getUTCSeconds());
  }

  function seedSyslog(key) {
    var boot = now() - (300 + J.hash('boot:' + key) % 900) * 1000;
    var v = '20.4R2-S2.1';
    function rec(offSec, txt) {
      var d = new Date(boot + offSec * 1000);
      return dateShort(d.getTime()) + '  ' + key + ' ' + txt;
    }
    return [
      rec(0, 'rpd[1032]: RPD_OSPF_INIT: OSPF version 2 initializing instance master'),
      rec(3, 'kernel: sxp: Connected to Route-Reflector'),
      rec(8, 'pic-concat-filter: mux-if-autodetect=yes,vlan tags'),
      rec(9, 'mgd[1457]: Junos startup scripts complete, running ' + v),
      rec(11, 'sshd[1421]: Server listening on 0.0.0.0 port 22.'),
      rec(14, 'kernel: ge-0/0/0: Full-duplex, 1000mbps, link state is up'),
      rec(20, 'rpd[1032]: RPD_OSPF_ADJACENCY: adjacency 10.0.12.2 up on ge-0/0/0.0'),
      rec(26, 'fmd[1547]: SNTP monitor startup complete')
    ];
  }
  function syslogPush(rt, txt) {
    if (!rt.syslog) rt.syslog = seedSyslog(rt.key);
    rt.syslog.push(dateShort(now()) + '  ' + rt.key + ' ' + txt);
    if (rt.syslog.length > 60) rt.syslog.splice(0, rt.syslog.length - 60);
  }

  // ---------- runtime ----------

  function ensureRt(key) {
    if (!J._rts) J._rts = {};
    if (J._rts[key]) return J._rts[key];
    var spec = (lab && lab.deviceSpec) ? lab.deviceSpec(key) : null;
    var bootAt = now() - (180000 + (J.hash ? (J.hash('b:' + key) % 900000) : Math.floor(Math.random() * 900000)));
    var root = db.create(null);
    if (spec && Array.isArray(spec.baseline)) {
      for (var i = 0; i < spec.baseline.length; i++) { try { db.set(root, spec.baseline[i]); } catch (e) {} }
    }
    var cand = db.clone(root);
    J._rts[key] = {
      key: key,
      spec: spec || { key: key, model: key === 'SW1' ? 'EX4300-24T' : 'MX240', version: '20.4R2-S2.1', platform: key === 'SW1' ? 'ex' : 'mx' },
      committed: root,
      config: root,
      candidate: cand,
      revisions: [],
      commitLog: [],
      bootAt: bootAt,
      lastConfigured: bootAt + 60000,
      commitCount: 0,
      running: true,
      confirmed: null,
      pendingRollbackNotice: false,
      syslog: seedSyslog(key)
    };
    return J._rts[key];
  }

  function getWorld() {
    if (!J._devsAll) {
      J._devsAll = {};
      if (lab && lab.deviceKeys) { for (var k = 0; k < lab.deviceKeys.length; k++) J._devsAll[lab.deviceKeys[k]] = ensureRt(lab.deviceKeys[k]); }
    }
    if (net && net.buildWorld) return net.buildWorld(J._devsAll);
    return { devices: {}, deviceKeys: (lab && lab.deviceKeys) || [] };
  }

  // ---------- tokenizing ----------

  function tokenize(line) {
    var t = []; var cur = ''; var q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) { if (ch === '"') { q = false; continue; } cur += ch; continue; }
      if (ch === '"') { q = true; continue; }
      if (/\s/.test(ch)) { if (cur.length) { t.push(cur); cur = ''; } continue; }
      if (ch === '|') { if (cur.length) { t.push(cur); cur = ''; } t.push('|'); continue; }
      cur += ch;
    }
    if (cur.length) t.push(cur);
    return t;
  }
  function splitPipe(toks) {
    var i = toks.indexOf('|');
    if (i < 0) return { main: toks, pipe: [] };
    return { main: toks.slice(0, i), pipe: toks.slice(i + 1) };
  }
  function errCaret(sess, line, tokIdx, msg) {
    var p = prompt(sess);
    var nl = p.lastIndexOf('\n');
    var pl = nl >= 0 ? p.slice(nl + 1) : p;
    var toks = tokenize(line);
    var col = pl.length;
    for (var i = 0; i < tokIdx && i < toks.length; i++) col += String(toks[i]).length + 1;
    return { lines: [pl + line, padR('', col) + (msg || 'error: syntax error')] };
  }

  function bootSeq(rt) {
    var v = (rt.spec && rt.spec.version) || '20.4R2-S2.1';
    var h = rt.key || 'R1';
    return [
      'Consoles: serial console. Type ^S to interrupt boot...',
      '',
      'FreeBSD/amd64 (' + h.toLowerCase() + ') (ttyu0)',
      '',
      "Booting `Junos OS'",
      'JUNOS ' + v + ' built by builder on 2021-06-14 03:12:34 UTC',
      'Copyright (c) 1996-2021, Juniper Networks, Inc.',
      '',
      h + '  (ttyd0)',
      '',
      'login: '
    ];
  }

  function makeSess(rt, world) {
    return {
      rt: rt,
      world: world || getWorld(),
      mode: 'login',
      user: null,
      history: [],
      hidx: -1,
      input: '',
      screenLen: 24,
      pager: null,
      editPath: [],
      confirmed: null,
      cwd: '/root',
      fromKey: null
    };
  }

  function prompt(sess) {
    if (!sess) return 'user@R1> ';
    var rt = sess.rt || {}; var h = rt.key || 'R1';
    var u = sess.user || 'user';
    if (sess.mode === 'login') return 'login: ';
    if (sess.mode === 'shell') return u + '@' + h + ':~ # ';
    if (sess.mode === 'cli-cfg') {
      var p = (sess.editPath && sess.editPath.length) ? sess.editPath.join(' ') : '';
      if (p) return '[edit ' + p + ']\n' + u + '@' + h + '# ';
      return '[edit]\n' + u + '@' + h + '# ';
    }
    if (sess.mode === 'cli-op') return u + '@' + h + '> ';
    return u + '@' + h + '> ';
  }

  // ============================================================
  // Command trees — words carry one-line Junos help descriptions.
  // Built from [word, desc, subList?, dyn?] tuples.
  // ============================================================

  var SHOW_INT_SUB = [
    ['brief', 'Show brief output'],
    ['detail', 'Show detailed output'],
    ['diagnostics', 'Interface diagnostic status'],
    ['extensive', 'Show extensive output'],
    ['media', 'Show physical interface information'],
    ['statistics', 'Show interface statistics'],
    ['terse', 'Show terse output']
  ];
  var SHOW_OSPF_SUB = [
    ['database', 'Show link-state database contents'],
    ['interface', 'Show interface-level OSPF information', null, 'ifname'],
    ['neighbor', 'Show OSPF neighbor state'],
    ['overview', 'Show overview information'],
    ['route', 'Show OSPF routing table'],
    ['statistics', 'Show statistics related to OSPF']
  ];
  var SHOW_ROUTE_SUB = [
    ['detail', 'Show detailed route information'],
    ['exact', 'Show exact matching route entries'],
    ['extensive', 'Show extensive route information'],
    ['forwarding-table', 'Show routing table forwarding table', [['detail', 'Show detailed route information'], ['exact', 'Show exact matching route entries'], ['extensive', 'Show extensive route information']]],
    ['protocol', 'Show routes for a given protocol', null, true],
    ['summary', 'Show summary of route table']
  ];
  var SHOW_SYSTEM_SUB = [
    ['commit', 'Display committed system information'],
    ['processes', 'Show running processes'],
    ['storage', 'Show storage information'],
    ['uptime', 'Show system uptime'],
    ['users', 'Show logged-in users']
  ];
  var SHOW_CHASSIS_SUB = [
    ['alarms', 'Show currently active alarms'],
    ['environment', 'Show display environmental information'],
    ['fpc', 'Flexible PIC Controller information', [['pic-status', 'Show chassis PIC status']]],
    ['hardware', 'Show hardware components'],
    ['routing-engine', 'Show routing engine information']
  ];

  function buildTree(list) {
    var o = {};
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      o[e[0]] = { w: e[0], d: e[1], sub: e[2] ? buildTree(e[2]) : null, dyn: e[3] || null };
    }
    return o;
  }

  var OP_TOP = [
    ['clear', 'Clear information in the database', [['arp', 'Remove ARP table entries'], ['ospf', 'Clear OSPF state', [['neighbor', 'Clear OSPF neighbor state'], ['statistics', 'Clear OSPF statistics']]]]],
    ['configure', 'Enter configuration mode'],
    ['edit', 'Enter configuration mode'],
    ['file', 'Perform file operations', [['list', 'List file information'], ['show', 'Show file contents'], ['statistics', 'Show file statistics']]],
    ['help', 'Provide help information'],
    ['monitor', 'Display real-time information about interfaces', [['interface', 'Live interface statistics', null, 'ifname'], ['traffic', 'Traffic on specific destination prefixes', [['interface', 'Interface to monitor', null, 'ifname']]]]],
    ['ping', 'Send ICMP ECHO_REQUEST packets to network hosts', null, true],
    ['pipe', 'Filter command output'],
    ['quit', 'Exit from the CLI'],
    ['request', 'Make operational-mode requests', [['support', 'Support information, commands', [['information', 'Display support information']]], ['system', 'System-level request', [['reboot', 'Reboot the system']]]]],
    ['set', 'Set CLI properties', [['cli', 'CLI properties', [['screen-length', 'Lines to display before pausing output', null, true], ['terminal-type', 'Terminal type for console output', null, true]]]]],
    ['show', 'Show information about a command'],
    ['status', 'Show users currently in configuration mode'],
    ['ssh', 'Open a secure shell to a remote host', null, true],
    ['start', 'Start a program on a routing engine', [['shell', 'Start the standard shell']]],
    ['telnet', 'Open a telnet session to a remote host', null, true],
    ['traceroute', 'Trace route to remote hosts', null, true],
    ['exit', 'Exit from the CLI']
  ];

  var SHOW_LIST = [
    ['arp', 'Show Address Resolution Protocol table'],
    ['bgp', 'Show Border Gateway Protocol information', [['summary', 'Show BGP summary information'], ['neighbor', 'Show BGP peer information']]],
    ['chassis', 'Show chassis information', SHOW_CHASSIS_SUB],
    ['configuration', 'Show candidate/committed configuration', null, true],
    ['ethernet-switching', 'Show ethernet switching table', [['table', 'Show MAC learning table']]],
    ['interfaces', 'Display interface information', SHOW_INT_SUB, true],
    ['lldp', 'Display Link Layer Discovery Protocol', [['neighbors', 'Show LLDP neighbor information']]],
    ['log', 'Show contents of a log file', null, true],
    ['ospf', 'Show Open Shortest Path First information', SHOW_OSPF_SUB],
    ['route', 'Show routing table (RIB)', SHOW_ROUTE_SUB, true],
    ['spanning-tree', 'Show Rapid Spanning Tree Protocol information', [['bridge', 'Show STP bridge information'], ['interface', 'Show STP interface information']]],
    ['system', 'Show system information', SHOW_SYSTEM_SUB],
    ['version', 'Show software version'],
    ['vlans', 'Show configured VLANs']
  ];

  var OP_TREE = buildTree(OP_TOP);
  OP_TREE.show.sub = buildTree(SHOW_LIST);
  var OP_ROOT = { w: null, d: '', sub: OP_TREE, dyn: null };

  var CFG_TOP = [
    ['activate', 'Remove the inactive marker from a statement'],
    ['annotate', 'Annotate a statement with a comment'],
    ['commit', 'Commit the configuration', [['and-quit', 'Commit and return to operational mode'], ['check', 'Check the configuration for correctness'], ['comment', 'Comment to attach to the commit'], ['confirmed', 'Automatically roll back if not confirmed']]],
    ['copy', 'Copy a statement'],
    ['deactivate', 'Add the inactive marker to a statement'],
    ['delete', 'Delete a data element'],
    ['edit', 'Edit a sub-element'],
    ['exit', 'Exit from this level'],
    ['insert', 'Insert a new element'],
    ['rename', 'Rename a statement'],
    ['rollback', 'Roll back to last committed configuration'],
    ['run', 'Run an operational-mode command'],
    ['set', 'Set a set of statements in the configuration'],
    ['show', 'Show a configuration'],
    ['status', 'Display users currently in configuration mode'],
    ['top', 'Return to top of the hierarchy'],
    ['up', 'Move up in the hierarchy']
  ];

  // ---------- keyword resolution (Junos unique prefix matching) ----------

  var AMBIG = { ambiguous: true };

  function resolveTok(tok, tree) {
    if (tok == null || tree == null) return null;
    var t = String(tok).toLowerCase();
    if (tree[t]) return tree[t];
    var hits = [];
    for (var k in tree) { if (k.toLowerCase().indexOf(t) === 0) hits.push(tree[k]); }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return AMBIG;
    return null;
  }

  // Walk the keyword tree over tokens. Returns deepest node reached.
  function walkTree(tree, toks) {
    var node = tree;
    for (var c = 0; c < toks.length; c++) {
      var r = resolveTok(toks[c], node.sub);
      if (r === AMBIG) return { node: node, rest: toks.slice(c), fail: 'ambiguous', failTok: c };
      if (!r) return { node: node, rest: toks.slice(c), fail: 'nomatch', failTok: c };
      node = r;
      if (!node.sub) return { node: node, rest: toks.slice(c + 1), fail: null, failTok: -1 };
    }
    return { node: node, rest: [], fail: null, failTok: -1 };
  }

  function dynCandidates(kind, sess) {
    var world = sess.world || getWorld();
    var ds = world.devices[sess.rt.key];
    if (kind === 'ifname') return ds ? ds.iflist.slice() : [];
    if (kind === 'logname') return ['messages', 'interactive-commands', 'chassisd', 'cosd', 'rpd'];
    return [];
  }

  function candsAt(node, sess) {
    var out = [];
    if (!node || !node.sub) return out;
    var keys = Object.keys(node.sub);
    keys.sort(J.cmpTokens);
    for (var i = 0; i < keys.length; i++) {
      var n = node.sub[keys[i]];
      out.push([n.w, n.d || '']);
      if (n.dyn) {
        var dyn = dynCandidates(n.dyn, sess);
        for (var d = 0; d < dyn.length; d++) out.push([dyn[d], '']);
      }
    }
    return out;
  }

  function completionsBlock(rows) {
    var out = ['Possible match completions:'];
    if (!rows.length) out.push('  (no matches)');
    var w = 0;
    for (var i = 0; i < rows.length; i++) w = Math.max(w, String(rows[i][0]).length);
    w = Math.min(w, 20);
    for (var j = 0; j < rows.length; j++) {
      out.push('  ' + padR(rows[j][0], w + 3) + (rows[j][1] || ''));
    }
    return out;
  }

  // ============================================================
  // show * renderers (derived from runtime + world state)
  // ============================================================

  function dsOf(sess) {
    var world = sess.world || getWorld();
    return (world.devices && world.devices[sess.rt.key]) || null;
  }
  function specVer(rt) { return (rt.spec && rt.spec.version) || '20.4R2-S2.1'; }

  function showVersion(rt) {
    var v = specVer(rt);
    return [
      'Hostname: ' + (rt.key || 'R1'),
      'Model: ' + ((rt.spec && rt.spec.model) || 'mx240').toLowerCase(),
      'Junos: ' + v,
      'JUNOS OS Kernel 64-bit  [' + v + ']',
      'JUNOS OS Crypto 60-bit  [' + v + ']',
      'JUNOS base OS boot [' + v + ']',
      'JUNOS Routing Software [' + v + ']',
      'JUNOS OS jsd [v21.3R1.7]',
      'JUNOS OS py-extensions [' + v + ']'
    ];
  }

  function showUptime(rt) {
    var out = [];
    var booted = rt.bootAt || now() - 3180000;
    var cur = new Date(now());
    var mins = Math.max(0, Math.floor((now() - booted) / 60000));
    out.push('Current time:      ' + utc(now()));
    out.push('System booted:     ' + utc(booted) + ' (' + routeAge(booted) + ' ago)');
    out.push('Protocols started: ' + utc(booted + 52000) + ' (' + routeAge(booted + 52000) + ' ago)');
    out.push('Last configured:   ' + utc(rt.lastConfigured || booted) + ' (' + routeAge(rt.lastConfigured || booted) + ' ago) by root');
    out.push(' ' + (cur.getUTCHours() % 12) + ':' + z2(cur.getUTCMinutes()) + (cur.getUTCHours() < 12 ? 'am' : 'pm') + '  up ' + mins + ' mins, 1 user, load averages: 0.07, 0.02, 0.01');
    return out;
  }

  function showIntTerse(ds, nameFilter) {
    var out = [];
    out.push('Interface               Admin Link Proto    Local                 Remote');
    if (!ds) return out;
    for (var i = 0; i < ds.iflist.length; i++) {
      var name = ds.iflist[i];
      if (nameFilter && name.indexOf(nameFilter) !== 0) continue;
      var ifc = ds.interfaces[name]; if (!ifc) continue;
      out.push(padR(name, 24) + padR(ifc.adminUp ? 'up' : 'down', 6) + padR(ifc.linkUp ? 'up' : 'down', 5));
      for (var u = 0; u < ifc.unilist.length; u++) {
        var un = ifc.unilist[u];
        if (un.family === 'inet') {
          for (var a = 0; a < un.addrs.length; a++) {
            out.push(padR(name + '.' + un.num, 24) + padR('--', 6) + padR('--', 5) + padR('inet', 9) + un.addrs[a]);
          }
        }
      }
    }
    return out;
  }

  function showIntBlock(ds, ifc, mode) {
    var out = [];
    out.push('Physical interface: ' + ifc.name + ', ' + (ifc.adminUp ? 'Enabled' : 'Disabled') + ', Physical link is ' + (ifc.linkUp ? 'Up' : 'Down'));
    out.push('  Interface index: ' + ifc.index + ', SNMP ifIndex: ' + ifc.ifIndex + ', Generation: ' + ifc.gen);
    if (ifc.desc) out.push('  Description: ' + ifc.desc);
    out.push('  Link-level type: Ethernet, MTU: ' + (ifc.mtu || 65535) + ', Speed: ' + (ifc.speed || 'Unspecified'));
    out.push('  Device flags   : Present Running ' + (ifc.adminUp ? '' : 'Down ') + (ifc.linkUp ? '' : 'LinkDown'));
    if (mode === 'statistics') {
      var seed = ds.key + ':' + ifc.name;
      out.push('  Input packets : ' + detBig(seed + ':pk') + ' (' + detBig(seed + ':pr') + ' pps)');
      out.push('  Output packets: ' + detBig(seed + ':opk') + ' (' + detBig(seed + ':opr') + ' pps)');
    }
    if (mode === 'media') {
      out.push('  Media type: Copper, Link-mode: Full-duplex');
      out.push('  MAC: ' + ifc.mac + ', Media type: Copper');
      out.push('  Wavelength: N/A, Autonegotiation: Enabled');
    }
    for (var u = 0; u < ifc.unilist.length; u++) {
      var un = ifc.unilist[u];
      out.push('  Logical interface ' + ifc.name + '.' + un.num + ' (Index ' + (ifc.index + 251) + ') (SNMP ifIndex ' + (ifc.ifIndex + (parseInt(un.num, 10) || 0)) + ')');
      out.push('    Flags: Up SNMP-Traps Encapsulation: ' + (un.family === 'ethernet-switching' ? 'ENET2' : 'BSD-Style'));
      if (un.addrs.length) out.push('    inet ' + un.addrs.join(', '));
      if (un.family === 'ethernet-switching') {
        out.push('    Protocol ethernet-switching, MTU: 1514, VLAN tagging: ' + (un.interfaceMode === 'trunk' ? 'Trunk' : 'None'));
      }
    }
    return out;
  }

  function showRoute(ds, detailMode, destFilter, routesOverride) {
    var out = [];
    if (!ds) return ['inet.0: 0 destinations, 0 routes'];
    var routes = routesOverride || (ds.routes || []);
    if (destFilter) {
      routes = routes.filter(function (r5) { return destMatches(r5.dest, destFilter); });
      if (!routes.length) return ['inet.0: 0 destinations, 0 routes'];
    }
    var dests = {};
    for (var i = 0; i < routes.length; i++) dests[routes[i].dest] = 1;
    var dcount = Object.keys(dests).length;
    out.push('');
    out.push('inet.0: ' + dcount + ' destinations, ' + routes.length + ' routes (' + dcount + ' active, 0 holddown, 0 hidden)');
    out.push('+ = Active Route, - = Last Active, * = Both');
    out.push('');
    for (var k = 0; k < routes.length && k < 60; k++) {
      var r = routes[k];
      var age = r.created ? routeAge(r.created) : '00:00:00';
      var head = padR(r.dest, 19) + '*[' + r.proto + '/' + r.pref + '] ' + age;
      if (r.proto === 'Direct') head += ', metric 0, tag 0';
      else if (r.proto === 'Local' && String(r.via || '').indexOf('lo0') === 0) head += ', metric 0';
      else if (r.proto === 'OSPF') head += ', metric ' + (r.metric != null ? r.metric : '1');
      out.push(head);
      if (detailMode) out.push('              Route type: ' + (r.proto === 'OSPF' ? 'intra-area' : (r.proto === 'Static' ? 'static' : 'direct')));
      if (r.mode === 'discard' || r.mode === 'reject') { out.push('                      Discard'); continue; }
      if (r.proto === 'Local') { out.push('                      Local via ' + (r.local ? r.local : r.dest.split('/')[0])); continue; }
      if (r.proto === 'Direct') { out.push('                    > via ' + (r.via || '')); continue; }
      if (r.to) out.push('                    > to ' + r.to + ' via ' + (r.via || ''));
      else out.push('                    > via ' + (r.via || '?'));
    }
    return out;
  }

  function showRouteSummary(ds) {
    var out = [];
    if (!ds) return out;
    if (ds.bgp && ds.bgp.groups && ds.bgp.groups.length) out.push('Autonomous system number: 65000');
    out.push('Router ID: ' + (ds.routerId || '1.1.1.1'));
    out.push('');
    var byProto = {};
    for (var i = 0; i < ds.routes.length; i++) byProto[ds.routes[i].proto] = (byProto[ds.routes[i].proto] || 0) + 1;
    out.push('inet.0: ' + ds.routes.length + ' total routes');
    var order = ['Direct', 'Local', 'Static', 'OSPF', 'BGP'];
    for (var o = 0; o < order.length; o++) {
      var proto = order[o];
      if (byProto[proto]) out.push('  ' + padL(padR(proto + ':', 9), 0) + padR(padL(byProto[proto], 4), 11) + 'routes, ' + padL(byProto[proto], 4) + ' active');
    }
    return out;
  }

  function maskOfCidr(cidr) {
    var p = J.parseIp(cidr);
    if (!p || p.prefix === null) return '255.255.255.255';
    var mask = (p.prefix === 0) ? 0 : ((0xFFFFFFFF << (32 - p.prefix)) >>> 0);
    return J.intToIp(mask);
  }

  function hexFt(x) {
    var s = (x >>> 0).toString(16);
    while (s.length < 8) s = '0' + s;
    return '0x' + s;
  }

  function showRouteForwarding(ds) {
    var out = [];
    out.push('Routing table: inet.0');
    out.push('Internet:');
    out.push('Destination        Type RtRef Next hop           Type Index NhRef Netif');
    var routes = ds ? (ds.routes || []) : [];
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      var name = r.dest === '0.0.0.0/0' ? 'default' : r.dest;
      var type = r.proto === 'Local' ? 'lcl' : 'user';
      var seed = ds.key + ':ft:' + r.dest;
      var nh = r.to ? r.to : hexFt(J.hash(seed));
      var nhType = r.proto === 'Local' ? 'locl' : (r.mode === 'discard' || r.mode === 'reject' ? 'dscd' : 'ucst');
      var netif = r.via ? String(r.via) : (r.proto === 'Local' ? 'lo0' : '-');
      out.push(padR(name, 19) + padR(type, 5) + padR('0', 6) + padR(nh, 19) + padR(nhType, 6) + padR(String(500 + J.hash(seed) % 300), 6) + padR('3', 6) + netif);
    }
    return out;
  }

  function showOspfNbr(ds) {
    var out = [];
    out.push('Address          State              Interface     Dead time  ID               Pri Retx');
    if (ds && ds.ospfNeighbors) {
      for (var i = 0; i < ds.ospfNeighbors.length; i++) {
        var n = ds.ospfNeighbors[i];
        out.push(padR(n.ip, 17) + padR(n.state || 'Full', 19) + padR(n.iface || '', 14) + padR(n.dead || '00:00:36', 11) + padR(n.id || '', 18) + padL(String(n.prio || '128'), 4));
      }
    }
    return out;
  }

  function showOspfInterface(ds, ifTok) {
    var out = [];
    out.push('Interface           State     ID            Cost    DR         BDR        Type    MTU');
    if (!ds || !ds.ospf) return out;
    var want = ifTok ? String(ifTok) : null;
    var adjByIf = {};
    var world = ds.world;
    if (world && world.adjacencies) {
      for (var w = 0; w < world.adjacencies.length; w++) {
        var e = world.adjacencies[w];
        if (e.u.key === ds.key) adjByIf[e.uIf.ukey] = e.vIf.ip;
        else if (e.v.key === ds.key) adjByIf[e.vIf.ukey] = e.uIf.ip;
      }
    }
    for (var i = 0; i < ds.ospf.ifaces.length; i++) {
      var ofc = ds.ospf.ifaces[i];
      var ukey = ofc.name;
      if (want && String(ukey).indexOf(want) !== 0) continue;
      var sn = null;
      for (var s = 0; s < ds.subnets.length; s++) if (ds.subnets[s].ukey === ukey) sn = ds.subnets[s];
      if (!sn) continue;
      var cost = sn.kind === 'lo' ? 0 : (sn.kind === 'irb' ? 1 : 10);
      if (ofc.passive) {
        out.push(padR(ukey, 20) + 'Passive   ' + padR(sn.ip, 14) + padR(String(cost), 8) + padR('0.0.0.0', 11) + padR('0.0.0.0', 11) + padR('-', 8) + '65535');
        continue;
      }
      var peerIp = adjByIf[ukey];
      if (peerIp) {
        var lo = [sn.ip, peerIp].sort(J.cmpTokens)[0];
        var hi = [sn.ip, peerIp].sort(J.cmpTokens)[1];
        out.push(padR(ukey, 20) + 'BDR       ' + padR(sn.ip, 14) + padR(String(cost), 8) + padR(hi, 11) + padR(lo, 11) + padR('P2P', 8) + '1500');
      } else {
        out.push(padR(ukey, 20) + 'DR        ' + padR(sn.ip, 14) + padR(String(cost), 8) + padR('0.0.0.0', 11) + padR('0.0.0.0', 11) + padR('BMA', 8) + '1500');
      }
    }
    return out;
  }

  function showOspfDatabase(ds) {
    var out = [];
    if (!ds || !ds.ospf) return ['OSPF instance not running'];
    var area = (ds.ospf.areas && ds.ospf.areas[0]) || '0.0.0.0';
    out.push('OSPF database, Area ' + area);
    out.push(' Type       ID               Adv Rtr           Seq          Age  Opt  Cksum  Len');
    var lsas = ds.ospfLsas || [];
    for (var i = 0; i < lsas.length; i++) {
      var l = lsas[i];
      var age = Math.floor((Date.now() - ds.bootAt) / 1000) % 3600;
      out.push(padR(l.type, 8) + '*' + padR(l.id, 16) + padR(l.advRtr, 17) + padR(l.seq, 13) + padR(String(age), 5) + ' 0x2 ' + padR(l.cksum, 7) + String(l.len));
    }
    return out;
  }

  function showOspfRoute(ds) {
    var out = [];
    if (!ds) return out;
    out.push('Topology default (Route ID ' + (ds.routerId || '1.1.1.1') + ', Route table inet.0    ID 0.0.0.0)');
    out.push(' Destination         Netmask       Next Hop        State   Cost   Interface');
    for (var i = 0; i < ds.routes.length; i++) {
      var r = ds.routes[i];
      if (r.proto !== 'OSPF') continue;
      var to = r.to || '0.0.0.0';
      out.push(padR(r.dest, 20) + padR(maskOfCidr(r.dest), 14) + padR(to, 16) + padR('Full', 8) + padR(String(r.metric || 0), 7) + (r.via || '-'));
    }
    return out;
  }

  function showOspfOverview(ds) {
    if (!ds || !ds.ospf) return ['OSPF instance is not running'];
    var out = [];
    out.push('Instance: master');
    out.push('Version: 2');
    out.push('Metric: 10 (external: 1)');
    out.push('MTU check: enabled');
    out.push('Reference bandwidth: 100mbps');
    out.push('Router ID: ' + (ds.routerId || '1.1.1.1'));
    out.push('');
    var routerLsa = 0, netLsa = 0;
    for (var i = 0; i < (ds.ospfLsas || []).length; i++) { if (ds.ospfLsas[i].type === 'Router') routerLsa++; else netLsa++; }
    out.push('Areas: ' + ((ds.ospf.areas && ds.ospf.areas.length) || 1));
    var activeIfs = 0;
    for (var k = 0; k < ds.ospf.ifaces.length; k++) { if (!ds.ospf.ifaces[k].passive) activeIfs++; }
    out.push('Area 0.0.0.0');
    out.push('  Interfaces:      ' + ds.ospf.ifaces.length + ' (' + activeIfs + ' active)');
    out.push('  Neighbors:       ' + ds.ospfNeighbors.length);
    out.push('  Area scope LSAs: ' + (routerLsa + netLsa));
    out.push('    Router: ' + routerLsa + ', Net: ' + netLsa);
    return out;
  }

  function showOspfStats(ds) {
    var out = [];
    out.push('Packet type     Received  Transmitted');
    var seed = ds ? ds.key : 'R1';
    var types = ['Hello', 'DBDesc', 'LSReq', 'LSUpd', 'LSAck'];
    for (var i = 0; i < types.length; i++) {
      out.push(padR(types[i], 10) + padL(String(detBig(seed + ':osin:' + types[i])), 10) + padL(String(detBig(seed + ':osout:' + types[i])), 12));
    }
    out.push('');
    out.push('LSA database refresh count ' + detBig(seed + ':' + 'osrefr'));
    return out;
  }

  function showBgpSummary(ds) {
    var out = [];
    var peers = (ds && ds.bgp && ds.bgp.peers) ? ds.bgp.peers : [];
    var groups = (ds && ds.bgp && ds.bgp.groups) ? ds.bgp.groups : [];
    out.push('Groups: ' + groups.length + ' Peers: ' + peers.length + ' Down peers: 0');
    out.push('Unconfigured peers: 0');
    out.push('Table          Tot Paths  Act Paths Suppressed  History Damp State    Pending');
    out.push('inet.0                    0           0          0        0          0        0');
    out.push('Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn');
    out.push('State|#Active/Received/Accepted/Damped');
    for (var i = 0; i < peers.length; i++) {
      var p = peers[i];
      var state = p.state || 'Establ';
      if (state === 'Idle') state = '#Idle/0/0/0/0';
      out.push(padR(p.ip, 25) + padL(String(p.peerAs || '65000'), 7) + padL(String(p.inPkt || '68'), 10) + padL(String(p.outPkt || '68'), 10) + padL('0', 7) + padL('0', 7) + padL(String(p.upFor || '53'), 8) + ' ' + state);
    }
    return out;
  }

  function showBgpNeighbor(ds) {
    return showBgpSummary(ds);
  }

  function showArp(ds) {
    var out = [];
    out.push('MAC Address       Address         Name                      Interface     Flags');
    if (ds && ds.arp) {
      for (var i = 0; i < ds.arp.length; i++) {
        var a = ds.arp[i];
        out.push(padR(a.mac, 18) + padR(a.ip, 16) + padR(a.ip, 26) + padR(a.iface, 14) + ' none');
      }
    }
    return out;
  }

  function showLldp(pds) {
    var out = [];
    out.push('Local Interface    Chassis Id          Port info          System Name');
    if (pds && pds.lldp) {
      for (var i = 0; i < pds.lldp.length; i++) {
        var nl = pds.lldp[i];
        out.push(padR(nl.localIf, 19) + padR(nl.chassisId || '', 20) + padR(nl.peerPort, 19) + (nl.peer || ''));
      }
    }
    return out;
  }

  function showVlans(ds) {
    var out = [];
    if (!ds || !ds.platform || ds.platform !== 'ex') return out;
    out.push('Routing instance        VLAN name   VLAN ID     Interfaces');
    for (var v = 0; v < ds.vlans.length; v++) {
      var vlan = ds.vlans[v];
      var ports = [];
      for (var i = 0; i < ds.iflist.length; i++) {
        var ifc = ds.interfaces[ds.iflist[i]];
        for (var u = 0; u < ifc.unilist.length; u++) {
          var un = ifc.unilist[u];
          if (un.family === 'ethernet-switching') {
            for (var m = 0; m < un.vlanMembers.length; m++) {
              if (un.vlanMembers[m] === vlan.name) { ports.push(un.ukey + (ifc.linkUp ? '*' : '')); break; }
            }
          }
        }
      }
      if (vlan.l3) ports.push(vlan.l3);
      var line = 'default                 ' + padR(vlan.name, 12) + padR(String(vlan.id), 12) + (ports.length ? ports.slice(0, 2).map(wMark).join(', ') : '');
      out.push(line);
      var rest = ports.slice(2);
      var idx = 2;
      while (rest.length) {
        var nextLine = padR('', 48) + rest.slice(0, 2).map(wMark).join(', ');
        out.push(nextLine.replace(/\s$/, ''));
        idx += 2;
        rest = ports.slice(idx);
      }
    }
    function wMark(p) { return p; }
    return out;
  }

  function showMacTable(ds) {
    var out = [];
    out.push('MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Permanent static, R - Remote MAC);');
    out.push('');
    out.push('Routing instance : default');
    out.push('    Vlan                MAC                 MAC         Logical    Active');
    out.push('    name                address             flags       interface  source');
    var count = 0;
    if (ds && ds.macTable) {
      for (var i = 0; i < ds.macTable.length; i++) {
        var m = ds.macTable[i];
        out.push('    ' + padR(m.vlan, 20) + padR(m.mac, 21) + padR('D', 12) + padR(m.iface + '.0', 11) + '    ' + (m.type || 'Learn'));
        count++;
      }
    }
    out.push('Total MAC addresses learned in this instance: ' + count);
    return out;
  }

  function showStpBridge(ds) {
    if (!ds || !ds.stp) return ['Spanning tree enabled protocol  RSTP'];
    var out = [];
    var mac = ds.stp.bridgeMac;
    var rootIsSelf = ds.stp.rootBridgeMac === ds.stp.bridgeMac;
    out.push('Root bridge ID            ' + '32768.' + ds.stp.rootBridgeMac);
    out.push('Root port                 ' + (rootIsSelf ? 'This bridge is the root' : ds.iflist[0] || '-'));
    out.push('Root path cost            ' + (rootIsSelf ? '0' : '20000'));
    out.push('Bridge ID                 ' + ds.stp.pri + '.' + mac);
    out.push('Extended system ID        0');
    out.push('Total number of topologies  1');
    out.push('Topology 0');
    out.push('    Name           00 (Default)');
    out.push('    Bridge ID      ' + ds.stp.pri + '.' + mac);
    out.push('    Flags          ITF (In Topology Flush)');
    return out;
  }

  function showStpInterface(ds) {
    var out = [];
    out.push('Spanning tree interface parameters for instance 0');
    out.push('');
    out.push('Interface                  State      Role        Cost   Pri   Port ID');
    if (ds && ds.stp) {
      for (var i = 0; i < ds.stp.ports.length; i++) {
        var p = ds.stp.ports[i];
        out.push(padR(p.iface + '.0', 27) + padR(p.state, 11) + padR(p.role, 12) + padR(String(p.cost), 7) + padR(String(p.pri), 6) + '128.' + (521 + i));
      }
    }
    return out;
  }

  function showChassisHardware(rt) {
    var out = ['Inventory'];
    if ((rt.spec && rt.spec.platform) === 'ex') {
      out.push('FPC 0            REV 15     711-051312   ' + (rt.spec.serial || 'DX012345') + '   EX4300-24T');
      out.push('  PIC 0          REV 09     BUILTIN      BUILTIN           24x 10/100/1000-BT');
      out.push('  PIC 1          REV 09     BUILTIN      BUILTIN           4x 10GE(SFP+)');
    } else {
      out.push('FPC 0            REV 15     711-051312   ' + (rt.spec.serial || 'ABTR0123') + '   MPCE Type 3-3D');
      out.push('  CPU 0          REV 15     BUILTIN      BUILTIN           MPCE Type 3-3D');
      out.push('  PIC 0          REV 18     BUILTIN      BUILTIN           8x 1GE(SFP)');
    }
    out.push('Routing Engine 0 REV 04     750-051094   CAAL2923          ' + ((rt.spec && rt.spec.platform) === 'ex' ? 'RE-S-EX4300' : 'RE-S-1800x4'));
    return out;
  }

  function showChassisFpc(rt) {
    if ((rt.spec && rt.spec.platform) === 'ex') {
      return [
        'Temp  CPU Utilization (%)    CPU Utilization (%)  Memory    Utilization (%)',
        'Slot  State            (#1)  Total                (GB)      Heap    Used',
        '  0   Online             4    32                   1.1       11    42'
      ];
    }
    return [
      'Temp  CPU Utilization (%)    CPU Utilization (%)  Memory    Utilization (%)',
      'Slot  State            (#1)  Total                (GB)      Heap    Used',
      '  0   Online             3    26                   2.1       14    38'
    ];
  }

  function showChassisPicStatus(rt) {
    if ((rt.spec && rt.spec.platform) === 'ex') {
      return [
        'PIC 0      Online            24x 10/100/1000-BT',
        'PIC 1      Online            4x 10GE(SFP+)'
      ];
    }
    return [
      'PIC 0      Online            8x 1GE-SFP        1GE-SFP'
    ];
  }

  function showChassisRE(rt) {
    var seed = rt.key + ':re';
    var out = [
      'Routing Engine status:',
      '    Slot 0:',
      '        Current state                  Master'
    ];
    if ((rt.spec && rt.spec.platform) === 'ex') {
      out.push('    Model                     RE-S-EX4300-24T-4S');
      out.push('    Serial ID                 ' + (rt.spec.serial || 'CAAL2923'));
    } else {
      out.push('    Model                     RE-S-1800x4');
      out.push('    Serial ID                 ' + (rt.spec.serial || 'CAAL2923'));
    }
    out.push('        Temp A                      ' + (33 + detBig(seed) % 8) + ' degrees C / ' + (91 + detBig(seed) % 14) + ' degrees F');
    out.push('        CPU utilization:');
    out.push('          User                       ' + (2 + detBig(seed + ':u') % 6) + ' percent');
    out.push('          Kernel                    ' + (14 + detBig(seed + ':k') % 18) + ' percent');
    out.push('          Interrupt                  1 percent');
    out.push('          Idle                      ' + (56 + detBig(seed + ':i') % 25) + ' percent');
    out.push('        Last powered on:            ' + utc(rt.bootAt));
    out.push('        Load averages:              0.07  0.02  0.01');
    return out;
  }

  function showChassisAlarms(rt) {
    return [
      '1 alarms currently active',
      'Alarm time               Class  Description',
      utc(rt.bootAt) + '  Minor  Management Ethernet Link Down'];
  }

  function showChassisEnvironment(rt) {
    var seed = rt.key + ':env';
    return [
      'Item                           Measurement  Previous  Measurement',
      'Temperature                    OK           n/a',
      '    VMEM Slot 0                ' + (33 + detBig(seed) % 6) + ' degrees C / ' + (91 + detBig(seed) % 11) + ' degrees F',
      'Power supplies:',
      '    PEM 0                      OK           0.00      0',
      '    PEM 1                     _absent'
    ];
  }

  function showSystemCommit(rt) {
    var out = [];
    var log = rt.commitLog || [];
    var shown = 0;
    for (var i = 0; i < log.length && shown < 9; i++) {
      var e = log[i];
      var line = '  ' + (shown === 0 ? '1' : shown) + '  ' + utc(e.time) + ' by ' + (e.by || 'root') + ' via cli';
      if (e.comment) line += ' commit "' + e.comment + '"';
      out.push(line);
      shown++;
    }
    out.push((shown + 1) + '  (current)');
    return out;
  }

  function showSystemUsers(rt) {
    var booted = rt.bootAt || now() - 3000000;
    var cur = new Date(now());
    var stamp = dayStamp(cur);
    return [
      stamp + '  up ' + Math.max(1, Math.floor((now() - booted) / 60000)) + ' mins, 1 user, load averages: 0.07, 0.02, 0.01',
      'USER     TTY      FROM                  LOGIN@  IDLE WHAT',
      'root     d0       -                     ' + stamp.slice(7, 12) + '      -    cli'
    ];
  }

  function dayStamp(d) {
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    return mon + ' ' + z2(d.getUTCDate()) + ' ' + ((d.getUTCHours() % 12 || 12)) + ':' + z2(d.getUTCMinutes()) + (d.getUTCHours() < 12 ? 'am' : 'pm');
  }

  function showSystemStorage() {
    return [
      'Filesystem                       Size   Used  Avail Capacity  Mounted on',
      '/dev/gpt/system                  6.8G   1.9G   4.3G    30%    /',
      'devfs                            1.1M   1.1M     0B   100%    /dev',
      'tmpfs                            134M   1.5M   133M     1%    /tmp'
    ];
  }

  function showSystemProcess() {
    return [
      ' PID USERNAME   THR PRI NICE   SIZE    RES STATE    TIME   WCPU COMMAND',
      ' 597 root         1  20    0   269M   238M select  1:36  1.3% mgd',
      '  34 root         1  16    0   229M   3240K kqueue  0:05  0.0% rpd',
      ' 831 root         1  20    0   223M  11600K select  0:01  0.0% sshd'
    ];
  }

  function showLog(rt, name) {
    var n = String(name == null ? 'messages' : name).replace(/\.gz.*$/,'');
    if (n === 'messages') {
      return (rt.syslog || seedSyslog(rt.key)).slice();
    }
    if (n === 'interactive-commands') {
      return (rt.intLog || seedIntLog(rt)).slice();
    }
    if (n === 'rpd' || n === 'chassisd' || n === 'cosd') {
      return seedDaemonLog(rt, n);
    }
    return dayStamp(new Date(now())) + '  ' + rt.key + ' mgd[1374]: UI_LOG_ADDFILE: Cannot add new file ' + n + ' to logfile database';
  }

  function seedIntLog(rt) {
    var b = rt.bootAt || now() - 900000;
    return [
      dateShort(b + 52000) + '  ' + rt.key + ' mgd[1374]: UI_CMDLINE_READ_LINE: user \'root\', command \'show version \''
    ];
  }

  function intLogPush(rt, cmd) {
    if (!rt.intLog) rt.intLog = seedIntLog(rt);
    rt.intLog.push(dateShort(now()) + '  ' + rt.key + ' mgd[1374]: UI_CMDLINE_READ_LINE: user \'' + (rt.lastUser || 'root') + '\', command \'' + cmd + ' \'');
    if (rt.intLog.length > 60) rt.intLog.splice(0, rt.intLog.length - 60);
  }

  function seedDaemonLog(rt, n) {
    var b = rt.bootAt || now() - 900000;
    function L(off, txt) { return dateShort(b + off * 1000) + '  ' + rt.key + ' ' + n + ': ' + txt; }
    if (n === 'rpd') {
      return [
        L(0, 'RPD_OSPF_INIT: OSPF version 2 initializing instance master'),
        L(3, 'RPD_OSPF_ADJACENCY_UP: neighbor state up'),
        L(6, 'RPD_KRT_SYSCALL: add route notification')
      ];
    }
    if (n === 'chassisd') {
      return [
        L(1, 'CHASSISD_FRU_OFFLINE: FPC 0 offline'),
        L(2, 'CHASSISD_SNMP_TRAP: SNMP trap generated: FRU power supply inserted')
      ];
    }
    return [
      L(0, 'COSD_ONDEMAND_TIMEOUT: on-demand cosd request timed out'),
      L(5, 'COSD_CELL_INTERFACE_JOIN: interface join complete')
    ];
  }

  // ---------- diagnostics: ping / traceroute / ssh / telnet ----------

  function findTarget(world, tok) {
    var p = J.parseIp(String(tok));
    if (p && p.ip && p.prefix === null) return { ip: p.ip };
    var t = String(tok).toLowerCase();
    for (var i = 0; i < world.deviceKeys.length; i++) {
      var k = world.deviceKeys[i];
      var ds = world.devices[k];
      if (k.toLowerCase() === t || String(ds.hostname).toLowerCase() === t) {
        var best = null;
        for (var s = 0; s < ds.subnets.length; s++) if (ds.subnets[s].kind === 'lo') best = ds.subnets[s];
        var sn = best || null;
        if (sn) return { ip: sn.ip };
        for (var s2 = 0; s2 < ds.subnets.length; s2++) {
          if (ds.subnets[s2].kind !== 'mgmt') return { ip: ds.subnets[s2].ip };
        }
        return { ip: ds.subnets[0].ip };
      }
    }
    for (var h = 0; h < world.hosts.length; h++) {
      if (String(world.hosts[h].name).toLowerCase() === t) return { ip: world.hosts[h].ip, host: true };
    }
    return null;
  }
  function ipOf(cidr) { var p = J.parseIp(cidr); return p ? p.ip : null; }

  // ---- ping ----
  // Needs: count, source, rapid parsing; deterministic per-sequence delays; TTL = 64 - (hops+1).
  function opPing(sess, args, world) {
    var rt = sess.rt;
    var dst = null, count = 5, src = null, rapid = false;
    for (var i = 0; i < args.length; i++) {
      var a = args[i];
      if (a === 'count' && args[i + 1]) { count = Math.min(100, parseInt(args[i + 1], 10) || 5); i++; }
      else if (a === 'source' && args[i + 1]) { src = args[i + 1]; i++; }
      else if (a === 'rapid') rapid = true;
      else if (dst === null && a !== 'count' && a !== 'source') dst = a;
    }
    if (dst === null) {
      return { lines: ['ping: invalid destination address'] };
    }
    var target = findTarget(world, dst);
    if (!target) {
      return { lines: ['ping: unknown host ' + dst] };
    }
    var res = net.pingDev(world, rt.key, target.ip, src);
    var lines = ['PING ' + target.ip + ' (' + target.ip + '): 56 data bytes'];
    if (res.code === 'badsrc') {
      return { lines: ['ping: bind: Cannot assign requested address'] };
    }
    if (res.code === 'baddest') {
      return { lines: ['ping: invalid destination address'] };
    }
    var ttl = 64 - ((res.hops || []).length + 1);
    var times = [];
    for (var q = 0; q < count; q++) {
      var tm = parseFloat(det(rt.key + ':' + target.ip + ':' + q));
      times.push(tm);
      if (!res.ok) {
        if (res.code === 'nohost') lines.push('Request timeout for icmp_seq ' + q);
        else if (res.code === 'noroute') lines.push('ping: sendto: No route to host');
        else lines.push('Request timeout for icmp_seq ' + q);
        continue;
      }
      lines.push('64 bytes from ' + target.ip + ': icmp_seq=' + q + ' ttl=' + ttl + ' time=' + tm + ' ms');
    }
    if (rapid) { /* rapid mode: same output, shorter interval */ }
    lines.push('');
    lines.push('--- ' + target.ip + ' ping statistics ---');
    lines.push(count + ' packets transmitted, ' + (res.ok ? count : 0) + ' packets received, ' + (res.ok ? '0' : '100') + '% packet loss');
    if (res.ok && count > 1) {
      var mn = times[0], mx = times[0], av = 0;
      for (var t = 0; t < times.length; t++) { mn = Math.min(mn, times[t]); mx = Math.max(mx, times[t]); av += times[t]; }
      lines.push('round-trip min/avg/max/stddev = ' + mn.toFixed(3) + '/' + (av / times.length).toFixed(3) + '/' + mx.toFixed(3) + '/0.098 ms');
    }
    return { lines: lines };
  }

  // ---- traceroute (real path via JJ.net.tracePath) ----
  function opTraceroute(sess, args, world) {
    var rt = sess.rt;
    var dst = null;
    for (var i = 0; i < args.length; i++) {
      if (args[i] !== 'as-number-lookup' && dst === null) dst = args[i];
    }
    if (dst === null) return { lines: ['traceroute: invalid destination address'] };
    var target = findTarget(world, dst);
    if (!target) return { lines: ['traceroute: unknown host ' + dst] };
    var res = net.tracePath(world, rt.key, target.ip);
    var lines = ['traceroute to ' + target.ip + ' (' + target.ip + '), 30 hops max, 40 byte packets'];
    if (res.ok) {
      for (var h = 0; h < res.hops.length; h++) {
        var hop = res.hops[h];
        lines.push(' ' + (h + 1) + '  ' + hop.to + '  ' + det(rt.key + ':tr:' + h) + ' ms  ' + det(rt.key + ':trb:' + h) + ' ms  ' + det(rt.key + ':trc:' + h) + ' ms');
      }
      lines.push(' ' + (res.hops.length + 1) + '  ' + target.ip + ' (' + target.ip + ')  ' + det(rt.key + ':tr:fn') + ' ms  ' + det(rt.key + ':trb:fn') + ' ms  ' + det(rt.key + ':trc:fn') + ' ms');
    } else {
      for (var f = Math.max(1, res.hops.length); f <= Math.max(3, res.hops.length); f++) {
        lines.push(' ' + f + '  * * *');
      }
    }
    return { lines: lines };
  }

  // ---------- cross-device ssh / telnet (session switching) ----------

  function deviceForIp(world, ip) {
    var hit = net.deviceWithIp(world, ip);
    return hit ? hit.key : null;
  }

  function lastLoginStamp(offsetMs) {
    var d = new Date(now() - (offsetMs || 7180000));
    var mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
    var dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
    return dow + ' ' + mon + ' ' + z2(d.getUTCDate()) + ' ' + z2(d.getUTCHours()) + ':' + z2(d.getUTCMinutes()) + ':' + z2(d.getUTCSeconds()) + ' ' + d.getUTCFullYear();
  }

  function srcIpOf(sess, world, fromKey) {
    var ds = world.devices[fromKey];
    if (!ds) return '10.0.0.1';
    var cands = [];
    for (var s = 0; s < ds.subnets.length; s++) {
      if (ds.subnets[s].kind === 'lo' || ds.subnets[s].kind === 'mgmt') continue;
      cands.push(ds.subnets[s]);
    }
    if (!cands.length) cands = ds.subnets;
    cands.sort(function (x, y) { return J.cmpTokens([x.ukey], [y.ukey]); });
    return cands[0].ip;
  }

  function opSsh(sess, args, world) {
    var rt = sess.rt;
    var raw = args.length ? args[0] : '';
    var user = null, host = raw;
    var at = String(raw).indexOf('@');
    if (at > 0) { user = raw.slice(0, at); host = raw.slice(at + 1); }
    if (!host) return { lines: ['        usage: ssh <host>'], cmd: null };
    var found = findTarget(world, host);
    if (!found) return { lines: ['ssh: Could not resolve hostname ' + host + ': Host name lookup failure'] };
    var devKey = found.host ? null : deviceForIp(world, found.ip);
    if (!devKey || devKey === rt.key) {
      return { lines: ['ssh: connect to host ' + found.ip + ' port 22: Connection refused'] };
    }
    var dstRt = ensureRt(devKey);
    var srcIp = srcIpOf(sess, world, sess.fromKey || rt.key);
    sess.fromKey = rt.key;
    sess.rt = dstRt;
    sess.user = user || 'root';
    sess.editPath = [];
    sess.screenLen = 24;
    sess.pager = null;
    syslogPush(dstRt, 'sshd[' + (1380 + (J.hash('ssh:' + dstRt.key) % 7100)) + ']: Accepted publickey for ' + sess.user + ' from ' + srcIp + ' port 62421 ssh2');
    return {
      lines: [
        'Password:',
        'Last login: ' + lastLoginStamp() + ' from ' + srcIp,
        '',
        'Warning: This system is for LAB use only... All activity is subject to monitoring.'
      ],
      mode: 'shell'
    };
  }

  function opTelnet(sess, args, world) {
    var rt = sess.rt;
    var host = args.length ? args[0] : '';
    if (!host) return { lines: ['        usage: telnet <host>'], cmd: null };
    var port = 23;
    if (args.length > 1 && /^\d+$/.test(args[1])) port = parseInt(args[1], 10);
    var found = findTarget(world, host);
    if (!found) return { lines: ['telnet: could not resolve ' + host + ': Name or service not known'] };
    var devKey = found.host ? null : deviceForIp(world, found.ip);
    if (!devKey || devKey === rt.key) {
      return { lines: ['telnet: connect to address ' + found.ip + ': Connection refused'] };
    }
    var dstRt = ensureRt(devKey);
    var srcIp = srcIpOf(sess, world, sess.fromKey || rt.key);
    var srcRt = J._rts ? J._rts[sess.fromKey || rt.key] : null;
    if (srcRt) syslogPush(srcRt, 'telnetd[' + (1400 + (J.hash('tn:' + dstRt.key) % 500)) + ']: Connection received from ' + srcIp);
    sess.fromKey = rt.key;
    sess.rt = dstRt;
    sess.user = null;
    sess.editPath = [];
    sess.screenLen = 24;
    sess.pager = null;
    return {
      lines: [
        'Trying ' + found.ip + '...',
        'Connected to ' + found.ip + '.',
        'Escape character is \x27^]\x27.',
        '',
        dstRt.key + '  (ttyd0)',
        ''
      ],
      mode: 'login'
    };
  }

  // ---------- helpers: interface / config path resolution ----------

  function resolveIfname(ds, tok) {
    if (!ds || tok == null) return null;
    var t = String(tok);
    for (var i = 0; i < ds.iflist.length; i++) if (ds.iflist[i] === t) return ds.iflist[i];
    var hits = [];
    for (var j = 0; j < ds.iflist.length; j++) if (ds.iflist[j].indexOf(t) === 0) hits.push(ds.iflist[j]);
    return hits.length === 1 ? hits[0] : null;
  }

  function showIfName(ds, args) {
    var t = args.ifname || (args.free && args.free[0]) || null;
    return t ? resolveIfname(ds, t) : null;
  }

  function cfgResolvePath(root, parts) {
    var node = root;
    for (var i = 0; i < parts.length; i++) {
      var c = null;
      for (var k = 0; k < node.children.length; k++) {
        if (node.children[k].name === parts[i]) { c = node.children[k]; break; }
      }
      if (!c) {
        var hits = [];
        for (var x = 0; x < node.children.length; x++) {
          if (node.children[x].name.indexOf(parts[i]) === 0) hits.push(node.children[x]);
        }
        if (hits.length === 1) c = hits[0];
      }
      if (!c) return { node: node, failIdx: i };
      node = c;
    }
    return { node: node, failIdx: -1 };
  }

  // ---------- op mode — small utilities ----------

  function opFileList(sess, args) {
    var p = args.length ? args[0] : '/var/home/root';
    if (p === '/' || p === '') {
      return [
        '/:',
        '.',
        'bin/',
        'boot/',
        'config/',
        'dev/',
        'etc/',
        'home/',
        'kernel/',
        'opt/',
        'packages/',
        'root/',
        'tmp/',
        'usr/',
        'var/',
        ''
      ];
    }
    if (/^\/var\/log(\/)?$/.test(p)) {
      return [
        '/var/log:',
        '.',
        'chassisd',
        'cosd',
        'interactive-commands',
        'messages',
        'rpd',
        ''
      ];
    }
    return [
      p.replace(/\/$/, '') + ':',
      '.',
      'README.md',
      'robust-a.config',
      'robust-b.config',
      'var/',
      ''
    ];
  }

  function opFileShow(rt, path) {
    if (!path) return { lines: ['usage: file show <file>'] };
    if (/messages/.test(path)) {
      var log = rt.syslog || seedSyslog(rt.key);
      return { lines: log.slice(-8).slice() };
    }
    if (/interactive-commands/.test(path)) {
      return { lines: (rt.intLog || seedIntLog(rt)).slice(-8) };
    }
    if (/\.md$/i.test(path)) {
      return { lines: ['# SHARKS Junos practice lab', '# Sample configs: robust-a.config, robust-b.config'] };
    }
    if (/\.config$/.test(path)) {
      return { lines: configSetLines(rt) };
    }
    return { lines: ['error: cannot open \x27' + path + '\x27'] };
  }

  function configSetLines(rt) {
    var es = db.setLines(rt.committed || rt.config, false);
    var out = [];
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      out.push((e.inactive ? 'inactive: set ' : 'set ') + db.stmtText(e));
    }
    return out;
  }

  function displaySetLines(root) {
    var es = db.setLines(root, true);
    var out = [];
    for (var i = 0; i < es.length; i++) {
      if (es[i].inactive) continue;
      out.push('set ' + db.stmtText(es[i]));
    }
    return out;
  }

  function opFileStats(rt, path) {
    return [
      'files: ' + (rt.syslog ? rt.syslog.length : 8),
      'blocks: 64',
      'size: 10485 bytes',
      'last modified: ' + utc(now() - 60000),
      ''
    ];
  }

  function opMonitor(sess, args) {
    var ds = dsOf(sess);
    var tok = args.length ? args[0] : '';
    var name = resolveIfname(ds, tok);
    if (!tok) return { lines: ['        usage: monitor interface <ifname>'] };
    if (!name || ds.interfaces[name].kind !== 'phys') {
      return { lines: ['error: interface not found  ' + tok] };
    }
    var ifc = ds.interfaces[name];
    var seed = ds.key + ':' + name;
    return {
      lines: [
        '',
        'Monitoring ' + name + ' ... hit \x27ctrl-c\x27 to terminate monitoring',
        '',
        'Format: two lines:  Input packets (ping) / Output packets (ping),',
        padR('Current', 20) + padL('uint64', 16) + padL('%', 5) + padL('uint64', 9) + '    ' + padL('uint64', 9),
        padR(delRef(), 4),
        padR('Bytes', 20) + padL(String(detBig(seed + ':mb')), 16) + padL('b/s', 5) + padL(String(detBig(seed + ':ob')), 9) + 'b/s',
        'Type \x27^c\x27 to quit monitoring. ^C    '
      ]
    };
  }
  function delRef() { return '0'; }

  function opRequestSystem(rt) { return { lines: [], reboot: true }; }

  function opRequestSupport(rt, ds) {
    var lines = [];
    lines = lines.concat(showVersion(rt));
    lines = lines.concat(['']);
    lines = lines.concat(['Utilization:']);
    lines = lines.concat(showChassisRE(rt).slice(3, 9));
    lines = lines.concat(['']);
    lines = lines.concat(['Configuration:']);
    lines = lines.concat(db.setLines(rt.committed).slice(0, 12));
    return lines;
  }

  function opSetCli(sess, args) {
    var line = args.join(' ');
    if (!args[2]) return errCaret(sess, line, args.length, 'error: incomplete command');
    var prop = args[2];
    var sargs = args.slice(3);
    if (/terminal/.test(prop)) {
      sess.terminalType = sargs[0] || 'ansi';
      return { lines: [] };
    }
    if (/screen-length/.test(prop)) {
      var n = sargs[0];
      if (n === '0') {
        sess.screenLen = 0;
        return { lines: ['Screen length set to none'] };
      } else if (/^\d+$/.test(String(n))) {
        sess.screenLen = parseInt(n, 10) || 0;
        return { lines: ['Screen length set to ' + sess.screenLen] };
      }
      return errCaret(sess, line, 3, 'error: syntax error');
    }
    return errCaret(sess, line, 2, 'error: syntax error');
  }

  function startShell(sess) {
    sess.mode = 'shell';
    return { lines: [] };
  }

  function shellHelp(sess) {
    return ['Junos shell command simulation: commands available:',
      '  cat, cd, cli, date, df, exit, help, hostname, logout, ls, ps, pwd, quit, reboot, uname, uptime, whoami'];
  }

  var SHELL_LEAF = ['calendar', 'cli', 'help', 'logout', 'quit'];

  var HOME_FILES = ['.cshrc', '.history', 'README.md', 'robust-a.config', 'robust-b.config', 'var/'];
  var SHELL_TREE = {
    '/': ['bin/', 'boot/', 'config/', 'dev/', 'etc/', 'home/', 'kernel/', 'opt/', 'packages/', 'root/', 'tmp/', 'usr/', 'var/'],
    '/bin': ['cat', 'csh', 'ls', 'ps', 'pwd', 'reboot', 'sh'],
    '/boot': ['kernel-010/'],
    '/config': ['juniper.conf', 'temporary.conf'],
    '/dev': ['ttyd0'],
    '/etc': ['hosts', 'motd', 'passwd', 'resolv.conf'],
    '/home': ['root/', 'user/'],
    '/kernel': ['kernel'],
    '/packages': ['junos/'],
    '/root': HOME_FILES,
    '/root/var': ['log/', 'tmp/'],
    '/tmp': [],
    '/usr': ['bin/', 'lib/'],
    '/var': ['home/', 'log/', 'tmp/'],
    '/var/home': ['root/', 'user/'],
    '/var/home/root': HOME_FILES,
    '/var/home/root/var': ['log/', 'tmp/'],
    '/var/home/user': ['.cshrc', '.shrc'],
    '/var/log': ['chassisd', 'cosd', 'interactive-commands', 'messages', 'rpd'],
    '/var/tmp': []
  };

  function normShellPath(cwd, arg) {
    var p = String(arg == null ? '' : arg);
    if (!p || p === '~') return '/root';
    var stack;
    if (p[0] === '~') { stack = ['root']; p = p.slice(1); }
    else if (p[0] === '/') { stack = []; p = p.slice(1); }
    else stack = (String(cwd || '/root') === '/' ? [] : String(cwd || '/root').slice(1).split('/'));
    var segs = p.split('/');
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (!s || s === '.') continue;
      if (s === '..') { stack.pop(); continue; }
      stack.push(s);
    }
    var out = '/' + stack.join('/');
    if (out.length > 1 && out.charAt(out.length - 1) === '/') out = out.slice(0, -1);
    return out;
  }

  function shellCatLine(rt, ap) {
    if (ap === '/var/log/messages') return showLog(rt, 'messages');
    if (ap === '/var/log/interactive-commands') return showLog(rt, 'interactive-commands');
    if (ap === '/var/log/rpd' || ap === '/var/log/chassisd' || ap === '/var/log/cosd') return showLog(rt, ap.split('/').pop());
    var base = ap.split('/').pop();
    if (/^robust-(a|b)\.config$/.test(base)) return configSetLines(rt);
    if (/^(juniper\.conf|temporary\.conf)$/.test(base)) return db.braceRender(rt.committed, [], false) || [];
    if (/^README\.md/i.test(base)) return ['# SHARKS Junos practice lab', '# Sample configs: robust-a.config, robust-b.config'];
    var fm = {
      '/etc/hosts': ['127.0.0.1 localhost'],
      '/etc/resolv.conf': ['nameserver 10.0.0.1'],
      '/etc/motd': ['Junos OS for lab use only... All activity is subject to monitoring.'],
      '/etc/passwd': ['root:*:0:0:Mr. Juno:/root:/bin/csh', 'user:*:2:0:Labs:/var/home/user:/bin/csh']
    };
    if (fm[ap]) return fm[ap].slice();
    return null;
  }

  function shellCmd(sess, line) {
    var toks = tokenize(line);
    if (!toks.length) return { lines: [] };
    var w = toks[0];
    var rt = sess.rt;
    var cwd = sess.cwd || '/root';
    if (w === 'cli') { sess.mode = 'cli-op'; return { lines: [], mode: 'cli-op' }; }
    if (w === 'pwd') return { lines: [cwd] };
    if (w === 'cd') {
      var np = normShellPath(cwd, toks[1] || '~');
      if (!SHELL_TREE[np]) return { lines: ['cd: can\x27t cd to ' + (toks[1] == null ? '~' : toks[1])] };
      sess.cwd = np;
      return { lines: [] };
    }
    if (w === 'ls' || w === 'dir') {
      var largs = toks.slice(1);
      var longList = false, target = null;
      for (var a2 = 0; a2 < largs.length; a2++) {
        if (largs[a2].charAt(0) === '-') longList = true;
        else if (target === null) target = largs[a2];
      }
      var dp = normShellPath(cwd, target);
      if (!SHELL_TREE[dp]) return { lines: ['ls: ' + (target == null ? '.' : target) + ': No such file or directory'] };
      var names2 = SHELL_TREE[dp].slice().sort(J.cmpTokens);
      if (longList) {
        var lsLines = [];
        for (var l2 = 0; l2 < names2.length; l2++) {
          var isDir2 = names2[l2].slice(-1) === '/';
          var sz2 = 420 + (J.hash(dp + ':' + names2[l2]) % 2100);
          var ld2 = new Date(now() - 860000);
          var stamp2 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][ld2.getUTCMonth()] + ' ' + z2(ld2.getUTCDate()) + ' ' + z2(ld2.getUTCHours()) + ':' + z2(ld2.getUTCMinutes());
          lsLines.push((isDir2 ? 'drwxr-xr-x' : '-rw-r--r--') + '  1 root  field  ' + padL(String(sz2), 5) + ' ' + stamp2 + '  ' + names2[l2]);
        }
        return { lines: lsLines };
      }
      return { lines: names2 };
    }
    if (w === 'cat' || w === 'more' || w === 'less') {
      if (toks.length < 2) return { lines: ['usage: cat <file>'] };
      var catLines = [];
      for (var c2 = 1; c2 < toks.length; c2++) {
        var ap2 = normShellPath(cwd, toks[c2]);
        var L2 = shellCatLine(rt, ap2);
        if (L2 == null) return { lines: ['cat: ' + toks[c2] + ': No such file or directory'] };
        catLines = catLines.concat(L2);
      }
      return { lines: catLines };
    }
    if (w === 'ps') return { lines: showSystemProcess() };
    if (w === 'df') return { lines: showSystemStorage() };
    if (w === 'reboot') {
      syslogPush(rt, 'kernel: reboot initiated by ' + (sess.user || 'root'));
      return { lines: ['reboot: shutting down now'], reboot: true };
    }
    if (w === 'uname' || w.indexOf('uname') === 0) {
      return { lines: ['FreeBSD ' + sess.rt.key.toLowerCase() + '.juniper.net ' + (specVer(sess.rt)).toLowerCase() + ' CR-2021 FreeBSD/amd64'] };
    }
    if (w === 'date') return { lines: [dayStamp(new Date(now())) + '  ' + utc(now())] };
    if (w === 'calendar') return {
      lines: [
        'June 2026',
        'Mo Tu We Th Fr Sa Su',
        ' 1  2  3  4  5  6  7'
      ]
    };
    if (w === 'hostname') return { lines: [sess.rt.key] };
    if (w === 'uptime') {
      var booted = sess.rt.bootAt || now() - 3000000;
      return { lines: [dayStamp(new Date(now())) + '  up ' + Math.max(1, Math.floor((now() - booted) / 60000)) + ' mins, 1 user, load averages: 0.07, 0.02, 0.01'] };
    }
    if (w === 'whoami') return { lines: [sess.user || 'root'] };
    if (w === 'help') return { lines: shellHelp(sess) };
    if (w === 'logout' || w === 'exit' || w === 'quit') {
      sess.mode = 'login';
      sess.user = null;
      return { lines: [] };
    }
    return { lines: ['sh: ' + w + ': not found'] };
  }

  function opHelp(sess) {
    return completionsBlockPadding(OP_TOP);
  }

  function completionsBlockPadding(rows) {
    var out = ['Available commands:'];
    var w = 0;
    for (var i = 0; i < rows.length; i++) w = Math.max(w, String(rows[i][0]).length);
    w = Math.min(w, 18);
    for (var j = 0; j < rows.length; j++) out.push('  ' + padR(rows[j][0], w + 3) + (rows[j][1] || ''));
    return out;
  }

  // ---------- pipe filters ----------

  function applyPipes(lines, pipeToks) {
    if (!pipeToks || !pipeToks.length) return lines;
    var cur = lines.slice();
    var i = 0;
    var out = [].concat(cur);
    while (i < pipeToks.length) {
      var f = pipeToks[i];
      if (f === 'display' || (f === 'disp' && 'display'.indexOf(f) === 0)) {
        if ((pipeToks[i + 1] === 'set') || (pipeToks[i + 1] === 'se' && 'set'.indexOf(pipeToks[i + 1]) === 0)) {
          out = out.filter(function (l) { return /^set /.test(l); });
          i += 2;
          continue;
        }
        i += 2;
        continue;
      }
      var mo;
      if (/^(ma|mat|matc|match)$/.test(f)) {
        mo = pipeToks[i + 1];
        out = matchFilter(out, mo, false);
        i += 2;
        continue;
      }
      if (/^(ex|exc|exce|excep|except)$/.test(f)) {
        mo = pipeToks[i + 1];
        out = matchFilter(out, mo, true);
        i += 2;
        continue;
      }
      if (/^(co|cou|coun|count)$/.test(f)) {
        return [String(out.length)];
      }
      if (/^(la|las|last)$/.test(f)) {
        out = out.slice(-Math.max(0, parseInt(pipeToks[i + 1], 10) || 0));
        i += 2;
        continue;
      }
      if (/^(fi|fir|firs|first)$/.test(f)) {
        out = out.slice(0, Math.max(0, parseInt(pipeToks[i + 1], 10) || 0));
        i += 2;
        continue;
      }
      break;
    }
    return out;
  }

  function matchFilter(lines, pattern, negate) {
    if (pattern == null) return lines;
    var re = null;
    try { re = new RegExp(String(pattern), 'i'); } catch (e) {}
    var out = [];
    if (re) {
      for (var i = 0; i < lines.length; i++) {
        var m = re.test(lines[i]);
        if (negate ? !m : m) out.push(lines[i]);
      }
      return out;
    }
    var s = String(pattern).toLowerCase();
    for (var k = 0; k < lines.length; k++) {
      var hit = lines[k].toLowerCase().indexOf(s) >= 0;
      if (negate ? !hit : hit) out.push(lines[k]);
    }
    return out;
  }

  // ---------- operational dispatcher ----------

  function runOp(sess, line) {
    var world = sess.world;
    var rt = sess.rt;
    var sp = splitPipe(tokenize(line));
    var main = sp.main, pipeToks = sp.pipe;
    if (!main.length) return { lines: [] };
    var ds = world.devices[rt.key];

    var args = {};
    var pathWords = [];
    var node = OP_ROOT;
    var failTok = -1, failKind = null;
    var i = 0;
    for (i = 0; i < main.length; i++) {
      var tok = main[i];
      var r = resolveTok(tok, node.sub);
      if (r === AMBIG) { failKind = 'ambiguous'; failTok = i; break; }
      if (r == null) {
        if (node.dyn && dynValid(node.dyn, sess, tok)) {
          if (node.dyn === true) { args.free = args.free || []; args.free.push(tok); }
          else { args[node.dyn] = tok; }
          continue;
        }
        if (node.free) { args.rest = main.slice(i); i = main.length; break; }
        failKind = 'nomatch'; failTok = i; break;
      }
      node = r;
      pathWords.push(node.w);
      if (!node.sub) {
        var rrest = main.slice(i + 1);
        if (node.dyn && rrest.length && dynValid(node.dyn, sess, rrest[0])) {
          if (node.dyn === true) {
            args.rest = rrest;
            args.leafRest = true;
          } else {
            args[node.dyn] = rrest[0];
            args.rest = rrest.slice(1);
          }
        } else {
          args.rest = rrest;
        }
        i = main.length;
        break;
      }
    }
    if (failTok >= 0) {
      if (failTok === 0) {
        return { lines: failKind === 'ambiguous' ? ['% Ambiguous command.'] : ['% Unknown command.'] };
      }
      return errCaret(sess, line, failTok, failKind === 'ambiguous' ? '% ambiguous command' : '^ unknown command: \x27' + main[failTok] + '\x27');
    }
    if (!pathWords.length) return { lines: completionsBlock(candsAt(OP_ROOT, sess)) };

    // absorb trailing identifiers for leaf commands (show interfaces terse <if>, show log <file>, …)
    if (args.rest && args.rest.length) {
      var kj = pathWords.join(' ');
      var t0 = String(args.rest[0]);
      if (!args.ifname && !args.free && resolveIfname(ds, t0) &&
          (kj === 'show interfaces' || kj.indexOf('show interfaces ') === 0 ||
           kj === 'monitor interface' || kj === 'monitor traffic interface')) {
        args.ifname = t0;
        args.rest = args.rest.slice(1);
      }
    }
    if (args.rest && args.rest.length && !args.leafRest) {
      return errCaret(sess, line, main.length - args.rest.length, '^ invalid input: ' + args.rest[0]);
    }

    var key = pathWords.join(' ');

    // op-mode `show configuration` special pipes (compare / display set)
    if (key === 'show configuration' && pipeToks.length) {
      var p0 = String(pipeToks[0] || '').toLowerCase();
      if (p0.length && 'compare'.indexOf(p0) === 0 && 'count'.indexOf(p0) !== 0) {
        var rbase = (rt.revisions && rt.revisions[1]) || rt.committed;
        if (pipeToks[1] && /^(ro|rol|roll|rollb|rollba|rollbac|rollback)$/.test(String(pipeToks[1]).toLowerCase())) {
          var rn = parseInt(pipeToks[2], 10);
          rbase = (rt.revisions && rt.revisions[rn]) || rbase;
        }
        return { lines: compareAt(sess, rbase) };
      }
      if (p0.length && 'display'.indexOf(p0) === 0 && pipeToks[1] && 'set'.indexOf(String(pipeToks[1]).toLowerCase()) === 0) {
        return { lines: displaySetLines(rt.committed) };
      }
    }

    // completion gate: partial 'show' paths that are themselves runnable commands run now
    if (node && node.sub && pathWords[0] === 'show' && !args.rest && !args.ifname && !args.free) {
      var kk = pathWords.join(' ');
      if (kk !== 'show interfaces' && kk !== 'show route' && kk !== 'show route forwarding-table' && kk !== 'show chassis fpc') {
        return { lines: completionsBlock(candsAt(node, sess)) };
      }
    }

    var out = dispatchOp(sess, key, args, ds, world, rt);
    if (out && out.msgType === 'mode') return out;
    var lines = out.lines == null ? [] : out.lines;
    return {
      lines: applyPipes(lines, pipeToks),
      mode: out.mode || null,
      reboot: out.reboot || false,
      pend: out.pend || null
    };
  }

  function dynValid(kind, sess, tok) {
    var world = sess.world;
    var ds = world.devices[sess.rt.key];
    if (kind === 'ifname') return ds ? !!resolveIfname(ds, tok) : false;
    if (kind === 'logname') return true;
    if (kind === true) return true;
    return false;
  }

  function dispatchOp(sess, key, args, ds, world, rt) {
    var lines;
    switch (key) {
      case 'show version': return { lines: showVersion(rt) };
      case 'show system uptime':
        lines = showUptime(rt); break;
      case 'show system processes':
        lines = showSystemProcess(); break;
      case 'show system storage':
        lines = showSystemStorage(); break;
      case 'show system users':
        lines = showSystemUsers(rt); break;
      case 'show system commit': lines = showSystemCommit(rt); break;
      case 'show':
        return { lines: completionsBlock(candsAt(OP_TREE.show, sess)) };
      case 'show interfaces': {
        var ifn0 = args.ifname || (args.free && args.free[0]) || null;
        if (ifn0) {
          var name = resolveIfname(ds, ifn0);
          if (!name) return { lines: caretErrorIfname(ifn0) };
          return { lines: showIntBlock(ds, ds.interfaces[name], 'detail') };
        }
        lines = showIntTerse(ds, null);
        break;
      }
      case 'show interfaces terse':
        lines = showIntTerse(ds, showIfName(ds, args));
        break;
      case 'show interfaces brief':
        case 'show interfaces media': case 'show interfaces statistics': case 'show interfaces diagnostics': case 'show interfaces detail': case 'show interfaces extensive': {
        if (!args.ifname && !args.free) return { lines: ['error: interface required for this view'] };
        var nm = showIfName(ds, args);
        if (!nm) return { lines: caretErrorIfname(args.ifname || (args.free && args.free[0]) || '') };
        var mode = key.split(' ')[2];
        lines = showIntBlock(ds, ds.interfaces[nm], mode === 'extensive' ? 'detail' : mode);
        break;
      }
      case 'show route':
        return { lines: routeLines(ds, args) };
      case 'show route detail': case 'show route exact': case 'show route extensive':
        return { lines: routeLines(ds, args, 'detail') };
      case 'show route forwarding-table':
        return { lines: showRouteForwarding(ds) };
      case 'show route forwarding-table detail': case 'show route forwarding-table extensive':
        return { lines: showRouteForwarding(ds) };
      case 'show route forwarding-table exact':
        return { lines: showRouteForwarding(ds) };
      case 'show route summary':
        return { lines: showRouteSummary(ds) };
      case 'show route protocol': {
        var pproto = (args.rest && args.rest[0]) || (args.free && args.free[0]) || null;
        return { lines: routeLines(ds, args, null, pproto) };
      }
      case 'show ospf neighbor':
        return { lines: showOspfNbr(ds) };
      case 'show ospf interface':
        return { lines: showOspfInterface(ds, args.ifname || null) };
      case 'show ospf database':
        return { lines: showOspfDatabase(ds) };
      case 'show ospf route':
        return { lines: showOspfRoute(ds) };
      case 'show ospf overview':
        return { lines: showOspfOverview(ds) };
      case 'show ospf statistics':
        return { lines: showOspfStats(ds) };
      case 'show bgp summary':
        return { lines: showBgpSummary(ds) };
      case 'show bgp neighbor':
        return { lines: showBgpNeighbor(ds) };
      case 'show arp':
        return { lines: showArp(ds) };
      case 'show lldp': case 'show lldp neighbors':
        return { lines: showLldp(ds) };
      case 'show vlans':
        return { lines: ds.vlans.length ? showVlans(ds) : ['error: no vlans configured on this device'] };
      case 'show ethernet-switching table':
        return { lines: showMacTable(ds) };
      case 'show spanning-tree bridge':
        return { lines: showStpBridge(ds) };
      case 'show spanning-tree interface':
        return { lines: showStpInterface(ds) };
      case 'show chassis hardware':
        return { lines: showChassisHardware(rt) };
      case 'show chassis fpc':
        return { lines: showChassisFpc(rt) };
      case 'show chassis fpc pic-status': case 'show chassis pic-status':
        return { lines: showChassisPicStatus(rt) };
      case 'show chassis routing-engine':
        return { lines: showChassisRE(rt) };
      case 'show chassis alarms':
        return { lines: showChassisAlarms(rt) };
      case 'show chassis environment':
        return { lines: showChassisEnvironment(rt) };
      case 'show log':
        return { lines: showLog(rt, args.logname || (args.rest && args.rest[0]) || null) };
      case 'show configuration': {
        var showParts = args.rest || [];
        return cfgShow(sess, showParts);
      }
      case 'ping':
        if (!args.rest || !args.rest.length) return { pend: 'ping' };
        return opPing(sess, args.rest, world);
      case 'traceroute':
        if (!args.rest || !args.rest.length) return { pend: 'traceroute' };
        return opTraceroute(sess, args.rest, world);
      case 'ssh':
        if (!args.rest || !args.rest.length) return { pend: 'ssh' };
        return opSsh(sess, args.rest, world);
      case 'telnet':
        if (!args.rest || !args.rest.length) return { pend: 'telnet' };
        return opTelnet(sess, args.rest, world);
      case 'clear arp':
        ds.arp = [];
        return { lines: [] };
      case 'clear ospf neighbor':
        ds.ospfNeighbors = [];
        return { lines: [] };
      case 'clear ospf statistics':
        return { lines: [] };
      case 'file list':
        lines = opFileList(sess, args.rest || []);
        break;
      case 'file show': {
        var fsout = opFileShow(rt, (args.rest || [])[0]);
        return { lines: fsout.lines };
      }
      case 'file statistics':
        lines = opFileStats(rt, (args.rest || [])[0]);
        break;
      case 'monitor interface':
        return opMonitor(sess, args.ifname ? [args.ifname] : (args.rest || []));
      case 'monitor traffic': case 'monitor':
        return { lines: completionsBlock(candsAt(OP_TREE.monitor, sess)) };
      case 'request system reboot':
        return opRequestSystem(rt);
      case 'request support information':
        return { lines: opRequestSupport(rt, ds) };
      case 'request': case 'request system':
        return { lines: completionsBlock(candsAt(OP_TREE.request, sess)) };
      case 'set cli screen-length':
        return opSetCli(sess, ['set', 'cli', 'screen-length'].concat(args.rest || []));
      case 'set cli terminal-type':
        return opSetCli(sess, ['set', 'cli', 'terminal-type'].concat(args.rest || []));
      case 'set':
        return { lines: completionsBlock(candsAt(OP_TREE.set, sess)) };
      case 'start shell':
        return startShell(sess);
      case 'start':
        return { lines: completionsBlock(candsAt(OP_TREE.start, sess)) };
      case 'help':
        return { lines: opHelp(sess) };
      case 'status':
        return { lines: cfgStatus(sess) };
      case 'quit': case 'exit':
        sess.mode = 'login';
        return { lines: [], msgType: 'mode', mode: 'login' };
      case 'configure': case 'edit':
        sess.mode = 'cli-cfg';
        return { lines: [], msgType: 'mode', mode: 'cli-cfg' };
      case 'pipe':
        return { lines: [] };
      default:
        if (node.sub) return { lines: completionsBlock(candsAt(node, sess)) };
        return { lines: ['% Unknown command.'] };
    }
    return { lines: lines };
  }

  function caretErrorIfname(tok) {
    return ['error: could not find interface \x27' + tok + '\x27'];
  }

  // route table builders with dest/protocol filters
  function routeDestFilter(args) {
    var pool = [];
    if (args && args.free) pool = pool.concat(args.free);
    if (args && args.rest) pool = pool.concat(args.rest);
    for (var i = 0; i < pool.length; i++) {
      var t = String(pool[i]);
      if (/^(detail|exact|extensive|forwarding-table|summary|protocol|dot|hide-address|table|all|private)$/.test(t)) continue;
      if (!/^[a-zA-Z]/.test(t)) return t;
    }
    return null;
  }

  function destMatches(dest, filter) {
    if (String(dest) === String(filter)) return true;
    var pf = J.parseIp(String(filter));
    var pd = J.parseIp(String(dest));
    if (!pf || !pd) return false;
    if (pf.prefix === null && J.inNet(filter, dest)) return true;
    if (pf.prefix !== null && pd.prefix !== null && pd.prefix >= pf.prefix) {
      return J.inNet(pd.ip, filter);
    }
    return false;
  }

  function routeLines(ds, args, mode, proto) {
    var wantDetail = mode === 'detail';
    if (args && args.proto) proto = proto || args.proto;
    var routes = (ds && ds.routes) || [];
    var filtered = routes;
    if (proto) {
      filtered = filtered.filter(function (r) {
        return String(r.proto).toLowerCase() === String(proto).toLowerCase();
      });
    }
    var destFilter = proto ? null : routeDestFilter(args);
    if (destFilter) {
      filtered = filtered.filter(function (r) { return destMatches(r.dest, destFilter); });
    }
    if (!filtered.length) {
      return ['inet.0: 0 destinations, 0 routes'];
    }
    if (wantDetail) {
      var outb = [''];
      var dseen = {};
      for (var d2 = 0; d2 < filtered.length; d2++) dseen[filtered[d2].dest] = 1;
      outb.push('inet.0: ' + Object.keys(dseen).length + ' destinations, ' + filtered.length + ' routes (' + filtered.length + ' active, 0 holddown, 0 hidden)');
      outb.push('+ = Active Route, - = Last Active, * = Both');
      outb.push('');
      for (var k = 0; k < filtered.length; k++) {
        var r2 = filtered[k];
        var age2 = r2.created ? routeAge(r2.created) : '00:00:00';
        var head2 = padR(r2.dest, 19) + '*[' + r2.proto + '/' + r2.pref + '] ' + age2;
        if (r2.proto === 'Direct') head2 += ', metric 0, tag 0';
        else if (r2.proto === 'Local') head2 += ', metric 0';
        else if (r2.proto === 'OSPF') head2 += ', metric ' + (r2.metric != null ? r2.metric : '1');
        outb.push(head2);
        outb.push('\tState: <Active Int>');
        outb.push('\tAge: ' + age2);
        outb.push('\tMetric: ' + (r2.metric != null ? r2.metric : '0'));
        if (r2.proto === 'OSPF') outb.push('\tArea: 0.0.0.0');
        if (r2.mode === 'discard' || r2.mode === 'reject') outb.push('\tDiscard');
        else if (r2.proto === 'Local') outb.push('\tLocal via ' + (r2.local ? r2.local : r2.dest.split('/')[0]));
        else if (r2.to) outb.push('\tNext hop: ' + r2.to + ', via ' + r2.via);
        else if (r2.via) outb.push('\tvia ' + r2.via);
        outb.push('');
      }
      return outb;
    }
    return showRoute(ds, null, null, filtered);
  }

  // ============================================================
  // PART 4B — configuration mode runtime
  // (runCfg / cfgShow / compare / candidateWords / pendFeed / feed)
  // ============================================================

  var CFG_TREE = buildTree(CFG_TOP);
  var CFG_ROOT = { w: null, d: '', sub: CFG_TREE, dyn: null };

  function cfgCmdOf(tok) {
    var t = String(tok == null ? '' : tok).toLowerCase();
    if (CFG_TREE[t]) return CFG_TREE[t];
    var hit = null, n = 0;
    for (var k in CFG_TREE) {
      if (k.indexOf(t) === 0) { hit = CFG_TREE[k]; n++; }
    }
    if (n === 1) return hit;
    return n > 1 ? AMBIG : null;
  }

  function cfgMissingName(root, path) {
    var cur = root;
    for (var i = 0; i < path.length; i++) {
      var c = null;
      for (var k = 0; k < cur.children.length; k++) {
        if (cur.children[k].name === path[i]) { c = cur.children[k]; break; }
      }
      if (!c) return path[i];
      cur = c;
    }
    return null;
  }

  var CFG_SINGLE_VAL = { description: 1, 'vlan-id': 1, 'next-hop': 1, 'l3-interface': 1, 'peer-as': 1, cost: 1, priority: 1, 'hold-time': 1, mtu: 1, 'host-name': 1, 'domain-name': 1, 'router-id': 1, type: 1, mode: 1, 'protocol-version': 1, 'connection-limit': 1, 'interface-mode': 1, 'port-mode': 1, level: 1 };

  function cfgSet(sess, rt, root, line, rest, abs) {
    if (!rest.length) return errCaret(sess, line, 1, 'error: incomplete command');
    if (rest.length >= 2) {
      var stmt = rest[rest.length - 2];
      if (CFG_SINGLE_VAL[stmt]) {
        var pPath = abs(rest.slice(0, -1));
        var tgt = db.nodeAt(root, pPath, false);
        if (tgt) {
          tgt.values = [rest[rest.length - 1]];
          return { lines: [] };
        }
      }
    }
    db.set(root, abs(rest));
    return { lines: [] };
  }

  function cfgDelete(sess, rt, root, line, rest, abs) {
    if (!rest.length) return errCaret(sess, line, 1, 'error: incomplete command');
    var path = abs(rest);
    var okd = db.del(root, path);
    if (!okd) {
      var missing = cfgMissingName(root, path);
      return { lines: ['warning: statement not found: ' + (missing || path[path.length - 1])] };
    }
    return { lines: [] };
  }

  function cfgInactive(sess, rt, root, line, rest, abs, on) {
    if (!rest.length) return errCaret(sess, line, 1, 'error: incomplete command');
    var path = abs(rest);
    var target = db.nodeAt(root, path, false);
    if (!target) {
      var missing = cfgMissingName(root, path);
      return { lines: ['warning: statement not found: ' + (missing || path[path.length - 1])] };
    }
    db.setInactive(root, path, !!on);
    return { lines: [] };
  }

  function cfgAnnotate(sess, rt, root, line, rest, abs) {
    if (rest.length < 2) return errCaret(sess, line, 1, 'error: incomplete command');
    var text = rest[rest.length - 1];
    var path = abs(rest.slice(0, -1));
    var target = db.nodeAt(root, path, false);
    if (!target) {
      return { lines: ['warning: statement not found: ' + path[path.length - 1]] };
    }
    db.annotate(root, path, text);
    return { lines: [] };
  }

  function cfgEditPath(sess, rt, root, line, rest, abs) {
    if (!rest.length) return errCaret(sess, line, 1, 'error: incomplete command');
    var path = abs(rest);
    var end = db.nodeAt(root, path, false);
    if (!end) {
      var missing = cfgMissingName(root, path);
      return { lines: ['warning: statement not found: ' + (missing || path[path.length - 1])] };
    }
    sess.editPath = path;
    return { lines: [] };
  }

  function cfgUp(sess, rest) {
    var n = parseInt(rest[0], 10);
    if (!n || n < 1) n = 1;
    var ep = sess.editPath || [];
    if (ep.length === 0) return { lines: ['error: already at the top level of the hierarchy'] };
    sess.editPath = ep.slice(0, Math.max(0, ep.length - n));
    return { lines: [] };
  }

  function cfgCopy(sess, rt, root, line, rest, abs) {
    var ti = -1;
    for (var i2 = 0; i2 < rest.length; i2++) {
      if (rest[i2].toLowerCase() === 'to') { ti = i2; break; }
    }
    if (ti <= 0 || ti === rest.length - 1) {
      return errCaret(sess, line, 1, 'error: invalid copy destination');
    }
    var src = abs(rest.slice(0, ti));
    if (ti !== rest.length - 2) {
      return errCaret(sess, line, ti + 2, 'error: invalid copy destination');
    }
    var dst = abs(rest.slice(ti + 1));
    var srcNode = db.nodeAt(root, src, false);
    if (!srcNode) return { lines: ['warning: statement not found: ' + src[src.length - 1]] };
    var dstParent = db.nodeAt(root, dst.slice(0, -1), true);
    var nm = dst[dst.length - 1];
    if (db.child(dstParent, nm)) return { lines: ['warning: statement exists: ' + nm] };
    var cp = db.clone(srcNode);
    cp.name = nm;
    dstParent.children.push(cp);
    return { lines: [] };
  }

  function cfgRename(sess, rt, root, line, rest, abs) {
    var ti = -1;
    for (var i2 = 0; i2 < rest.length; i2++) {
      if (rest[i2].toLowerCase() === 'to') { ti = i2; break; }
    }
    if (ti <= 0 || ti === rest.length - 1) {
      return errCaret(sess, line, 1, 'error: invalid rename destination');
    }
    if (ti !== rest.length - 2) {
      return errCaret(sess, line, ti + 2, 'error: invalid rename destination');
    }
    var src = abs(rest.slice(0, ti));
    var dst = abs(rest.slice(ti + 1));
    var srcNode = db.nodeAt(root, src, false);
    if (!srcNode) return { lines: ['warning: statement not found: ' + src[src.length - 1]] };
    var newNm = dst[dst.length - 1];
    var parent = db.nodeAt(root, src.slice(0, -1), false);
    if (!parent) return { lines: ['warning: statement not found: ' + src[src.length - 1]] };
    if (db.child(parent, newNm)) return { lines: ['warning: statement exists: ' + newNm] };
    srcNode.name = newNm;
    return { lines: [] };
  }

  function cfgStatus(sess) {
    var rt = sess.rt;
    var lv = (sess.editPath && sess.editPath.length) ? '[edit ' + sess.editPath.join(' ') + ']' : '[edit]';
    return [
      'Users currently editing candidate configuration:',
      (sess.user || 'root') + ' (pid 1563) on since ' + dateShort(rt.bootAt || now() - 900000) + ', idle 00:00:09',
      lv
    ];
  }

  function cfgCommit(sess, rest) {
    var rt = sess.rt;
    var flags = { quit: false, check: false, confirmedMins: 0, comment: null };
    for (var i = 0; i < rest.length; i++) {
      var t = String(rest[i]).toLowerCase();
      if ('and-quit'.indexOf(t) === 0 && t.length >= 4) flags.quit = true;
      else if (t === 'check' || 'check'.indexOf(t) === 0) flags.check = true;
      else if ('confirmed'.indexOf(t) === 0 && t.length >= 4) {
        var mm = parseInt(rest[i + 1], 10);
        if (mm) {
          flags.confirmedMins = mm;
          i++;
        } else {
          flags.confirmedMins = 10;
        }
      } else if ('comment'.indexOf(t) === 0 && t.length >= 2) {
        flags.comment = rest[i + 1] || null;
        i++;
      }
    }
    if (flags.check) return { lines: ['configuration check succeeds'] };

    var committedNew = db.clone(rt.candidate);
    rt.committed = committedNew;
    rt.config = committedNew;
    if (!rt.revisions) rt.revisions = [];
    rt.revisions.unshift(db.clone(committedNew));
    if (rt.revisions.length > 50) rt.revisions.length = 50;
    if (!rt.commitLog) rt.commitLog = [];
    rt.commitLog.unshift({ time: now(), by: sess.user || 'root', comment: flags.comment });
    rt.commitCount = (rt.commitCount || 0) + 1;
    if (rt.confirmed) rt.confirmed = null;

    var outl, newMode = null;
    if (flags.confirmedMins > 0) {
      rt.confirmed = { until: now() + flags.confirmedMins * 60000, mins: flags.confirmedMins };
      outl = ['commit confirmed will be rolled back in ' + flags.confirmedMins + ' minutes'];
    } else {
      outl = ['commit complete'];
    }
    if (flags.quit) {
      sess.mode = 'cli-op';
      newMode = 'cli-op';
    }
    if (newMode) return { lines: outl, msgType: 'mode', mode: 'cli-op' };
    return { lines: outl };
  }

  function cfgRollback(sess, rest) {
    var rt = sess.rt;
    var n = parseInt(rest[0], 10);
    if (isNaN(n)) n = 0;
    var revs = rt.revisions || [];
    if (n < 0 || n >= revs.length) {
      return { lines: ['error: rollback ' + n + ' exceeds available revision history'] };
    }
    if (rt.confirmed) rt.confirmed = null;
    rt.candidate = db.clone(revs[n]);
    return { lines: ['load complete'] };
  }

  var PIPE_KINDS = ['count', 'display', 'compare', 'match', 'except', 'last', 'first', 'no-more', 'resolution', 'trim'];

  function pipeKindOf(tok) {
    var t = String(tok == null ? '' : tok).toLowerCase();
    if (!t) return null;
    var hits = [];
    for (var i = 0; i < PIPE_KINDS.length; i++) {
      if (PIPE_KINDS[i].indexOf(t) === 0) hits.push(PIPE_KINDS[i]);
    }
    return hits.length === 1 ? hits[0] : null;
  }

  function hdrGroupMatches(group, ep) {
    if (!ep.length) return true;
    if (!group) return false;
    var parts = group.split(' ');
    if (parts.length < ep.length) return false;
    for (var i = 0; i < ep.length; i++) {
      if (parts[i] !== ep[i]) return false;
    }
    return true;
  }

  function compareAt(sess, base) {
    var rt = sess.rt;
    var isNew = (sess.mode === 'cli-cfg') ? rt.candidate : rt.committed;
    var out = db.compareTrees(base || rt.committed, isNew);
    var ep = sess.editPath || [];
    if (ep.length) {
      var keep = [], curHit = false;
      for (var i = 0; i < out.length; i++) {
        var L = out[i];
        if (L.charAt(0) === '[') {
          var inner = L.slice(5, -1).trim();
          curHit = hdrGroupMatches(inner, ep);
          if (curHit) keep.push(L);
          continue;
        }
        if (curHit) keep.push(L);
      }
      out = keep;
    }
    out.push('');
    return out;
  }

  function cfgShow(sess, parts, pipe) {
    var rt = sess.rt;
    var root = (sess.mode === 'cli-cfg') ? rt.candidate : rt.committed;
    pipe = pipe || [];
    parts = parts || [];
    var pk = pipe.length ? pipeKindOf(pipe[0]) : null;

    if (pk === 'compare') {
      var base = rt.committed;
      var pipeArgs = pipe.slice(1);
      for (var q = 0; q < pipeArgs.length; q++) {
        if ('rollback'.indexOf(String(pipeArgs[q]).toLowerCase()) === 0) {
          var rn = parseInt(pipeArgs[q + 1], 10);
          base = (rt.revisions && rt.revisions[rn]) ? rt.revisions[rn] : rt.committed;
          break;
        }
      }
      return { lines: compareAt(sess, base) };
    }
    if (pk === 'display' && pipe[1] && 'set'.indexOf(String(pipe[1]).toLowerCase()) === 0) {
      return { lines: displaySetLines(root) };
    }

    var absP = (sess.editPath || []).concat(parts);
    var nodeP = db.nodeAt(root, absP, false);
    var startPath = absP;
    if (!nodeP && parts.length) {
      nodeP = db.nodeAt(root, parts, false);
      startPath = parts;
    }
    if (!nodeP && parts.length) {
      return { lines: ['warning: statement not found: ' + parts[parts.length - 1]] };
    }
    var bl = db.braceRender(root, startPath, false);
    if (bl == null) bl = [];
    bl = applyPipes(bl, pipe);
    return { lines: bl };
  }

  function runCfg(sess, line) {
    var rt = sess.rt;
    var root = rt.candidate;
    var sp = splitPipe(tokenize(line));
    var toks = sp.main, pipe = sp.pipe;
    if (!toks.length) return { lines: [] };
    var c = cfgCmdOf(toks[0]);
    if (c === AMBIG) return errCaret(sess, line, 0, '% ambiguous command');
    if (!c) return errCaret(sess, line, 0, '^ unknown command: \x27' + toks[0] + '\x27');
    var rest = toks.slice(1);
    var ep = sess.editPath || [];
    var abs = function (tokens) { return ep.concat(tokens); };
    switch (c.w) {
      case 'set': return cfgSet(sess, rt, root, line, rest, abs);
      case 'delete': return cfgDelete(sess, rt, root, line, rest, abs);
      case 'activate': return cfgInactive(sess, rt, root, line, rest, abs, false);
      case 'deactivate': return cfgInactive(sess, rt, root, line, rest, abs, true);
      case 'annotate': return cfgAnnotate(sess, rt, root, line, rest, abs);
      case 'edit': return cfgEditPath(sess, rt, root, line, rest, abs);
      case 'top':
        sess.editPath = [];
        return { lines: [] };
      case 'up': return cfgUp(sess, rest);
      case 'show': return cfgShow(sess, rest, pipe);
      case 'commit': return cfgCommit(sess, rest);
      case 'rollback': return cfgRollback(sess, rest);
      case 'run': return runOp(sess, rest.join(' '));
      case 'status': return { lines: cfgStatus(sess) };
      case 'exit':
        sess.mode = 'cli-op';
        return { lines: [], msgType: 'mode', mode: 'cli-op' };
      case 'copy': return cfgCopy(sess, rt, root, line, rest, abs);
      case 'rename': return cfgRename(sess, rt, root, line, rest, abs);
      case 'insert':
        db.set(root, ep.concat(rest));
        return { lines: [] };
    }
    return { lines: [] };
  }

  function cfgStmtCandidates(sess, restTokens) {
    var root = sess.rt.candidate;
    var last = restTokens.length ? String(restTokens[restTokens.length - 1]) : null;
    var path = (sess.editPath || []).concat(restTokens.slice(0, Math.max(0, restTokens.length - (last ? 1 : 0))));
    var node = db.nodeAt(root, path, false);
    var seen = {}, out = [];
    function addList(nd) {
      if (!nd) return;
      for (var i = 0; i < nd.children.length; i++) {
        var nm = nd.children[i].name;
        if (!seen[nm]) { seen[nm] = 1; out.push([nm, '']); }
      }
    }
    addList(node);
    addList(root);
    out.sort(function (a, b) { return J.cmpTokens([a[0]], [b[0]]); });
    if (last) {
      out = out.filter(function (r) { return r[0].indexOf(String(last)) === 0; });
    }
    return out;
  }

  function candidateWords(sess, parts, trailing) {
    if (!sess) return { rows: [] };
    var mode = sess.mode;
    if (mode === 'login' || sess.pend) return { rows: [] };
    var words = (parts || []).map(String);

    if (mode === 'shell') {
      var sh = SHELL_LEAF.concat(['cat', 'cd', 'date', 'df', 'dir', 'exit', 'hostname', 'less', 'ls', 'more', 'ps', 'pwd', 'reboot', 'uname', 'uptime', 'whoami']);
      sh = sh.filter(function (x, idx) { return sh.indexOf(x) === idx; });
      sh.sort(J.cmpTokens);
      if (!trailing && words.length) {
        var pat = String(words[words.length - 1]).toLowerCase();
        sh = sh.filter(function (x) { return x.indexOf(pat) === 0; });
      }
      return { rows: sh.map(function (x) { return [x, '']; }) };
    }

    if (mode === 'cli-cfg') {
      if (!words.length) return { rows: candsAt(CFG_ROOT, sess) };
      var c = cfgCmdOf(words[0]);
      if (!c || c === AMBIG) {
        var rows0 = candsAt(CFG_ROOT, sess);
        var t0 = String(words[0]);
        return { rows: rows0.filter(function (r) { return r[0].indexOf(t0) === 0; }) };
      }
      if (words.length === 1 && !trailing) {
        return { rows: candsAt(CFG_ROOT, sess).filter(function (r) { return r[0].indexOf(words[0]) === 0; }) };
      }
      var rest2 = words.slice(1);
      var last = (!trailing && rest2.length) ? rest2[rest2.length - 1] : null;
      if (c.w === 'commit') {
        var rows = candsAt(CFG_TREE.commit, sess);
        if (last) rows = rows.filter(function (r) { return r[0].indexOf(last) === 0; });
        return { rows: rows };
      }
      if (c.w === 'run') {
        return candidateWords({ mode: 'cli-op', rt: sess.rt, world: sess.world, pend: null }, rest2, trailing);
      }
      if (c.w === 'show') {
        return { rows: cfgStmtCandidates(sess, trailing ? rest2 : rest2) };
      }
      // statement-path commands: set/delete/edit/activate/… complete hierarchy names
      return { rows: cfgStmtCandidates(sess, rest2) };
    }

    // cli-op
    var node = OP_ROOT;
    var check = (!trailing && words.length) ? words[words.length - 1] : null;
    var walk = words.length && !trailing ? words.slice(0, -1) : words;
    var hardFail = false;
    for (var wi = 0; wi < walk.length; wi++) {
      var r = resolveTok(walk[wi], node.sub);
      if (!r || r === AMBIG) { hardFail = true; break; }
      node = r;
    }
    if (hardFail) {
      var rowsFall = [];
      if (walk.length > 1) {
        var parent2 = OP_TREE;
        for (var pi = 0; pi < walk.length - 1; pi++) {
          var rp = resolveTok(walk[pi], parent2.sub);
          if (!rp || rp === AMBIG) break;
          parent2 = rp;
        }
        rowsFall = candsAt(parent2, sess);
      }
      return { rows: rowsFall };
    }
    var rowsO = candsAt(node, sess);
    if (node.dyn) {
      var dc = dynCandidates(node.dyn, sess);
      for (var dy = 0; dy < dc.length; dy++) rowsO.push([dc[dy], '']);
    }
    if (check) {
      rowsO = rowsO.filter(function (r) { return r[0].indexOf(check) === 0; });
    }
    return { rows: rowsO };
  }

  var PEND_PROMPTS = { ping: 'Host: ', traceroute: 'Host: ', ssh: 'Host: ', telnet: 'Host: ' };

  function pendFeed(sess, line) {
    var p = sess.pend;
    if (!p) return { lines: [] };
    var val = String(line == null ? '' : line).trim();
    if (p.step === 0) {
      if (!val) {
        sess.pend = null;
        return { lines: [] };
      }
      p.host = val;
      p.step = 1;
      return { lines: [], prompt: 'count: ' };
    }
    if (p.step === 1) {
      p.count = val ? (parseInt(val, 10) || 0) : 0;
      p.step = 2;
      return { lines: [], prompt: 'source: ' };
    }
    sess.pend = null;
    var src = val ? val : null;
    var out;
    if (p.kind === 'ping') {
      var pa = [p.host];
      if (p.count) pa = pa.concat(['count', String(p.count)]);
      if (src) pa = pa.concat(['source', src]);
      out = opPing(sess, pa, sess.world);
    } else if (p.kind === 'traceroute') {
      out = opTraceroute(sess, [p.host], sess.world);
    } else if (p.kind === 'ssh') {
      out = opSsh(sess, [src ? src + '@' + p.host : p.host], sess.world);
    } else {
      out = opTelnet(sess, [p.host], sess.world);
    }
    return out;
  }

  function feed(sess, line) {
    if (!sess) return { lines: [] };
    if (sess.pend) return pendFeed(sess, line);
    var rt = sess.rt || null;
    var notice = [];
    if (rt && rt.confirmed && now() >= rt.confirmed.until) {
      rt.candidate = db.clone(rt.committed);
      rt.config = rt.committed;
      rt.confirmed = null;
      notice = ['error: commit confirmed expired: configuration rolled back'];
    }
    if (sess.mode === 'login') {
      var u = String(line == null ? '' : line).trim();
      if (!u) return { lines: [] };
      sess.user = u;
      sess.mode = (u === 'root') ? 'shell' : 'cli-op';
      sess.cwd = (u === 'root') ? '/root' : '/var/home/user';
      if (rt) rt.lastUser = u;
      return { lines: notice.slice(), mode: sess.mode };
    }
    if (sess.mode === 'shell') {
      var outS = shellCmd(sess, line);
      return {
        lines: notice.concat(outS.lines || []),
        mode: outS.mode || null,
        reboot: !!outS.reboot
      };
    }
    if (sess.mode === 'cli-cfg') {
      if (rt && String(line || '').trim()) intLogPush(rt, String(line).trim());
      var outC = runCfg(sess, line);
      return {
        lines: notice.concat(outC.lines || []),
        mode: (outC.mode || null),
        reboot: !!outC.reboot
      };
    }
    // cli-op
    var out = runOp(sess, line);
    if (out && out.pend) {
      sess.pend = { kind: out.pend, step: 0, host: null, count: 0, src: null };
      return { lines: notice.slice(), prompt: PEND_PROMPTS[out.pend] };
    }
    if (rt && String(line || '').trim()) intLogPush(rt, String(line).trim());
    return {
      lines: notice.concat(out.lines || []),
      mode: (out.mode || null),
      reboot: !!out.reboot
    };
  }

  function bootLinesFor(rt) {
    if (!rt) rt = { key: 'R1', spec: null };
    return bootSeq(rt);
  }

  // ---------- exports ----------

  global.JJ = global.JJ || {};
  global.JJ.machine = {
    feed: feed,
    prompt: prompt,
    promptFor: function (sess) {
      if (sess && sess.pager && sess.pager.open) return '';
      return prompt(sess);
    },
    createSession: makeSess,
    createDeviceRuntime: ensureRt,
    ensureRuntime: ensureRt,
    buildWorldFromDevs: function (devs) {
      if (net && net.buildWorld) return net.buildWorld(devs || {});
      return { devices: devs || {}, deviceKeys: Object.keys(devs || {}), adjacencies: [], hosts: [] };
    },
    getWorld: getWorld,
    bootLinesFor: bootLinesFor,
    tokenize: tokenize,
    candidateWords: candidateWords,
    pendFeed: pendFeed,
    runOp: runOp,
    runCfg: runCfg,
    cfgShow: cfgShow,
    shellCmd: shellCmd,
    startShell: startShell,
    applyPipes: applyPipes,
    completionsBlock: completionsBlock,
    errCaret: errCaret
  };
})(typeof window !== 'undefined' ? window : globalThis);
