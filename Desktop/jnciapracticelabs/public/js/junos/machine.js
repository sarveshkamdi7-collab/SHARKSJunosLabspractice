(function (global) {
  'use strict';

  var J = global.JJ || {};
  var db = J.db;
  var lab = J.lab;
  var net = J.net;

  // ============================================================
  // JJ.machine - Junos CLI simulator runtime.
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
      syslog: seedSyslog(key),
      files: {},
      protectedPaths: []
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
    // keep chained filters: `| match x | count` must see ['match','x','count']
    var pipe = [];
    for (var k = i + 1; k < toks.length; k++) if (toks[k] !== '|') pipe.push(toks[k]);
    return { main: toks.slice(0, i), pipe: pipe };
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
  // Command trees - words carry one-line Junos help descriptions.
  // Built from [word, desc, subList?, dyn?] tuples.
  // ============================================================

  var SHOW_INT_SUB = [
    ['brief', 'Show brief output'],
    ['descriptions', 'Show interface descriptions'],
    ['detail', 'Show detailed output'],
    ['diagnostics', 'Interface diagnostic status'],
    ['extensive', 'Show extensive output'],
    ['irb', 'Show IRB interface information', [['terse', 'Show terse output'], ['brief', 'Show brief output'], ['detail', 'Show detailed output']]],
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
    ['hidden', 'Show hidden route entries', null, true],
    ['protocol', 'Show routes for a given protocol', null, true],
    ['summary', 'Show summary of route table'],
    ['table', 'Show routing tables', [['summary', 'Show route table summary'], ['detail', 'Show detailed route information']], true]
  ];
  var SHOW_SYSTEM_SUB = [
    ['alarms', 'Show current system alarms'],
    ['commit', 'Display committed system information'],
    ['information', 'Show system information'],
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
    ['bfd', 'Show Bidirectional Forwarding Detection', [['session', 'Show BFD session information', [['detail', 'Show detailed BFD session output']]]]],
    ['bgp', 'Show Border Gateway Protocol information', [['summary', 'Show BGP summary information'], ['neighbor', 'Show BGP peer information']]],
    ['chassis', 'Show chassis information', SHOW_CHASSIS_SUB],
    ['configuration', 'Show candidate/committed configuration', null, true],
    ['ethernet-switching', 'Show ethernet switching table', [['table', 'Show MAC learning table'], ['interfaces', 'Show switching interface information']]],
    ['firewall', 'Show firewall filter counters', [['filter', 'Show firewall counter and filter information', null, true], ['log', 'Show firewall log event information']]],
    ['interfaces', 'Display interface information', SHOW_INT_SUB, true],
    ['isis', 'Show IS-IS information', [['adjacency', 'Show IS-IS adjacency database'], ['database', 'Show IS-IS link-state database'], ['interface', 'Show IS-IS interface information'], ['route', 'Show IS-IS routing table'], ['statistics', 'Show IS-IS protocol statistics']]],
    ['lacp', 'Show Link Aggregation Control Protocol', [['interfaces', 'Show LACP member interfaces']]],
    ['ldp', 'Show Label Distribution Protocol', [['database', 'Show LDP label database'], ['neighbor', 'Show LDP neighbor information'], ['session', 'Show LDP session information']]],
    ['lldp', 'Display Link Layer Discovery Protocol', [['neighbors', 'Show LLDP neighbor information']]],
    ['log', 'Show contents of a log file', null, true],
    ['mpls', 'Show MPLS information', [['interface', 'Show MPLS interface information'], ['lsp', 'Show label-switched-path session information']]],
    ['ospf', 'Show Open Shortest Path First information', SHOW_OSPF_SUB],
    ['route', 'Show routing table (RIB)', SHOW_ROUTE_SUB, true],
    ['rsvp', 'Show Resource Reservation Protocol', [['interface', 'Show RSVP interface information'], ['session', 'Show RSVP session information']]],
    ['security', 'Show security (SRX) information', [
      ['flow', 'Show flow session information', [['session', 'Show flow sessions'], ['summary', 'Show flow session summary'], ['status', 'Show flow status']]],
      ['ike', 'Show IKE security associations', [['security-associations', 'Show IKE security associations']]],
      ['ipsec', 'Show IPsec security associations', [['security-associations', 'Show IPsec security associations']]],
      ['nat', 'Show network address translation', [
        ['destination', 'Show destination NAT', [['rule', 'Show destination NAT rules', [['all', 'Show all rules']]]]],
        ['source', 'Show source NAT', [['rule', 'Show source NAT rules', [['all', 'Show all rules']]], ['summary', 'Show source NAT summary']]],
        ['static', 'Show static NAT', [['rule', 'Show static NAT rules', [['all', 'Show all rules']]]]]
      ]],
      ['policies', 'Show security policies', [['detail', 'Show policy detail', null, true], ['hit-count', 'Show policy hit counts']]],
      ['zones', 'Show security zones']
    ]],
    ['spanning-tree', 'Show Rapid Spanning Tree Protocol information', [['bridge', 'Show STP bridge information'], ['interface', 'Show STP interface information']]],
    ['system', 'Show system information', SHOW_SYSTEM_SUB],
    ['vrrp', 'Show Virtual Router Redundancy Protocol', [['brief', 'Show VRRP summary']]],
    ['version', 'Show software version'],
    ['vlans', 'Show configured VLANs']
  ];

  var OP_TREE = buildTree(OP_TOP);
  OP_TREE.show.sub = buildTree(SHOW_LIST);
  var OP_ROOT = { w: null, d: '', sub: OP_TREE, dyn: null };

  var CFG_TOP = [
    ['activate', 'Remove the inactive marker from a statement'],
    ['annotate', 'Annotate a statement with a comment'],
    ['commit', 'Commit the configuration', [['and-quit', 'Commit and return to operational mode'], ['at', 'Schedule the commit'], ['check', 'Check the configuration for correctness'], ['comment', 'Comment to attach to the commit'], ['confirmed', 'Automatically roll back if not confirmed'], ['synchronize', 'Commit on both routing engines']]],
    ['copy', 'Copy a statement'],
    ['deactivate', 'Add the inactive marker to a statement'],
    ['delete', 'Delete a data element'],
    ['edit', 'Edit a sub-element'],
    ['exit', 'Exit from this level'],
    ['insert', 'Insert a new element'],
    ['load', 'Merge or replace data from an ASCII file'],
    ['protect', 'Protect a statement against changes'],
    ['quit', 'Exit from configuration mode'],
    ['rename', 'Rename a statement'],
    ['replace', 'Replace a text string or pattern'],
    ['rollback', 'Roll back to last committed configuration'],
    ['run', 'Run an operational-mode command'],
    ['set', 'Set a set of statements in the configuration'],
    ['show', 'Show a configuration'],
    ['status', 'Display users currently in configuration mode'],
    ['top', 'Return to top of the hierarchy'],
    ['unprotect', 'Unprotect a statement'],
    ['up', 'Move up in the hierarchy'],
    ['wildcard', 'Perform wildcard operations', [['delete', 'Delete matching statements (? is single, * is any)']]]
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
      var admin = ifc.adminUp ? 'up' : 'down';
      var link = ifc.linkUp ? 'up' : 'down';
      out.push(padR(name, 24) + padR(admin, 6) + padR(link, 5));
      var isLo = /^lo\d*$/.test(name);
      for (var u = 0; u < ifc.unilist.length; u++) {
        var un = ifc.unilist[u];
        var uname = name + '.' + un.num;
        var proto = un.family === 'inet' ? 'inet' :
          (un.family === 'ethernet-switching' ? 'eth-switch' : (un.family || ''));
        if (un.family === 'inet' && un.addrs && un.addrs.length) {
          for (var a = 0; a < un.addrs.length; a++) {
            var row = padR(uname, 24) + padR(admin, 6) + padR(link, 5) + padR('inet', 9) + un.addrs[a];
            if (isLo) row = padR(uname, 24) + padR(admin, 6) + padR(link, 5) + padR('inet', 9) + padR(un.addrs[a], 22) + '--> 0/0';
            out.push(row);
          }
        } else {
          out.push(padR(uname, 24) + padR(admin, 6) + padR(link, 5) + padR(proto, 9));
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
    if (mode === 'statistics' || mode === 'detail' || mode === 'extensive') {
      var seed = ds.key + ':' + ifc.name;
      var ib = detBig(seed + ':ib') * 137 + 4096;
      var ip = detBig(seed + ':ip') * 3 + 12;
      var ob = detBig(seed + ':ob') * 131 + 2048;
      var op = detBig(seed + ':op') * 3 + 8;
      var ibr = detBig(seed + ':ibr') * 8;
      var opr = detBig(seed + ':opr') * 8;
      out.push('  Traffic statistics:');
      out.push('   Input  bytes  :' + padL(String(ib), 22) + padL(String(ibr), 21) + ' bps');
      out.push('   Input  packets:' + padL(String(ip), 22) + padL(String(detBig(seed + ':ipp')), 21) + ' pps');
      out.push('   Output bytes  :' + padL(String(ob), 22) + padL(String(opr), 21) + ' bps');
      out.push('   Output packets:' + padL(String(op), 22) + padL(String(detBig(seed + ':opp')), 21) + ' pps');
      out.push('  Start time: ' + utc(now() - 900000));
      out.push('');
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
      if (r.proto === 'Local') { out.push('                      Local via ' + (r.via || r.local || r.dest.split('/')[0])); continue; }
      if (r.proto === 'Direct') { out.push('                    > via ' + (r.via || '')); continue; }
      if (r.to) out.push('                    > to ' + r.to + ' via ' + (r.via || ''));
      else out.push('                    > via ' + (r.via || '?'));
    }
    return out;
  }

  function showRouteSummary(ds) {
    var out = [];
    if (!ds) return out;
    if (ds.bgp && ds.bgp.groups && ds.bgp.groups.length) out.push('Autonomous system number: ' + (ds.bgp.localAs || '65000'));
    out.push('Router ID: ' + (ds.routerId || '1.1.1.1'));
    out.push('');
    var byProto = {}, dests = {};
    for (var i = 0; i < ds.routes.length; i++) {
      byProto[ds.routes[i].proto] = (byProto[ds.routes[i].proto] || 0) + 1;
      dests[ds.routes[i].dest] = 1;
    }
    var dcount = Object.keys(dests).length;
    out.push('inet.0: ' + dcount + ' destinations, ' + ds.routes.length + ' routes (' + ds.routes.length + ' active, 0 holddown, 0 hidden)');
    var order = ['Direct', 'Local', 'Static', 'OSPF', 'BGP'];
    for (var o = 0; o < order.length; o++) {
      var proto = order[o];
      if (byProto[proto]) out.push(padL(proto + ':', 21) + padL(String(byProto[proto]), 7) + ' routes,' + padL(String(byProto[proto]), 7) + ' active');
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
    out.push('MAC Address       Address         Name                      Interface           Flags');
    var n = 0;
    if (ds && ds.arp) {
      for (var i = 0; i < ds.arp.length; i++) {
        var a = ds.arp[i];
        out.push(padR(a.mac, 18) + padR(a.ip, 16) + padR(a.ip, 26) + padR(a.iface, 20) + ' none');
        n++;
      }
    }
    out.push('Total entries: ' + n);
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

  // ============================================================
  // PART 3B - BFD / IS-IS / LDP / MPLS / LACP / VRRP / firewall /
  //           SRX security. All parse the device's committed config
  //           through the same db tree helpers (tGo/tKid/tKids).
  // ============================================================

  function tGo(root, path) {
    var n = root;
    for (var i = 0; n && i < path.length; i++) n = db.child(n, path[i]);
    return n;
  }
  function tKid(node, name) { return node ? db.child(node, name) : null; }
  function tKids(node, name) {
    var out = [];
    if (!node) return out;
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (name && c.name !== name) continue;
      if (c.name === '[' || c.name === ']') continue;
      if (c.inactive) continue;
      out.push(c);
    }
    return out;
  }
  function tVal(n) {
    if (!n) return null;
    return n.values.length ? n.values[0] : (n.children.length ? n.children[0].name : null);
  }
  function firstUnder(node, name) { return tVal(tKid(node, name)); }
  // deep find: value tokens typed after a value capture nest arbitrarily deeply
  // (e.g. minimum-interval 300 multiplier 5 puts multiplier under the 300 node)
  function deepFind(node, name) {
    if (!node) return null;
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (c.name === name) return c;
      var d = deepFind(c, name);
      if (d) return d;
    }
    return null;
  }
  function deepVal(node, name) { return tVal(tKid(node, name) || deepFind(node, name)); }
  function valuesUnder(node, name) { var c = tKid(node, name); return c ? c.values.slice() : []; }
  function namesOf(node) {
    if (!node) return [];
    var out = [];
    for (var i = 0; i < node.children.length; i++) {
      var nm = node.children[i].name;
      if (nm !== '[' && nm !== ']' && !node.children[i].inactive) out.push(nm);
    }
    return out;
  }
  function pad2(x) { return z2(x < 10 ? x : x % 100).slice(-2); }
  function hex4(x) { return ('0000' + (x & 0xffff).toString(16)).slice(-4); }
  // IDENT-parent containers e.g. `set firewall family inet filter F1` yields
  // family { inet { filter { F1 { ... } } } } - this helper plucks the value
  // nodes (the actual named items) hanging under every container of `name`.
  function groupValueNodes(parent, name) {
    var out = [];
    var containers = tKids(parent, name);
    for (var i = 0; i < containers.length; i++) {
      for (var k = 0; k < containers[i].children.length; k++) {
        var c = containers[i].children[k];
        if (c.name === '[' || c.name === ']' || c.inactive) continue;
        out.push(c);
      }
    }
    return out;
  }
  function committedRoot(rt) { return rt.committed || rt.config; }

  // ---------- interface descriptions (operational view) ----------

  function showIntDescriptions(ds, rt) {
    var out = ['Interface       Admin Link Description'];
    var root = committedRoot(rt);
    var ifRoot = tGo(root, ['interfaces']);
    if (!ifRoot) return out;
    var ifaces = tKids(ifRoot);
    for (var i = 0; i < ifaces.length; i++) {
      var ifn = ifaces[i];
      var desc = tVal(tKid(ifn, 'description'));
      if (!desc) {
        var uvals = groupValueNodes(ifn, 'unit');
        for (var u = 0; u < uvals.length && !desc; u++) desc = tVal(tKid(uvals[u], 'description'));
      }
      if (!desc) {
        var dnode = deepFind(ifn, 'description');
        desc = dnode ? tVal(dnode) : null;
      }
      if (!desc) continue;
      var auf = '--', lnk = '--';
      if (ds && ds.interfaces[ifn.name]) {
        auf = ds.interfaces[ifn.name].adminUp ? 'up' : 'down';
        lnk = ds.interfaces[ifn.name].linkUp ? 'up' : 'down';
      }
      out.push(padR(ifn.name, 16) + padR(auf, 6) + padR(lnk, 6) + desc);
    }
    return out;
  }

  // ---------- system alarms / information ----------

  function showSystemAlarms(rt) {
    var root = committedRoot(rt);
    if (!tGo(root, ['system', 'root-authentication'])) {
      return [
        '1 alarms currently active',
        'Alarm time               Class  Description',
        utc(rt.bootAt) + '  Minor  Root password is still not configured'
      ];
    }
    return ['No alarms currently active'];
  }

  function showSystemInformation(rt) {
    var root = committedRoot(rt);
    var host = firstUnder(tGo(root, ['system']), 'host-name') || rt.key;
    return [
      'Model: ' + ((rt.spec && rt.spec.model) || 'vSRX 3.0'),
      'Family: junos',
      'Junos: ' + ((rt.spec && rt.spec.version) || '20.4R2-S2.1'),
      'Hostname: ' + host
    ];
  }

  // ---------- BFD ----------

  function bfdSessions(ds, rt) {
    var out = [];
    var root = committedRoot(rt);
    function minMs(bfdNode) {
      var mv = deepVal(bfdNode, 'minimum-interval');
      return parseInt(mv, 10) || 300;
    }
    function multOf(bfdNode) {
      var mv = deepVal(bfdNode, 'multiplier');
      return parseInt(mv, 10) || 3;
    }
    function nbrState(ds, ifaceBase, peer) {
      if (ds && ds.ospfNeighbors) {
        for (var i = 0; i < ds.ospfNeighbors.length; i++) {
          var n = ds.ospfNeighbors[i];
          if (peer) { if (n.ip === peer) return { addr: n.ip, iface: n.iface, up: String(n.state || '').toLowerCase() === 'full' }; }
          if (ifaceBase && String(n.iface || '').split('.')[0] === ifaceBase) {
            return { addr: n.ip, iface: n.iface, up: String(n.state || '').toLowerCase() === 'full' };
          }
        }
      }
      return null;
    }
    function ifaceFor(ds, ip) {
      if (ds && ds.subnets) {
        for (var i = 0; i < ds.subnets.length; i++) {
          if (J.inNet(ip, ds.subnets[i].cidr)) return ds.subnets[i].iface;
        }
      }
      return '-';
    }
    function bgPeerUp(ds, ip) {
      if (ds && ds.bgp && ds.bgp.peers) {
        for (var i = 0; i < ds.bgp.peers.length; i++) {
          if (ds.bgp.peers[i].ip === ip) {
            var s = String(ds.bgp.peers[i].state || 'Establ');
            return s.indexOf('Idle') < 0 && s.indexOf('Active') < 0 ? 'Up' : 'Down';
          }
        }
      }
      return 'Up';
    }
    var po = tGo(root, ['protocols', 'ospf']);
    if (po) {
      var areas = groupValueNodes(po, 'area');
      for (var a = 0; a < areas.length; a++) {
        var ifVals = groupValueNodes(areas[a], 'interface');
        for (var k = 0; k < ifVals.length; k++) {
          var bfd = tKid(ifVals[k], 'bfd-liveness-detection');
          if (!bfd) continue;
          var ifName = ifVals[k].name;
          var hit = nbrState(ds, ifName.split('.')[0], null);
          out.push({
            addr: hit ? hit.addr : '0.0.0.0',
            iface: ifName + (String(ifName).indexOf('.') < 0 ? '.0' : ''),
            state: !hit || hit.up ? 'Up' : 'Down',
            client: 'OSPF', min: minMs(bfd), mult: multOf(bfd)
          });
        }
      }
    }
    var st = tGo(root, ['routing-options', 'static']);
    var routes = st ? tKid(st, 'route') : null;
    if (routes) {
      var rns = tKids(routes);
      for (var r2 = 0; r2 < rns.length; r2++) {
        var bfd2 = tKid(rns[r2], 'bfd-liveness-detection');
        if (!bfd2) {
          var nhNode2 = tKid(rns[r2], 'next-hop');
          bfd2 = nhNode2 ? deepFind(nhNode2, 'bfd-liveness-detection') : null;
        }
        if (!bfd2) continue;
        var nh2 = firstUnder(rns[r2], 'next-hop');
        if (!nh2) continue;
        var up2 = false, if2 = '-';
        if (ds && ds.routes) {
          for (var q2 = 0; q2 < ds.routes.length; q2++) {
            var rr2 = ds.routes[q2];
            if ((rr2.proto === 'Direct' || rr2.proto === 'Local') && J.inNet(nh2, rr2.dest)) { up2 = true; break; }
          }
        }
        if (ds && ds.subnets) {
          for (var sn2 = 0; sn2 < ds.subnets.length; sn2++) {
            if (J.inNet(nh2, ds.subnets[sn2].cidr)) { if2 = ds.subnets[sn2].iface; break; }
          }
        }
        out.push({ addr: nh2, iface: if2, state: up2 ? 'Up' : 'Down', client: 'Static', min: minMs(bfd2), mult: multOf(bfd2) });
      }
    }
    var bg = tGo(root, ['protocols', 'bgp']);
    if (bg) {
      var grps = groupValueNodes(bg, 'group');
      for (var g2 = 0; g2 < grps.length; g2++) {
        var bfd3 = tKid(grps[g2], 'bfd-liveness-detection');
        if (!bfd3) continue;
        var nbrs = [];
        var nbC = tKids(grps[g2], 'neighbor');
        for (var nb = 0; nb < nbC.length; nb++) {
          namesOf(nbC[nb]).forEach(function (nip) { nbrs.push(nip); });
        }
        for (var s2 = 0; s2 < nbrs.length; s2++) {
          var ip2 = nbrs[s2];
          var hit2 = nbrState(ds, null, ip2);
          out.push({
            addr: ip2,
            iface: hit2 && hit2.iface ? hit2.iface : ifaceFor(ds, ip2),
            state: bgPeerUp(ds, ip2),
            client: 'BGP', min: minMs(bfd3), mult: multOf(bfd3)
          });
        }
      }
    }
    return out;
  }

  function showBfdSession(ds, rt, wantDetail) {
    var ss = bfdSessions(ds, rt);
    if (!ss.length) return [];
    var out = [];
    if (wantDetail) {
      for (var i = 0; i < ss.length; i++) {
        var s = ss[i];
        var seed = detBig(rt.key + ':bfd:' + s.addr);
        out.push('Address ' + s.addr + ', State ' + s.state + ', Interface ' + s.iface);
        out.push('  Client: ' + s.client + ', Examined: 0, Sessions: 1');
        out.push('  Local discr ' + (1000 + seed % 800) + ', Remote discr ' + (1000 + detBig(s.addr + ':r') % 800) + ', Min interval ' + s.min + 'ms, Multiplier ' + s.mult);
        out.push('  Min Tx interval ' + s.min + 'ms, Min Rx interval ' + s.min + 'ms');
        out.push('');
      }
      return out;
    }
    out.push('                                               Detect   Transmit');
    out.push('Address          State     Interface      Interval     Interval   Multiplier');
    for (var j = 0; j < ss.length; j++) {
      var r = ss[j];
      out.push(padR(r.addr, 17) + padR(r.state, 10) + padR(r.iface, 15) + padL(String(r.min), 9) + padL(String(r.min), 11) + padL(String(r.mult), 12));
    }
    return out;
  }

  // ---------- firewall filters / policers ----------

  function firewallFilters(rt) {
    var root = committedRoot(rt);
    var famF = tGo(root, ['firewall', 'family']);
    var filters = [];
    if (!famF) return filters;
    var inetNodes = tKids(famF, 'inet');
    for (var v = 0; v < inetNodes.length; v++) {
      var fConts = tKids(inetNodes[v], 'filter');
      for (var fc = 0; fc < fConts.length; fc++) {
        var termVals = groupValueNodes(fConts[fc], 'term');
        var terms = [];
        for (var t = 0; t < termVals.length; t++) {
          var thenN = tKid(termVals[t], 'then');
          var countConts = tKids(thenN, 'count');
          var counted = false;
          for (var cn = 0; cn < countConts.length; cn++) {
            var kids = countConts[cn].children;
            for (var ck = 0; ck < kids.length; ck++) {
              if (kids[ck].name === '[' || kids[ck].name === ']' || kids[ck].inactive) continue;
              terms.push(kids[ck].name);
              counted = true;
            }
          }
          if (!counted) {
            // terms without an explicit counter still get shown under the term name
            var has = false;
            for (var d = 0; d < terms.length; d++) if (terms[d] === termVals[t].name) has = true;
            if (!has) terms.push(termVals[t].name);
          }
        }
        var names = namesOf(fConts[fc]);
        for (var xn = 0; xn < names.length; xn++) filters.push({ name: names[xn], counters: terms });
      }
    }
    return filters;
  }

  function showFirewall(rt, filterName) {
    var filters = firewallFilters(rt);
    if (!filters.length) return [];
    var out = [];
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i];
      if (filterName && f.name !== filterName.toLowerCase()) continue;
      if (!f.counters.length) continue;
      out.push('Filter: ' + f.name);
      out.push('Counters:');
      out.push('Name                                                Bytes              Packets');
      var used = {};
      for (var c = 0; c < f.counters.length; c++) {
        var cn = f.counters[c];
        if (used[cn]) continue;
        used[cn] = 1;
        var seed = detBig(rt.key + ':fw:' + f.name + ':' + cn);
        out.push(padR(cn, 52) + padL(String(detBig(cn + ':b') % 90000), 9) + padL(String(seed % 900), 12));
      }
      out.push('');
    }
    if (out.length && out[out.length - 1] === '') out.length--;
    return out;
  }

  function showFirewallLog(rt) {
    var seed = detBig(rt.key + ':fwlog');
    var out = [
      'Oct 30 ' + z2(10 + seed % 3) + ':' + z2(seed % 60) + ':' + z2((seed >> 3) % 60) + ' ' + rt.key + ' RT_FLOW: RT_FLOW_SESSION_DENY: session denied 192.168.10.' + (2 + seed % 60) + '/42' + (seed % 5) + '->203.0.113.2/80 tcp 6 ge-0/0/1.0 192.168.10.1/1 default-policy(3) 0'
    ];
    return out;
  }

  function showPolicer(rt) {
    var root = committedRoot(rt);
    var po = tGo(root, ['firewall']);
    var pConts = po ? tKids(po, 'policer') : [];
    if (!pConts.length) return [];
    var out = [];
    for (var i = 0; i < pConts.length; i++) {
      var names = namesOf(pConts[i]);
      for (var k = 0; k < names.length; k++) {
        var seed = detBig(rt.key + ':pl:' + names[k]);
        out.push(names[k] + ':');
        out.push('  Bandwidth limit: ' + (1 + seed % 9) + 'm');
        out.push('  Burst size limit: ' + (10 + seed % 20) + 'k');
        out.push('  Packets: ' + (seed % 5000));
        out.push('');
      }
    }
    if (out.length && out[out.length - 1] === '') out.length--;
    return out;
  }

  // ---------- IS-IS ----------

  function isisCfg(ds, rt) { return tGo(committedRoot(rt), ['protocols', 'isis']); }

  function isisPeers(ds) {
    var out = [];
    if (ds && ds.lldp) {
      for (var i = 0; i < ds.lldp.length; i++) out.push(ds.lldp[i]);
    }
    return out;
  }

  function isisSysId(name) {
    var seed = detBig(name + ':isis');
    return pad2(seed % 100) + '.' + z2((seed >> 3) % 10) + pad2((seed >> 5) % 100) + '.' + z2((seed >> 8) % 10) + pad2((seed >> 11) % 100) + '.00';
  }

  function showIsisAdjacency(ds, rt) {
    var out = [];
    out.push('Interface             System         L State        Hold (secs) SNPA');
    if (!isisCfg(ds, rt)) return out;
    var peers = isisPeers(ds);
    for (var i = 0; i < peers.length; i++) {
      var p = peers[i];
      var seed = detBig(p.peer + ':isis:hold');
      var level = 2;
      out.push(padR(p.localIf || 'ge-0/0/0' + '.' + (0), 22) + padR(p.peer || '-', 15) + padL(String(level), 2) + padR('', 1) + padR('Up', 13) + padL(String(18 + seed % 12), 9));
    }
    return out;
  }

  function showIsisDatabase(ds, rt) {
    var out = [];
    if (!isisCfg(ds, rt)) return out;
    out.push('IS-IS level 2 link-state database:');
    out.push('LSP ID                      Sequence Checksum Lifetime Attributes');
    var self = detBig(rt.key + ':isis:seq');
    out.push(padR(rt.key + '.00-00', 28) + padR('0x' + (1 + self % 9), 9) + padR('0x' + hex4(self), 7) + padL('1043', 9) + padR(' L1 L2', 7));
    var peers = isisPeers(ds);
    for (var i = 0; i < peers.length; i++) {
      var ps = detBig(peers[i].peer + ':isis:seq');
      out.push(padR((peers[i].peer || 'peer') + '.00-00', 28) + padR('0x' + (1 + ps % 9), 9) + padR('0x' + hex4(ps), 7) + padL('1042', 9) + padR(' L1 L2', 7));
    }
    out.push('  ' + (peers.length + 1) + ' LSPs');
    return out;
  }

  function showIsisInterface(ds, rt) {
    var out = [];
    out.push('Interface           State         System ID       L Level  ES HELLO SID');
    var ics = isisCfg(ds, rt);
    if (!ics) return out;
    var ifVals = groupValueNodes(ics, 'interface');
    if (!ifVals.length) {
      // bare `set protocols isis interface ge-0/0/0` - value nodes may sit directly under isis
      var direct = namesOf(ics);
      for (var d = 0; d < direct.length; d++) if (/^(ge|et|xe|ae|lo)-/.test(direct[d])) ifVals.push({ name: direct[d] });
    }
    for (var i = 0; i < ifVals.length; i++) {
      var lv = firstUnder(ifVals[i], 'level') || '2';
      var seed = detBig(ifVals[i].name + ':isisif');
      out.push(padR(ifVals[i].name, 20) + padR('Up', 14) + padR(isisSysId(rt.key), 16) + padL('2', 2) + padR(lv, 9) + padL(String(seed % 9000), 6));
    }
    return out;
  }

  function showIsisRoute(ds, rt) {
    var out = [];
    if (!isisCfg(ds, rt)) return out;
    out.push('IS-IS level 2 routing table:');
    out.push('Prefix             Path Type  Route Type    NH-Type        Metric   Interface');
    var peers = isisPeers(ds);
    for (var i = 0; i < peers.length; i++) {
      out.push(padR((peers[i].peer || '0.0.0.0') + '/32', 19) + padR('2 Intra', 8) + padR('Network', 10) + padR('IP', 10) + padL(String(10), 7) + padR('  ' + (peers[i].localIf || 'ge-0/0/0.0'), 16));
    }
    return out;
  }

  function showIsisStats(ds, rt) {
    var seed = detBig(rt.key + ':isisstats');
    return [
      'IS-IS statistics for ' + rt.key + ':',
      'PduConstructor:                 ' + (350 + seed % 400),
      'LspBuilder:                     ' + (20 + seed % 40),
      'LspRefresh:                     ' + (5 + seed % 20),
      'DrHellosSent:                   ' + (60 + seed % 100)
    ];
  }

  // ---------- LDP / MPLS / RSVP ----------

  function showLdpNeighbor(ds, rt) {
    var out = [];
    out.push('Address            Interface          Label space ID         Hold time');
    if (!tGo(committedRoot(rt), ['protocols', 'ldp'])) return out;
    var peers = isisPeers(ds);
    for (var i = 0; i < peers.length; i++) {
      var p = peers[i];
      var seed = detBig(p.peer + ':ldp:hold');
      var addr = '0.0.0.0';
      if (ds && ds.ospfNeighbors) {
        var base = String(p.localIf || '').split('.')[0];
        for (var q = 0; q < ds.ospfNeighbors.length; q++) {
          if (String(ds.ospfNeighbors[q].iface || '').split('.')[0] === base) addr = ds.ospfNeighbors[q].ip;
        }
      }
      out.push(padR(addr, 19) + padR(p.localIf || 'ge-0/0/0.0', 19) + padR((p.peer || '0.0.0.0') + ':0', 23) + padL(String(10 + seed % 260), 5));
    }
    return out;
  }

  function showLdpSession(ds, rt) {
    var out = [];
    out.push('Address           State        Connection     Hold time  Adv. Mode');
    if (!tGo(committedRoot(rt), ['protocols', 'ldp'])) return out;
    var peers = isisPeers(ds);
    for (var i = 0; i < peers.length; i++) {
      var seed = detBig(peers[i].peer + ':ldp:session');
      out.push(padR(detBigSeedIp(rt.key, peers[i].peer), 18) + padR('Operational', 13) + padR('Open', 15) + padL(String(10 + seed % 260), 7) + padR('    DU', 6));
    }
    return out;
  }

  function detBigSeedIp(a, b) {
    var s = detBig(a + ':ldpip:' + b);
    return '10.' + (0 + s % 254) + '.' + ((s >> 4) % 254) + '.' + ((s >> 8) % 254);
  }

  function showLdpDatabase(ds, rt) {
    var out = [];
    if (!tGo(committedRoot(rt), ['protocols', 'ldp'])) return out;
    out.push('Input label database, ' + rt.key + ':');
    var base = detBig(rt.key + ':ldp:lbl');
    out.push(padL(String(300000 + base % 900), 8) + '  ' + rt.key + '/32');
    out.push('Output label database, ' + rt.key + ':');
    var peers = isisPeers(ds);
    for (var i = 0; i < peers.length; i++) {
      out.push(padL(String(300000 + detBig(peers[i].peer + ':ldp:lbl') % 900), 8) + '  ' + (peers[i].peer || 'peer') + '/32');
    }
    return out;
  }

  function mplsLspList(rt) {
    var root = committedRoot(rt);
    var mpls = tGo(root, ['protocols', 'mpls']);
    var lsps = [];
    var lspNodes = mpls ? groupValueNodes(mpls, 'label-switched-path') : [];
    for (var i = 0; i < lspNodes.length; i++) {
      var to = firstUnder(lspNodes[i], 'to');
      lsps.push({ name: lspNodes[i].name, to: to });
    }
    return lsps;
  }

  function lo0SelfIp(rt) {
    var lo = tGo(committedRoot(rt), ['interfaces', 'lo0']);
    if (!lo) return null;
    var uvals = groupValueNodes(lo, 'unit');
    for (var i = 0; i < uvals.length; i++) {
      var fam = tKid(uvals[i], 'family');
      var inetNodes = fam ? tKids(fam, 'inet') : [];
      for (var v = 0; v < inetNodes.length; v++) {
        var avals = groupValueNodes(inetNodes[v], 'address');
        for (var a = 0; a < avals.length; a++) {
          var nm = avals[a].name;
          if (nm && nm.split('/')[0]) return nm.split('/')[0];
        }
      }
    }
    return null;
  }

  function showMplsLsp(rt, kind) {
    var lsps = mplsLspList(rt);
    if (!lsps.length) return [];
    var out = [];
    out.push('Ingress LSP: ' + lsps.length + ' sessions');
    out.push('To              From            State Rt P     ActivePath       LSPname');
    var selfIp = lo0SelfIp(rt) || detBigSeedIp(rt.key, 'self');
    for (var i = 0; i < lsps.length; i++) {
      out.push(padR(lsps[i].to || '0.0.0.0', 16) + padR(selfIp, 16) + padR('Up', 7) + padL('0', 2) + padR('*', 3) + padR('', 12) + lsps[i].name.replace(/ /g, '-'));
    }
    out.push('Total ' + lsps.length + ' displayed, ' + lsps.length + ' Up, ' + lsps.length + ' Egress, ' + lsps.length + ' Ingress');
    return out;
  }

  function showMplsInterface(rt) {
    var out = [];
    var mpls = tGo(committedRoot(rt), ['protocols', 'mpls']);
    var ifVals = mpls ? groupValueNodes(mpls, 'interface') : [];
    if (!ifVals.length) return out;
    out.push('MPLS interface                    State');
    for (var i = 0; i < ifVals.length; i++) {
      out.push(padR(ifVals[i].name, 34) + padR('Up', 8));
    }
    return out;
  }

  function showRsvpInterface(rt) {
    var rsvp = tGo(committedRoot(rt), ['protocols', 'rsvp']);
    var ifVals = rsvp ? groupValueNodes(rsvp, 'interface') : [];
    var out = [];
    out.push('RSVP interface: ' + ifVals.length + ' activated interfaces');
    for (var i = 0; i < ifVals.length; i++) {
      var seed = detBig(ifVals[i].name + ':rsvpif');
      out.push('RSVP interface: ' + ifVals[i].name + ' (Active Reservations: ' + (seed % 3) + ', Bandwidth: 1bps)');
    }
    return out;
  }

  // ---------- LACP / VRRP ----------

  function showLacp(rt) {
    var root = committedRoot(rt);
    var ifRoot = tGo(root, ['interfaces']);
    if (!ifRoot) return [];
    var aegroups = {};
    var ifaces = tKids(ifRoot);
    for (var i = 0; i < ifaces.length; i++) {
      var ge = tKid(ifaces[i], 'gigether-options');
      var a802 = ge ? tKids(ge, '802.3ad') : [];
      if (!a802.length) continue;
      var aeName = a802[0].children.length ? a802[0].children[0].name : (a802[0].values[0] || 'ae0');
      (aegroups[aeName] = aegroups[aeName] || []).push(ifaces[i].name);
    }
    if (!Object.keys(aegroups).length) return [];
    var out = [];
    var aeNames = Object.keys(aegroups).sort();
    for (var g = 0; g < aeNames.length; g++) {
      var members = aegroups[aeNames[g]].sort();
      out.push('Aggregated interface: ' + aeNames[g]);
      out.push('    LACP state:       Role   Exp   Def  Dist  Col  Syn  Aggr  Timeout  Activity');
      for (var m = 0; m < members.length; m++) {
        out.push('      ' + padR(members[m], 12) + 'Actor    No    No   Yes  Yes  Yes   Yes     Fast    Active');
        out.push('      ' + padR(members[m], 12) + 'Partner  No    No   Yes  Yes  Yes   Yes     Fast    Active');
      }
      out.push('    LACP protocol:        Receive State  Transmit State          Mux State');
      for (var m2 = 0; m2 < members.length; m2++) {
        out.push('      ' + padR(members[m2], 12) + 'Current   Fast periodic Collecting distributing');
      }
    }
    return out;
  }

  function processVrrpIfaces(out, rt) {
    var root = committedRoot(rt);
    var ifRoot = tGo(root, ['interfaces']);
    if (!ifRoot) return;
    var ifaces = tKids(ifRoot);
    for (var i = 0; i < ifaces.length; i++) {
      var ifn = ifaces[i];
      var uvals = groupValueNodes(ifn, 'unit');
      for (var u = 0; u < uvals.length; u++) {
        var famC = tKid(uvals[u], 'family');
        var inetNodes = famC ? tKids(famC, 'inet') : [];
        for (var iv = 0; iv < inetNodes.length; iv++) {
          var avals = groupValueNodes(inetNodes[iv], 'address');
          for (var a = 0; a < avals.length; a++) {
            var groups = groupValueNodes(avals[a], 'vrrp-group');
            for (var v = 0; v < groups.length; v++) {
              var gid = groups[v].name;
              var pri = parseInt(firstUnder(groups[v], 'priority'), 10) || 100;
              var vaddrs = namesOf(tKid(groups[v], 'virtual-address'));
              var vIp = vaddrs.length ? vaddrs[0] : (vinetOf(avals[a]) || '0.0.0.0');
              var role = pri >= 100 ? 'master' : 'backup';
              var mac = '00:00:5e:00:01:' + z2(parseInt(gid, 10) % 256);
              var mseed = detBig(ifn.name + ':vrrp:' + gid);
              var st = mseed % 3 === 0 ? 'up' : (role === 'master' ? 'master' : 'backup');
              out.push(padR(ifn.name + '.' + uvals[u].name, 14) + padR(st, 12) + padR(gid, 8) + padR(gid, 6) + padR('active', 9) + padR(vIp, 15) + padR(mac, 16) + padR(role === 'master' ? rt.key : 'n/a', 8));
            }
          }
        }
      }
    }
  }

  function showVrrp(rt) {
    var out = [];
    out.push('Interface     State       Group   VRID  Mode     Virtual IP     Virtual MAC     Master of');
    processVrrpIfaces(out, rt);
    return out.length > 1 ? out : [];
  }

  function vinetOf(addrNode) {
    var nm = addrNode.name;
    return nm && nm.indexOf('/') > 0 ? nm.split('/')[0] : nm;
  }

  // ---------- SRX security ----------

  function secZones(rt) {
    var root = committedRoot(rt);
    var zRoot = tGo(root, ['security', 'zones']);
    var zones = [];
    if (!zRoot) return zones;
    var zvals = groupValueNodes(zRoot, 'security-zone');
    for (var i = 0; i < zvals.length; i++) {
      var z = zvals[i];
      var zone = { name: z.name, ifaces: [], services: [], protocols: [], screens: [] };
      zone.ifaces = namesOf(tKid(z, 'interfaces'));
      var hb = tKid(z, 'host-inbound-traffic');
      zone.services = namesOf(tKid(hb, 'system-services'));
      zone.protocols = namesOf(tKid(hb, 'protocols'));
      zone.screens = namesOf(tKid(z, 'screen'));
      zones.push(zone);
    }
    return zones;
  }

  // policies tree: security { policies { from-zone { TRUST { to-zone { UNTRUST {
  //   policy { WEB-ACCESS { match {...} then {...} } } } } } } } }
  function secPolicies(rt) {
    var out = { default: 'deny-all', rules: [] };
    var pRoot = tGo(committedRoot(rt), ['security', 'policies']);
    if (!pRoot) return out;
    var dpc = tKids(pRoot, 'default-policy');
    if (dpc.length && dpc[0].children.length) out.default = dpc[0].children[0].name;
    function hasLogUnder(n) {
      if (!n) return false;
      for (var i = 0; i < n.children.length; i++) {
        var c = n.children[i];
        if (c.name === 'log') return true;
        if (hasLogUnder(c)) return true;
      }
      return false;
    }
    function pushPolicy(from, to, pn, out) {
      var match = tKid(pn, 'match');
      var thenN = tKid(pn, 'then');
      var thenNames = namesOf(thenN);
      var action = 'deny';
      for (var an = 0; an < thenNames.length; an++) {
        if (thenNames[an].indexOf('permit') === 0) { action = 'permit'; break; }
        if (thenNames[an].indexOf('deny') === 0 || thenNames[an].indexOf('reject') === 0) { action = 'deny'; break; }
      }
      out.rules.push({
        from: from, to: to, name: pn.name,
        src: namesOf(tKid(match, 'source-address')),
        dst: namesOf(tKid(match, 'destination-address')),
        app: namesOf(tKid(match, 'application')),
        action: action,
        log: thenNames.indexOf('log') >= 0 || hasLogUnder(thenN),
        node: pn
      });
    }
    var fzc = tKids(pRoot, 'from-zone');
    for (var f = 0; f < fzc.length; f++) {
      var fzVals = tKids(fzc[f]);
      for (var fzv = 0; fzv < fzVals.length; fzv++) {
        var from = fzVals[fzv].name;
        var tzc = tKids(fzVals[fzv], 'to-zone');
        if (tzc.length) {
          for (var t = 0; t < tzc.length; t++) {
            var tzVals = tKids(tzc[t]);
            for (var tzv = 0; tzv < tzVals.length; tzv++) {
              var pvals = groupValueNodes(tzVals[tzv], 'policy');
              for (var p = 0; p < pvals.length; p++) pushPolicy(from, tzVals[tzv].name, pvals[p], out);
            }
          }
        } else {
          var pvals2 = groupValueNodes(fzVals[fzv], 'policy');
          for (var p2 = 0; p2 < pvals2.length; p2++) pushPolicy(from, null, pvals2[p2], out);
        }
      }
    }
    for (var ix = 0; ix < out.rules.length; ix++) out.rules[ix].index = 4 + ix;
    return out;
  }

  // NAT tree: security { nat { source { rule-set { SNAT { from { zone { TRUST {
  //   to { zone { UNTRUST { rule { SR-1 { match {...} then {...} } } } } } } } } } } }
  function natRuleSets(rt, kind) {
    var grp = tGo(committedRoot(rt), ['security', 'nat', kind]);
    if (!grp) return [];
    var out = [];
    var rsConts = tKids(grp, 'rule-set');
    for (var rc = 0; rc < rsConts.length; rc++) {
      var rsVals = tKids(rsConts[rc]);
      for (var v = 0; v < rsVals.length; v++) {
        var rs = rsVals[v];
        var ent = { setName: rs.name, from: 'any', to: 'any', rules: [] };
        var fromC = tKid(rs, 'from');
        var zC1 = fromC ? tKid(fromC, 'zone') : null;
        var fzVals = zC1 ? tKids(zC1) : [];
        var holder = null;
        if (fzVals.length) {
          ent.from = fzVals[0].name;
          holder = fzVals[0];
          var toC = tKid(fzVals[0], 'to');
          var zC2 = toC ? tKid(toC, 'zone') : null;
          var tzVals = zC2 ? tKids(zC2) : [];
          if (tzVals.length) { ent.to = tzVals[0].name; holder = tzVals[0]; }
        }
        var rCont = holder ? tKids(holder, 'rule') : [];
        for (var r = 0; r < rCont.length; r++) {
          var rvals = tKids(rCont[r]);
          for (var rv = 0; rv < rvals.length; rv++) ent.rules.push(rvals[rv]);
        }
        if (ent.rules.length) out.push(ent);
      }
    }
    return out;
  }

  function showSecurityZones(rt) {
    var zones = secZones(rt);
    if (!zones.length) return [];
    var out = [];
    for (var i = 0; i < zones.length; i++) {
      var z = zones[i];
      out.push('Security zone: ' + z.name);
      out.push('  Send reset for non-SYN session TCP packets: Off');
      out.push('  Policy configurable: Yes');
      out.push('  Interfaces bound: ' + z.ifaces.length);
      if (z.ifaces.length) {
        out.push('  Interfaces:');
        for (var k = 0; k < z.ifaces.length; k++) out.push('    ' + z.ifaces[k]);
      }
      if (z.services.length) {
        out.push('  Host inbound services: ' + z.services.join(' '));
      }
      out.push('');
    }
    return out;
  }

  function showSecurityPolicies(rt, key, args) {
    var pol = secPolicies(rt);
    if (key.indexOf('hit-count') >= 0) {
      if (!pol.rules.length) return ['Default policy: ' + pol.default, ''];
      var outH = [];
      outH.push('Policy name                      Counter name           Hit count');
      for (var h = 0; h < pol.rules.length; h++) {
        var rh = pol.rules[h];
        var seed = detBig(rt.key + ':hit:' + rh.name);
        outH.push(padR(rh.name, 33) + padR('session-counter', 22) + padL(String(20 + seed % 900), 9));
      }
      return outH;
    }
    var pool = (args.free || []).concat(args.rest || []);
    var fz = null, tz = null;
    for (var i = 0; i < pool.length; i++) {
      var lv = String(pool[i]).toLowerCase();
      if (lv.indexOf('from-zone') === 0 && pool[i + 1]) { fz = pool[i + 1]; i++; }
      else if (lv.indexOf('to-zone') === 0 && pool[i + 1]) { tz = pool[i + 1]; i++; }
    }
    var out = ['Default policy: ' + pol.default];
    out.push('');
    for (var r = 0; r < pol.rules.length; r++) {
      var ru = pol.rules[r];
      if (fz && ru.from !== fz) continue;
      if (tz && ru.to !== tz) continue;
      out.push('From zone: ' + (ru.from || 'any') + ', To zone: ' + (ru.to || 'any'));
      out.push('  Policy: ' + ru.name + ', State: enabled, Index: ' + ru.index + ', Sequence number: ' + (r + 1));
      out.push('    Source addresses: ' + (ru.src.length ? ru.src.join(', ') : 'any'));
      out.push('    Destination addresses: ' + (ru.dst.length ? ru.dst.join(', ') : 'any'));
      out.push('    Applications: ' + (ru.app.length ? ru.app.join(', ') : 'any'));
      out.push('    Action: ' + (ru.action === 'permit' ? 'permit' : 'deny') + (ru.log ? ', log' : ''));
      out.push('');
    }
    return out;
  }

  function hostFromPrefix(prefix, seed, base) {
    var ip = String(prefix || base).split('/')[0];
    var parts = ip.split('.');
    if (parts.length === 4) parts[3] = String(base + (seed % 200));
    return parts.join('.');
  }

  function showFlowSessions(rt) {
    var pol = secPolicies(rt);
    var zones = secZones(rt);
    if (!pol.rules.length) return ['Total sessions: 0'];
    var out = [];
    var shown = 0;
    for (var r = 0; r < pol.rules.length; r++) {
      var ru = pol.rules[r];
      if (ru.action !== 'permit') continue;
      var seed = detBig(rt.key + ':flow:' + ru.name);
      var inIf = zoneIface(zones, ru.from);
      var outIf = zoneIface(zones, ru.to);
      var src = ru.src.length ? hostFromPrefix(ru.src[0], seed, 10) : hostFromPrefix('192.168.10.0/24', seed, 10);
      var dst = ru.dst.length ? ru.dst[0].split('/')[0] : '203.0.113.' + (1 + seed % 240);
      var svc = ru.app.length && ru.app[0].indexOf('http') >= 0 ? 'tcp' : 'udp';
      var dport = svc === 'tcp' ? 80 : 53;
      out.push('Session ID: ' + (20000 + (seed % 90000)) + ', Policy name: ' + ru.name + '/' + ru.index + ', Timeout: ' + (2 + seed % 30) + ', Valid');
      out.push('  In: ' + src + '/' + (40000 + seed % 22000) + ' --> ' + dst + '/' + dport + '; ' + svc + ', Conn Tag: 0x0, If: ' + (inIf || 'ge-0/0/1.0') + ', Pkts: ' + (1 + seed % 9) + ', Bytes: ' + (60 + seed % 90) + ',');
      out.push('  Out: ' + dst + '/' + dport + ' --> ' + src + '/' + (31000 + seed % 30000) + '; ' + svc + ', Conn Tag: 0x0, If: ' + (outIf || 'ge-0/0/0.0') + ', Pkts: ' + (2 + seed % 7) + ', Bytes: ' + (70 + seed % 110) + ',');
      shown++;
    }
    if (!shown) return ['Total sessions: 0'];
    out.push('Total sessions: ' + shown);
    return out;
  }

  function zoneIface(zones, zn) {
    if (!zones) return null;
    for (var i = 0; i < zones.length; i++) if (zones[i].name === zn && zones[i].ifaces.length) return zones[i].ifaces[0];
    return null;
  }

  function showFlowSummary(rt) {
    var pol = secPolicies(rt);
    var seed = detBig(rt.key + ':flowsum');
    var total = 0, hit = 0;
    for (var r = 0; r < pol.rules.length; r++) if (pol.rules[r].action === 'permit') { total++; hit += 2 + seed % 9; }
    var out = [
      'Total sessions: ' + total,
      'Session hits: ' + hit
    ];
    if (total) {
      out = out.concat([
        'ICMP sessions: ' + (1 + seed % 3),
        'TCP sessions: ' + (total - 1),
        'UDP sessions: ' + (1 + seed % 2),
        '',
        'Max sessions: ' + (2000 + seed % 4000)
      ]);
    }
    return out;
  }

  function showFlowStatus(rt) {
    var pol = secPolicies(rt);
    var n = 0;
    for (var r = 0; r < pol.rules.length; r++) if (pol.rules[r].action === 'permit') n++;
    var seed = detBig(rt.key + ':flowst');
    return [
      'Flow gate is enabled',
      'Flow proto: IPv4/IPv6',
      'Flow mode: flow-based',
      'Total sessions: ' + n + ' (' + (seed % 3) + ' TCP, ' + (n ? (1 + seed % 2) : 0) + ' UDP)'
    ];
  }

  function natThenKind(natKind, thenN) {
    var key = { source: 'source-nat', destination: 'destination-nat', static: 'static-nat' }[natKind] || natKind;
    var t = tKid(thenN, key);
    return t;
  }

  function showNatSummary(rt) {
    var rsets = natRuleSets(rt, 'source');
    var totalRules = 0;
    var out = [];
    var seed = detBig(rt.key + ':natsrc');
    for (var r = 0; r < rsets.length; r++) {
      var rs = rsets[r];
      for (var q = 0; q < rs.rules.length; q++) {
        var ru = rs.rules[q];
        totalRules++;
        var match = tKid(ru, 'match');
        var thenN = tKid(ru, 'then');
        var snat = thenN ? natThenKind('source', thenN) : null;
        var tType = snat && snat.children.length ? snat.children[0].name : 'interface';
        var poolName = null;
        if (tType === 'pool') {
          var pv = tKids(snat, 'pool');
          poolName = pv.length && pv[0].children.length ? pv[0].children[0].name : 'POOL1';
        }
        var srcAddr = namesOf(tKid(match, 'source-address'));
        out.push('Source NAT rule: ' + ru.name + ', Rule-set: ' + rs.setName);
        out.push('  From zone: ' + rs.from + ', To zone: ' + rs.to);
        out.push('  Source addresses: ' + (srcAddr.length ? srcAddr.join(', ') : 'any'));
        out.push('  Translation type: ' + (poolName ? 'pool (' + poolName + ')' : tType));
        out.push('  Translation hits: ' + (100 + seed % 1800));
        out.push('');
      }
    }
    var head = ['Total rules: ' + totalRules];
    if (totalRules) head.push('Total bytes: ' + (totalRules * (seed % 9) + 1) + '.' + (seed % 9) + ' MB, Total packets: ' + (totalRules * (10 + seed % 60)) + '.' + (seed % 9) + ' k, Total flows: ' + (130 + seed % 2600));
    return head.concat(totalRules ? [''].concat(out) : out);
  }

  function showNatRules(rt, kind) {
    var rsets = natRuleSets(rt, kind);
    if (!rsets.length) return ['Total rules: 0'];
    var out = [];
    var totalRules = 0;
    for (var r = 0; r < rsets.length; r++) {
      var rs = rsets[r];
      for (var q = 0; q < rs.rules.length; q++) {
        var ru = rs.rules[q];
        totalRules++;
        var match = tKid(ru, 'match');
        var thenN = tKid(ru, 'then');
        var src = namesOf(tKid(match, 'source-address'));
        var dst = namesOf(tKid(match, 'destination-address'));
        var dport = namesOf(tKid(match, 'destination-port'));
        var desc = '  Rule: ' + ru.name + ', Rule-set: ' + rs.setName + (src.length ? ', Source: ' + src.join(', ') : '') + (dst.length != 0 ? ', Dest: ' + dst.join(', ') : '') + (dport.length ? ', Port: ' + dport.join(',') : '');
        var poolN = thenN ? natThenKind(kind, thenN) : null;
        var poolName = null;
        if (poolN) {
          var pv = tKids(poolN, 'pool');
          if (pv.length && pv[0].children.length) poolName = pv[0].children[0].name;
          else if (poolN.children.length && kind !== 'source') {
            // static-nat: `prefix X` or bare pool name
            if (poolN.children[0].name === 'prefix' && poolN.children[0].children.length) {
              desc += ', Prefix: ' + poolN.children[0].children[0].name;
              poolName = '(prefix)';
            }
          }
        }
        desc += poolName && poolName !== '(prefix)' ? ', Pool: ' + poolName : (kind === 'source' && !poolName ? ', Translation: interface' : '');
        out.push(desc.trim());
      }
    }
    return ['Total rules: ' + totalRules, ''].concat(out);
  }

  function showIkeSas(rt) {
    var ikeRoot = tGo(committedRoot(rt), ['security', 'ike']);
    if (!ikeRoot) return [];
    var gwVals = groupValueNodes(ikeRoot, 'gateway');
    if (!gwVals.length) return [];
    var out = ['Index   State  Initiator cookie  Responder cookie  Mode           Remote Address'];
    for (var i = 0; i < gwVals.length; i++) {
      var addr = firstUnder(gwVals[i], 'address') || '0.0.0.0';
      var seed = detBig(rt.key + ':ike:' + gwVals[i].name);
      var ck = '';
      for (var c = 0; c < 16; c++) ck += '0123456789abcdef'.charAt(detBig(gwVals[i].name + ':ck' + c) % 16);
      var ck2 = '';
      for (var c2 = 0; c2 < 16; c2++) ck2 += '0123456789abcdef'.charAt(detBig(gwVals[i].name + ':ck2' + c2) % 16);
      out.push(padL(String(1000 + seed % 8000), 5) + '   UP     ' + ck + '  ' + ck2 + '  IKEv2          ' + addr);
    }
    return out;
  }

  function showIpsecSas(rt) {
    var root = committedRoot(rt);
    var ipRoot = tGo(root, ['security', 'ipsec']);
    if (!ipRoot) return [];
    var vpnVals = groupValueNodes(ipRoot, 'vpn');
    if (!vpnVals.length) return [];
    var ikeGwVals = [];
    var ikeRoot = tGo(root, ['security', 'ike']);
    if (ikeRoot) ikeGwVals = groupValueNodes(ikeRoot, 'gateway');
    var out = ['  Total active tunnels: ' + vpnVals.length + '     Total Ipsec sas: ' + vpnVals.length * 2, ''];
    out.push('  ID     Gateway          Algorithm       SPI      Life:sec/kb  Mon lsys Port');
    for (var i = 0; i < vpnVals.length; i++) {
      var seed = detBig(rt.key + ':ipsec:' + vpnVals[i].name);
      var gwName = firstUnder(vpnVals[i], 'ike-gateway');
      if (!gwName) {
        var low = tKid(vpnVals[i], 'ike');
        gwName = low && low.children.length ? low.children[0].name : null;
      }
      var gwAddr = null;
      for (var gi = 0; gi < ikeGwVals.length; gi++) {
        if (ikeGwVals[gi].name === gwName) {
          gwAddr = firstUnder(ikeGwVals[gi], 'address');
          break;
        }
      }
      var spi1 = '', spi2 = '';
      for (var c = 0; c < 8; c++) spi1 += '0123456789abcdef'.charAt(detBig(vpnVals[i].name + ':spi1' + c) % 16);
      for (var c2 = 0; c2 < 8; c2++) spi2 += '0123456789abcdef'.charAt(detBig(vpnVals[i].name + ':spi2' + c2) % 16);
      var life = 2400 + seed % 3000;
      out.push('  <' + (300000 + seed % 200000) + ' ESP:aes-cbc-256/sha256 ' + padR(spi1, 9) + life + '/unlim -  root 500 ' + (gwAddr || '0.0.0.0'));
      out.push('  >' + (300000 + seed % 200000) + ' ESP:aes-cbc-256/sha256 ' + padR(spi2, 9) + life + '/unlim -  root 500 ' + (gwAddr || '0.0.0.0'));
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

  function showSwSwitchingInterfaces(ds) {
    var out = [];
    if (!ds || !ds.platform || ds.platform !== 'ex') {
      return ['error: command is not valid on this platform'];
    }
    out.push('Interface       State  VLAN members');
    for (var i = 0; i < ds.iflist.length; i++) {
      var name = ds.iflist[i];
      var ifc = ds.interfaces[name]; if (!ifc) continue;
      if (name.indexOf('irb') === 0) continue;
      var swUnit = null;
      for (var u = 0; u < ifc.unilist.length; u++) {
        if (ifc.unilist[u].family === 'ethernet-switching') { swUnit = ifc.unilist[u]; break; }
      }
      if (!swUnit) continue;
      var members = [];
      for (var m = 0; m < swUnit.vlanMembers.length; m++) {
        members.push(swUnit.vlanMembers[m] + (swUnit.interfaceMode === 'trunk' ? '(T)' : ''));
      }
      var nm2 = swUnit.ukey || (name + '.' + swUnit.num);
      out.push(padR(nm2, 16) + padR(ifc.linkUp ? 'up' : 'down', 7) + (members.length ? members.join(' ') : ''));
    }
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

  // ---------- op mode - small utilities ----------

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
    var files = rt.files || {};
    var fshort = String(path).replace(/^.*[\/\\]/, '');
    if (files[path] != null) return { lines: String(files[path]).split('\n') };
    if (files[fshort] != null) return { lines: String(files[fshort]).split('\n') };
    if (/messages/.test(path)) {
      var log = rt.syslog || seedSyslog(rt.key);
      return { lines: log.slice(-8).slice() };
    }
    if (/interactive-commands/.test(path)) {
      return { lines: (rt.intLog || seedIntLog(rt)).slice(-8) };
    }
    if (/\.md$/i.test(path)) {
      return { lines: ['# SharkLab Studio', '# Sample configs: robust-a.config, robust-b.config'] };
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

  function opMonitorTraffic(ds, tok) {
    var name = resolveIfname(ds, tok);
    if (!tok) return { lines: ['        usage: monitor traffic interface <ifname>'] };
    if (!name || !ds.interfaces[name]) {
      return { lines: ['error: interface not found  ' + tok] };
    }
    var seed = ds.key + ':' + name;
    var selfIp = (ds.subnets && ds.subnets[0]) ? ds.subnets[0].ip : '0.0.0.0';
    var out = [];
    out.push('Address 00:50:56:' + pad2((seed.length * 7) % 90 + 9) + ':' + pad2(seed.length % 90 + 9) + ':' + pad2((seed.length * 13) % 90 + 9));
    out.push('');
    out.push('Capturing on \x27' + name + '\x27');
    out.push('');
    var rows = [
      '  1   ' + detBig(seed + ':t0') + '  ARP        Who has ' + selfIp.replace(/\.\d+$/, '.254') + '? Tell ' + selfIp,
      '  2   ' + detBig(seed + ':t1') + '  OSPF       ' + selfIp + ' > 224.0.0.5: OSPFv2 Hello Packet, len 48',
      '  3   ' + detBig(seed + ':t2') + '  ARP        Reply ' + selfIp + ' is-at ' + (ds.interfaces[name].mac || selfMac('3')),
      '  4   ' + detBig(seed + ':t3') + '  ARP        Who has ' + selfIp.replace(/\.\d+$/, '.254') + '? Tell ' + selfIp,
      '  5   ' + detBig(seed + ':t4') + '  OSPF       ' + selfIp + ' > 224.0.0.5: OSPFv2 Hello Packet, len 48'
    ];
    out.push.apply(out, rows);
    out.push('');
    out.push('5 packets captured');
    return { lines: out };
  }
  function selfMac(i) { return '00:50:56:bb:cc:0' + i; }
  function pad2(v) { v = String(v); return (v.length < 2 ? '0' : '') + v; }

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
    if (/^README\.md/i.test(base)) return ['# SharkLab Studio', '# Sample configs: robust-a.config, robust-b.config'];
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

  function applyPipes(lines, pipeToks, sess) {
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
      if (/^(sa|sav|save)$/.test(f)) {
        var savePath = pipeToks[i + 1];
        if (sess && sess.rt && savePath) {
          var text = out.join('\n');
          sess.rt.files = sess.rt.files || {};
          sess.rt.files[String(savePath)] = text;
          var short = String(savePath).replace(/^.*[\/\\]/, '');
          if (short && short !== String(savePath)) sess.rt.files[short] = text;
        }
        return []; // Junos `| save` is silent
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

  function runOp(sess, line) {    var world = sess.world;
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
      if (!args.free && pathWords.length >= 2 && pathWords[0] === 'file' &&
          (pathWords[1] === 'show' || pathWords[1] === 'list' || pathWords[1] === 'statistics')) {
        args.free = args.rest;
        args.rest = [];
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
        var cbase = rt.committed, cused = 1;
        for (var hq = 1; hq < pipeToks.length; hq++) {
          if ('rollback'.indexOf(String(pipeToks[hq]).toLowerCase()) === 0) {
            cbase = revisionBase(rt, parseInt(pipeToks[hq + 1], 10));
            cused = hq + 2;
            break;
          }
        }
        var cdiff = compareAt(sess, cbase, rt.candidate);
        var cafter = pipeToks.slice(cused);
        return { lines: cafter.length ? applyPipes(cdiff, cafter, sess) : cdiff };
      }
      if (p0.length && 'display'.indexOf(p0) === 0 && pipeToks[1] && 'set'.indexOf(String(pipeToks[1]).toLowerCase()) === 0) {
        var dset = displaySetLines(rt.committed);
        var dafter = pipeToks.slice(2);
        return { lines: dafter.length ? applyPipes(dset, dafter, sess) : dset };
      }
    }

    // completion gate: partial 'show' paths that are themselves runnable commands run now
    if (node && node.sub && pathWords[0] === 'show' && !args.rest && !args.ifname && !args.free) {
      var kk = pathWords.join(' ');
      if (kk !== 'show interfaces' && kk !== 'show route' && kk !== 'show route forwarding-table' && kk !== 'show chassis fpc' &&
          kk !== 'show bfd session' && kk !== 'show security policies' && kk !== 'show vrrp' && kk !== 'show firewall' &&
          kk !== 'show security nat source rule' && kk !== 'show security nat destination rule' && kk !== 'show security nat static rule') {
        return { lines: completionsBlock(candsAt(node, sess)) };
      }
    }

    var out = dispatchOp(sess, key, args, ds, world, rt);
    if (out && out.msgType === 'mode') return out;
    var lines = out.lines == null ? [] : out.lines;
    return {
      lines: applyPipes(lines, pipeToks, sess),
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

  function walkOpTree(key) {
    if (!key) return null;
    var n = OP_TREE;
    var toks = String(key).split(' ');
    for (var i = 0; i < toks.length && n; i++) {
      n = resolveTok(toks[i], n.sub);
    }
    return n;
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
      case 'show system alarms':
        lines = showSystemAlarms(rt); break;
      case 'show system information':
        lines = showSystemInformation(rt); break;
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
      case 'show interfaces descriptions':
        return { lines: showIntDescriptions(ds, rt) };
      case 'show interfaces brief':
        case 'show interfaces media': case 'show interfaces statistics': case 'show interfaces diagnostics': case 'show interfaces detail': case 'show interfaces extensive': {
        if (!args.ifname && !args.free) return { lines: ['error: interface required for this view'] };
        var nm = showIfName(ds, args);
        if (!nm) return { lines: caretErrorIfname(args.ifname || (args.free && args.free[0]) || '') };
        var mode = key.split(' ')[2];
        lines = showIntBlock(ds, ds.interfaces[nm], mode === 'extensive' ? 'detail' : mode);
        break;
      }
      case 'show interfaces irb': case 'show interfaces irb terse': case 'show interfaces irb brief': case 'show interfaces irb detail': {
        if (ds && ds.iflist) {
          var hasIrbIflist = false;
          for (var hil = 0; hil < ds.iflist.length; hil++) {
            if (String(ds.iflist[hil]).indexOf('irb') === 0) { hasIrbIflist = true; break; }
          }
          if (hasIrbIflist) {
            var terse2 = showIntTerse(ds, 'irb');
            if (terse2.length > 1) return { lines: terse2 };
          }
        }
        if (ds && ds.subnets) {
          var rowz = [];
          for (var irz = 0; irz < ds.subnets.length; irz++) {
            var snz = ds.subnets[irz];
            if (snz.kind !== 'irb') continue;
            rowz.push(padR(snz.ukey || (snz.iface + '.' + snz.unit), 24) + padR('up', 6) + padR('up', 5) + padR('inet', 9) + snz.cidr);
          }
          if (rowz.length) return { lines: ['Interface               Admin Link Proto    Local                 Remote'].concat(rowz) };
        }
        return { lines: ['error: device does not have irb configured'] };
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
      case 'show route hidden': case 'show route hidden detail': case 'show route hidden extensive': {
        var hjoin = (args.free || []).join(' ') + ' ' + (args.rest || []).join(' ');
        return { lines: routeHidden(ds, rt, (key + ' ' + hjoin).indexOf('detail') >= 0 || (key + ' ' + hjoin).indexOf('extensive') >= 0) };
      }
      case 'show route table': case 'show route table summary': case 'show route table detail': {
        var tpool = (args.free || []).concat(args.rest || []);
        var tleft = [], wantSummary = false;
        for (var tw2 = 0; tw2 < tpool.length; tw2++) {
          var w2 = String(tpool[tw2]).toLowerCase();
          if (w2.indexOf('summary') === 0) { wantSummary = true; continue; }
          if (/^(inet|inet6|mpls|bgp|iso|vpn)\.?/.test(w2)) continue;
          if (w2 === 'detail' || w2 === '0' || w2 === '1') continue;
          tleft.push(String(tpool[tw2]));
        }
        if (wantSummary) return { lines: showRouteSummary(ds) };
        return { lines: routeLines(ds, { free: tleft, rest: [] }) };
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
      case 'show bfd session': case 'show bfd session detail': {
        var bfdDetail = String(key).indexOf('detail') >= 0;
        var bfdTok = (args.free || []).concat(args.rest || []);
        for (var bi = 0; bi < bfdTok.length; bi++) if (String(bfdTok[bi]).toLowerCase().indexOf('detail') === 0) bfdDetail = true;
        return { lines: showBfdSession(ds, rt, bfdDetail) };
      }
      case 'show firewall':
        return { lines: showFirewall(rt) };
      case 'show firewall filter':
        return { lines: showFirewall(rt, ((args.free || [])[0]) || ((args.rest || [])[0]) || null) };
      case 'show firewall log':
        return { lines: showFirewallLog(rt) };
      case 'show policer':
        return { lines: showPolicer(rt) };
      case 'show isis adjacency':
        return { lines: showIsisAdjacency(ds, rt) };
      case 'show isis database':
        return { lines: showIsisDatabase(ds, rt) };
      case 'show isis interface':
        return { lines: showIsisInterface(ds, rt) };
      case 'show isis route':
        return { lines: showIsisRoute(ds, rt) };
      case 'show isis statistics':
        return { lines: showIsisStats(ds, rt) };
      case 'show ldp neighbor':
        return { lines: showLdpNeighbor(ds, rt) };
      case 'show ldp session':
        return { lines: showLdpSession(ds, rt) };
      case 'show ldp database':
        return { lines: showLdpDatabase(ds, rt) };
      case 'show mpls lsp':
        return { lines: showMplsLsp(rt) };
      case 'show mpls interface':
        return { lines: showMplsInterface(rt) };
      case 'show rsvp session':
        return { lines: showMplsLsp(rt, 'rsvp') };
      case 'show rsvp interface':
        return { lines: showRsvpInterface(rt) };
      case 'show lacp interfaces':
        return { lines: showLacp(rt) };
      case 'show vrrp': case 'show vrrp brief':
        return { lines: showVrrp(rt) };
      case 'show security zones':
        return { lines: showSecurityZones(rt) };
      case 'show security policies': case 'show security policies detail': case 'show security policies hit-count':
        return { lines: showSecurityPolicies(rt, key, args) };
      case 'show security flow session':
        return { lines: showFlowSessions(rt) };
      case 'show security flow summary':
        return { lines: showFlowSummary(rt) };
      case 'show security flow status':
        return { lines: showFlowStatus(rt) };
      case 'show security nat source summary':
        return { lines: showNatSummary(rt) };
      case 'show security nat source rule': case 'show security nat source rule all':
        return { lines: showNatRules(rt, 'source') };
      case 'show security nat destination rule': case 'show security nat destination rule all':
        return { lines: showNatRules(rt, 'destination') };
      case 'show security nat static rule': case 'show security nat static rule all':
        return { lines: showNatRules(rt, 'static') };
      case 'show security ike security-associations':
        return { lines: showIkeSas(rt) };
      case 'show security ipsec security-associations':
        return { lines: showIpsecSas(rt) };
      case 'clear security flow session': case 'clear security flow sessions':
      case 'clear security ike security-associations': case 'clear security ipsec security-associations':
        return { lines: [] };
      case 'show arp':
        return { lines: showArp(ds) };
      case 'show lldp': case 'show lldp neighbors':
        return { lines: showLldp(ds) };
      case 'show vlans':
        return { lines: ds.vlans.length ? showVlans(ds) : ['error: no vlans configured on this device'] };
      case 'show ethernet-switching table':
        return { lines: showMacTable(ds) };
      case 'show ethernet-switching interfaces':
        return { lines: showSwSwitchingInterfaces(ds) };
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
        lines = opFileList(sess, (args.free || []).concat(args.rest || []));
        break;
      case 'file show': {
        var fpath = (args.free && args.free[0]) || (args.rest && args.rest[0]) || null;
        var fsout = opFileShow(rt, fpath);
        return { lines: fsout.lines };
      }
      case 'file statistics':
        lines = opFileStats(rt, (args.free && args.free[0]) || (args.rest && args.rest[0]) || null);
        break;
      case 'monitor interface':
        return opMonitor(sess, args.ifname ? [args.ifname] : (args.rest || []));
      case 'monitor traffic interface':
        return opMonitorTraffic(ds, args.ifname ? args.ifname : (args.rest && args.rest[0]) || '');
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
        sess.editPath = [];
        return { lines: [], msgType: 'mode', mode: 'cli-cfg' };
      case 'pipe':
        return { lines: [] };
      default: {
        var walked = walkOpTree(key);
        if (walked && walked.sub) return { lines: completionsBlock(candsAt(walked, sess)) };
        return { lines: ['% Unknown command.'] };
      }
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

  // ---------- route hidden / unresolvable statics ----------

  function routeHidden(ds, rt, wantDetail) {
    var root = committedRoot(rt);
    var st = tGo(root, ['routing-options', 'static']);
    var routes = st ? tKid(st, 'route') : null;
    var hidden = [];
    if (routes) {
      var rns = tKids(routes);
      for (var i = 0; i < rns.length; i++) {
        var nh = firstUnder(rns[i], 'next-hop');
        if (!nh) continue;
        var resolvable = false;
        if (ds && ds.subnets) {
          for (var s = 0; s < ds.subnets.length; s++) {
            if (J.inNet(nh, ds.subnets[s].cidr)) { resolvable = true; break; }
          }
        }
        if (resolvable) continue;
        var seed = detBig(rt.key + ':rh:' + rns[i].name);
        hidden.push({ dest: rns[i].name, nh: nh, age: routeAge(now() - 60000 - seed % 3600000) });
      }
    }
    var out = [];
    var act = ds && ds.routes ? ds.routes.length : 0;
    var total = act + hidden.length;
    out.push('inet.0: ' + total + ' destinations, ' + total + ' routes (' + act + ' active, 0 holddown, ' + hidden.length + ' hidden)');
    out.push('');
    for (var h = 0; h < hidden.length; h++) {
      out.push(padR(hidden[h].dest, 19) + '[Static/5] ' + hidden[h].age + ', unresolvable');
      if (wantDetail) {
        out.push('\tState: <Hidden Int>');
        out.push('\tAge: ' + hidden[h].age);
        out.push('\tNext hop: ' + hidden[h].nh + ' unresolvable');
        out.push('');
      }
    }
    return out;
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
        else if (r2.proto === 'Local') outb.push('\tLocal via ' + (r2.via || r2.local || r2.dest.split('/')[0]));
        else if (r2.to) outb.push('\tNext hop: ' + r2.to + ', via ' + r2.via);
        else if (r2.via) outb.push('\tvia ' + r2.via);
        outb.push('');
      }
      return outb;
    }
    return showRoute(ds, null, null, filtered);
  }

  // ============================================================
  // PART 4B - configuration mode runtime
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
    var guardSet = guardProtected(sess, rt, line, abs(rest));
    if (guardSet) return guardSet;
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
    var guardDel = guardProtected(sess, rt, line, abs(rest));
    if (guardDel) return guardDel;
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
    var guardIn = guardProtected(sess, rt, line, abs(rest));
    if (guardIn) return guardIn;
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
    // Junos never refuses an `edit` into a hierarchy that is not in the
    // candidate yet; the nodes appear when the first statement is set.
    sess.editPath = abs(rest);
    return { lines: [] };
  }

  function cfgUncommitted(rt) {
    if (!rt) return false;
    try { return !db.equal(rt.candidate, rt.committed); } catch (e) { return true; }
  }

  function cfgLeave(sess) {
    sess.mode = 'cli-op';
    sess.editPath = [];
    return { lines: [], msgType: 'mode', mode: 'cli-op' };
  }

  function popEditLevel(ep) {
    // `unit 0` / `address 1.2.3.4/24` are one visible level even though the
    // tree stores the keyword and its value as separate nodes.
    var p = (ep || []).slice();
    if (!p.length) return p;
    p.pop();
    while (p.length && db.isIdentParent(p[p.length - 1])) p.pop();
    return p;
  }

  function cfgExit(sess) {
    var ep = sess.editPath || [];
    if (ep.length) {
      sess.editPath = popEditLevel(ep);
      return { lines: [] };
    }
    if (cfgUncommitted(sess.rt)) {
      sess.pend = { kind: 'exit-confirm', step: 0 };
      return {
        lines: [
          'The configuration has been changed but not committed',
          'Exit with uncommitted changes? [yes,no] (yes)'
        ],
        prompt: ''
      };
    }
    return cfgLeave(sess);
  }

  function cfgUp(sess, rest) {
    var n = parseInt(rest[0], 10);
    if (!n || n < 1) n = 1;
    if (!(sess.editPath || []).length) return { lines: ['error: already at the top level of the hierarchy'] };
    for (var i = 0; i < n && sess.editPath.length; i++) sess.editPath = popEditLevel(sess.editPath);
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
    var guardRn = guardProtected(sess, rt, line, src);
    if (guardRn) return guardRn;
    var srcNode = db.nodeAt(root, src, false);
    if (!srcNode) return { lines: ['warning: statement not found: ' + src[src.length - 1]] };
    var newNm = dst[dst.length - 1];
    var parent = db.nodeAt(root, src.slice(0, -1), false);
    if (!parent) return { lines: ['warning: statement not found: ' + src[src.length - 1]] };
    if (db.child(parent, newNm)) return { lines: ['warning: statement exists: ' + newNm] };
    srcNode.name = newNm;
    return { lines: [] };
  }

  // ---------- protect / unprotect / wildcard delete / replace / load ----------

  function pathText(path) { return path.join(' '); }

  function samePrefix(a, b, len) {
    for (var i = 0; i < len; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function protectedHit(rt, path) {
    var ps = rt.protectedPaths || [];
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].length <= path.length && samePrefix(ps[i], path, ps[i].length)) return ps[i];
    }
    return null;
  }

  function guardProtected(sess, rt, line, path) {
    var hit = protectedHit(rt, path);
    if (!hit) return null;
    return { lines: ['error: statement is protected: ' + pathText(hit)] };
  }

  function cfgProtectToggle(sess, rt, root, line, rest, abs, want) {
    if (!rest.length) return errCaret(sess, line, 1, 'error: incomplete command');
    var path = abs(rest);
    var target = db.nodeAt(root, path, false);
    if (!target) {
      var missing = cfgMissingName(root, path);
      return { lines: ['warning: statement not found: ' + (missing || path[path.length - 1])] };
    }
    if (!rt.protectedPaths) rt.protectedPaths = [];
    var ps = rt.protectedPaths;
    var found = -1;
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].length === path.length && samePrefix(ps[i], path, path.length)) { found = i; break; }
    }
    if (want) {
      if (found >= 0) return { lines: ['warning: statement already protected'] };
      ps.push(path.slice());
      return { lines: [] };
    }
    if (found >= 0) {
      ps.splice(found, 1);
      return { lines: [] };
    }
    // also honor a broader protected ancestor
    for (var u = 0; u < ps.length; u++) {
      if (ps[u].length < path.length && samePrefix(ps[u], path, ps[u].length)) {
        ps.splice(u, 1);
        return { lines: [] };
      }
    }
    return { lines: ['warning: statement is not protected'] };
  }

  function wildcardRe(pat) {
    var rx = '';
    var p = String(pat);
    for (var i = 0; i < p.length; i++) {
      var ch = p.charAt(i);
      if (ch === '*') rx += '.*';
      else if (ch === '?') rx += '.';
      else rx += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + rx + '$', 'i');
  }

  function cfgWildcardDelete(sess, rt, root, line, rest, abs) {
    var toks = rest;
    if (toks.length && toks[0].toLowerCase() === 'delete') toks = toks.slice(1);
    if (!toks.length) return errCaret(sess, line, 1, 'error: incomplete command');
    var wi = -1;
    for (var i = 0; i < toks.length; i++) {
      if (/[*?]/.test(toks[i])) { wi = i; break; }
    }
    var seg = wi < 0 ? toks.length - 1 : wi;
    var parentPath = abs(toks.slice(0, seg));
    var base = db.nodeAt(root, parentPath, false);
    if (!base) {
      var missing = cfgMissingName(root, abs(toks));
      return { lines: ['warning: statement not found: ' + (missing || toks[seg])] };
    }
    var rx = wildcardRe(toks[seg]);
    var deeper = toks.slice(seg + 1);
    var count = 0, matches = [];
    for (var c = 0; c < base.children.length; c++) {
      var ch2 = base.children[c];
      if (ch2.name === '[' || ch2.name === ']') continue;
      if (rx.test(ch2.name)) matches.push(ch2);
    }
    for (var m = 0; m < matches.length; m++) {
      var okd = true;
      if (deeper.length) {
        var deep = matches[m];
        for (var d = 0; d < deeper.length; d++) {
          deep = db.child(deep, deeper[d]);
          if (!deep) { okd = false; break; }
        }
      }
      if (!okd) continue;
      if (protectedHit(rt, parentPath.concat(matches[m].name))) continue;
      db.del(root, parentPath.concat(matches[m].name));
      count++;
    }
    if (!count) return { lines: ['warning: no statements matched'] };
    return { lines: ['warning: ' + count + ' statement' + (count > 1 ? 's' : '') + ' deleted'] };
  }

  function replaceOnRoot(root, oldStr, newStr) {
    var count = 0;
    function walk(n) {
      for (var i = 0; i < n.children.length; i++) walk(n.children[i]);
      if (n.values && n.values.length) {
        for (var v = 0; v < n.values.length; v++) {
          var nu = String(n.values[v]).split(oldStr).join(newStr);
          if (nu !== String(n.values[v])) { n.values[v] = nu; count++; }
        }
      }
      if (n.name) {
        var nu2 = String(n.name).split(oldStr).join(newStr);
        if (nu2 !== n.name) { n.name = nu2; count++; }
      }
    }
    walk(root);
    return count;
  }

  function cfgReplacePattern(sess, rt, root, line, rest) {
    var idx = -1;
    for (var i = 0; i < rest.length; i++) {
      if (String(rest[i]).toLowerCase() === 'pattern') { idx = i; break; }
    }
    if (idx < 0 || idx + 2 > rest.length - 1) return errCaret(sess, line, 1, 'error: incomplete command');
    var oldStr = String(rest[idx + 1]);
    var newStr = String(rest[idx + 2] == null ? '' : rest[idx + 2]);
    var count = replaceOnRoot(root, oldStr, newStr);
    if (!count) return { lines: ['warning: nothing matched: ' + oldStr] };
    return { lines: [] };
  }

  // ---------- load family ----------

  var CFG_IDENT = { unit: 1, address: 1, interface: 1, neighbor: 1, route: 1, user: 1, area: 1, group: 1, term: 1, filter: 1, application: 1, family: 1, zone: 1, community: 1 };

  function readFile(rt, path) {
    var files = rt.files || {};
    var short = String(path).replace(/^.*[\/\\]/, '');
    if (files[path] != null) return files[path];
    if (files[short] != null) return files[short];
    if (/\.config$/i.test(short)) return configSetLines(rt).join('\n');
    if (/\.set$/i.test(short)) return configSetLines(rt).join('\n');
    return null;
  }

  function cfgBraceLex(s) {
    var outT = [], cur = '', i = 0;
    function flush() { if (cur.length) { outT.push(cur); cur = ''; } }
    while (i < s.length) {
      var ch = s.charAt(i);
      if (ch === '"') {
        var j = s.indexOf('"', i + 1);
        var seg = j < 0 ? s.slice(i + 1) : s.slice(i + 1, j);
        flush(); outT.push(seg);
        i = j < 0 ? s.length : j + 1;
        continue;
      }
      if (ch === '#') { var e = s.indexOf('\n', i); i = e < 0 ? s.length : e; continue; }
      if (ch === '/' && s.charAt(i + 1) === '*') { var k = s.indexOf('*/', i + 2); i = k < 0 ? s.length : k + 2; continue; }
      if (ch === ';' || ch === '{' || ch === '}') { flush(); outT.push(ch); i++; continue; }
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { flush(); i++; continue; }
      cur += ch; i++;
    }
    flush();
    return outT;
  }

  function cfgBraceWalk(scope, tokens) {
    var cur = scope;
    for (var i = 0; i < tokens.length; i++) {
      cur = db.childOrCreate(cur, tokens[i]);
    }
    return cur;
  }

  function cfgBraceParse(scope, text) {
    var toks = cfgBraceLex(text);
    var idx = 0;
    var count = 0;
    function parseInto(node) {
      while (idx < toks.length) {
        if (toks[idx] === '}') { idx++; return; }
        var path = [], marker = null;
        while (idx < toks.length && toks[idx] !== ';' && toks[idx] !== '{') {
          var tk = toks[idx];
          if (tk === 'inactive:' || tk === '!') marker = 'inactive';
          else path.push(tk);
          idx++;
        }
        if (idx >= toks.length) break;
        var term = toks[idx]; idx++;
        if (term === '{') {
          var sub = cfgBraceWalk(node, path);
          if (marker) sub.inactive = true;
          if (path.length) count++;
          parseInto(sub);
        } else {
          if (path.length) {
            db.set(node, path);
            if (marker) db.setInactive(node, path, true);
            count++;
          }
        }
      }
    }
    parseInto(scope);
    return count;
  }

  function applyConfigText(rt, text, opp) {
    var linesIn = String(text).split(/\r?\n/);
    var isSetLines = false;
    for (var s = 0; s < linesIn.length; s++) {
      var l0 = linesIn[s].trim();
      if (!l0 || l0.charAt(0) === '#' || l0.slice(0, 2) === '/*') continue;
      if (/^set /i.test(l0) || /^(de)?activate /i.test(l0) || /^delete /i.test(l0)) isSetLines = true;
      break;
    }
    var root = opp === 'override' ? db.create(null) : rt.candidate;
    var count = 0;
    if (isSetLines) {
      for (var si = 0; si < linesIn.length; si++) {
        var sl = linesIn[si].trim();
        if (!sl || sl.charAt(0) === '#' || sl.slice(0, 2) === '/*') continue;
        var tk = tokenize(sl);
        if (!tk.length) continue;
        var verb = String(tk[0]).toLowerCase();
        var body = tk.slice(1);
        if (verb === 'set') { db.set(root, body.length ? body : tk); count++; }
        else if (verb === 'deactivate') { db.setInactive(root, body, true); count++; }
        else if (verb === 'activate') { db.setInactive(root, body, false); count++; }
        else if (verb === 'delete') { db.del(root, body); count++; }
        else if (verb === 'replace' && body.length >= 3 && String(body[0]).toLowerCase() === 'pattern') { count += replaceOnRoot(root, body[1], body[2]); }
        else if (verb !== 'annotate' && verb !== 'commit') { db.set(root, body.length ? tk : tk); count++; }
      }
    } else {
      count = cfgBraceParse(root, text);
    }
    if (opp === 'override') rt.candidate = root;
    return count;
  }

  function cfgLoad(sess, rt, line, rest) {
    var opp = null, terminal = false, path = null;
    var consumed = 0;
    for (var i = 0; i < rest.length; i++) {
      var kw = String(rest[i]).toLowerCase();
      if (!opp && /^(set|merge|override|replace)$/.test(kw)) { opp = kw; consumed++; continue; }
      if (!opp && 'factory-default'.indexOf(kw) === 0) { opp = 'factory-default'; consumed++; continue; }
      if (kw === 'terminal') { terminal = true; consumed++; continue; }
      path = toksTail(rest, i);
      break;
    }
    if (!opp) {
      return errCaret(sess, line, 1, 'error: invalid load operation: ' + (rest[0] || ''));
    }
    if (opp === 'factory-default') {
      var fresh = db.create(null);
      var bl = (rt.spec && rt.spec.baseline) || [];
      for (var b = 0; b < bl.length; b++) {
        try { db.set(fresh, bl[b]); } catch (e) {}
      }
      rt.candidate = fresh;
      rt.files = rt.files || {};
      rt.protectedPaths = [];
      return { lines: ['load complete: factory-default configuration loaded'] };
    }
    if (terminal) {
      return { lines: [], pend: 'load-set', opp: opp, prompt: '' };
    }
    if (!path) return errCaret(sess, line, rest.length, 'error: filename required');
    var text = readFile(rt, path);
    if (text == null) {
      return { lines: ['error: file not found: ' + path] };
    }
    applyConfigText(rt, text, opp);
    return { lines: ['load complete'] };
  }
  function toksTail(toks, from) {
    var out = [];
    for (var i = from < 0 ? 0 : from; i < toks.length; i++) out.push(toks[i]);
    return out.length ? out : null;
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
    var flags = { quit: false, check: false, confirmedMins: 0, comment: null, at: null, sync: false };
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
      } else if (t === 'at') {
        var att = rest[i + 1] ? String(rest[i + 1]) : prompt(sess).trim();
        if (att && /^\d{2}:\d{2}/.test(String(rest[i + 2] || ''))) {
          att = att + ' ' + String(rest[i + 2]);
          i++;
        }
        if (att) i++;
        flags.at = att || null;
      } else if ('synchronize'.indexOf(t) === 0 && t.length >= 5) {
        flags.sync = true;
      }
    }
    if (flags.check) return { lines: ['configuration check succeeds'] };

    var previous = rt.committed;
    if (!rt.revisions) rt.revisions = [];
    if (previous) {
      rt.revisions.unshift(db.clone(previous));
      if (rt.revisions.length > 50) rt.revisions.length = 50;
    }
    var committedNew = db.clone(rt.candidate);
    rt.committed = committedNew;
    rt.config = committedNew;
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
    if (flags.sync) {
      outl = ['commit synchronize: complete on both routing engines'].concat(outl);
    }
    if (flags.at) {
      outl = ['At ' + flags.at + ', will commit the configuration'].concat(outl);
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
    if (n === 0) {
      // rollback 0 discards the candidate and reloads the running config
      if (rt.confirmed) rt.confirmed = null;
      rt.candidate = db.clone(rt.committed);
      return { lines: ['load complete'] };
    }
    if (n < 0 || !revs[n - 1]) {
      return { lines: ['error: rollback ' + n + ' exceeds available revision history'] };
    }
    if (rt.confirmed) rt.confirmed = null;
    rt.candidate = db.clone(revs[n - 1]);
    return { lines: ['load complete'] };
  }

  var PIPE_KINDS = ['count', 'display', 'compare', 'match', 'except', 'last', 'first', 'no-more', 'resolution', 'trim', 'save'];

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

  function revisionBase(rt, n) {
    if (!n) return rt.committed;
    var revs = rt.revisions || [];
    return revs[n - 1] || rt.committed;
  }

  function compareAt(sess, base, isNewOverride) {
    var rt = sess.rt;
    var isNew = isNewOverride || ((sess.mode === 'cli-cfg') ? rt.candidate : rt.committed);
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
      var used = 1;
      var pipeArgs = pipe.slice(1);
      for (var q = 0; q < pipeArgs.length; q++) {
        if ('rollback'.indexOf(String(pipeArgs[q]).toLowerCase()) === 0) {
          base = revisionBase(rt, parseInt(pipeArgs[q + 1], 10));
          used = q + 3;
          break;
        }
      }
      var diff = compareAt(sess, base);
      var after = pipe.slice(used);
      return { lines: after.length ? applyPipes(diff, after, sess) : diff };
    }
    if (pk === 'display' && pipe[1] && 'set'.indexOf(String(pipe[1]).toLowerCase()) === 0) {
      var setOut = displaySetLines(root);
      var restPipe = pipe.slice(2);
      return { lines: restPipe.length ? applyPipes(setOut, restPipe, sess) : setOut };
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
    bl = applyPipes(bl, pipe, sess);
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
    if (c.w === 'show' && toks[1] === 'configuration') { // cfg-mode Junos: show configuration [hier]
      return cfgShow(sess, toks.slice(2), pipe, true);
    }
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
      case 'exit': return cfgExit(sess);
      case 'quit': return cfgLeave(sess);
      case 'copy': return cfgCopy(sess, rt, root, line, rest, abs);
      case 'rename': return cfgRename(sess, rt, root, line, rest, abs);
      case 'load': return cfgLoad(sess, rt, line, rest);
      case 'protect': return cfgProtectToggle(sess, rt, root, line, rest, abs, true);
      case 'unprotect': return cfgProtectToggle(sess, rt, root, line, rest, abs, false);
      case 'replace': return cfgReplacePattern(sess, rt, root, line, rest);
      case 'wildcard': return cfgWildcardDelete(sess, rt, root, line, rest, abs);
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

  var PEND_PROMPTS = { ping: 'Host: ', traceroute: 'Host: ', ssh: 'Host: ', telnet: 'Host: ', 'load-set': '' };

  function pendFeed(sess, line) {
    var p = sess.pend;
    if (!p) return { lines: [] };
    var val = String(line == null ? '' : String(line));
    var trim = val.trim();
    if (p.kind === 'exit-confirm') {
      sess.pend = null;
      var ans = trim.toLowerCase();
      if (ans === 'n' || ans === 'no') return { lines: [] };
      return cfgLeave(sess);
    }
    if (p.kind === 'load-set') {
      var eof = trim === 'ctrl-d' || trim === 'ctl-d' || trim === '^d' || (val.length === 1 && val.charCodeAt(0) === 4);
      if (!trim.length && p.buffered.length) eof = true;
      if (eof) {
        sess.pend = null;
        var text = p.buffered.join('\n');
        var opp = p.opp || 'set';
        if (p.buffered.length && opp === 'set') {
          // bare "load set terminal" with set-lines pasted; honor each verb per line
          applyConfigText(sess.rt, text, opp);
          return { lines: ['load complete'] };
        }
        if (p.buffered.length) {
          applyConfigText(sess.rt, text, opp);
          return { lines: ['load complete'] };
        }
        return { lines: ['load complete'] };
      }
      if (trim.length) p.buffered.push(trim);
      return { lines: [], prompt: '' };
    }
    if (p.step === 0) {
      if (!trim) {
        sess.pend = null;
        return { lines: [] };
      }
      p.host = trim;
      p.step = 1;
      return { lines: [], prompt: 'count: ' };
    }
    if (p.step === 1) {
      p.count = trim ? (parseInt(trim, 10) || 0) : 0;
      p.step = 2;
      return { lines: [], prompt: 'source: ' };
    }
    sess.pend = null;
    var src = trim ? trim : null;
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
      if (outC && outC.pend) {
        sess.pend = { kind: outC.pend, step: 0, opp: outC.opp || null, buffered: [] };
        return { lines: notice.slice(), prompt: outC.prompt != null ? outC.prompt : (PEND_PROMPTS[outC.pend] || 'Host: ') };
      }
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
    buildWorldFromDevs: function (devs, extra) {
      if (net && net.buildWorld) return net.buildWorld(devs || {}, extra || null);
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
    errCaret: errCaret,
    // build a fresh config tree from `set`-style lines (used by preset bootstrap)
    buildRootFromSetLines: function (lines) {
      var stub = { candidate: db.create(null), files: {}, protectedPaths: [] };
      applyConfigText(stub, (lines || []).join('\n'), 'merge');
      return stub.candidate;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
