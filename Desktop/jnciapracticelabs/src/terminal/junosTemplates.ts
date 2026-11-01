import { collectInterfaces } from './junosRenderers';
import { JunosStateStore } from './junosStateStore';

export interface JunosTemplateContext {
  store: JunosStateStore;
  command: string;
  args: string[];
}

export type JunosTemplate = (context: JunosTemplateContext) => string[] | null;

function interfaceNames(store: JunosStateStore): string[] {
  return [...new Set(collectInterfaces(store.candidateRoot).map((entry) => entry.iface))];
}

function ospfNeighbors(store: JunosStateStore): string[] {
  const hasLan = interfaceNames(store).includes('ge-0/0/1');
  const lines = [
    'Address          Interface              State     ID               Pri  Dead',
  ];
  lines.push('10.0.12.2        ge-0/0/0.0             Full      2.2.2.2          128    39');
  if (hasLan) {
    lines.push('10.0.10.2        ge-0/0/1.0             Full      3.3.3.3          128    38');
  }
  return lines;
}

function ospfInterfaces(store: JunosStateStore): string[] {
  const lines = [
    'Interface        State     Area             DR ID           BDR ID          Nbrs',
  ];
  const names = interfaceNames(store);
  if (names.includes('ge-0/0/0')) {
    lines.push('ge-0/0/0.0       PtToPt    0.0.0.0          0.0.0.0         0.0.0.0         1');
  }
  if (names.includes('ge-0/0/1')) {
    lines.push('ge-0/0/1.0       DR        0.0.0.0          1.1.1.1         0.0.0.0         2');
    lines.push('ge-0/0/1.20      DR        0.0.0.0          1.1.1.1         0.0.0.0         0');
  }
  if (names.includes('lo0')) {
    lines.push('lo0.0            Passive   0.0.0.0          0.0.0.0         0.0.0.0         0');
  }
  return lines;
}

function bgpSummary(): string[] {
  return [
    'Groups: 1 Peers: 1 Down peers: 0',
    'Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending',
    'inet.0                 0          0          0          0          0          0',
    '',
    'Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State',
    '10.0.12.2             65002          4          5       0       0       00:04:12 Establ',
  ];
}

function ethernetSwitching(): string[] {
  return [
    'Ethernet switching table : 2 entries, 2 learned',
    'Routing instance : default-switch',
    'Vlan                MAC                 MAC      Age    Logical',
    'Name                Address             flags           interface',
    'STAFF-VLAN          00:11:22:33:44:10   D           -   ge-0/0/1.0',
    'GUEST-VLAN          00:11:22:33:44:20   D           -   ge-0/0/1.20',
  ];
}

function lldpNeighbors(): string[] {
  return [
    'Local Interface    Parent Interface    Chassis Id          Port info           System Name',
    'ge-0/0/0.0         -                   00:11:22:33:44:02   ge-0/0/0.0          R2',
    'ge-0/0/1.0         -                   00:11:22:33:44:10   ge-0/0/1.0          SW1',
  ];
}

function logMessages(): string[] {
  return [
    'Oct 31 00:00:02  R1 mgd[1000]: UI_CMDLINE_READ_LINE: User \'user\', command \'show log messages\'',
    'Oct 31 00:00:03  R1 rpd[1001]: RPD_OSPF_NBRUP: OSPF neighbor 10.0.12.2 (ge-0/0/0.0) reached state Full',
    'Oct 31 00:00:04  R1 rpd[1001]: RPD_OSPF_NBRUP: OSPF neighbor 10.0.10.2 (ge-0/0/1.0) reached state Full',
  ];
}

function ntpStatus(): string[] {
  return [
    'status        : synchronized',
    'system peer   : 10.0.12.2',
    'stratum       : 3',
    'offset        : 0.003 seconds',
    'root delay    : 0.001 seconds',
    'root dispersion: 0.002 seconds',
  ];
}

function dhcpLeases(): string[] {
  return [
    'Address        MAC address       Hostname        Lease expires',
    '10.0.20.10     00:11:22:33:44:20 client-guest    2026-10-31 12:00:00 UTC',
  ];
}

const templates: Record<string, JunosTemplate> = {
  'show ospf neighbor': ({ store }) => ospfNeighbors(store),
  'show ospf interface': ({ store }) => ospfInterfaces(store),
  'show ospf database': () => [
    'OSPF database, Area 0.0.0.0',
    'Type       ID               Adv Rtr           Seq      Age  Opt  Cksum  Len',
    'Router   1.1.1.1          1.1.1.1           0x80000002  120  0x22 0x1234  48',
  ],
  'show bgp summary': () => bgpSummary(),
  'show bgp neighbor': () => [
    'Peer: 10.0.12.2+179 AS 65002 Local: 10.0.12.1+49152 AS 65001',
    'Type: External    State: Established    Flags: <Sync>',
    'Last State: OpenConfirm   Last Event: RecvKeepAlive',
  ],
  'show ethernet-switching table': () => ethernetSwitching(),
  'show lldp neighbors': () => lldpNeighbors(),
  'show protocols': () => [
    '',
    'ospf {',
    '    area 0.0.0.0 {',
    '        interface ge-0/0/0.0;',
    '        interface ge-0/0/1.0;',
    '        interface ge-0/0/1.20;',
    '        interface lo0.0 {',
    '            passive;',
    '        }',
    '    }',
    '}',
  ],
  'show log messages': () => logMessages(),
  'show ntp status': () => ntpStatus(),
  'show dhcp server leases': () => dhcpLeases(),
  'show system services': () => ['ssh enabled', 'telnet disabled'],
  'show chassis': () => ['Chassis: junos-ex', 'Midplane: up', 'Routing Engine 0: online'],
  'show chassis routing-engine': () => [
    'Routing Engine status:',
    '  Slot 0:',
    '    Current state: Master',
    '    Temperature: 38 degrees C',
    '    CPU utilization: 4 percent',
  ],
  'show virtual-chassis': () => ['Virtual Chassis ID: 1234.5678.90ab', 'Member 0: R1 (Master)'],
  'show version': ({ store }) => [
    'Hostname: ' + store.hostname,
    'Model: junos-ex',
    'Junos: 21.4R3.15',
    'JUNOS Software Release [21.4R3.15]',
  ],
};

export function findJunosTemplate(context: JunosTemplateContext): string[] | null {
  const key = [context.command, ...context.args].join(' ');
  const template = templates[key];
  return template ? template(context) : null;
}
