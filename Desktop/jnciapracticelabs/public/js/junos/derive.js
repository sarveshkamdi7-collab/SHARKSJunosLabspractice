(function (global) {
  'use strict';

  var J = global.JJ;
  var db = J.db;

  // ============================================================
  // JJ.net — derives runtime device state (ds) from committed
  // config trees + the lab topology. Pure simulation, no images.
  // ============================================================

  // ---------- small helpers ----------

  function val1(n) {
    return n && n.values && n.values.length ? n.values[0] : null;
  }

  function go(root, path) {
    var cur = root;
    for (var i = 0; i < path.length; i++) {
      cur = db.child(cur, path[i]);
      if (!cur) return null;
    }
    return cur;
  }

  function cfgVal(root, path) {
    return val1(go(root, path));
  }

  function kids(node) {
    return node ? node.children : [];
  }

  function hasStmt(node, name) {
    var c = db.child(node, name);
    return !!c && !c.inactive;
  }

  function stmtVal(node, name) {
    var c = db.child(node, name);
    if (!c || c.inactive) return null;
    return val1(c);
  }

  function ipOf(cidr) {
    var p = J.parseIp(cidr);
    return p ? p.ip : null;
  }

  function preOf(cidr) {
    var p = J.parseIp(cidr);
    return p ? (p.prefix === null ? 32 : p.prefix) : null;
  }

  function sameNet(a, b) {
    var na = J.netOf(a), nb = J.netOf(b);
    return !!na && !!nb && na === nb;
  }

  function ifKind(name) {
    if (name === 'lo0') return 'lo';
    if (name === 'fxp0' || name === 'me0') return 'mgmt';
    if (name === 'irb') return 'irb';
    return 'phys';
  }

  function detNs(seed) {
    var h = J.hash('' + seed);
    var v = (h % 3600) / 100;
    if (v < 0.2) v += 0.2;
    return v.toFixed(3);
  }

  function pad4(n) {
    var s = (n >>> 0).toString(16);
    while (s.length < 4) s = '0' + s;
    return s;
  }

  function portCount(spec) {
    return spec.platform === 'ex' ? 24 : 8;
  }

  function cmpIfname(a, b) {
    var na = ifKind(a), nb = ifKind(b);
    if (na !== nb) {
      var order = { mgmt: 0, phys: 1, irb: 2, lo: 3 };
      return order[na] - order[nb];
    }
    if (na === 'irb') return a.length - b.length;
    return J.cmpTokens([a], [b]);
  }

  function cmpUnitKey(a, b) {
    var ia = a.indexOf('.'), ib = b.indexOf('.');
    var pa = ia < 0 ? '' : a.slice(ia + 1), pb = ib < 0 ? '' : b.slice(ib + 1);
    var r = cmpIfname(ia < 0 ? a : a.slice(0, ia), ib < 0 ? b : b.slice(0, ib));
    if (r !== 0) return r;
    if (!pa && !pb) return 0;
    if (!pa) return -1;
    if (!pb) return 1;
    return parseInt(pa, 10) - parseInt(pb, 10);
  }

  // ---------- device spec / port inventory ----------

  function baseInterface(key, name, kind) {
    return {
      name: name,
      kind: kind,
      desc: null,
      adminUp: true,
      linkUp: (kind === 'lo' || kind === 'irb'),
      mac: J.macFor('iface:' + key + ':' + name),
      speed: kind === 'phys' ? '1000mbps' : null,
      mtu: (kind === 'phys' || kind === 'mgmt') ? 1514 : null,
      index: 681 + (J.hash(key + '|' + name) % 220),
      ifIndex: 518 + (J.hash(key + '#snmp:' + name) % 300),
      gen: 130 + (J.hash(key + '#' + name) % 90),
      lastFlapped: null,
      units: {},
      unilist: []
    };
  }

  function unitKey(ifname, uNum) {
    return ifname + '.' + uNum;
  }

  function parseUnit(ifc, uNode, uNum, devKey) {
    var famRoot = db.child(uNode, 'family');
    var famInet = famRoot ? db.child(famRoot, 'inet') : null;
    var famInet6 = famRoot ? db.child(famRoot, 'inet6') : null;
    var famES = famRoot ? db.child(famRoot, 'ethernet-switching') : null;
    var u = {
      num: uNum,
      desc: stmtVal(uNode, 'description'),
      family: famES ? 'ethernet-switching' : (famInet || famInet6 ? 'inet' : null),
      family6: !!(famInet6 && famInet6.children.length),
      addrs: [],
      addrs6: [],
      vlanMembers: [],
      interfaceMode: null,
      mtu: null
    };
    if (famInet) {
      u.mtu = stmtVal(famInet, 'mtu');
      var addr = db.child(famInet, 'address');
      if (addr && !addr.inactive) {
        for (var i = 0; i < addr.children.length; i++) {
          if (!addr.children[i].inactive) u.addrs.push(addr.children[i].name);
        }
      }
    }
    if (famInet6) {
      var addr6 = db.child(famInet6, 'address');
      if (addr6 && !addr6.inactive) {
        for (var k = 0; k < addr6.children.length; k++) {
          if (!addr6.children[k].inactive) u.addrs6.push(addr6.children[k].name);
        }
      }
    }
    if (famES) {
      u.mtu = stmtVal(famES, 'mtu');
      u.interfaceMode = stmtVal(famES, 'interface-mode') || stmtVal(famES, 'port-mode');
      var vlan = db.child(famES, 'vlan');
      if (vlan && !vlan.inactive) {
        var mem = db.child(vlan, 'members');
        if (mem && !mem.inactive) u.vlanMembers = mem.values.slice();
      }
    }
    u.ukey = unitKey(ifc.name, uNum);
    u.mac = J.macFor('unit:' + devKey + ':' + u.ukey);
    ifc.units[uNum] = u;
    ifc.unilist.push(u);
    return u;
  }

  function parseIfcNode(devKey, ifcRoot) {
    var name = ifcRoot.name;
    var kind = ifKind(name);
    var ifc = baseInterface(devKey, name, kind);
    ifc.desc = stmtVal(ifcRoot, 'description');
    ifc.adminUp = !(hasStmt(ifcRoot, 'disable') || hasStmt(ifcRoot, 'disabled'));
    var unitsNode = db.child(ifcRoot, 'unit');
    if (unitsNode && !unitsNode.inactive) {
      for (var i = 0; i < unitsNode.children.length; i++) {
        if (!unitsNode.children[i].inactive) {
          var uNode = unitsNode.children[i];
          var uokay = parseInt(uNode.name, 10);
          if (isNaN(uokay)) uokay = parseInt(uNode.name.replace(/\D/g, ''), 10) || 0;
          parseUnit(ifc, uNode, String(uokay), devKey);
        }
      }
      ifc.unilist.sort(function (a, b) { return parseInt(a.num, 10) - parseInt(b.num, 10); });
    }
    return ifc;
  }

  // ---------- VLAN / bridging ----------

  function parseVlans(root) {
    var out = [];
    var vlansRoot = db.child(root, 'vlans');
    if (!vlansRoot || vlansRoot.inactive) return out;
    for (var i = 0; i < vlansRoot.children.length; i++) {
      if (vlansRoot.children[i].inactive) continue;
      var v = vlansRoot.children[i];
      out.push({
        name: v.name,
        id: parseInt(stmtVal(v, 'vlan-id'), 10) || 0,
        l3: stmtVal(v, 'l3-interface'),
        members: []
      });
    }
    return out;
  }

  // ---------- OSPF config ----------

  function parseOspf(root, ds) {
    var ospfRoot = db.child(root, 'protocols');
    if (!ospfRoot) return null;
    var o = db.child(ospfRoot, 'ospf');
    if (!o || o.inactive || hasStmt(o, 'disable')) return null;
    var out = { ifaces: [], areas: [], routerId: ds.routerId };
    for (var i = 0; i < o.children.length; i++) {
      if (o.children[i].inactive) continue;
      if (o.children[i].name !== 'area') continue;
      var areaNode = o.children[i];
      for (var a = 0; a < areaNode.children.length; a++) {
        var areaId = areaNode.children[a];
        if (areaId.inactive) continue;
        out.areas.push(areaId.name);
        for (var k = 0; k < areaId.children.length; k++) {
          if (areaId.children[k].inactive) continue;
          if (areaId.children[k].name !== 'interface') continue;
          var intNode = areaId.children[k];
          for (var m = 0; m < intNode.children.length; m++) {
            if (intNode.children[m].inactive) continue;
            var ifn = intNode.children[m];
            out.ifaces.push({
              name: ifn.name,
              area: areaId.name,
              passive: hasStmt(ifn, 'passive'),
              metric: stmtVal(ifn, 'metric') || stmtVal(ifn, 'cost'),
              priority: stmtVal(ifn, 'priority'),
              hello: stmtVal(ifn, 'hello-interval'),
              dead: stmtVal(ifn, 'dead-interval')
            });
          }
        }
      }
    }
    return out;
  }

  // ---------- Static routes config ----------

  function parseStatics(root) {
    var out = [];
    var st = go(root, ['routing-options', 'static']);
    if (!st || st.inactive) return out;
    var routes = db.child(st, 'route');
    if (!routes || routes.inactive) return out;
    for (var i = 0; i < routes.children.length; i++) {
      if (routes.children[i].inactive) continue;
      var r = routes.children[i];
      var nh = stmtVal(r, 'next-hop');
      if (nh) {
        var p = J.parseIp(nh);
        out.push({ dest: r.name, via: p ? p.ip : null, mode: 'nh', ip: p ? p.ip : null });
        continue;
      }
      if (hasStmt(r, 'discard')) out.push({ dest: r.name, mode: 'discard', ip: null });
      else if (hasStmt(r, 'reject')) out.push({ dest: r.name, mode: 'reject', ip: null });
    }
    return out;
  }

  // ---------- BGP config ----------

  function parseBgp(root, ds) {
    var pRoot = db.child(root, 'protocols');
    if (!pRoot) return null;
    var b = db.child(pRoot, 'bgp');
    if (!b || b.inactive || hasStmt(b, 'disable')) return null;
    var groups = [];
    var gRoot = db.child(b, 'group');
    if (!gRoot || gRoot.inactive) return { groups: groups };
    for (var i = 0; i < gRoot.children.length; i++) {
      if (gRoot.children[i].inactive) continue;
      var g = gRoot.children[i];
      var gtype = stmtVal(g, 'type');
      if (!gtype) continue;
      var peers = [];
      var nRoot = db.child(g, 'neighbor');
      if (nRoot && !nRoot.inactive) {
        for (var k = 0; k < nRoot.children.length; k++) {
          if (!nRoot.children[k].inactive) peers.push(nRoot.children[k].name);
        }
      }
      groups.push({
        name: g.name,
        type: gtype,
        peerAs: stmtVal(g, 'peer-as'),
        localAddress: stmtVal(g, 'local-address'),
        neighbors: peers
      });
    }
    return { groups: groups };
  }

  // ---------- endpoints in an L2 broadcast domain ----------

  // ---------- Main per-device derivation ----------

  function deriveDevice(ctx, dev) {
    var key = dev.key;
    var cfg = dev.config;
    var spec = JJ.lab.deviceSpec(key);
    var now = ctx.now;

    var ds = {
      key: key,
      model: spec.model,
      serial: spec.serial,
      version: spec.version,
      platform: spec.platform,
      bootAt: dev.bootAt,
      commitCount: dev.commitCount || 0,
      savedFiles: dev.savedFiles || {},
      hostname: cfgVal(cfg, ['system', 'host-name']) || key,

      interfaces: {},
      iflist: [],
      subnets: [],
      vlans: [],
      statics: [],
      routes: [],
      routerId: cfgVal(cfg, ['routing-options', 'router-id']),

      ospf: null,
      ospfNeighbors: [],
      ospfLsas: [],
      bgp: null,
      arp: [],
      lldp: [],
      macTable: [],
      stp: null,

      derivedAt: now
    };

    ds.vlans = parseVlans(cfg);
    ds.statics = parseStatics(cfg);
    ds.bgp = parseBgp(cfg, ds);

    // ----- interfaces (configured + spare ports for realism) -----
    var ifRoot = db.child(cfg, 'interfaces');
    var configured = {};
    if (ifRoot) {
      for (var i = 0; i < ifRoot.children.length; i++) {
        var ifcRoot = ifRoot.children[i];
        configured[ifcRoot.name] = parseIfcNode(key, ifcRoot);
      }
    }
    var n = portCount(spec);
    for (var p = 0; p < n; p++) {
      var pn = 'ge-0/0/' + p;
      if (!configured[pn]) {
        var spare = baseInterface(key, pn, 'phys');
        ifcFinish(key, spare, dev.bootAt);
        ds.interfaces[pn] = spare;
      }
    }
    for (var k in configured) ds.interfaces[k] = configured[k];
    ds.iflist = Object.keys(ds.interfaces).sort(cmpIfname);
    for (var q = 0; q < ds.iflist.length; q++) {
      var ifc2 = ds.interfaces[ds.iflist[q]];
      ifcFinish(key, ifc2, dev.bootAt);
      for (var u = 0; u < ifc2.unilist.length; u++) collectSubnets(ifc2.unilist[u], ifc2, ds);
    }

    // ----- OSPF config -----
    ds.ospf = parseOspf(cfg, ds);
    if (ds.ospf) ds.ospf.enabled = ds.ospf.ifaces.length > 0 && !!ds.routerId;
    if (ds.ospf && !ds.ospf.routerId) ds.ospf.enabled = false;

    buildRoutes(ds, ctx);
    return ds;
  }

  function ifcFinish(key, ifc, bootAt) {
    ifc.lastFlapped = bootAt + J.hash('flap:' + key + ':' + ifc.name) % 4000;
  }

  var bootMap = {};
  function deliverBoot(key) {
    if (!bootMap[key]) bootMap[key] = Date.now() - (300 + J.hash('boot:' + key) % 900) * 1000;
    return bootMap[key];
  }

  function collectSubnets(u, ifc, ds) {
    for (var i = 0; i < u.addrs.length; i++) {
      var cidr = u.addrs[i];
      ds.subnets.push({
        iface: ifc.name,
        unit: u.num,
        ukey: u.ukey,
        cidr: cidr,
        ip: ipOf(cidr),
        prefix: preOf(cidr),
        net: J.netOf(cidr),
        kind: ifc.kind
      });
    }
  }

  // ---------- route building ----------

  function routeAdd(list, r) {
    list.push(r);
  }

  function routeLocalIp(ds, cidr, ukey) {
  return {
    dest: ipOf(cidr) + '/32',
    proto: 'Local',
    pref: 8,
    metric: 0,
    via: ukey,
    to: null,
    local: ipOf(cidr),
    created: ds.bootAt || ds.derivedAt
  };
  }

  function buildRoutes(ds, ctx) {
    var routes = ds.routes;

    for (var i = 0; i < ds.subnets.length; i++) {
      var sn = ds.subnets[i];
      if (sn.kind === 'lo') {
        routeAdd(routes, routeLocalIp(ds, sn.cidr, sn.ukey));
      } else {
        routeLocalIpCheck(ds, routes, sn);
      }
    }
    for (var s = 0; s < ds.statics.length; s++) {
      var st = ds.statics[s];
      var via = null;
      if (st.mode === 'nh' && st.ip) {
        for (var a = 0; a < ds.subnets.length; a++) {
          if (J.inNet(st.ip, ds.subnets[a].cidr)) via = ds.subnets[a].ukey;
        }
      }
      routeAdd(routes, {
        dest: st.dest,
        proto: 'Static',
        pref: 5,
        metric: 0,
        via: via,
        to: st.mode === 'nh' ? st.ip : null,
        mode: st.mode,
        created: ds.derivedAt
      });
    }

    // OSPF routes come after adjacency computation (deriveWorld hook)
    routes.sort(function (a, b) {
      if (J.cmpIpCidr(a.dest, b.dest) !== 0) return J.cmpIpCidr(a.dest, b.dest);
      var ord = { Direct: 0, Local: 1, Static: 2, OSPF: 3 };
      return (ord[a.proto] || 4) - (ord[b.proto] || 4);
    });
  }

  function routeLocalIpCheck(ds, routes, sn) {
      routeAdd(routes, {
        dest: sn.net,
        proto: 'Direct',
        pref: 0,
        metric: 0,
        via: sn.ukey,
        to: null,
        created: ds.bootAt || ds.derivedAt
      });
    routeAdd(routes, routeLocalIp(ds, sn.cidr, sn.ukey));
  }

  // ---------- adjacency + OSPF topology ----------

  function findAdjacencies(world) {
    var list = [];
    var keys = world.deviceKeys;
    for (var i = 0; i < keys.length; i++) {
      for (var k = i + 1; k < keys.length; k++) {
        var a = world.devices[keys[i]], b = world.devices[keys[k]];
        for (var m = 0; m < a.subnets.length; m++) {
          for (var q = 0; q < b.subnets.length; q++) {
            var sa = a.subnets[m], sb = b.subnets[q];
            if (sa.kind === 'lo' || sb.kind === 'lo') continue;
            if (sa.kind === 'mgmt' || sb.kind === 'mgmt') continue;
            if (!sameNet(sa.cidr, sb.cidr)) continue;
            list.push({ u: a, uIf: sa, v: b, vIf: sb, subnet: sa.net });
          }
        }
      }
    }
    // filter pairs to real adjacency: both sides OSPF active on those ifaces
    var real = [];
    for (var z = 0; z < list.length; z++) {
      var e = list[z];
      var oa = ospfIfaceOf(e.u, e.uIf), ob = ospfIfaceOf(e.v, e.vIf);
      if (!oa || !ob) continue;
      if (oa.passive || ob.passive) continue;
      if (!ifcActive(e.u, e.uIf) || !ifcActive(e.v, e.vIf)) continue;
      real.push(e);
    }
    return real;
  }

  function ospfIfaceOf(ds, sn) {    if (!ds.ospf) return null;
    var ukey = sn.ukey;
    for (var i = 0; i < ds.ospf.ifaces.length; i++) {
      if (ds.ospf.ifaces[i].name === ukey) return ds.ospf.ifaces[i];
    }
    return null;
  }

  function ifcActive(ds, sn) {
    var ifc = ds.interfaces[sn.iface];
    if (!ifc) return false;
    if (!ifc.adminUp) return false;
    if (ifc.kind === 'phys' && !ifc.linkUp) return false;
    return true;
  }

  // ---------- world build ----------

  function buildWorld(devs) {
    var lab = JJ.lab;
    var now = Date.now();
    var world = {
      deviceKeys: lab.deviceKeys.slice(),
      devices: {},
      links: lab.topology,
      hosts: lab.hosts,
      domains: [],
      adjacencies: [],
      derivedAt: now
    };
    for (var i = 0; i < world.deviceKeys.length; i++) {
      var k = world.deviceKeys[i];
      var dev = devs[k] || { key: k, config: db.create(null), bootAt: deliverBoot(k), commitCount: 0, savedFiles: {} };
      var ds = deriveDevice({ now: now }, dev);
      ds.world = world;
      world.devices[k] = ds;
    }

    // phys / bridging link state
    computeLinkFlags(world);
    // L2 broadcast domains
    world.domains = computeDomains(world);
    // re-derive link states now that domains are known
    for (var d = 0; d < world.deviceKeys.length; d++) computeDeviceLinkFlags(world, world.deviceKeys[d]);

    // adjacencies
    world.adjacencies = findAdjacencies(world);

    // OSPF LSAs + neighbor tables
    for (var x = 0; x < world.deviceKeys.length; x++) {
      var key2 = world.deviceKeys[x];
      var ds2 = world.devices[key2];
      buildOspfState(world, ds2);
      addOspfRoutes(world, ds2);
    }

    // ARP / LLDP / MAC / STP
    for (var y = 0; y < world.deviceKeys.length; y++) {
      var key3 = world.deviceKeys[y];
      var ds3 = world.devices[key3];
      buildArp(world, ds3);
      buildLldp(world, ds3);
      buildMacTable(world, ds3);
      buildStp(world, ds3);
    }

    // BGP state (needs all devices parsed)
    for (var b = 0; b < world.deviceKeys.length; b++) {
      var key4 = world.deviceKeys[b];
      var ds4 = world.devices[key4];
      buildBgpState(world, ds4);
    }
    return world;
  }

  function computeLinkFlags(world) {
    // mark phys linkUp from direct topology links where other side adminUp
    for (var i = 0; i < world.links.length; i++) {
      var L = world.links[i];
      var da = world.devices[L.a], dbb = world.devices[L.b];
      var ia = da.interfaces[L.aPort], ibd = dbb.interfaces[L.bPort];
      if (ia) ia.linkUp = !!(ibd && ibd.adminUp);
      if (ibd) ibd.linkUp = !!(ia && ia.adminUp);
    }
  }

  function computeDomains(world) {
    var out = [];
    for (var i = 0; i < world.deviceKeys.length; i++) {
      var ds = world.devices[world.deviceKeys[i]];
      for (var v = 0; v < ds.vlans.length; v++) {
        var vlan = ds.vlans[v];
        out.push({ sw: ds.key, vlan: vlan.name, vlanId: vlan.id, ports: vlan.members.slice(), l3: vlan.l3 });
      }
    }
    return out;
  }

  function computeDeviceLinkFlags(world, key) {
    var ds = world.devices[key];
    if (!ds) return;
    for (var i = 0; i < ds.iflist.length; i++) {
      var ifc = ds.interfaces[ds.iflist[i]];
      if (ifc.kind === 'phys') {
        var linked = false;
        for (var z = 0; z < world.links.length; z++) {
          var L = world.links[z];
          var peer = null, peerPort = null;
          if (L.a === key && L.aPort === ifc.name) { peer = L.b; peerPort = L.bPort; }
          else if (L.b === key && L.bPort === ifc.name) { peer = L.a; peerPort = L.aPort; }
          if (!peer) continue;
          var pd = world.devices[peer];
          var pif = pd ? pd.interfaces[peerPort] : null;
          if (pif && pif.adminUp) { linked = true; break; }
        }
        ifc.linkUp = linked;
      } else if (ifc.kind === 'irb') {
        var vlc = hasIrbVlanRef(ds, ifc.name);
        ifc.linkUp = vlc;
      }
    }
    // hosts attach
    for (var h = 0; h < world.hosts.length; h++) {
      var host = world.hosts[h];
      var sd = world.devices[host.sw];
      if (!sd) continue;
      var sif = sd.interfaces[host.port];
      if (sif) sif.linkUp = !!(sif.adminUp && hostVlanActive(sd, host.vlan));
    }
  }

  function hostVlanActive(ds, vlan) {
    for (var i = 0; i < ds.vlans.length; i++) if (ds.vlans[i].name === vlan) return true;
    return false;
  }

  function hasIrbVlanRef(ds, ifname) {
    for (var i = 0; i < ds.vlans.length; i++) if (ds.vlans[i].l3 === ifname) return true;
    return false;
  }

  function buildOspfState(world, ds) {
    ds.ospfNeighbors = [];
    ds.ospfLsas = [];
    if (!ds.ospf || !ds.ospf.enabled) return;

    // neighbor table
    for (var i = 0; i < world.adjacencies.length; i++) {
      var e = world.adjacencies[i];
      if (e.u.key === ds.key) {
        ds.ospfNeighbors.push({
          ip: e.vIf.ip,
          iface: e.uIf.ukey,
          state: 'Full',
          id: e.v.routerId,
          prio: parseInt(e.v.ospf ? (e.v.ospf.ifaces[0] && e.v.ospf.ifaces[0].priority) || '128' : '128', 10) || 128,
          dead: '00:00:36',
          created: ds.derivedAt
        });
      } else if (e.v.key === ds.key) {
        ds.ospfNeighbors.push({
          ip: e.uIf.ip,
          iface: e.vIf.ukey,
          state: 'Full',
          id: e.u.routerId,
          prio: parseInt(e.u.ospf ? (e.u.ospf.ifaces[0] && e.u.ospf.ifaces[0].priority) || '128' : '128', 10) || 128,
          dead: '00:00:36',
          created: ds.derivedAt
        });
      }
    }
    ds.ospfNeighbors.sort(function (a, b) {
      var r = J.cmpIpCidr(a.ip, b.ip);
      return r !== 0 ? r : cmpUnitKey(a.iface, b.iface);
    });

    // Router LSAs
    for (var d = 0; d < world.deviceKeys.length; d++) {
      var other = world.devices[world.deviceKeys[d]];
      if (!other.ospf || !other.ospf.enabled) continue;
      var nbrLinks = 0;
      for (var a = 0; a < world.adjacencies.length; a++) {
        if (world.adjacencies[a].u.key === other.key || world.adjacencies[a].v.key === other.key) nbrLinks++;
      }
      if (nbrLinks === 0) {
        var len2 = 48;
        ds.ospfLsas.push({ type: 'Router', id: other.routerId, advRtr: other.routerId, seq: '0x8000000' + (1 + (other.commitCount % 7)), age: Math.floor((world.derivedAt - other.bootAt) / 1000) % 3600, cksum: '0x' + pad4(J.hash('lsa:' + other.key) % 65536), len: len2 });
        continue;
      }
      var len = 48 + nbrLinks * 12;
      ds.ospfLsas.push({
        type: 'Router',
        id: other.routerId,
        advRtr: other.routerId,
        seq: '0x8000000' + (1 + (other.commitCount % 7)),
        age: Math.floor((world.derivedAt - other.bootAt) / 1000) % 3600,
        cksum: '0x' + pad4(J.hash('lsa:' + other.key) % 65536),
        len: len
      });
    }
    // Net LSAs per multiaccess subnet with 2+ routers
    var seenSubnets = {};
    for (var x = 0; x < world.adjacencies.length; x++) {
      var e2 = world.adjacencies[x];
      var sk = e2.subnet;
      if (seenSubnets[sk]) continue;
      seenSubnets[sk] = 1;
      var sub = pickSubnetHostArr(world, e2);
      if (sub) {
        ds.ospfLsas.push({
          type: 'Net',
          id: sub.ip,
          advRtr: (e2.u.routerId > e2.v.routerId ? e2.u.routerId : e2.v.routerId),
          seq: '0x80000001',
          age: Math.floor((world.derivedAt - ds.bootAt) / 1000) % 3600,
          cksum: '0x' + pad4(J.hash('netlsa:' + e2.subnet) % 65536),
          len: 32
        });
      }
    }
    ds.ospfLsas.sort(function (a, b) {
      if (a.type !== b.type) return a.type === 'Router' ? -1 : 1;
      return J.cmpIpCidr([a.id], [b.id]);
    });
  }

  function pickSubnetHostArr(world, e) {
    var ip1 = e.uIf.ip, ip2 = e.vIf.ip;
    var a = J.ipToInt(ip1), b = J.ipToInt(ip2);
    return a >= b ? e.uIf : e.vIf;
  }

  function addOspfRoutes(world, ds) {
    if (!ds.ospf || !ds.ospf.enabled) return;

    var dist = {}, via = {}, viaIp = {}, done = {};
    dist[ds.key] = 0;
    for (;;) {
      var cur = null, best = Infinity;
      for (var key in dist) {
        if (!done[key] && dist[key] < best) { best = dist[key]; cur = key; }
      }
      if (cur === null) break;
      done[cur] = 1;
      for (var i = 0; i < world.adjacencies.length; i++) {
        var e = world.adjacencies[i];
        var otherKey = null, myIf = null, otherIf = null;
        if (e.u.key === cur) { otherKey = e.v.key; myIf = e.uIf; otherIf = e.vIf; }
        else if (e.v.key === cur) { otherKey = e.u.key; myIf = e.vIf; otherIf = e.uIf; }
        if (!otherKey) continue;
        var nd = dist[cur] + 10;
        if (dist[otherKey] === undefined || nd < dist[otherKey]) {
          dist[otherKey] = nd;
          if (cur === ds.key) {
            via[otherKey] = myIf.ukey;
            viaIp[otherKey] = otherIf.ip;
          } else {
            via[otherKey] = via[cur];
            viaIp[otherKey] = viaIp[cur];
          }
        }
      }
    }

    var seen = {};
    for (var k in done) {
      if (k === ds.key) continue;
      var od = world.devices[k];
      for (var s = 0; s < od.subnets.length; s++) {
        var sn = od.subnets[s];
        var isOwn = false;
        for (var m = 0; m < ds.subnets.length; m++) {
          if (sameNet(ds.subnets[m].cidr, sn.cidr)) { isOwn = true; break; }
        }
        if (isOwn) continue;
        var dest = sn.kind === 'lo' ? ipOf(sn.cidr) + '/32' : sn.net;
        if (seen[dest]) continue;
        seen[dest] = 1;
        ds.routes.push({
          dest: dest,
          proto: 'OSPF',
          pref: 10,
          metric: dist[k] * 10,
          via: via[k],
          to: viaIp[k],
          created: ds.bootAt || ds.derivedAt
        });
      }
    }
    ds.routes.sort(function (a, b) {
      if (J.cmpIpCidr(a.dest, b.dest) !== 0) return J.cmpIpCidr(a.dest, b.dest);
      var ord = { Direct: 0, Local: 1, Static: 2, OSPF: 3 };
      return (ord[a.proto] || 4) - (ord[b.proto] || 4);
    });
  }

  function buildArp(world, ds) {
    ds.arp = [];
    for (var i = 0; i < ds.subnets.length; i++) {
      var sn = ds.subnets[i];
      if (sn.kind === 'lo') continue;
      // neighbor router ifaces
      for (var k = 0; k < world.deviceKeys.length; k++) {
        var od = world.devices[world.deviceKeys[k]];
        if (od.key === ds.key) continue;
        for (var m = 0; m < od.subnets.length; m++) {
          var os = od.subnets[m];
          if (os.kind === 'lo' || os.kind === 'mgmt') continue;
          if (!sameNet(sn.cidr, os.cidr)) continue;
          ds.arp.push({ ip: os.ip, mac: od.interfaces[os.iface].mac, iface: sn.ukey, created: ds.derivedAt });
        }
      }
      // host endpoints on same l2 (bridged)
      for (var h = 0; h < world.hosts.length; h++) {
        var host = world.hosts[h];
        if (!sameNet(sn.cidr, host.ip + '/32')) continue;
        if (hostOnSameL2(world, ds, host, sn)) {
          ds.arp.push({ ip: host.ip, mac: vpcsMacForHost(host), iface: sn.ukey, created: ds.derivedAt });
        }
      }
    }
    ds.arp.sort(function (a, b) { return J.cmpIpCidr(a.ip, b.ip); });
  }

  function hostOnSameL2(world, ds, host, sn) {
    if (sn.kind === 'irb') {
      for (var i = 0; i < ds.vlans.length; i++) {
        if (ds.vlans[i].name === host.vlan && ds.vlans[i].l3 === sn.ukey) return true;
      }
      return false;
    }
    if (sn.kind !== 'phys') return false;
    // ds on a router whose subnet is bridged to host's port vlan
    for (var k = 0; k < world.links.length; k++) {
      var L = world.links[k];
      if (L.l2 !== true) continue;
      var rside = world.devices[L.a] === ds ? { port: L.aPort } : (world.devices[L.b] === ds ? { port: L.bPort } : null);
      if (!rside) continue;
      var swside = L.a === host.sw ? { port: L.aPort } : (L.b === host.sw ? { port: L.bPort } : null);
      if (!swside) continue;
      var sd = world.devices[host.sw];
      var swIf = sd.interfaces[host.port];
      if (!swIf) continue;
      var swu = swIf.units[hostUnitNum(swIf)];
      if (!swu) continue;
      var inVlan = false;
      for (var lv = 0; lv < swu.vlanMembers.length; lv++) if (swu.vlanMembers[lv] === host.vlan) inVlan = true;
      var upIfInVlan = uplinkInVlan(sd, host.vlan);
      if (inVlan && upIfInVlan) return true;
      break;
    }
    return false;
  }

  function hostUnitNum(swIf) {
    var u = '0';
    for (var i = 0; i < swIf.unilist.length; i++) u = swIf.unilist[i].num;
    return u;
  }

  function uplinkInVlan(sd, vlan) {
    // find sw port that is L2 uplink toward router and in same vlan
    for (var i = 0; i < sd.iflist.length; i++) {
      var ifc = sd.interfaces[sd.iflist[i]];
      if (ifc.kind !== 'phys') continue;
      for (var u = 0; u < ifc.unilist.length; u++) {
        for (var m = 0; m < ifc.unilist[u].vlanMembers.length; m++) {
          if (ifc.unilist[u].vlanMembers[m] === vlan) return true;
        }
      }
    }
    return false;
  }

  function buildLldp(world, ds) {
    ds.lldp = [];
    for (var i = 0; i < world.links.length; i++) {
      var L = world.links[i];
      var localIf = null, peerKey = null, peerPort = null;
      if (L.a === ds.key) { localIf = L.aPort; peerKey = L.b; peerPort = L.bPort; }
      else if (L.b === ds.key) { localIf = L.bPort; peerKey = L.a; peerPort = L.aPort; }
      if (!localIf) continue;
      var pd = world.devices[peerKey];
      var myIf = ds.interfaces[localIf];
      if (!myIf || !myIf.adminUp) continue;
      var pif = pd.interfaces[peerPort];
      if (!pif || !pif.adminUp) continue;
      ds.lldp.push({
        localIf: localIf,
        peer: world.devices[peerKey].hostname,
        peerPort: peerPort,
        chassisId: pd.interfaces[peerPort].mac,
        created: ds.derivedAt
      });
    }
    ds.lldp.sort(function (a, b) { return J.cmpTokens([a.localIf], [b.localIf]); });
  }

  function buildMacTable(world, ds) {
    if (ds.platform !== 'ex') { ds.macTable = []; return; }
    ds.macTable = [];
    for (var h = 0; h < world.hosts.length; h++) {
      var host = world.hosts[h];
      var sd = world.devices[host.sw];
      if (!sd || sd.key !== ds.key) continue;
      var sif = sd.interfaces[host.port];
      var hu = null;
      if (sif) for (var u = 0; u < sif.unilist.length; u++) hu = sif.unilist[u];
      if (!hu) continue;
      var inVlan = false;
      for (var lv = 0; lv < hu.vlanMembers.length; lv++) if (hu.vlanMembers[lv] === host.vlan) inVlan = true;
      if (!inVlan) continue;
      var vid = 0;
      for (var b = 0; b < ds.vlans.length; b++) if (ds.vlans[b].name === host.vlan) vid = ds.vlans[b].id;
      ds.macTable.push({ vlan: host.vlan, vlanId: vid, mac: vpcsMacForHost(host), iface: sif.name, type: 'Learn', created: ds.derivedAt });
    }
    // router uplink mac learned on uplink port
    for (var i = 0; i < world.links.length; i++) {
      var L = world.links[i];
      if (L.l2 !== true) continue;
      var mineIsSw = false, rkey = null, rport = null, myPort = null;
      if (L.a === ds.key) { mineIsSw = true; myPort = L.aPort; rkey = L.b; rport = L.bPort; }
      else if (L.b === ds.key) { mineIsSw = true; myPort = L.bPort; rkey = L.a; rport = L.aPort; }
      if (!mineIsSw) continue;
      var rd = world.devices[rkey];
      var rp = rd.interfaces[rport];
      if (!rp) continue;
      var m0 = '0';
      if (rp.unilist && rp.unilist.length) m0 = rp.unilist[0].num;
      var rpn = rp.units[m0];
      if (!rpn) continue;
      var vlans = rpn.vlanMembers || [];
      for (var q = 0; q < vlans.length; q++) {
        var vid2 = vlans[q];
        var idn = 0;
        for (var w2 = 0; w2 < ds.vlans.length; w2++) if (ds.vlans[w2].name === vid2) idn = ds.vlans[w2].id;
        ds.macTable.push({ vlan: vid2, vlanId: idn, mac: rp.mac, iface: rp.name, type: 'Learn', created: ds.derivedAt });
      }
    }
    ds.macTable.sort(function (a, b) {
      if (a.vlanId !== b.vlanId) return a.vlanId - b.vlanId;
      return String(a.mac).localeCompare(String(b.mac));
    });
  }

  function buildStp(world, ds) {
    if (ds.platform !== 'ex') { ds.stp = null; return; }
    var bridgeMac = J.macFor('stp:' + ds.key);
    var root = bridgeMac;
    var ports = [];
    for (var i = 0; i < ds.iflist.length; i++) {
      var ifc = ds.interfaces[ds.iflist[i]];
      if (ifc.kind !== 'phys') continue;
      var state = 'FWD', role = 'Designated';
      var vlans = ifc.unilist && ifc.unilist.length ? ifc.unilist[0].vlanMembers : [];
      if (!ifc.adminUp) state = 'DIS';
      ports.push({ iface: ifc.name, state: state, role: role, cost: 20000, pri: 128 });
    }
    ds.stp = { rootBridgeMac: root, bridgeMac: bridgeMac, pri: 32768, ports: ports, protocol: 'RSTP' };
  }

  function buildBgpState(world, ds) {
    if (!ds.bgp) return;
    for (var g = 0; g < ds.bgp.groups.length; g++) {
      var grp = ds.bgp.groups[g];
      var list = [];
      for (var n = 0; n < grp.neighbors.length; n++) {
        var ip = grp.neighbors[n];
        var peerKey = null;
        for (var d = 0; d < world.deviceKeys.length; d++) {
          var od = world.devices[world.deviceKeys[d]];
          if (od.key === ds.key) continue;
          var isPeer = false;
          for (var s = 0; s < od.subnets.length; s++) {
            if (ipOf(od.subnets[s].cidr) === ip) isPeer = true;
          }
          if (isPeer) peerKey = od.key;
        }
        var peer = peerKey ? world.devices[peerKey] : null;
        var state = 'Idle';
        var upFor = 0;
        if (peer) {
          var peerConfiguredForUs = false;
          for (var pg = 0; pg < (peer.bgp ? peer.bgp.groups.length : 0); pg++) {
            var pgrp = peer.bgp.groups[pg];
            for (var pn = 0; pn < pgrp.neighbors.length; pn++) {
              var pip = pgrp.neighbors[pn];
              for (var sb = 0; sb < ds.subnets.length; sb++) {
                if (ipOf(ds.subnets[sb].cidr) === pip) peerConfiguredForUs = true;
              }
            }
          }
          var hasPeerAs = grp.peerAs && peer.bgp && peer.bgp.groups.length ? true : false;
          var iHaveRoute = false;
          for (var r = 0; r < ds.routes.length; r++) {
            if (ipOf(ds.routes[r].dest) === ip || sameNet(ds.routes[r].dest, ip + '/32')) iHaveRoute = true;
          }
          if (peerConfiguredForUs && hasPeerAs && iHaveRoute && grp.localAddress) {
            state = 'Establ';
            upFor = Math.floor((world.derivedAt - ds.bootAt) / 1000) % 3600;
          } else if (peerConfiguredForUs && hasPeerAs && iHaveRoute) {
            state = 'Active';
          }
        }
        list.push({
          ip: ip,
          peerAs: grp.peerAs,
          state: state,
          upFor: upFor,
          inPkt: 200 + (J.hash('bgp:' + ds.key + ':' + ip) % 80),
          outPkt: 180 + (J.hash('bgpOut:' + ds.key + ':' + ip) % 80),
          flap: 0,
          outQ: 0
        });
      }
      grp.sessions = list;
      if (list.length) ds.bgp.peers = list;
    }
  }

  function vpcsMacForHost(host) {
    if (!host) return J.macFor('hostmac:x');
    var idx = (J.hash(String(host.name)) % 254) + 1;
    var s = (idx < 10) ? '0' + idx : '' + idx;
    return '00:50:79:66:68:' + s;
  }

  function deviceMacForIp(world, ip) {
    if (!world || !ip) return null;
    for (var k = 0; k < world.deviceKeys.length; k++) {
      var ds = world.devices[world.deviceKeys[k]];
      if (!ds) continue;
      for (var s = 0; s < ds.subnets.length; s++) {
        var sn = ds.subnets[s];
        if (sn.ip === ip) {
          if (sn.kind === 'lo') return ds.interfaces['lo0'] ? ds.interfaces['lo0'].mac : null;
          if (sn.kind === 'irb') {
            var ifc = ds.interfaces[sn.iface];
            var u = ifc && ifc.units ? ifc.units[(sn.unit + '')] : null;
            if (u && u.mac) return u.mac;
            if (ifc) return ifc.mac;
            return null;
          }
          var ifc2 = ds.interfaces[sn.iface];
          return ifc2 ? ifc2.mac : null;
        }
      }
    }
    // check hosts
    for (var h = 0; h < world.hosts.length; h++) {
      if (world.hosts[h].ip === ip) return vpcsMacForHost(world.hosts[h]);
    }
    return null;
  }

  // ---------- ping / traceroute resolution ----------

  function bestRoutes(routes, ip) {
    var matches = [];
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      if (J.inNet(ip, r.dest)) matches.push(r);
    }
    if (!matches.length) return [];
    var maxPre = -1;
    for (var m = 0; m < matches.length; m++) {
      var p = preOf(matches[m].dest);
      if (p > maxPre) maxPre = p;
    }
    var out = [];
    for (var k = 0; k < matches.length; k++) {
      if (preOf(matches[k].dest) === maxPre) out.push(matches[k]);
    }
    out.sort(function (a, b) { return a.pref - b.pref; });
    return out;
  }

  function deviceWithIp(world, ip) {
    for (var i = 0; i < world.deviceKeys.length; i++) {
      var ds = world.devices[world.deviceKeys[i]];
      for (var s = 0; s < ds.subnets.length; s++) {
        if (ipOf(ds.subnets[s].cidr) === ip) return { key: world.deviceKeys[i], subnet: ds.subnets[s] };
      }
    }
    return null;
  }

  function deviceWithNet(world, ip) {
    for (var i = 0; i < world.deviceKeys.length; i++) {
      var ds = world.devices[world.deviceKeys[i]];
      for (var s = 0; s < ds.subnets.length; s++) {
        if (ds.subnets[s].kind === 'lo' || ds.subnets[s].kind === 'mgmt') continue;
        if (J.inNet(ip, ds.subnets[s].cidr)) return { key: world.deviceKeys[i], subnet: ds.subnets[s] };
      }
    }
    return null;
  }

  function localSubnetFor(ds, ip) {
    for (var i = 0; i < ds.subnets.length; i++) {
      var sn = ds.subnets[i];
      if (sn.kind === 'lo' || sn.kind === 'mgmt') continue;
      if (J.inNet(ip, sn.cidr)) return sn;
    }
    return null;
  }

  function chooseSource(ds, dstIp, explicitSrc) {
    if (explicitSrc) {
      for (var i = 0; i < ds.subnets.length; i++) {
        if (ipOf(ds.subnets[i].cidr) === explicitSrc) return { ok: true, ip: explicitSrc };
      }
      return { ok: false, requested: explicitSrc };
    }
    var own = localSubnetFor(ds, dstIp);
    if (own) return { ok: true, ip: ipOf(own.cidr) };
    // default: address of iface that owns route to dst
    var bids = bestRoutes(ds.routes, dstIp);
    if (bids.length) {
      var r0 = bids[0];
      if (r0.via) {
        var snr = null;
        for (var q = 0; q < ds.subnets.length; q++) if (ds.subnets[q].ukey === r0.via) snr = ds.subnets[q];
        if (snr) return { ok: true, ip: ipOf(snr.cidr) };
      }
    }
    // fallback: lowest ip address
    var cands = [];
    for (var s = 0; s < ds.subnets.length; s++) {
      if (ds.subnets[s].kind === 'lo') continue;
      cands.push(ds.subnets[s]);
    }
    cands.sort(function (a, b) { return J.cmpIpCidr([a.ip], [b.ip]); });
    if (cands.length) return { ok: true, ip: ipOf(cands[0].cidr) };
    return { ok: true, ip: ipOf(ds.subnets[0].cidr) };
  }

  function tracePath(world, devKey, dstIp) {
    var hops = [];
    var ds = world.devices[devKey];
    var cur = ds;
    var curKey = devKey;
    var guard = 0;
    while (guard++ < 16) {
      var own = localSubnetFor(cur, dstIp);
      if (own) {
        var found = arpEntryFor(cur, dstIp);
        if (found) return { ok: true, hops: hops, responderKey: curKey, responderHost: arpHostOf(world, dstIp) };
        return { ok: false, hops: hops, code: 'nohost' };
      }
      var bids = bestRoutes(cur.routes, dstIp);
      if (!bids.length) return { ok: false, hops: hops, code: 'noroute' };
      var r0 = bids[0];
      if (r0.proto === 'Local') {
        return { ok: true, hops: hops, responderKey: curKey, responderHost: null };
      }
      if (r0.proto === 'Static' && (r0.mode === 'discard' || r0.mode === 'reject')) {
        return { ok: false, hops: hops, code: 'nohost' };
      }
      if (!r0.to) return { ok: false, hops: hops, code: 'nohost' };
      var nextKey = null;
      for (var i = 0; i < world.deviceKeys.length; i++) {
        var od = world.devices[world.deviceKeys[i]];
        for (var s = 0; s < od.subnets.length; s++) {
          if (ipOf(od.subnets[s].cidr) === r0.to) nextKey = world.deviceKeys[i];
        }
      }
      if (!nextKey) return { ok: false, hops: hops, code: 'nohost' };
      hops.push({ dev: curKey, to: r0.to, via: r0.via });
      curKey = nextKey;
      cur = world.devices[nextKey];
    }
    return { ok: false, hops: hops, code: 'loop' };
  }

  function arpEntryFor(ds, ip) {
    for (var i = 0; i < ds.arp.length; i++) if (ds.arp[i].ip === ip) return ds.arp[i];
    return null;
  }

  function arpHostOf(world, ip) {
    for (var i = 0; i < world.hosts.length; i++) {
      if (world.hosts[i].ip === ip) return world.hosts[i];
    }
    return null;
  }

  function pingDev(world, devKey, dstIp, explicitSrc) {
    var ds = world.devices[devKey];
    var p = J.parseIp(dstIp);
    if (!p || p.prefix !== null) return { ok: false, code: 'baddest', src: null, hops: [] };
    var src = chooseSource(ds, dstIp, explicitSrc);
    if (!src.ok) return { ok: false, code: 'badsrc', requested: explicitSrc, hops: [] };
    var res = tracePath(world, devKey, dstIp);
    res.src = src.ip;
    return res;
  }

  // ---------- exposed api ----------

  var api = {
    buildWorld: buildWorld,
    pingDev: pingDev,
    tracePath: tracePath,
    deviceWithIp: deviceWithIp,
    deviceWithNet: deviceWithNet,
    ipOf: ipOf,
    parseOspf: parseOspf,
    deviceMacForIp: deviceMacForIp,
    vpcsMacForHost: vpcsMacForHost
  };

  global.JJ = global.JJ || {};
  global.JJ.net = api;
})(typeof window !== 'undefined' ? window : globalThis);
