(function (global) {
  'use strict';

  var J = global.JJ;
  var APP = J.app = J.app || {};
  var STORAGE_KEY = 'jncia.gns3.project.v2';
  var SNAPSHOT_KEY = 'jncia.gns3.snapshot.v2';
  var STORAGE_VERSION = 2;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function uid(prefix) { return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function pad2(v) { return (v < 10 ? '0' : '') + v; }
  function icon(id, cls) { return '<svg' + (cls ? ' class="' + cls + '"' : '') + '><use href="#i-' + id + '"></use></svg>'; }

  APP.$ = $; APP.$$ = $$; APP.uid = uid; APP.esc = esc; APP.clone = clone;
  APP.clamp = clamp; APP.icon = icon;

  // solid device glyphs (Bootstrap Icons) used in chrome: tree, palette, menus
  var DEVICE_GLYPH = { router: 'b-router', switch: 'b-ethernet', pc: 'b-display', firewall: 'b-shield-lock', server: 'b-server' };

  var TEMPLATES = {
    // routers
    vsrx: { type: 'router', icon: 'router', model: 'vSRX 3.0', vendor: 'Juniper', prefix: 'R', junos: true, platform: 'vsrx' },
    vmx: { type: 'router', icon: 'router', model: 'vMX 21.4', vendor: 'Juniper', prefix: 'R', junos: true, platform: 'vmx' },
    vptx: { type: 'router', icon: 'router', model: 'vPTX 21.4', vendor: 'Juniper', prefix: 'R', junos: true, platform: 'vmx' },
    mx: { type: 'router', icon: 'router', model: 'MX240', vendor: 'Juniper', prefix: 'R', junos: true, platform: 'mx' },
    acx: { type: 'router', icon: 'router', model: 'ACX1100', vendor: 'Juniper', prefix: 'R', junos: true, platform: 'mx' },
    router: { type: 'router', icon: 'router', model: 'Junos Router', vendor: 'Juniper', prefix: 'R', junos: true, platform: 'junos' },
    // switches
    switch: { type: 'switch', icon: 'switch', model: 'EX4300-24T', vendor: 'Juniper', prefix: 'SW', junos: true, platform: 'ex' },
    ex: { type: 'switch', icon: 'switch', model: 'EX4300-24T', vendor: 'Juniper', prefix: 'SW', junos: true, platform: 'ex' },
    ex2300: { type: 'switch', icon: 'switch', model: 'EX2300-24T', vendor: 'Juniper', prefix: 'SW', junos: true, platform: 'ex' },
    ex3400: { type: 'switch', icon: 'switch', model: 'EX3400-24P', vendor: 'Juniper', prefix: 'SW', junos: true, platform: 'ex' },
    qfx: { type: 'switch', icon: 'switch', model: 'QFX5100-48S', vendor: 'Juniper', prefix: 'SW', junos: true, platform: 'ex' },
    vc: { type: 'switch', icon: 'switch', model: 'EX Virtual Chassis', vendor: 'Juniper', prefix: 'SW', junos: true, platform: 'ex' },
    // security
    srx: { type: 'firewall', icon: 'firewall', model: 'SRX300', vendor: 'Juniper', prefix: 'SRX', junos: true, platform: 'srx' },
    srx340: { type: 'firewall', icon: 'firewall', model: 'SRX340', vendor: 'Juniper', prefix: 'SRX', junos: true, platform: 'srx' },
    srxha: { type: 'firewall', icon: 'firewall', model: 'vSRX HA Cluster', vendor: 'Juniper', prefix: 'SRX', junos: true, platform: 'srx' },
    // hosts
    vpcs: { type: 'host', icon: 'pc', model: 'VPCS', vendor: 'Virtual PC', prefix: 'Host', junos: false },
    ubuntu: { type: 'host', icon: 'pc', model: 'Ubuntu 22.04', vendor: 'Linux', prefix: 'Host', junos: false },
    alpine: { type: 'host', icon: 'pc', model: 'Alpine 3.19', vendor: 'Linux', prefix: 'Host', junos: false },
    win: { type: 'host', icon: 'pc', model: 'Windows 11', vendor: 'Microsoft', prefix: 'Win', junos: false },
    srv: { type: 'host', icon: 'server', model: 'Ubuntu Server 22.04', vendor: 'Linux', prefix: 'Srv', junos: false },
    docker: { type: 'host', icon: 'server', model: 'Docker Host', vendor: 'Linux', prefix: 'Host', junos: false },
    pc: { type: 'host', icon: 'pc', model: 'Generic Host', vendor: 'End Device', prefix: 'Host', junos: false }
  };

  var PRESETS = {
    jncia: {
      title: 'JNCIA Basic Routing',
      positions: { R1: { x: 180, y: 132 }, R2: { x: 400, y: 132 }, R3: { x: 620, y: 132 }, SW1: { x: 400, y: 306 }, 'Host-A': { x: 262, y: 458 }, 'Host-B': { x: 540, y: 458 } },
      nodes: [
        { name: 'R1', template: 'vsrx' }, { name: 'R2', template: 'vmx' }, { name: 'R3', template: 'vsrx' },
        { name: 'SW1', template: 'switch' }, { name: 'Host-A', template: 'ubuntu' }, { name: 'Host-B', template: 'vpcs' }
      ],
      topology: [
        { a: 'R1', ap: 'ge-0/0/0', b: 'R2', bp: 'ge-0/0/0', label: '10.0.12.0/30' },
        { a: 'R2', ap: 'ge-0/0/1', b: 'R3', bp: 'ge-0/0/0', label: '10.0.23.0/30' },
        { a: 'R1', ap: 'ge-0/0/1', b: 'SW1', bp: 'ge-0/0/0', label: 'trunk, VLAN 10/20' },
        { a: 'SW1', ap: 'ge-0/0/1', b: 'Host-A', bp: 'eth0', label: 'VLAN 10, staff' },
        { a: 'SW1', ap: 'ge-0/0/2', b: 'Host-B', bp: 'eth0', label: 'VLAN 20, guest' }
      ],
      hosts: [
        { name: 'Host-A', ip: '10.0.3.20', gateway: '10.0.3.2' },
        { name: 'Host-B', ip: '10.1.1.20', gateway: '10.1.1.2' }
      ],
      configs: null,
      tasks: [
        { title: 'Verify OSPF adjacencies', device: 'R1', run: [['show ospf neighbor'], ['show ospf interface']] },
        { title: 'Trace the learned routes', device: 'R1', run: [['show route protocol ospf'], ['show route table inet.0 summary']] },
        { title: 'End-to-end reachability', device: 'Host-A', run: [['ping 10.1.1.20'], ['traceroute 10.1.1.20']] }
      ]
    },
    vlan: {
      title: 'VLAN Trunking & IRB',
      positions: { R1: { x: 174, y: 180 }, R2: { x: 620, y: 142 }, R3: { x: 620, y: 340 }, SW1: { x: 390, y: 260 }, 'Host-A': { x: 250, y: 445 }, 'Host-B': { x: 530, y: 445 } },
      nodes: [
        { name: 'R1', template: 'vsrx' }, { name: 'R2', template: 'vmx' }, { name: 'R3', template: 'vsrx' },
        { name: 'SW1', template: 'switch' }, { name: 'Host-A', template: 'ubuntu' }, { name: 'Host-B', template: 'vpcs' }
      ],
      topology: [
        { a: 'R1', ap: 'ge-0/0/1', b: 'SW1', bp: 'ge-0/0/0', label: 'trunk, VLAN 10/20' },
        { a: 'R1', ap: 'ge-0/0/0', b: 'R2', bp: 'ge-0/0/0', label: '10.0.12.0/30' },
        { a: 'R2', ap: 'ge-0/0/1', b: 'R3', bp: 'ge-0/0/0', label: '10.0.23.0/30' },
        { a: 'SW1', ap: 'ge-0/0/1', b: 'Host-A', bp: 'eth0', label: 'VLAN 10, staff' },
        { a: 'SW1', ap: 'ge-0/0/2', b: 'Host-B', bp: 'eth0', label: 'VLAN 20, guest' }
      ],
      hosts: [
        { name: 'Host-A', ip: '192.168.10.20', gateway: '192.168.10.10' },
        { name: 'Host-B', ip: '192.168.20.20', gateway: '192.168.20.10' }
      ],
      configs: null,
      tasks: [
        { title: 'Inspect VLAN membership', device: 'SW1', run: [['show vlans'], ['show ethernet-switching interfaces']] },
        { title: 'Check learned MACs', device: 'SW1', run: [['show ethernet-switching table']] },
        { title: 'IRB routing view', device: 'R1', run: [['show interfaces irb terse'], ['show route table inet.0 summary']] }
      ]
    },
    ospf: {
      title: 'Static Routes & RIP/OSPF',
      positions: { R1: { x: 195, y: 145 }, R2: { x: 585, y: 145 }, R3: { x: 390, y: 340 }, SW1: { x: 390, y: 480 }, 'Host-A': { x: 210, y: 482 }, 'Host-B': { x: 570, y: 482 } },
      nodes: [
        { name: 'R1', template: 'vsrx' }, { name: 'R2', template: 'vmx' }, { name: 'R3', template: 'vsrx' },
        { name: 'SW1', template: 'switch' }, { name: 'Host-A', template: 'ubuntu' }, { name: 'Host-B', template: 'vpcs' }
      ],
      topology: [
        { a: 'R1', ap: 'ge-0/0/0', b: 'R2', bp: 'ge-0/0/0', label: '10.0.12.0/30' },
        { a: 'R2', ap: 'ge-0/0/1', b: 'R3', bp: 'ge-0/0/0', label: '10.0.23.0/30' },
        { a: 'R3', ap: 'ge-0/0/2', b: 'SW1', bp: 'ge-0/0/0', label: 'trunk, VLAN 10/20' },
        { a: 'SW1', ap: 'ge-0/0/1', b: 'Host-A', bp: 'eth0', label: 'VLAN 10, staff' },
        { a: 'SW1', ap: 'ge-0/0/2', b: 'Host-B', bp: 'eth0', label: 'VLAN 20, guest' }
      ],
      hosts: [
        { name: 'Host-A', ip: '10.0.3.20', gateway: '10.0.3.2' },
        { name: 'Host-B', ip: '10.1.1.20', gateway: '10.1.1.2' }
      ],
      configs: null,
      tasks: [
        { title: 'Static route module', device: 'R1', run: [['show route protocol static'], ['show route hidden']] },
        { title: 'OSPF module', device: 'R2', run: [['show ospf neighbor'], ['show ospf database']] },
        { title: 'End-to-end ping', device: 'Host-A', run: [['ping 10.1.1.20'], ['traceroute 10.1.1.20']] }
      ]
    },
    vlabs: {
      title: 'Juniper vLabs Standard 3-Router Hub',
      positions: { R1: { x: 160, y: 310 }, R2: { x: 390, y: 150 }, R3: { x: 620, y: 310 }, SW1: { x: 390, y: 370 }, 'Host-A': { x: 210, y: 482 }, 'Host-B': { x: 570, y: 482 } },
      nodes: [
        { name: 'R1', template: 'vmx' }, { name: 'R2', template: 'vmx' }, { name: 'R3', template: 'vmx' },
        { name: 'SW1', template: 'switch' }, { name: 'Host-A', template: 'ubuntu' }, { name: 'Host-B', template: 'vpcs' }
      ],
      topology: [
        { a: 'R1', ap: 'ge-0/0/0', b: 'R2', bp: 'ge-0/0/0', label: '10.0.12.0/30' },
        { a: 'R2', ap: 'ge-0/0/1', b: 'R3', bp: 'ge-0/0/0', label: '10.0.23.0/30' },
        { a: 'R2', ap: 'ge-0/0/4', b: 'SW1', bp: 'ge-0/0/0', label: 'trunk, VLAN 10/20' },
        { a: 'SW1', ap: 'ge-0/0/1', b: 'Host-A', bp: 'eth0', label: 'VLAN 10, staff' },
        { a: 'SW1', ap: 'ge-0/0/2', b: 'Host-B', bp: 'eth0', label: 'VLAN 20, guest' }
      ],
      hosts: [
        { name: 'Host-A', ip: '10.0.3.20', gateway: '10.0.3.2' },
        { name: 'Host-B', ip: '10.1.1.20', gateway: '10.1.1.2' }
      ],
      configs: null,
      tasks: [
        { title: 'vLabs standard jump', device: 'R2', run: [['show ospf neighbor'], ['show interfaces terse'], ['show system uptime']] },
        { title: 'Platform inventory', device: 'R1', run: [['show chassis hardware'], ['show version'], ['show system information']] }
      ]
    },
    bgp: {
      title: 'EBGP & BFD Peering',
      positions: { R1: { x: 200, y: 160 }, R2: { x: 560, y: 160 }, 'Host-A': { x: 200, y: 420 }, 'Host-B': { x: 560, y: 420 } },
      nodes: [
        { name: 'R1', template: 'vmx', model: 'vMX 21.4' }, { name: 'R2', template: 'vmx', model: 'vMX 21.4' },
        { name: 'Host-A', template: 'ubuntu' }, { name: 'Host-B', template: 'vpcs' }
      ],
      topology: [
        { a: 'R1', ap: 'ge-0/0/0', b: 'R2', bp: 'ge-0/0/0', label: '10.0.12.0/30, AS65001 ↔ AS65002' },
        { a: 'R1', ap: 'ge-0/0/1', b: 'Host-A', bp: 'eth0', label: '192.168.10.0/24' },
        { a: 'R2', ap: 'ge-0/0/1', b: 'Host-B', bp: 'eth0', label: '192.168.20.0/24' }
      ],
      hosts: [
        { name: 'Host-A', ip: '192.168.10.10', gateway: '192.168.10.1' },
        { name: 'Host-B', ip: '192.168.20.10', gateway: '192.168.20.1' }
      ],
      configs: {
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
      },
      tasks: [
        { title: 'Establish the eBGP session', device: 'R1', run: [['show bgp summary'], ['show bgp neighbor']] },
        { title: 'BFD health for the peer', device: 'R1', run: [['show bfd session'], ['show bfd session detail']] },
        { title: 'Verify exchanged routes', device: 'R1', run: [['show route protocol bgp'], ['show route table inet.0 summary']] },
        { title: 'Announce a new prefix (R2)', device: 'R2', sub: 'configure', run: [['set policy-options policy-statement EXPORT-STATIC term ST1 from route-filter 198.51.100.0/24 exact'], ['set routing-options static route 198.51.100.0/24 next-hop discard'], ['commit']] },
        { title: 'End-to-end via BGP path', device: 'Host-B', run: [['ping 192.168.10.10']] }
      ]
    },
    vsrx: {
      title: 'vSRX Zones, Policies & NAT',
      positions: { FW1: { x: 400, y: 140 }, R1: { x: 660, y: 140 }, 'Host-A': { x: 210, y: 300 }, 'Host-B': { x: 210, y: 470 } },
      nodes: [
        { name: 'FW1', template: 'srx', model: 'vSRX 3.0' }, { name: 'R1', template: 'vmx', model: 'vMX 21.4' },
        { name: 'Host-A', template: 'ubuntu' }, { name: 'Host-B', template: 'vpcs' }
      ],
      topology: [
        { a: 'FW1', ap: 'ge-0/0/0', b: 'R1', bp: 'ge-0/0/0', label: 'UNTRUST, 203.0.113.0/30' },
        { a: 'FW1', ap: 'ge-0/0/1', b: 'Host-A', bp: 'eth0', label: 'TRUST, 192.168.10.0/24' },
        { a: 'FW1', ap: 'ge-0/0/2', b: 'Host-B', bp: 'eth0', label: 'TRUST, 192.168.20.0/24' }
      ],
      hosts: [
        { name: 'Host-A', ip: '192.168.10.10', gateway: '192.168.10.1' },
        { name: 'Host-B', ip: '192.168.20.10', gateway: '192.168.20.1' }
      ],
      configs: {
        FW1: [
          'set system host-name FW1',
          'set interfaces ge-0/0/0 description UNTRUST-UPSTREAM',
          'set interfaces ge-0/0/0 unit 0 family inet address 203.0.113.1/30',
          'set interfaces ge-0/0/1 description TRUST-LAN-A',
          'set interfaces ge-0/0/1 unit 0 family inet address 192.168.10.1/24',
          'set interfaces ge-0/0/2 description TRUST-LAN-B',
          'set interfaces ge-0/0/2 unit 0 family inet address 192.168.20.1/24',
          'set security zones security-zone TRUST interfaces ge-0/0/1',
          'set security zones security-zone TRUST interfaces ge-0/0/2',
          'set security zones security-zone TRUST host-inbound-traffic system-services ping',
          'set security zones security-zone UNTRUST interfaces ge-0/0/0',
          'set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT match source-address any',
          'set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT match destination-address any',
          'set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT match application any',
          'set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT then permit',
          'set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT then permit log',
          'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS match source-address any',
          'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS match destination-address 203.0.113.0/24',
          'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS match application any',
          'set security policies from-zone TRUST to-zone UNTRUST policy WEB-ACCESS then permit',
          'set security policies default-policy deny-all',
          'set security nat source rule-set SNAT from zone TRUST to zone UNTRUST rule SR-1 match source-address 0.0.0.0/0',
          'set security nat source rule-set SNAT from zone TRUST to zone UNTRUST rule SR-1 then source-nat interface',
          'set routing-options static route 0.0.0.0/0 next-hop 203.0.113.2'
        ],
        R1: [
          'set system host-name R1',
          'set interfaces ge-0/0/0 description UPSTREAM-TO-FW1',
          'set interfaces ge-0/0/0 unit 0 family inet address 203.0.113.2/30',
          'set interfaces lo0 unit 0 family inet address 9.9.9.9/32',
          'set routing-options static route 192.168.10.0/24 next-hop 203.0.113.1'
        ]
      },
      tasks: [
        { title: 'Zones & host-inbound', device: 'FW1', run: [['show security zones'], ['show interfaces descriptions']] },
        { title: 'Policies & hit counts', device: 'FW1', run: [['show security policies'], ['show security policies hit-count']] },
        { title: 'Flow sessions & NAT', device: 'FW1', run: [['show security flow session'], ['show security nat source summary']] },
        { title: 'IKE / IPsec baseline', device: 'FW1', run: [['show security ike security-associations'], ['show security ipsec security-associations']] },
        { title: 'Add a deny policy step', device: 'FW1', sub: 'configure', run: [['set security policies from-zone TRUST to-zone UNTRUST policy BLOCK-TELNET match destination-address 203.0.113.0/24'], ['set security policies from-zone TRUST to-zone UNTRUST policy BLOCK-TELNET match source-address any'], ['set security policies from-zone TRUST to-zone UNTRUST policy BLOCK-TELNET match application telnet'], ['set security policies from-zone TRUST to-zone UNTRUST policy BLOCK-TELNET then deny'], ['commit'], ['show security policies']] },
        { title: 'Upstream reachability', device: 'Host-A', run: [['ping 203.0.113.2']] }
      ]
    }
  };

  APP.TEMPLATES = TEMPLATES;
  APP.STORAGE_KEY = STORAGE_KEY;
  APP.SNAPSHOT_KEY = SNAPSHOT_KEY;
  APP.STORAGE_VERSION = STORAGE_VERSION;

  var state = defaultState();
  var runtimes = {};
  var world = null;
  var selectedNodeId = null;
  var selectedLinkId = null;
  var selectedAnnotationId = null;
  var historyStack = [];
  var redoStack = [];
  var saveTimer = null;
  var dirty = false;
  var serverStart = Date.now();

  APP.getState = function () { return state; };
  APP.setState = function (s) { state = normalizeState(s); return state; };
  APP.getWorld = function () { return world; };
  APP.getRuntimes = function () { return runtimes; };
  APP.getSelectedNodeId = function () { return selectedNodeId; };
  APP.getSelectedLinkId = function () { return selectedLinkId; };
  APP.getSelectedAnnotationId = function () { return selectedAnnotationId; };
  APP.setSelectedNodeId = function (id) { selectedNodeId = id; if (id) selectedLinkId = selectedAnnotationId = null; };
  APP.TEMPLATES_BY_KEY = TEMPLATES;
  APP.PRESETS = PRESETS;

  function defaultState() {
    var nodes = [
      makeNode('n-r1', 'R1', 'vsrx', 180, 132, 'running', 5001),
      makeNode('n-r2', 'R2', 'vmx', 400, 132, 'running', 5002),
      makeNode('n-r3', 'R3', 'vsrx', 620, 132, 'running', 5003),
      makeNode('n-sw1', 'SW1', 'switch', 400, 306, 'running', 5004),
      makeNode('n-host-a', 'Host-A', 'ubuntu', 262, 458, 'running', 5005),
      makeNode('n-host-b', 'Host-B', 'vpcs', 540, 458, 'running', 5006)
    ];
    nodes[4].ip = '10.0.3.20'; nodes[4].gateway = '10.0.3.2';
    nodes[5].ip = '10.1.1.20'; nodes[5].gateway = '10.1.1.2';
    return {
      version: STORAGE_VERSION,
      title: 'JNCIA Basic Routing',
      preset: 'jncia',
      nodes: nodes,
      links: [
        makeLink('l-1', 'n-r1', 'ge-0/0/0', 'n-r2', 'ge-0/0/0', '10.0.12.0/30'),
        makeLink('l-2', 'n-r2', 'ge-0/0/1', 'n-r3', 'ge-0/0/0', '10.0.23.0/30'),
        makeLink('l-3', 'n-r1', 'ge-0/0/1', 'n-sw1', 'ge-0/0/0', 'trunk, VLAN 10/20'),
        makeLink('l-4', 'n-sw1', 'ge-0/0/1', 'n-host-a', 'eth0', 'VLAN 10, staff'),
        makeLink('l-5', 'n-sw1', 'ge-0/0/2', 'n-host-b', 'eth0', 'VLAN 20, guest')
      ],
      annotations: [{ id: 'note-1', type: 'text', text: 'JNCIA LAB 01\nOSPF area 0.0.0.0\nR1, R2, R3', x: 64, y: 335, w: 136, h: 68 }],
      view: { zoom: 1, panX: 24, panY: 16 },
      settings: { grid: true, labels: false, leftDock: true, rightDock: true },
      savedAt: null
    };
  }

  function blankState() {
    return {
      version: STORAGE_VERSION,
      title: 'Untitled lab',
      preset: null,
      nodes: [],
      links: [],
      annotations: [],
      view: { zoom: 1, panX: 24, panY: 16 },
      settings: { grid: true, labels: false, leftDock: true, rightDock: true },
      savedAt: null
    };
  }

  function makeNode(id, name, templateKey, x, y, status, port) {
    var t = TEMPLATES[templateKey] || TEMPLATES.router;
    return {
      id: id, name: name, template: templateKey, type: t.type, icon: t.icon,
      model: t.model, vendor: t.vendor, junos: !!t.junos, platform: t.platform || '',
      x: x, y: y, status: status || 'running', consolePort: port || 5000,
      ip: '', gateway: ''
    };
  }
  function makeLink(id, a, aPort, b, bPort, label) {
    return { id: id, a: a, aPort: aPort, b: b, bPort: bPort, label: label || '', status: 'up' };
  }
  APP.makeNode = makeNode;
  APP.makeLink = makeLink;

  function normalizeState(raw) {
    if (!raw || !Array.isArray(raw.nodes)) return defaultState();
    var s = clone(raw);
    s.version = STORAGE_VERSION;
    s.title = s.title || 'Untitled Lab';
    s.preset = s.preset || '';
    s.nodes = s.nodes.map(function (n) {
      n.id = n.id || uid('n');
      n.name = n.name || 'Node';
      n.x = Number(n.x) || 120;
      n.y = Number(n.y) || 120;
      n.status = n.status === 'stopped' || n.status === 'paused' ? n.status : 'running';
      n.consolePort = Number(n.consolePort) || 5000;
      n.type = n.type || 'router';
      n.icon = n.icon || (n.type === 'host' ? 'pc' : n.type === 'switch' ? 'switch' : n.type === 'firewall' ? 'firewall' : 'router');
      n.junos = n.junos !== undefined ? !!n.junos : n.type !== 'host';
      return n;
    });
    s.links = (s.links || []).filter(function (l) { return l && findNodeIn(s, l.a) && findNodeIn(s, l.b); });
    s.annotations = Array.isArray(s.annotations) ? s.annotations : [];
    s.view = s.view || { zoom: 1, panX: 24, panY: 16 };
    s.view.zoom = clamp(Number(s.view.zoom) || 1, .28, 2.4);
    s.view.panX = Number(s.view.panX) || 0;
    s.view.panY = Number(s.view.panY) || 0;
    s.settings = Object.assign({ grid: true, labels: false, leftDock: true, rightDock: true }, s.settings || {});
    // one-time migration: interface labels used to default on; retire the noise once
    if (!s.meta) s.meta = {};
    if (!s.meta.labelsMigrated) { s.settings.labels = false; s.meta.labelsMigrated = true; }
    return s;
  }
  APP.normalizeState = normalizeState;

  function findNodeIn(s, id) { for (var i = 0; i < s.nodes.length; i++) if (s.nodes[i].id === id) return s.nodes[i]; return null; }
  function nodeById(id) { return findNodeIn(state, id); }
  function nodeByName(name) { for (var i = 0; i < state.nodes.length; i++) if (state.nodes[i].name === name) return state.nodes[i]; return null; }
  function linkById(id) { for (var i = 0; i < state.links.length; i++) if (state.links[i].id === id) return state.links[i]; return null; }
  APP.nodeById = nodeById; APP.nodeByName = nodeByName; APP.linkById = linkById;
  APP.selectedNode = function () { return nodeById(selectedNodeId); };

  // ---------------------------------------------------------------- chrome
  function toast(msg, kind, iconName) {
    var host = $('#toastHost');
    if (!host) return;
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || 'info');
    t.innerHTML = icon(iconName || (kind === 'error' ? 'warning' : kind === 'success' ? 'check' : 'help')) + '<span class="toast-msg">' + esc(msg) + '</span><button class="toast-close" title="Dismiss">' + icon('close') + '</button>';
    host.appendChild(t);
    var remove = function () { t.style.opacity = '0'; t.style.transform = 'translateY(4px)'; setTimeout(function () { t.remove(); }, 160); };
    t.querySelector('.toast-close').addEventListener('click', remove);
    setTimeout(remove, kind === 'error' ? 6000 : 3400);
  }
  APP.toast = toast;

  function setStatus(msg) {
    var el = $('#statusMessage');
    if (el) el.textContent = msg;
  }
  APP.setStatus = setStatus;

  function updateProjectChrome() {
    var title = state.title || 'Untitled Lab';
    if ($('#workspaceTabTitle')) $('#workspaceTabTitle').textContent = title;
    document.title = title + ' - SharkLab Studio';
    $$('.preset-card').forEach(function (b) { b.classList.toggle('active', b.dataset.preset === state.preset); });
  }

  function updateCounts() {
    var n = state.nodes.length, l = state.links.length;
    if ($('#statusNodes')) $('#statusNodes').textContent = n;
    if ($('#statusLinks')) $('#statusLinks').textContent = l;
    if ($('#topoCount')) $('#topoCount').textContent = n;
    var running = state.nodes.filter(function (x) { return x.status === 'running'; }).length;
    if ($('#statusRunning')) $('#statusRunning').textContent = running + '/' + n + ' running';
    var runItem = document.querySelector('.status-run');
    if (runItem) runItem.classList.toggle('off', !n || running < n);
  }

  function markDirty() {
    dirty = true;
    var el = $('#saveState');
    if (el) { el.style.color = '#a9a294'; el.innerHTML = icon('save') + '<span>Unsaved</span>'; }
  }
  function setSaved() {
    dirty = false;
    var el = $('#saveState');
    if (el) { el.style.color = ''; el.innerHTML = icon('check') + '<span>Saved</span>'; }
  }
  APP.markDirty = markDirty;

  // ------------------------------------------------------------- persistence
  function createRuntime(node) {
    if (!node || !node.junos) return null;
    var rt = null;
    try { rt = J.machine.createDeviceRuntime(node.name); } catch (e) { rt = null; }
    if (!rt) return null;
    if (!rt.spec) rt.spec = {};
    rt.spec.model = node.model || rt.spec.model;
    rt.spec.version = '21.4R1';
    // a switch placed from the palette must really behave like a switch
    if (node.platform === 'ex') rt.spec.platform = 'ex';
    else if (!rt.spec.platform) rt.spec.platform = node.platform || 'mx';
    rt.key = node.name;
    rt.running = node.status !== 'stopped';
    runtimes[node.name] = rt;
    return rt;
  }
  APP.createRuntime = createRuntime;
  APP.ensureRuntime = function (node) {
    if (!node || !node.junos) return null;
    return runtimes[node.name] || createRuntime(node);
  };

  function createAllRuntimes() {
    runtimes = {};
    for (var i = 0; i < state.nodes.length; i++) if (state.nodes[i].junos) createRuntime(state.nodes[i]);
  }
  APP.createAllRuntimes = createAllRuntimes;

  function collectConfigs() {
    var out = {};
    for (var k in runtimes) {
      if (!runtimes[k]) continue;
      out[k] = {
        committed: runtimes[k].committed, candidate: runtimes[k].candidate,
        bootAt: runtimes[k].bootAt, lastConfigured: runtimes[k].lastConfigured,
        commitCount: runtimes[k].commitCount || 0
      };
    }
    return out;
  }

  function restoreRuntimeConfigs(configs) {
    var names = Object.keys(configs || {});
    for (var i = 0; i < names.length; i++) {
      var n = nodeByName(names[i]);
      if (!n || !n.junos) continue;
      var rt = createRuntime(n);
      var cfg = configs[names[i]];
      if (rt && cfg) {
        if (cfg.committed) rt.committed = cfg.committed;
        if (cfg.candidate) rt.candidate = cfg.candidate;
        if (cfg.bootAt) rt.bootAt = cfg.bootAt;
        if (cfg.lastConfigured) rt.lastConfigured = cfg.lastConfigured;
        if (cfg.commitCount != null) rt.commitCount = cfg.commitCount;
        rt.config = rt.committed;
      }
    }
  }

  function collectProject() {
    return {
      format: 'gns3-junos-lab', version: STORAGE_VERSION, savedAt: new Date().toISOString(),
      project: {
        version: state.version, title: state.title, preset: state.preset,
        nodes: state.nodes, links: state.links, annotations: state.annotations,
        view: state.view, settings: state.settings, savedAt: state.savedAt
      },
      runtime: collectConfigs()
    };
  }
  APP.collectProject = collectProject;

  APP.saveProject = function (silent) {
    try {
      state.savedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(collectProject()));
      setSaved();
      if (!silent) toast('Project saved to this browser', 'success', 'check');
    } catch (e) { toast('Could not save the project: ' + e.message, 'error', 'warning'); }
  };

  function scheduleSave() {
    markDirty();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { APP.saveProject(true); }, 1200);
  }
  APP.scheduleSave = scheduleSave;

  // Everything on the canvas that the fixed lab definition does not already
  // know about: extra devices, their cables, and host endpoints.
  function worldInputs() {
    var byId = {}, i;
    for (i = 0; i < state.nodes.length; i++) byId[state.nodes[i].id] = state.nodes[i];
    var keys = [], links = [], hosts = [];
    for (i = 0; i < state.nodes.length; i++) {
      var n = state.nodes[i];
      if (n.junos) keys.push(n.name);
      if (n.type !== 'host') continue;
      var endpoint = null;
      for (var j = 0; j < state.links.length; j++) {
        var l = state.links[j];
        var side = l.a === n.id ? 'a' : (l.b === n.id ? 'b' : null);
        if (!side) continue;
        var peer = byId[side === 'a' ? l.b : l.a];
        if (!peer || peer.type !== 'switch') continue;
        endpoint = { sw: peer.name, port: side === 'a' ? l.bPort : l.aPort };
        break;
      }
      if (!endpoint) continue;
      hosts.push({ name: n.name, sw: endpoint.sw, port: endpoint.port, ip: n.ip || '', gateway: n.gateway || '' });
    }
    for (i = 0; i < state.links.length; i++) {
      var lk = state.links[i];
      var a = byId[lk.a], b = byId[lk.b];
      // host cabling is expressed through `hosts`, not as a device-to-device link
      if (!a || !b || !a.junos || !b.junos) continue;
      // a switch port facing a routed device is the L2 uplink the world knows
      var l2 = (a.type === 'switch') !== (b.type === 'switch');
      links.push({ a: a.name, aPort: lk.aPort, b: b.name, bPort: lk.bPort, l2: l2 });
    }
    return { deviceKeys: keys, links: links, hosts: hosts };
  }
  APP.worldInputs = worldInputs;

  function rebuildWorld() {
    try {
      var devs = {};
      for (var k in runtimes) if (runtimes[k]) devs[k] = runtimes[k];
      var extra = null;
      try { extra = worldInputs(); } catch (e) { extra = null; }
      world = J.machine.buildWorldFromDevs ? J.machine.buildWorldFromDevs(devs, extra) : J.machine.getWorld();
    } catch (e) { world = { devices: {}, deviceKeys: [] }; }
    return world;
  }
  APP.rebuildWorld = rebuildWorld;
  APP.worldDevice = function (name) { return world && world.devices ? world.devices[name] : null; };

  APP.loadProjectData = function (data, message) {
    if (!data || !data.project) throw new Error('Not a GNS3 Junos Lab project');
    if (APP.closeAllTerminals) APP.closeAllTerminals(true);
    state = normalizeState(data.project);
    try { J._rts = {}; } catch (e) {}
    runtimes = {};
    createAllRuntimes();
    restoreRuntimeConfigs(data.runtime || {});
    rebuildWorld();
    selectedNodeId = selectedLinkId = selectedAnnotationId = null;
    APP.renderAll(true);
    markDirty(); scheduleSave();
    if (message) toast(message, 'success', 'check');
  };

  APP.resetProject = function (title, blank) {
    if (APP.closeAllTerminals) APP.closeAllTerminals(true);
    try { J._rts = {}; } catch (e) {}
    runtimes = {};
    state = blank ? blankState() : defaultState();
    if (title) state.title = title;
    createAllRuntimes();
    rebuildWorld();
    selectedNodeId = selectedLinkId = selectedAnnotationId = null;
    APP.renderAll(true);
    markDirty(); scheduleSave();
  };

  // preset bootstrap: wipe every device runtime and rebuild committed configs
  APP.clearRuntimes = function () {
    runtimes = {};
    try { if (J._rts) { for (var k in J._rts) delete J._rts[k]; } } catch (e) {}
  };

  APP.resetRuntime = function (name, setLines, presetTitle, node) {
    var n = node || nodeByName(name);
    if (!n || !n.junos) return null;
    var rt = createRuntime(n);
    if (!rt) return null;
    if (Array.isArray(setLines) && setLines.length) {
      try {
        var fresh = J.machine.buildRootFromSetLines(setLines);
        var committed = J.db ? J.db.clone(fresh) : JSON.parse(JSON.stringify(fresh));
        rt.committed = committed;
        rt.config = committed;
        rt.candidate = J.db ? J.db.clone(fresh) : JSON.parse(JSON.stringify(fresh));
        rt.revisions = [J.db ? J.db.clone(fresh) : JSON.parse(JSON.stringify(fresh))];
        rt.files = {};
        rt.protectedPaths = [];
      } catch (e) {}
      var stamp = Date.now();
      rt.bootAt = stamp - 180000;
      rt.lastConfigured = rt.bootAt + 60000;
      rt.commitCount = 1;
      rt.commitLog = [{ time: stamp, by: 'root', comment: 'preset: ' + (presetTitle || 'baseline') }];
    }
    if (rt.spec) {
      if (n.model) rt.spec.model = n.model;
      if (n.platform) rt.spec.platform = n.platform;
    }
    return rt;
  };

  APP.restoreSnapshot = function () {
    try {
      var raw = localStorage.getItem(SNAPSHOT_KEY);
      if (!raw) { toast('No snapshot has been saved yet', 'warn', 'warning'); return; }
      APP.loadProjectData(JSON.parse(raw), 'Snapshot restored');
    } catch (e) { toast('Snapshot restore failed: ' + e.message, 'error', 'warning'); }
  };

  APP.bootCore = function () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var project = parsed && parsed.project ? parsed.project : parsed;
        if (project && project.nodes) {
          state = normalizeState(project);
          createAllRuntimes();
          if (parsed && parsed.runtime) restoreRuntimeConfigs(parsed.runtime);
        }
      }
    } catch (e) { state = defaultState(); }
    if (!runtimes || !Object.keys(runtimes).length) createAllRuntimes();
    rebuildWorld();
    APP.applyView();
    setSaved();
    serverStart = Date.now();
  };

  // ---------------------------------------------------------------- history
  APP.captureHistory = function () {
    historyStack.push(clone(state));
    if (historyStack.length > 50) historyStack.shift();
    redoStack.length = 0;
  };
  APP.undo = function () {
    if (!historyStack.length) { toast('Nothing to undo', 'info', 'help'); return; }
    redoStack.push(clone(state));
    state = normalizeState(historyStack.pop());
    if (APP.closeAllTerminals) APP.closeAllTerminals(true);
    rebuildWorld();
    APP.renderAll();
    scheduleSave();
    toast('Undo', 'info', 'reload');
  };
  APP.redo = function () {
    if (!redoStack.length) { toast('Nothing to redo', 'info', 'help'); return; }
    historyStack.push(clone(state));
    state = normalizeState(redoStack.pop());
    if (APP.closeAllTerminals) APP.closeAllTerminals(true);
    rebuildWorld();
    APP.renderAll();
    scheduleSave();
    toast('Redo', 'info', 'reload');
  };

  // ----------------------------------------------------------------- render
  function renderCanvasSettings() {
    var cv = $('#canvas');
    if (!cv) return;
    cv.classList.toggle('no-grid', !state.settings.grid);
    cv.classList.toggle('no-labels', !state.settings.labels);
    // labels toggle must rebuild the link SVG: port labels are no longer drawn when hidden
    APP.render.links();
    var gridItem = document.querySelector('[data-check="grid"]'); if (gridItem) gridItem.classList.toggle('checked', !!state.settings.grid);
    var labelItem = document.querySelector('[data-check="labels"]'); if (labelItem) labelItem.classList.toggle('checked', !!state.settings.labels);
    applyView();
  }
  APP.renderCanvasSettings = renderCanvasSettings;

  function nodeIconBase(node) {
    return node.icon || (node.type === 'host' ? 'pc' : node.type === 'switch' ? 'switch' : node.type === 'firewall' ? 'firewall' : 'router');
  }
  function nodeIconId(node) { return 'node-' + nodeIconBase(node); }
  function deviceGlyph(node) { return DEVICE_GLYPH[nodeIconBase(node)] || 'b-router'; }
  APP.nodeIconId = nodeIconId;
  APP.deviceGlyph = deviceGlyph;
  APP.glyph = function (id) { return '<svg><use href="#' + id + '"></use></svg>'; };

  function renderNodes() {
    var layer = $('#nodeLayer');
    if (!layer) return;
    var html = '';
    state.nodes.forEach(function (n) {
      html += '<div class="node ' + esc(n.status) + (selectedNodeId === n.id ? ' selected' : '') + (n.booting ? ' booting' : '') + '" data-node-id="' + esc(n.id) + '" style="left:' + n.x + 'px;top:' + n.y + 'px" title="' + esc(n.name + ', ' + n.model + ', ' + n.status) + '">' +
        '<div class="node-card"><div class="node-status"></div><div class="node-icon ' + esc(nodeIconBase(n)) + '">' + icon(nodeIconId(n)) + '</div><div class="node-label">' + esc(n.name) + '</div><div class="node-sub">' + esc(n.model || n.type) + '</div></div></div>';
    });
    layer.innerHTML = html;
    $$('.node', layer).forEach(bindNodeEvents);
  }

  function nodeRadius(node) {
    if (node.type === 'switch') return 36;
    if (node.type === 'host') return 30;
    if (node.type === 'firewall') return 29;
    return 30;
  }

  function renderLinks() {
    var layer = $('#linkLayer');
    if (!layer) return;
    var html = '';
    var showLabels = !!(state.settings && state.settings.labels);
    state.links.forEach(function (l) {
      var a = nodeById(l.a), b = nodeById(l.b);
      if (!a || !b) return;
      var up = a.status !== 'stopped' && b.status !== 'stopped';
      l.status = up ? 'up' : 'down';
      var geo = linkGeometry(a, b, l);
      html += '<g class="link-group" data-link-id="' + esc(l.id) + '"><path class="link-hit" d="' + geo.d + '"></path><path class="link-under" d="' + geo.d + '"></path><path class="link-cable ' + (up ? 'up' : 'down') + (selectedLinkId === l.id ? ' selected' : '') + '" d="' + geo.d + '"></path>' +
        endpoint(geo.x1, geo.y1, up) + endpoint(geo.x2, geo.y2, up) +
        (showLabels ? portLabel(geo.x1, geo.y1, l.aPort, geo.px1, geo.py1) + portLabel(geo.x2, geo.y2, l.bPort, geo.px2, geo.py2) : '') +
        (showLabels && l.label ? '<rect class="link-label-bg" x="' + (geo.cx - Math.max(36, String(l.label).length * 5.6 + 14) / 2) + '" y="' + (geo.cy + 10) + '" width="' + Math.max(36, String(l.label).length * 5.6 + 14) + '" height="14" rx="7"></rect><text class="link-label-text" x="' + geo.cx + '" y="' + (geo.cy + 20.4) + '" text-anchor="middle">' + esc(l.label) + '</text>' : '') + '</g>';
    });
    layer.innerHTML = html;
    $$('.link-hit', layer).forEach(function (el) {
      el.addEventListener('click', function (e) { e.stopPropagation(); selectLink(el.parentNode.dataset.linkId); });
      el.addEventListener('contextmenu', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (APP.showLinkMenu) APP.showLinkMenu(el.parentNode.dataset.linkId, e.clientX, e.clientY);
      });
    });
  }

  function endpoint(x, y, up) {
    return '<circle class="link-ring ' + (up ? 'up' : 'down') + '" cx="' + x + '" cy="' + y + '" r="3.3"></circle><circle class="link-dot ' + (up ? 'up' : 'down') + '" cx="' + x + '" cy="' + y + '" r="1.65"></circle>';
  }

  function portLabel(x, y, text, px, py) {
    var w = Math.max(26, String(text).length * 6 + 10);
    return '<g class="link-port-label"><rect class="link-port-bg" x="' + (x + px * 14 - w / 2) + '" y="' + (y + py * 15 - 6.5) + '" width="' + w + '" height="13" rx="4"></rect><text x="' + (x + px * 14) + '" y="' + (y + py * 15 + 3.2) + '" text-anchor="middle">' + esc(text) + '</text></g>';
  }

  function linkGeometry(a, b, l) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    var ux = dx / dist, uy = dy / dist;
    var ra = nodeRadius(a), rb = nodeRadius(b);
    var x1 = a.x + ux * ra, y1 = a.y + uy * ra;
    var x2 = b.x - ux * rb, y2 = b.y - uy * rb;
    var bend = ((J.hash ? J.hash(l.id) : 3) % 9) - 4;
    var nx = -uy, ny = ux;
    var c1x = x1 + (x2 - x1) * .34 + nx * bend, c1y = y1 + (y2 - y1) * .34 + ny * bend;
    var c2x = x1 + (x2 - x1) * .68 + nx * bend, c2y = y1 + (y2 - y1) * .68 + ny * bend;
    return {
      x1: x1, y1: y1, x2: x2, y2: y2, px1: -nx, py1: -ny, px2: nx, py2: ny,
      cx: (x1 + x2) / 2 + nx * bend * .65, cy: (y1 + y2) / 2 + ny * bend * .65,
      d: 'M ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' C ' + c1x.toFixed(2) + ' ' + c1y.toFixed(2) + ', ' + c2x.toFixed(2) + ' ' + c2y.toFixed(2) + ', ' + x2.toFixed(2) + ' ' + y2.toFixed(2)
    };
  }

  function renderAnnotations() {
    var layer = $('#annotationLayer');
    if (!layer) return;
    var html = '';
    state.annotations.forEach(function (a) {
      var sel = selectedAnnotationId === a.id ? ' selected' : '';
      if (a.type === 'rectangle') {
        html += '<g data-annotation-id="' + esc(a.id) + '" class="annotation"' + sel + '><rect x="' + a.x + '" y="' + a.y + '" width="' + a.w + '" height="' + a.h + '" rx="5" fill="rgba(255,255,255,.045)" stroke="rgba(255,255,255,.4)" stroke-width="1.4" stroke-dasharray="6 4"></rect><text class="annotation-text" x="' + (a.x + 8) + '" y="' + (a.y + 17) + '">' + esc(a.text || '') + '</text></g>';
      } else if (a.type === 'ellipse') {
        html += '<g data-annotation-id="' + esc(a.id) + '" class="annotation"' + sel + '><ellipse cx="' + (a.x + a.w / 2) + '" cy="' + (a.y + a.h / 2) + '" rx="' + Math.abs(a.w / 2) + '" ry="' + Math.abs(a.h / 2) + '" fill="rgba(255,255,255,.04)" stroke="rgba(255,255,255,.32)" stroke-width="1.4" stroke-dasharray="6 4"></ellipse><text class="annotation-text" x="' + (a.x + 8) + '" y="' + (a.y + 17) + '">' + esc(a.text || '') + '</text></g>';
      } else if (a.type === 'line') {
        html += '<g data-annotation-id="' + esc(a.id) + '" class="annotation"' + sel + '><line x1="' + a.x + '" y1="' + a.y + '" x2="' + a.x2 + '" y2="' + a.y2 + '" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-linecap="round"></line><circle cx="' + a.x + '" cy="' + a.y + '" r="2.5" fill="rgba(255,255,255,.55)"></circle><circle cx="' + a.x2 + '" cy="' + a.y2 + '" r="2.5" fill="rgba(255,255,255,.55)"></circle></g>';
      } else {
        var lines = String(a.text || '').split('\n');
        var w = a.w || 150, h = a.h || 58;
        var txt = '';
        for (var i = 0; i < Math.min(lines.length, 6); i++) txt += '<tspan x="' + (a.x + 12) + '" dy="' + (i === 0 ? 20 : 15) + '">' + esc(lines[i]) + '</tspan>';
        html += '<g data-annotation-id="' + esc(a.id) + '" class="annotation" style="cursor:move"' + sel + '><rect class="annotation-note" x="' + a.x + '" y="' + a.y + '" width="' + w + '" height="' + h + '" rx="7"></rect><text class="annotation-note-text" x="' + (a.x + 12) + '" y="' + (a.y + 2) + '">' + txt + '</text></g>';
      }
    });
    layer.innerHTML = html;
    $$('.annotation', layer).forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        selectedAnnotationId = el.dataset.annotationId;
        selectedNodeId = selectedLinkId = null;
        renderNodes(); renderLinks(); renderAnnotations(); APP.updateSelectionStatus();
        setStatus('Annotation selected, press Delete to remove');
      });
    });
  }

  function renderTopologyTree() {
    var el = $('#topologyTree');
    if (!el) return;
    if (!state.nodes.length) { el.innerHTML = '<div class="topo-empty">No nodes in this project.</div>'; return; }
    var html = '';
    state.nodes.forEach(function (n) {
      html += '<div class="topo-node ' + esc(n.status) + (selectedNodeId === n.id ? ' selected' : '') + '" data-tree-node="' + esc(n.id) + '" title="Console: telnet localhost:' + n.consolePort + '"><span class="topo-mini-icon">' + APP.glyph(deviceGlyph(n)) + '</span><span class="topo-name"><span class="status-dot"></span>' + esc(n.name) + '</span><span class="topo-sub">' + esc(n.status === 'running' ? 'Running' : n.status === 'paused' ? 'Paused' : 'Stopped') + '</span><span class="topo-actions"><button class="topo-action" data-tree-action="console" title="Open console">' + icon('terminal') + '</button><button class="topo-action" data-tree-action="toggle" title="Start / pause">' + icon(n.status === 'running' ? 'pause' : 'play') + '</button></span></div>';
    });
    el.innerHTML = html;
    $$('.topo-node', el).forEach(function (row) {
      var id = row.dataset.treeNode;
      row.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-tree-action]');
        if (btn) {
          e.stopPropagation();
          if (btn.dataset.treeAction === 'console') { if (APP.openConsoleById) APP.openConsoleById(id); }
          else {
            var n = nodeById(id);
            if (!n) return;
            if (n.status === 'running') pauseNode(id); else startNode(id);
          }
          return;
        }
        selectNode(id);
        focusNode(id);
      });
    });
  }
  APP.renderTopologyTree = renderTopologyTree;

  function renderAll(fit) {
    renderCanvasSettings();
    renderNodes();
    renderLinks();
    renderAnnotations();
    renderTopologyTree();
    if (APP.renderTabs) APP.renderTabs();
    updateProjectChrome();
    updateCounts();
    if (fit) setTimeout(fitView, 30);
  }
  APP.renderAll = renderAll;

  // ---------------------------------------------------------------- viewport
  function applyView() {
    var v = state.view;
    var vp = $('#viewport');
    if (vp) vp.style.transform = 'translate(' + v.panX + 'px,' + v.panY + 'px) scale(' + v.zoom + ')';
    var grid = $('#gridLayer');
    if (grid) {
      var size = 20 * v.zoom;
      grid.style.backgroundSize = size + 'px ' + size + 'px';
      grid.style.backgroundPosition = v.panX + 'px ' + v.panY + 'px';
    }
    var pct = Math.round(v.zoom * 100) + '%';
    if ($('#zoomReadout')) $('#zoomReadout').textContent = pct;
    if ($('#statusZoom')) $('#statusZoom').textContent = pct;
  }
  APP.applyView = applyView;

  function zoomAt(newZoom, sx, sy) {
    var cv = $('#canvas');
    if (!cv) return;
    var r = cv.getBoundingClientRect();
    sx = sx == null ? r.width / 2 : sx;
    sy = sy == null ? r.height / 2 : sy;
    newZoom = clamp(newZoom, .28, 2.4);
    var wx = (sx - state.view.panX) / state.view.zoom;
    var wy = (sy - state.view.panY) / state.view.zoom;
    state.view.zoom = newZoom;
    state.view.panX = sx - wx * newZoom;
    state.view.panY = sy - wy * newZoom;
    applyView(); scheduleSave();
  }
  APP.zoomAt = zoomAt;
  APP.zoomBy = function (factor) {
    var cv = $('#canvas');
    var r = cv ? cv.getBoundingClientRect() : { width: 800, height: 600 };
    zoomAt(state.view.zoom * factor, r.width / 2, r.height / 2);
  };

  function fitView() {
    if (!state.nodes.length) { state.view = { zoom: 1, panX: 40, panY: 30 }; applyView(); return; }
    var cv = $('#canvas');
    if (!cv) return;
    var cw = cv.clientWidth, ch = cv.clientHeight;
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.nodes.forEach(function (n) {
      minX = Math.min(minX, n.x - 68); maxX = Math.max(maxX, n.x + 68);
      minY = Math.min(minY, n.y - 62); maxY = Math.max(maxY, n.y + 62);
    });
    state.annotations.forEach(function (a) {
      minX = Math.min(minX, a.x - 20); maxX = Math.max(maxX, a.x + (a.w || 130) + 20);
      minY = Math.min(minY, a.y - 20); maxY = Math.max(maxY, a.y + (a.h || 58) + 20);
    });
    var bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
    var z = clamp(Math.min((cw - 110) / bw, (ch - 100) / bh), .35, 1.45);
    state.view.zoom = z;
    state.view.panX = (cw - bw * z) / 2 - minX * z;
    state.view.panY = (ch - bh * z) / 2 - minY * z;
    applyView(); scheduleSave();
    setStatus('Topology fitted to screen');
  }
  APP.fitView = fitView;
  APP.focusNode = function (id) {
    var n = nodeById(id); if (!n) return;
    var cv = $('#canvas'); if (!cv) return;
    state.view.panX = cv.clientWidth / 2 - n.x * state.view.zoom;
    state.view.panY = cv.clientHeight / 2 - n.y * state.view.zoom;
    applyView(); scheduleSave();
  };

  function screenToWorld(clientX, clientY) {
    var r = $('#canvas').getBoundingClientRect();
    return { x: (clientX - r.left - state.view.panX) / state.view.zoom, y: (clientY - r.top - state.view.panY) / state.view.zoom };
  }
  APP.screenToWorld = screenToWorld;

  // --------------------------------------------------------------- selection
  function selectNode(id) {
    selectedNodeId = id; selectedLinkId = null; selectedAnnotationId = null;
    renderNodes(); renderLinks(); renderAnnotations(); renderTopologyTree(); APP.updateSelectionStatus();
    if (APP.syncSelection) APP.syncSelection();
  }
  function selectLink(id) {
    selectedLinkId = id; selectedNodeId = null; selectedAnnotationId = null;
    renderNodes(); renderLinks(); renderAnnotations(); renderTopologyTree(); APP.updateSelectionStatus();
    var l = linkById(id);
    if (l) setStatus('Link ' + l.aPort + ' ↔ ' + l.bPort + ' selected, ' + l.status.toUpperCase());
  }
  APP.selectNode = selectNode; APP.selectLink = selectLink;

  APP.updateSelectionStatus = function (mx, my) {
    var n = nodeById(selectedNodeId);
    if (n) {
      if ($('#statusSelection')) $('#statusSelection').textContent = n.name + ', ' + n.model + ', ' + n.status;
      if ($('#statusPosX')) $('#statusPosX').textContent = Math.round(n.x);
      if ($('#statusPosY')) $('#statusPosY').textContent = Math.round(n.y);
    } else if (selectedLinkId) {
      var l = linkById(selectedLinkId);
      if ($('#statusSelection')) $('#statusSelection').textContent = l ? ('Link ' + l.aPort + ' ↔ ' + l.bPort + ', ' + l.status) : 'No device selected';
    } else {
      if ($('#statusSelection')) $('#statusSelection').textContent = 'No device selected';
      if (mx != null) {
        var p = screenToWorld(mx, my);
        if ($('#statusPosX')) $('#statusPosX').textContent = Math.round(p.x);
        if ($('#statusPosY')) $('#statusPosY').textContent = Math.round(p.y);
      }
    }
  };

  // ------------------------------------------------------------ node events
  var drag = null;
  function bindNodeEvents(el) {
    var id = el.dataset.nodeId;
    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      var node = nodeById(id);
      if (!node) return;
      if (APP.isLinkMode && APP.isLinkMode()) { APP.handleLinkNodeClick(id); return; }
      selectNode(id);
      APP.captureHistory();
      drag = { id: id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, nx: node.x, ny: node.y, moved: false, el: el };
      if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag || drag.id !== id) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      if (!drag.moved) { drag.moved = true; setStatus('Moving ' + (nodeById(id) || {}).name); }
      var node = nodeById(id); if (!node) return;
      node.x = drag.nx + dx / state.view.zoom;
      node.y = drag.ny + dy / state.view.zoom;
      el.style.left = node.x + 'px'; el.style.top = node.y + 'px';
      renderLinks(); APP.updateSelectionStatus(e.clientX, e.clientY);
    });
    el.addEventListener('pointerup', function () {
      if (!drag || drag.id !== id) return;
      if (drag.moved) { scheduleSave(); renderTopologyTree(); }
      drag = null;
    });
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault(); e.stopPropagation(); selectNode(id);
      if (APP.showNodeMenu) APP.showNodeMenu(id, e.clientX, e.clientY);
    });
  }

  // ---------------------------------------------------------- node lifecycle
  function redrawLifecycle() {
    renderNodes(); renderLinks(); renderTopologyTree(); updateCounts();
    if (APP.renderTabs) APP.renderTabs();
    if (APP.syncTerminalTabStatus) APP.syncTerminalTabStatus();
  }
  APP.redrawLifecycle = redrawLifecycle;

  function startNode(id) {
    var n = nodeById(id); if (!n) return;
    APP.captureHistory();
    n.status = 'running'; n.booting = true;
    if (n.junos) { var rt = APP.ensureRuntime(n); if (rt) rt.running = true; }
    redrawLifecycle();
    toast(n.name + ' started', 'success', 'play'); scheduleSave();
    setTimeout(function () { var nn = nodeById(id); if (nn) { nn.booting = false; renderNodes(); } }, 700);
  }
  function pauseNode(id) {
    var n = nodeById(id); if (!n) return;
    if (n.status === 'stopped') { toast(n.name + ' is stopped', 'warn', 'warning'); return; }
    APP.captureHistory();
    n.status = 'paused'; redrawLifecycle();
    toast(n.name + ' paused', 'warn', 'pause'); scheduleSave();
  }
  function stopNode(id) {
    var n = nodeById(id); if (!n) return;
    APP.captureHistory();
    n.status = 'stopped'; n.booting = false;
    if (n.junos) { var rt = APP.ensureRuntime(n); if (rt) rt.running = false; }
    redrawLifecycle();
    toast(n.name + ' stopped', 'warn', 'stop'); scheduleSave();
  }
  function restartNode(id) {
    var n = nodeById(id); if (!n) return;
    APP.captureHistory();
    n.status = 'stopped'; n.booting = false; redrawLifecycle();
    setTimeout(function () {
      var nn = nodeById(id); if (!nn) return;
      nn.status = 'running'; nn.booting = true;
      if (nn.junos) { var rt = APP.ensureRuntime(nn); if (rt) { rt.running = true; rt.bootAt = Date.now(); } }
      redrawLifecycle(); toast(nn.name + ' reloaded', 'success', 'reload');
      setTimeout(function () { var nx = nodeById(id); if (nx) { nx.booting = false; renderNodes(); } }, 800);
      scheduleSave();
    }, 450);
  }
  APP.startNode = startNode; APP.pauseNode = pauseNode; APP.stopNode = stopNode; APP.restartNode = restartNode;

  function deleteNode(id) {
    var n = nodeById(id); if (!n) return;
    APP.captureHistory();
    state.nodes = state.nodes.filter(function (x) { return x.id !== id; });
    state.links = state.links.filter(function (l) { return l.a !== id && l.b !== id; });
    delete runtimes[n.name];
    if (selectedNodeId === id) selectedNodeId = null;
    if (APP.closeTerminal) APP.closeTerminal(n.name, true);
    APP.rebuildWorld(); renderAll(); scheduleSave();
    toast(n.name + ' deleted', 'info', 'trash');
  }
  APP.deleteNode = deleteNode;

  function nextName(prefix) {
    for (var i = 1; i < 1000; i++) if (!nodeByName(prefix + i)) return prefix + i;
    return prefix + uid('');
  }
  function nextConsolePort() {
    for (var p = 5001; p < 5100; p++) if (!state.nodes.some(function (n) { return n.consolePort === p; })) return p;
    return 5100;
  }
  APP.nextName = nextName;

  function addNode(templateKey, x, y, explicitName) {
    var t = TEMPLATES[templateKey] || TEMPLATES.router;
    var name = explicitName || nextName(t.prefix);
    var node = makeNode(uid('n'), name, templateKey, x, y, 'running', nextConsolePort());
    if (t.type === 'host') {
      var idx = state.nodes.filter(function (n) { return n.type === 'host'; }).length;
      node.ip = '10.0.' + (idx + 2) + '.20';
      node.gateway = '10.0.' + (idx + 2) + '.1';
    }
    APP.captureHistory();
    state.nodes.push(node);
    if (node.junos) createRuntime(node);
    APP.rebuildWorld(); renderAll(); selectNode(node.id); scheduleSave();
    toast(name + ' placed on the canvas', 'success', 'plus');
    return node;
  }
  APP.addNode = addNode;

  APP.startAll = function () {
    APP.captureHistory();
    state.nodes.forEach(function (n) {
      if (n.status !== 'running') n.status = 'running';
      n.booting = true;
      if (n.junos) { var rt = APP.ensureRuntime(n); if (rt) rt.running = true; }
    });
    redrawLifecycle(); toast('All nodes started / resumed', 'success', 'play'); scheduleSave();
    setTimeout(function () { state.nodes.forEach(function (n) { n.booting = false; }); renderNodes(); }, 750);
  };
  APP.pauseAll = function () {
    APP.captureHistory();
    state.nodes.forEach(function (n) { if (n.status === 'running') n.status = 'paused'; });
    redrawLifecycle(); toast('All nodes paused', 'warn', 'pause'); scheduleSave();
  };
  APP.stopAll = function () {
    APP.captureHistory();
    state.nodes.forEach(function (n) { n.status = 'stopped'; n.booting = false; if (n.junos) { var rt = APP.ensureRuntime(n); if (rt) rt.running = false; } });
    redrawLifecycle(); toast('All nodes stopped', 'warn', 'stop'); scheduleSave();
  };
  APP.reloadAll = function () {
    APP.captureHistory();
    state.nodes.forEach(function (n) { n.status = 'stopped'; n.booting = false; });
    redrawLifecycle(); toast('Reloading all nodes…', 'info', 'reload');
    setTimeout(function () {
      state.nodes.forEach(function (n) { n.status = 'running'; n.booting = true; if (n.junos) { var rt = APP.ensureRuntime(n); if (rt) { rt.running = true; rt.bootAt = Date.now(); } } });
      redrawLifecycle();
      setTimeout(function () { state.nodes.forEach(function (n) { n.booting = false; }); renderNodes(); }, 900);
      toast('All nodes reloaded', 'success', 'reload'); scheduleSave();
    }, 550);
  };

  // ------------------------------------------------------------------ links
  function freePorts(a, b) {
    function usedFor(node) {
      var used = {};
      state.links.forEach(function (l) {
        if (l.a === node.id) used[l.aPort] = true;
        if (l.b === node.id) used[l.bPort] = true;
      });
      return used;
    }
    function list(node) {
      if (node.type === 'host') return ['eth0'];
      if (node.type === 'switch') { var sw = []; for (var i = 0; i < 24; i++) sw.push('ge-0/0/' + i); return sw; }
      if (node.type === 'firewall') return ['ge-0/0/0', 'ge-0/0/1', 'ge-0/0/2', 'ge-0/0/3', 'ge-0/0/4'];
      return ['ge-0/0/0', 'ge-0/0/1', 'ge-0/0/2', 'ge-0/0/3'];
    }
    var ua = usedFor(a), ub = usedFor(b);
    var pa = list(a).filter(function (p) { return !ua[p]; })[0];
    var pb = list(b).filter(function (p) { return !ub[p]; })[0];
    if (!pa || !pb) return null;
    return { aPort: pa, bPort: pb, label: a.type === 'switch' || b.type === 'switch' ? 'access / trunk' : 'Ethernet, 1G' };
  }
  APP.freePorts = freePorts;

  APP.createLinkBetween = function (aId, bId) {
    var a = nodeById(aId), b = nodeById(bId);
    if (!a || !b || a.id === b.id) return null;
    var ports = freePorts(a, b);
    if (!ports) { toast('No free interfaces are available for this link', 'error', 'warning'); return null; }
    APP.captureHistory();
    var l = makeLink(uid('l'), a.id, ports.aPort, b.id, ports.bPort, ports.label);
    state.links.push(l);
    renderLinks(); updateCounts(); scheduleSave();
    toast(a.name + ' ' + ports.aPort + ' ↔ ' + b.name + ' ' + ports.bPort + ' connected', 'success', 'cable');
    return l;
  };
  APP.deleteLink = function (id) {
    APP.captureHistory();
    state.links = state.links.filter(function (l) { return l.id !== id; });
    if (selectedLinkId === id) selectedLinkId = null;
    renderLinks(); renderNodes(); updateCounts(); scheduleSave();
    toast('Link deleted', 'info', 'trash');
  };

  // ------------------------------------------------------------- annotations
  APP.addAnnotation = function (a) {
    APP.captureHistory();
    state.annotations.push(a);
    renderAnnotations(); scheduleSave();
    toast('Annotation added', 'success', 'note');
  };
  APP.deleteAnnotation = function (id) {
    APP.captureHistory();
    state.annotations = state.annotations.filter(function (a) { return a.id !== id; });
    if (selectedAnnotationId === id) selectedAnnotationId = null;
    renderAnnotations(); scheduleSave();
  };
  APP.clearAnnotations = function () {
    if (!state.annotations.length) { toast('There are no annotations to clear', 'info', 'note'); return; }
    APP.captureHistory(); state.annotations = []; selectedAnnotationId = null;
    renderAnnotations(); scheduleSave(); toast('Annotations cleared', 'info', 'trash');
  };
  APP.addTextNote = function (text, x, y) {
    var lines = String(text || '').split('\n');
    var w = Math.max(132, Math.min(300, Math.max.apply(null, lines.map(function (s) { return s.length; })) * 7.2 + 22));
    var h = Math.max(40, lines.length * 12 + 18);
    APP.addAnnotation({ id: uid('note'), type: 'text', text: text, x: x, y: y, w: w, h: h });
  };

  // -------------------------------------------------------------- interface
  APP.getInterfaceRows = function (n) {
    if (n.type === 'host') return [{ name: 'eth0', admin: true, link: n.status !== 'stopped', family: 'inet', address: n.ip || '', kind: 'phys', editable: true }];
    var ds = APP.worldDevice(n.name);
    if (!ds || !ds.iflist) return [];
    var rows = [];
    ds.iflist.forEach(function (name) {
      var ifc = ds.interfaces[name];
      if (!ifc) return;
      if (ifc.kind === 'phys' && n.type === 'switch' && !/^ge-0\/0\/([0-9]|1[0-1])$/.test(name)) return;
      if (ifc.kind === 'phys' && n.type !== 'switch' && !/^ge-0\/0\/([0-7])$/.test(name)) return;
      var family = '-', addr = '';
      var uni = ifc.unilist && ifc.unilist.length ? ifc.unilist[0] : null;
      if (uni) {
        if (uni.family === 'inet') { family = 'inet'; addr = uni.addrs.join(', '); }
        else if (uni.family === 'ethernet-switching') { family = 'switching'; addr = uni.vlanMembers.join(', '); }
      }
      rows.push({ name: name, admin: !!ifc.adminUp, link: !!ifc.linkUp, family: family, address: addr, kind: ifc.kind, editable: ifc.kind !== 'irb' || true });
    });
    if (n.type !== 'switch' && !ds.iflist.some(function (x) { return x === 'fxp0'; })) {
      rows.unshift({ name: 'fxp0', admin: true, link: true, family: 'inet', address: '', kind: 'mgmt', editable: true });
    }
    return rows;
  };

  // ------------------------------------------------------------------ stats
  APP.setupStats = function () {
    var tick = 0;
    setInterval(function () {
      tick++;
      var cpu = 14 + Math.round(Math.abs(Math.sin(tick / 4)) * 15 + Math.random() * 7);
      var ram = 39 + Math.round(Math.abs(Math.sin(tick / 7)) * 7 + Math.random() * 3);
      if ($('#cpuGauge')) $('#cpuGauge').style.width = cpu + '%';
      if ($('#ramGauge')) $('#ramGauge').style.width = ram + '%';
      if ($('#cpuValue')) $('#cpuValue').textContent = cpu + '%';
      if ($('#ramValue')) $('#ramValue').textContent = ram + '%';
      var sec = Math.floor((Date.now() - serverStart) / 1000);
      var mins = Math.floor(sec / 60);
      if ($('#serverUptime')) $('#serverUptime').textContent = pad2(Math.floor(mins / 60)) + ':' + pad2(mins % 60);
    }, 2300);
  };

  APP.defaultState = defaultState;
  APP.render = { nodes: renderNodes, links: renderLinks, annotations: renderAnnotations, tree: renderTopologyTree };
  APP.updateCounts = updateCounts;
  APP.updateProjectChrome = updateProjectChrome;
  APP.renderCanvasSettings = renderCanvasSettings;

})(typeof window !== 'undefined' ? window : globalThis);
