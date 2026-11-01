import {
  ConfigNode,
  renderBlock,
  renderChildren,
  renderSetLines,
} from './junosConfig';
import { regexFromTokens } from './junosParser';

export type ConfigShape = 'default' | 'set';

export interface JunosRenderContext {
  hostname: string;
  lastConfigured: Date;
  now?: Date;
}

export interface InterfaceAddress {
  iface: string;
  unit: string;
  address?: string;
  description?: string;
  vlanId?: string;
}

export interface RouteEntry {
  destination: string;
  nextHop: string;
  interfaceName: string;
  protocol: 'Direct' | 'Local' | 'Static' | 'OSPF' | 'BGP';
  preference: string;
  age: string;
}

function formatDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return [
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`,
  ].join(' ');
}

export function renderConfig(
  root: ConfigNode,
  segments: string[],
  context: JunosRenderContext,
  shape: ConfigShape = 'default',
): string[] {
  void context;
  let node = root;
  for (const segment of segments) {
    const child = node.children.get(segment);
    if (!child) return ['', '}'];
    node = child;
  }

  if (shape === 'set') return renderSetLines(node, segments);
  if (segments.length === 0) return ['', ...renderChildren(root, 0), '}'];
  return ['', ...renderBlock(segments[segments.length - 1], node)];
}

export function renderShowCompare(diff: string[]): string[] {
  if (diff.length === 0) return [];
  return diff;
}

export function collectInterfaces(root: ConfigNode): InterfaceAddress[] {
  const interfaces = root.children.get('interfaces');
  if (!interfaces) return [];
  const result: InterfaceAddress[] = [];

  interfaces.children.forEach((ifaceNode, ifaceName) => {
    const description = ifaceNode.children.get('description')?.value;
    let units = [...ifaceNode.children.entries()].filter(([name]) => name.startsWith('unit '));

    if (units.length === 0) {
      result.push({ iface: ifaceName, unit: '0', description });
      return;
    }

    units = units.sort(([left], [right]) => {
      const leftId = Number(left.slice(5));
      const rightId = Number(right.slice(5));
      return leftId - rightId;
    });

    for (const [unitName, unitNode] of units) {
      const unit = unitName.slice(5);
      const family = unitNode.children.get('family inet');
      const address = family?.children.get('address')?.value;
      const vlanId = unitNode.children.get('vlan-id')?.value;
      const unitDescription = unitNode.children.get('description')?.value ?? description;
      result.push({ iface: ifaceName, unit, address, description: unitDescription, vlanId });
    }
  });

  return result;
}

function physicalState(iface: string): { admin: string; link: string } {
  if (iface === 'lo0') return { admin: 'up', link: 'up' };
  if (iface.startsWith('ge-')) return { admin: 'up', link: 'up' };
  return { admin: 'up', link: 'down' };
}

export function renderInterfacesTerse(root: ConfigNode): string[] {
  const interfaces = collectInterfaces(root);
  const lines = [
    'Interface               Admin Link Proto    Local                 Remote',
  ];
  const physicalSeen = new Set<string>();

  for (const entry of interfaces) {
    const state = physicalState(entry.iface);
    if (!physicalSeen.has(entry.iface)) {
      physicalSeen.add(entry.iface);
      lines.push(
        `${entry.iface.padEnd(23)} ${state.admin.padEnd(5)} ${state.link.padEnd(4)}`,
      );
    }
    const logical = `${entry.iface}.${entry.unit}`;
    if (entry.vlanId !== undefined) {
      lines.push(
        `${logical.padEnd(23)} ${state.admin.padEnd(5)} ${state.link.padEnd(4)} vlan     ${entry.vlanId}`,
      );
    }
    if (entry.address !== undefined) {
      lines.push(
        `${logical.padEnd(23)} ${state.admin.padEnd(5)} ${state.link.padEnd(4)} inet     ${entry.address}`,
      );
    }
  }

  return lines;
}

export function renderInterfacesDetail(root: ConfigNode, name?: string): string[] {
  const allInterfaces = collectInterfaces(root);
  const interfaces =
    name === undefined
      ? allInterfaces
      : allInterfaces.filter(
          (entry) => entry.iface === name || `${entry.iface}.${entry.unit}` === name,
        );
  if (name !== undefined && interfaces.length === 0) {
    return [`error: interface ${name} not found`];
  }
  const lines: string[] = [];

  interfaces.forEach((entry, index) => {
    const state = physicalState(entry.iface);
    const ifIndex = 128 + index;
    lines.push(
      `Physical interface: ${entry.iface}, Enabled, Physical link is ${
        state.link === 'up' ? 'Up' : 'Down'
      }`,
    );
    lines.push(`  Interface index: ${ifIndex}, SNMP ifIndex: ${ifIndex}`);
    if (entry.description !== undefined) {
      lines.push(`  Description: ${entry.description.replace(/^"|"$/g, '')}`);
    }
    lines.push('  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps');
    lines.push(
      `  Logical interface ${entry.iface}.${entry.unit} (Index ${
        64 + index
      }) (SNMP ifIndex ${ifIndex + 1})`,
    );
    lines.push('    Flags: Up SNMP-Traps 0x0 Encapsulation: ENET2');
    if (entry.vlanId !== undefined) lines.push(`    VLAN-Tag [ 0x8100.${entry.vlanId} ]`);
    lines.push('    Protocol inet, MTU: 1500');
    if (entry.address !== undefined) {
      lines.push('      Addresses, Flags: Is-Preferred Is-Primary');
      lines.push(`        Local: ${entry.address}`);
    }
    lines.push('');
  });

  return lines;
}

function ipToNumber(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

function numberToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

export function connectRoutes(root: ConfigNode): RouteEntry[] {
  const routes: RouteEntry[] = [];
  const seen = new Set<string>();
  const push = (route: RouteEntry): void => {
    if (seen.has(route.destination)) return;
    seen.add(route.destination);
    routes.push(route);
  };

  for (const entry of collectInterfaces(root)) {
    if (entry.address === undefined) continue;
    const [address, prefixText] = entry.address.split('/');
    const prefix = Number(prefixText ?? '32');
    const numeric = ipToNumber(address);
    if (numeric === null || !Number.isInteger(prefix)) continue;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (numeric & mask) >>> 0;
    const interfaceName = `${entry.iface}.${entry.unit}`;
    push({
      destination: `${numberToIp(network)}/${prefix}`,
      nextHop: 'Direct',
      interfaceName,
      protocol: 'Direct',
      preference: '0',
      age: '00:02:14',
    });
    push({
      destination: `${address}/32`,
      nextHop: 'Local',
      interfaceName,
      protocol: 'Local',
      preference: '0',
      age: '00:02:14',
    });
  }

  if (root.children.get('protocols')?.children.get('ospf')) {
    const samples: Record<string, string[]> = {
      R1: ['2.2.2.2/32', '3.3.3.3/32', '10.0.23.0/30'],
      R2: ['1.1.1.1/32', '3.3.3.3/32', '10.0.10.0/24', '10.0.20.0/24'],
      R3: ['1.1.1.1/32', '2.2.2.2/32', '10.0.12.0/30', '10.0.10.0/24', '10.0.20.0/24'],
    };
    const host = root.children.get('system')?.children.get('host-name')?.value ?? 'R1';
    for (const destination of samples[host.replace(/^"|"$/g, '')] ?? []) {
      push({
        destination,
        nextHop: '> to 10.0.12.2',
        interfaceName: 'ge-0/0/0.0',
        protocol: 'OSPF',
        preference: '10',
        age: '00:01:03',
      });
    }
  }

  const staticRoutes = root.children.get('routing-options')?.children.get('static')?.children;
  staticRoutes?.forEach((route, segment) => {
    if (!segment.startsWith('route ')) return;
    const destination = segment.slice('route '.length).trim();
    const nextHop = route.children.get('next-hop')?.value ?? 'discard';
    push({
      destination,
      nextHop: nextHop === 'discard' ? 'Discard' : `> to ${nextHop}`,
      interfaceName: 'ge-0/0/0.0',
      protocol: 'Static',
      preference: '5',
      age: '00:00:18',
    });
  });

  if (root.children.get('protocols')?.children.get('bgp')) {
    push({
      destination: '203.0.113.0/24',
      nextHop: '> to 10.0.12.2',
      interfaceName: 'ge-0/0/0.0',
      protocol: 'BGP',
      preference: '170',
      age: '00:03:22',
    });
  }

  return routes;
}

export function renderRoutes(root: ConfigNode): string[] {
  const routes = connectRoutes(root);
  const lines = [
    `inet.0: ${routes.length} destinations, ${routes.length} routes (${routes.length} active, 0 holddown, 0 hidden)`,
    '+ = Active Route, - = Last Active, * = Both',
    '',
  ];
  for (const route of routes) {
    lines.push(
      `${route.destination.padEnd(20)} *[${route.protocol}/${route.preference}] ${route.age}`,
    );
    if (route.protocol === 'Local') {
      lines.push(`                    Local via ${route.interfaceName}`);
    } else if (route.protocol === 'Direct') {
      lines.push(`                    > via ${route.interfaceName}`);
    } else {
      lines.push(`                    ${route.nextHop} via ${route.interfaceName}`);
    }
  }
  return lines;
}

export function renderRouteSummary(root: ConfigNode): string[] {
  const routes = connectRoutes(root);
  const counts = new Map<string, number>();
  for (const route of routes) {
    counts.set(route.protocol, (counts.get(route.protocol) ?? 0) + 1);
  }
  const lines = [
    `inet.0: ${routes.length} destinations, ${routes.length} routes (${routes.length} active, 0 holddown, 0 hidden)`,
    '',
  ];
  for (const [protocol, count] of counts) {
    lines.push(`  ${protocol}: ${count} routes, ${count} active`);
  }
  return lines;
}

export function renderArp(root: ConfigNode): string[] {
  const interfaces = collectInterfaces(root);
  const lines = [
    'MAC Address         Address         Interface           Flags',
  ];
  let macSuffix = 2;

  for (const entry of interfaces) {
    if (entry.address === undefined) continue;
    const [address, prefixText] = entry.address.split('/');
    const prefix = Number(prefixText ?? '32');
    if (!Number.isInteger(prefix) || prefix >= 31) continue;
    const numeric = ipToNumber(address);
    if (numeric === null) continue;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (numeric & mask) >>> 0;
    const host = prefix === 30 ? network + 2 : network + 10;
    const mac = `00:11:22:33:44:${String(macSuffix).padStart(2, '0').toUpperCase()}`;
    macSuffix += 1;
    lines.push(
      `${mac} ${numberToIp(host).padEnd(17)} ${`${entry.iface}.${entry.unit}`.padEnd(20)} none`,
    );
  }

  return lines;
}

export function renderVersion(
  context: JunosRenderContext,
  model = 'junos-ex',
  version = '21.4R3.15',
): string[] {
  return [
    'Hostname: ' + context.hostname,
    'Model: ' + model,
    'Junos: ' + version,
    'JUNOS Software Release [' + version + ']',
  ];
}

export function renderUptime(context: JunosRenderContext): string[] {
  const now = context.now ?? new Date();
  return [
    `Current time: ${formatDate(now)}`,
    '',
    `System booted: ${formatDate(new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3))}`,
    'Protocols started: 2026-01-01 00:00:00 UTC',
    `Last configured: ${formatDate(context.lastConfigured)} by user`,
    '',
    '3 days, 0 hours, 0 minutes, 0 seconds',
  ];
}

export function renderHelp(): string[] {
  return [
    'Junos command reference:',
    '  configuration mode: configure, edit, up, top, set, delete, commit, rollback, exit',
    '  show: show, show | compare, show configuration, show interfaces, show route, show arp',
    '  command mode: show, ping, traceroute, exit, quit',
  ];
}

export function applyPipes(lines: string[], pipes: string[][]): string[] {
  let output = [...lines];

  for (const pipe of pipes) {
    const name = (pipe[0] ?? '').toLowerCase();
    const args = pipe.slice(1);

    if (name === 'match') {
      const regex = regexFromTokens(args);
      if (regex) output = output.filter((line) => regex.test(line));
    } else if (name === 'except') {
      const regex = regexFromTokens(args);
      if (regex) output = output.filter((line) => !regex.test(line));
    } else if (name === 'count') {
      output = [String(output.length)];
    } else if (name === 'no-more') {
      continue;
    } else if (name === 'display' && (args[0] ?? '').toLowerCase() === 'set') {
      continue;
    } else if (name === 'compare') {
      continue;
    }
  }

  return output;
}
