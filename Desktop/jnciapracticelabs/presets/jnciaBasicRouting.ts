export interface JnciaHost {
  name: string;
  ip: string;
  gateway: string;
  mac: string;
  vlan: number;
}

export interface JnciaTopologyLink {
  a: string;
  ap: string;
  b: string;
  bp: string;
  label: string;
}

export interface JnciaPresetNode {
  name: string;
  template: 'vsrx' | 'vmx' | 'switch' | 'ubuntu' | 'vpcs';
}

export interface JnciaPreset {
  title: string;
  positions: Record<string, { x: number; y: number }>;
  nodes: JnciaPresetNode[];
  topology: JnciaTopologyLink[];
  hosts: JnciaHost[];
  configs: Record<string, string[]>;
  tasks: string[];
}

export const JNCIA_VLANS = {
  staff: { id: 10, name: 'STAFF', network: '10.0.10.0/24', gateway: '10.0.10.1' },
  guest: { id: 20, name: 'GUEST', network: '10.0.20.0/24', gateway: '10.0.20.1' },
} as const;

export const JNCIA_HOSTS: JnciaHost[] = [
  { name: 'Host-A', ip: '10.0.10.20', gateway: '10.0.10.1', mac: '00:50:79:66:68:01', vlan: 10 },
  { name: 'Host-B', ip: '10.0.20.20', gateway: '10.0.20.1', mac: '00:50:79:66:68:02', vlan: 20 },
];

export const R1_CONFIG: string[] = [
  'set system host-name R1',
  'set system time-zone UTC',
  'set system services ssh',
  'set interfaces ge-0/0/0 description "LINK-TO-R2"',
  'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30',
  'set interfaces ge-0/0/1 description "TRUNK-TO-SW1"',
  'set interfaces ge-0/0/1 vlan-tagging',
  'set interfaces ge-0/0/1 unit 10 vlan-id 10',
  'set interfaces ge-0/0/1 unit 10 description "STAFF-VLAN"',
  'set interfaces ge-0/0/1 unit 10 family inet address 10.0.10.1/24',
  'set interfaces ge-0/0/1 unit 20 vlan-id 20',
  'set interfaces ge-0/0/1 unit 20 description "GUEST-VLAN"',
  'set interfaces ge-0/0/1 unit 20 family inet address 10.0.20.1/24',
  'set interfaces lo0 unit 0 family inet address 1.1.1.1/32',
  'set protocols ospf area 0.0.0.0 interface ge-0/0/0.0',
  'set protocols ospf area 0.0.0.0 interface ge-0/0/1.10',
  'set protocols ospf area 0.0.0.0 interface ge-0/0/1.20',
  'set protocols ospf area 0.0.0.0 interface lo0.0 passive',
];

export const R2_CONFIG: string[] = [
  'set system host-name R2',
  'set system time-zone UTC',
  'set system services ssh',
  'set interfaces ge-0/0/0 description "LINK-TO-R1"',
  'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.2/30',
  'set interfaces ge-0/0/1 description "LINK-TO-R3"',
  'set interfaces ge-0/0/1 unit 0 family inet address 10.0.23.1/30',
  'set interfaces lo0 unit 0 family inet address 2.2.2.2/32',
  'set protocols ospf area 0.0.0.0 interface ge-0/0/0.0',
  'set protocols ospf area 0.0.0.0 interface ge-0/0/1.0',
  'set protocols ospf area 0.0.0.0 interface lo0.0 passive',
];

export const R3_CONFIG: string[] = [
  'set system host-name R3',
  'set system time-zone UTC',
  'set system services ssh',
  'set interfaces ge-0/0/0 description "LINK-TO-R2"',
  'set interfaces ge-0/0/0 unit 0 family inet address 10.0.23.2/30',
  'set interfaces lo0 unit 0 family inet address 3.3.3.3/32',
  'set protocols ospf area 0.0.0.0 interface ge-0/0/0.0',
  'set protocols ospf area 0.0.0.0 interface lo0.0 passive',
];

export const SW1_CONFIG: string[] = [
  'set system host-name SW1',
  'set system time-zone UTC',
  'set system services ssh',
  'set interfaces ge-0/0/1 description "TRUNK-TO-R1"',
  'set interfaces ge-0/0/1 unit 0 family ethernet-switching port-mode trunk',
  'set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members staff',
  'set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members guest',
  'set interfaces ge-0/0/2 description "HOST-A-STAFF"',
  'set interfaces ge-0/0/2 unit 0 family ethernet-switching port-mode access',
  'set interfaces ge-0/0/2 unit 0 family ethernet-switching vlan members staff',
  'set interfaces ge-0/0/3 description "HOST-B-GUEST"',
  'set interfaces ge-0/0/3 unit 0 family ethernet-switching port-mode access',
  'set interfaces ge-0/0/3 unit 0 family ethernet-switching vlan members guest',
  'set vlans staff vlan-id 10',
  'set vlans staff description "STAFF-VLAN"',
  'set vlans guest vlan-id 20',
  'set vlans guest description "GUEST-VLAN"',
];

export const JNCIA_CONFIGS: Record<string, string[]> = {
  R1: R1_CONFIG,
  R2: R2_CONFIG,
  R3: R3_CONFIG,
  SW1: SW1_CONFIG,
};

export const jnciaBasicRouting: JnciaPreset = {
  title: 'JNCIA Basic Routing',
  positions: {
    'Host-A': { x: 80, y: 260 },
    SW1: { x: 240, y: 260 },
    R1: { x: 420, y: 260 },
    R2: { x: 620, y: 260 },
    R3: { x: 820, y: 260 },
    'Host-B': { x: 80, y: 420 },
  },
  nodes: [
    { name: 'Host-A', template: 'vpcs' },
    { name: 'SW1', template: 'switch' },
    { name: 'R1', template: 'vsrx' },
    { name: 'R2', template: 'vmx' },
    { name: 'R3', template: 'vmx' },
    { name: 'Host-B', template: 'vpcs' },
  ],
  topology: [
    { a: 'Host-A', ap: 'eth0', b: 'SW1', bp: 'ge-0/0/2', label: 'VLAN 10' },
    { a: 'Host-B', ap: 'eth0', b: 'SW1', bp: 'ge-0/0/3', label: 'VLAN 20' },
    { a: 'SW1', ap: 'ge-0/0/1', b: 'R1', bp: 'ge-0/0/1', label: '802.1Q TRUNK' },
    { a: 'R1', ap: 'ge-0/0/0', b: 'R2', bp: 'ge-0/0/0', label: '10.0.12.0/30' },
    { a: 'R2', ap: 'ge-0/0/1', b: 'R3', bp: 'ge-0/0/0', label: '10.0.23.0/30' },
  ],
  hosts: JNCIA_HOSTS.map((host) => ({ ...host })),
  configs: JNCIA_CONFIGS,
  tasks: [
    'Confirm Host-A (VLAN 10) can ping its gateway 10.0.10.1.',
    'Confirm Host-B (VLAN 20) can ping its gateway 10.0.20.1.',
    'On R1, run "show interfaces terse" and identify the VLAN subinterfaces.',
    'On R1, run "show route" and verify the connected 10.0.10.0/24 and 10.0.20.0/24 networks.',
    'Verify OSPF neighbors with "show ospf neighbor" on R1 and R2.',
    'Trace the path from Host-A to Host-B and explain why inter-VLAN routing is required.',
  ],
};

export type JnciaPresetValidation =
  | { ok: true; preset: JnciaPreset }
  | { ok: false; errors: string[] };

function ipv4ToInt(value: string): number | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = result * 256 + octet;
  }
  return result >>> 0;
}

export function cidrToMask(cidr: number): string | null {
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) return null;
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return [24, 16, 8, 0].map((shift) => Math.floor(mask / 2 ** shift) % 256).join('.');
}

export function inSameSubnet(address: string, network: string): boolean {
  const [networkAddress, prefixText] = network.split('/');
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const addressInt = ipv4ToInt(address);
  const networkInt = ipv4ToInt(networkAddress);
  if (addressInt === null || networkInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((addressInt & mask) >>> 0) === ((networkInt & mask) >>> 0);
}

export function validateJnciaPreset(preset: JnciaPreset): JnciaPresetValidation {
  const errors: string[] = [];
  const nodeNames = new Set(preset.nodes.map((node) => node.name));
  const hostNames = new Set<string>();
  const hostIps = new Set<string>();
  const hostMacs = new Set<string>();

  if (preset.nodes.length === 0) errors.push('preset has no nodes');
  if (preset.hosts.length === 0) errors.push('preset has no hosts');

  for (const host of preset.hosts) {
    if (hostNames.has(host.name)) errors.push(`duplicate host name: ${host.name}`);
    if (hostIps.has(host.ip)) errors.push(`duplicate host IP: ${host.ip}`);
    if (hostMacs.has(host.mac.toLowerCase())) errors.push(`duplicate host MAC: ${host.mac}`);
    hostNames.add(host.name);
    hostIps.add(host.ip);
    hostMacs.add(host.mac.toLowerCase());

    if (!nodeNames.has(host.name)) errors.push(`host node missing: ${host.name}`);
    if (ipv4ToInt(host.ip) === null) errors.push(`invalid host IP: ${host.name} ${host.ip}`);
    if (ipv4ToInt(host.gateway) === null) errors.push(`invalid gateway: ${host.name} ${host.gateway}`);
    if (!host.mac.toLowerCase().startsWith('00:50:79:')) {
      errors.push(`host MAC must be a VPCS-style 00:50:79 address: ${host.name} ${host.mac}`);
    }

    if (host.vlan !== JNCIA_VLANS.staff.id && host.vlan !== JNCIA_VLANS.guest.id) {
      errors.push(`host VLAN must be 10 or 20: ${host.name}`);
    }
    const vlan = host.vlan === JNCIA_VLANS.guest.id ? JNCIA_VLANS.guest : JNCIA_VLANS.staff;
    if (!inSameSubnet(host.ip, vlan.network)) errors.push(`host IP outside VLAN ${host.vlan} subnet: ${host.name} ${host.ip}`);
    if (!inSameSubnet(host.gateway, vlan.network)) errors.push(`gateway outside VLAN ${host.vlan} subnet: ${host.name} ${host.gateway}`);
  }

  if (new Set(JNCIA_HOSTS.map((host) => host.vlan)).size !== 2) {
    errors.push('hosts must use two distinct VLANs');
  }
  if (JNCIA_HOSTS[0].ip === JNCIA_HOSTS[1].ip) errors.push('Host-A and Host-B must not share an IP address');
  if (JNCIA_HOSTS[0].mac === JNCIA_HOSTS[1].mac) errors.push('Host-A and Host-B must not share a MAC address');

  const linkKeys = new Set<string>();
  for (const link of preset.topology) {
    if (!nodeNames.has(link.a)) errors.push(`topology endpoint missing: ${link.a}`);
    if (!nodeNames.has(link.b)) errors.push(`topology endpoint missing: ${link.b}`);
    const key = [link.a, link.ap, link.b, link.bp].sort().join('|');
    if (linkKeys.has(key)) errors.push(`duplicate topology link: ${link.a}-${link.b}`);
    linkKeys.add(key);
  }

  for (const [name, lines] of Object.entries(preset.configs)) {
    if (!nodeNames.has(name)) errors.push(`config for unknown node: ${name}`);
    for (const line of lines) {
      if (!line.startsWith('set ')) errors.push(`config line must start with "set ": ${name}: ${line}`);
    }
  }

  return errors.length === 0 ? { ok: true, preset } : { ok: false, errors };
}

export function assertValidJnciaPreset(preset: JnciaPreset = jnciaBasicRouting): JnciaPreset {
  const result = validateJnciaPreset(preset);
  if (!result.ok) throw new Error(`Invalid JNCIA preset:\n${result.errors.join('\n')}`);
  return result.preset;
}

export default jnciaBasicRouting;
