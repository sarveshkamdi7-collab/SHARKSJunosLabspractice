(function (global) {
  'use strict';

  var J = global.JJ;

  function deviceSpec(key) {
    switch (key) {
      case 'R1':
        return {
          key: 'R1',
          model: 'MX240',
          version: '20.4R2-S2.1',
          serial: 'ABTR0123',
          platform: 'mx',
          bootExtra: 45 * 1000,
          baseline: [
            ['system', 'host-name', 'R1'],
            ['system', 'time-zone', 'UTC'],
            ['system', 'services', 'ssh', 'protocol-version', 'v2'],
            ['system', 'services', 'ssh', 'root-login', 'deny'],
            ['system', 'services', 'ssh', 'connection-limit', '5'],
            ['system', 'syslog', 'file', 'messages', 'any', 'notice'],
            ['system', 'syslog', 'file', 'messages', 'authorization', 'info'],
            ['interfaces', 'ge-0/0/0', 'description', 'LINK TO R2'],
            ['interfaces', 'ge-0/0/0', 'unit', '0', 'family', 'inet', 'address', '10.0.12.1/30'],
            ['interfaces', 'ge-0/0/1', 'description', 'LINK TO SW1'],
            ['interfaces', 'ge-0/0/1', 'unit', '0', 'family', 'inet', 'address', '10.0.3.1/24'],
            ['interfaces', 'ge-0/0/2', 'disable', 'description', 'SPARE'],
            ['interfaces', 'lo0', 'unit', '0', 'family', 'inet', 'address', '1.1.1.1/32'],
            ['interfaces', 'fxp0', 'unit', '0', 'family', 'inet', 'address', '192.168.1.10/24'],
            ['routing-options', 'static', 'route', '0.0.0.0/0', 'next-hop', '10.0.12.2'],
            ['routing-options', 'router-id', '1.1.1.1'],
            ['protocols', 'ospf', 'area', '0.0.0.0', 'interface', 'ge-0/0/0.0'],
            ['protocols', 'ospf', 'area', '0.0.0.0', 'interface', 'lo0.0', 'passive'],
            ['protocols', 'bgp', 'group', 'PEERS', 'type', 'internal'],
            ['protocols', 'bgp', 'group', 'PEERS', 'peer-as', '65000'],
            ['protocols', 'bgp', 'group', 'PEERS', 'local-address', '1.1.1.1'],
            ['protocols', 'bgp', 'group', 'PEERS', 'neighbor', '2.2.2.2']
          ]
        };
      case 'R2':
        return {
          key: 'R2',
          model: 'MX240',
          version: '20.4R2-S2.1',
          serial: 'ABTR0456',
          platform: 'mx',
          bootExtra: 62 * 1000,
          baseline: [
            ['system', 'host-name', 'R2'],
            ['system', 'time-zone', 'UTC'],
            ['system', 'services', 'ssh', 'protocol-version', 'v2'],
            ['system', 'syslog', 'file', 'messages', 'any', 'notice'],
            ['interfaces', 'ge-0/0/0', 'description', 'LINK TO R1'],
            ['interfaces', 'ge-0/0/0', 'unit', '0', 'family', 'inet', 'address', '10.0.12.2/30'],
            ['interfaces', 'ge-0/0/1', 'description', 'LINK TO R3'],
            ['interfaces', 'ge-0/0/1', 'unit', '0', 'family', 'inet', 'address', '10.0.23.1/30'],
            ['interfaces', 'ge-0/0/2', 'disable', 'description', 'SPARE'],
            ['interfaces', 'lo0', 'unit', '0', 'family', 'inet', 'address', '2.2.2.2/32'],
            ['interfaces', 'fxp0', 'unit', '0', 'family', 'inet', 'address', '192.168.1.11/24'],
            ['routing-options', 'static', 'route', '10.0.3.0/24', 'next-hop', '10.0.12.1'],
            ['routing-options', 'router-id', '2.2.2.2'],
            ['protocols', 'ospf', 'area', '0.0.0.0', 'interface', 'ge-0/0/0.0'],
            ['protocols', 'ospf', 'area', '0.0.0.0', 'interface', 'ge-0/0/1.0'],
            ['protocols', 'ospf', 'area', '0.0.0.0', 'interface', 'lo0.0', 'passive'],
            ['protocols', 'bgp', 'group', 'PEERS', 'type', 'internal'],
            ['protocols', 'bgp', 'group', 'PEERS', 'peer-as', '65000'],
            ['protocols', 'bgp', 'group', 'PEERS', 'local-address', '2.2.2.2'],
            ['protocols', 'bgp', 'group', 'PEERS', 'neighbor', '1.1.1.1']
          ]
        };
      case 'R3':
        return {
          key: 'R3',
          model: 'MX240',
          version: '20.4R2-S2.1',
          serial: 'ABTR0789',
          platform: 'mx',
          bootExtra: 71 * 1000,
          baseline: [
            ['system', 'host-name', 'R3'],
            ['system', 'time-zone', 'UTC'],
            ['system', 'services', 'ssh', 'protocol-version', 'v2'],
            ['system', 'syslog', 'file', 'messages', 'any', 'notice'],
            ['interfaces', 'ge-0/0/0', 'description', 'LINK TO R2'],
            ['interfaces', 'ge-0/0/0', 'unit', '0', 'family', 'inet', 'address', '10.0.23.2/30'],
            ['interfaces', 'ge-0/0/1', 'disable', 'description', 'SPARE'],
            ['interfaces', 'lo0', 'unit', '0', 'family', 'inet', 'address', '3.3.3.3/32'],
            ['interfaces', 'fxp0', 'unit', '0', 'family', 'inet', 'address', '192.168.1.12/24'],
            ['routing-options', 'router-id', '3.3.3.3'],
            ['routing-options', 'static', 'route', '172.16.9.0/24', 'discard'],
            ['protocols', 'ospf', 'area', '0.0.0.0', 'interface', 'ge-0/0/0.0'],
            ['protocols', 'ospf', 'area', '0.0.0.0', 'interface', 'lo0.0', 'passive']
          ]
        };
      case 'SW1':
        return {
          key: 'SW1',
          model: 'EX4300-24T',
          version: '20.4R2-S2.1',
          serial: 'DX012345',
          platform: 'ex',
          bootExtra: 88 * 1000,
          baseline: [
            ['system', 'host-name', 'SW1'],
            ['system', 'time-zone', 'UTC'],
            ['system', 'syslog', 'file', 'messages', 'any', 'notice'],
            ['interfaces', 'ge-0/0/0', 'description', 'UPLINK TO R1'],
            ['interfaces', 'ge-0/0/0', 'unit', '0', 'family', 'ethernet-switching', 'vlan', 'members', 'staff'],
            ['interfaces', 'ge-0/0/1', 'description', 'ACCESS HOST-A'],
            ['interfaces', 'ge-0/0/1', 'unit', '0', 'family', 'ethernet-switching', 'vlan', 'members', 'staff'],
            ['interfaces', 'ge-0/0/2', 'description', 'ACCESS HOST-B'],
            ['interfaces', 'ge-0/0/2', 'unit', '0', 'family', 'ethernet-switching', 'vlan', 'members', 'guest'],
            ['interfaces', 'ge-0/0/3', 'disable', 'description', 'SPARE'],
            ['interfaces', 'ge-0/0/4', 'disable', 'description', 'SPARE'],
            ['interfaces', 'irb', 'unit', '10', 'family', 'inet', 'address', '10.0.3.2/24'],
            ['interfaces', 'irb', 'unit', '20', 'family', 'inet', 'address', '10.1.1.2/24'],
            ['interfaces', 'me0', 'unit', '0', 'family', 'inet', 'address', '192.168.1.20/24'],
            ['vlans', 'staff', 'vlan-id', '10', 'l3-interface', 'irb.10'],
            ['vlans', 'guest', 'vlan-id', '20', 'l3-interface', 'irb.20'],
            ['protocols', 'rstp', 'interface', 'all']
          ]
        };
      default:
        return null;
    }
  }

  var TOPOLOGY = [
    { a: 'R1', aPort: 'ge-0/0/0', b: 'R2', bPort: 'ge-0/0/0' },
    { a: 'R2', aPort: 'ge-0/0/1', b: 'R3', bPort: 'ge-0/0/0' },
    { a: 'R1', aPort: 'ge-0/0/1', b: 'SW1', bPort: 'ge-0/0/0', l2: true }
  ];

  var HOSTS = [
    { name: 'Host-A', sw: 'SW1', port: 'ge-0/0/1', vlan: 'staff', ip: '10.0.3.20' },
    { name: 'Host-B', sw: 'SW1', port: 'ge-0/0/2', vlan: 'guest', ip: '10.1.1.20' }
  ];

  var LAB = {
    deviceKeys: ['R1', 'R2', 'R3', 'SW1'],
    topology: TOPOLOGY,
    hosts: HOSTS,
    deviceSpec: deviceSpec
  };

  global.JJ = global.JJ || {};
  global.JJ.lab = LAB;
})(typeof window !== 'undefined' ? window : globalThis);
