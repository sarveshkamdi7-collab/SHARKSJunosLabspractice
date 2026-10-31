export interface VpcsState {
  name: string;
  ip: string | null;
  mask: string | null;
  cidr: number | null;
  gateway: string | null;
  mac: string;
}

export interface VpcsInit {
  name: string;
  ip?: string | null;
  mask?: string | null;
  gateway?: string | null;
  mac?: string;
}

export interface VpcsResult {
  lines: string[];
  prompt: string;
  clear?: boolean;
  closed?: boolean;
}

export interface VpcsRegistryEntry {
  nodeId: string;
  name: string;
  state: VpcsState;
}

export const DEFAULT_VPCS_MAC = '00:50:79:66:68:01';
export const UNASSIGNED_IP = '0.0.0.0';

type IpVersion = 'ipv4' | 'ipv6';

interface ParsedAddress {
  version: IpVersion;
  address: string;
  cidr: number;
  mask: string | null;
}

interface CommandToken {
  text: string;
  quoted: boolean;
}

export function ipv4ToInt(value: string): number | null {
  const parts = value.trim().split('.');
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

export function isIpv4(value: string): boolean {
  return ipv4ToInt(value) !== null;
}

export function cidrToMask(cidr: number): string | null {
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) return null;
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return [24, 16, 8, 0].map((shift) => Math.floor(mask / 2 ** shift) % 256).join('.');
}

export function maskToCidr(mask: string): number | null {
  const maskInt = ipv4ToInt(mask);
  if (maskInt === null) return null;
  let cidr = 0;
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit -= 1) {
    if ((maskInt >>> bit) & 1) {
      if (seenZero) return null;
      cidr += 1;
    } else {
      seenZero = true;
    }
  }
  return cidr;
}

export function sameIpv4Subnet(address: string, network: string, cidr: number): boolean {
  const addressInt = ipv4ToInt(address);
  const networkInt = ipv4ToInt(network);
  if (addressInt === null || networkInt === null) return false;
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) return false;
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return ((addressInt & mask) >>> 0) === ((networkInt & mask) >>> 0);
}

export function isValidIpv6(value: string): boolean {
  const raw = value.split('/')[0];
  if (!raw.includes(':')) return false;
  try {
    const parsed = new URL(`http://[${raw}]`);
    return parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

export function tokenize(input: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  let current = '';
  let quoted = false;
  let quote: '"' | "'" | null = null;

  for (const char of input) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      quoted = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0 || quoted) {
        tokens.push({ text: current, quoted });
        current = '';
        quoted = false;
      }
      continue;
    }
    current += char;
  }

  if (current.length > 0 || quoted) tokens.push({ text: current, quoted });
  return tokens;
}

function toBare(tokens: CommandToken[]): string[] {
  return tokens.map((token) => token.text);
}

function parseMaskToken(value: string): number | null {
  const cleaned = value.startsWith('/') ? value.slice(1) : value;
  if (/^\d{1,2}$/.test(cleaned)) {
    const prefix = Number(cleaned);
    return prefix >= 0 && prefix <= 32 ? prefix : null;
  }
  return maskToCidr(cleaned);
}

function parseAddress(value: string): ParsedAddress | null {
  const parts = value.split('/');
  if (parts.length === 1) {
    if (!isIpv4(parts[0])) return null;
    return { version: 'ipv4', address: parts[0], cidr: 24, mask: cidrToMask(24) };
  }
  if (parts.length !== 2) return null;
  const cidr = Number(parts[1]);
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) return null;
  if (!isIpv4(parts[0])) return null;
  return { version: 'ipv4', address: parts[0], cidr, mask: cidrToMask(cidr) };
}

function randomMs(index: number): number {
  return 0.4 + index * 0.07;
}

function defaultMac(nodeId: string, name: string): string {
  const letter = /([a-z])$/.exec(name.toLowerCase());
  if (letter) {
    const octet = letter[1].charCodeAt(0) - 96;
    if (octet >= 1 && octet <= 254) {
      return `00:50:79:66:68:${octet.toString(16).padStart(2, '0')}`;
    }
  }
  let hash = 2166136261;
  for (const char of `${nodeId}:${name}`.toLowerCase()) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return `00:50:79:66:68:${((hash % 254) + 1).toString(16).padStart(2, '0')}`;
}

export class VpcsEngine {
  readonly nodeId: string;
  private stateValue: VpcsState;

  constructor(nodeId: string, init: VpcsInit) {
    this.nodeId = nodeId;
    this.stateValue = {
      name: init.name,
      ip: init.ip ?? null,
      mask: init.mask ?? null,
      cidr: init.ip ? maskToCidr(init.mask ?? '255.255.255.0') ?? 24 : null,
      gateway: init.gateway ?? null,
      mac: init.mac ?? defaultMac(nodeId, init.name),
    };
  }

  get state(): VpcsState {
    return { ...this.stateValue };
  }

  get prompt(): string {
    return `VPCS> `;
  }

  setIdentity(name: string, mac?: string): void {
    this.stateValue.name = name;
    if (mac) this.stateValue.mac = mac;
  }

  reset(init: VpcsInit): void {
    this.stateValue = {
      name: init.name,
      ip: init.ip ?? null,
      mask: init.mask ?? null,
      cidr: init.ip ? maskToCidr(init.mask ?? '255.255.255.0') ?? 24 : null,
      gateway: init.gateway ?? null,
      mac: init.mac ?? defaultMac(this.nodeId, init.name),
    };
  }

  renderResult(result: VpcsResult): string {
    const clear = result.clear ? '\x1b[2K\r' : '';
    return clear + result.lines.join('\r\n') + (result.lines.length > 0 ? '\r\n' : '');
  }

  execute(input: string): VpcsResult {
    const raw = input.replace(/[\r\n]+/g, ' ').trim();
    if (raw.length === 0) return this.result([]);

    const command = raw.split(/\s+/)[0].toLowerCase();
    const rest = raw.slice(command.length).trim();
    const tokens = tokenize(rest);
    const args = toBare(tokens);

    switch (command) {
      case 'help':
      case '?':
        return this.result(this.help());
      case 'show':
        return this.result(this.show(args));
      case 'ip':
        return this.result(this.configIp(args));
      case 'ping':
        return this.result(this.ping(args));
      case 'clear':
      case 'cls':
        return this.result([], true);
      case 'arp':
        return this.result(['ARP table is empty.']);
      case 'quit':
      case 'exit':
        return { ...this.result([]), closed: true };
      case 'dhcp':
        return this.result(['DHCP is not available on this lab VPCS. Use "ip <address> <gateway> [mask]".']);
      case 'set':
      case 'name':
        return this.result(this.setName(args));
      default:
        return this.result([`Unknown command: ${command}`, 'Type "help" for a list of commands.']);
    }
  }

  private result(lines: string[], clear = false): VpcsResult {
    return { lines, prompt: this.prompt, clear };
  }

  private help(): string[] {
    return [
      'VPCS commands:',
      '  show [ip]                     Show IP configuration',
      '  ip <address> <gateway> [mask] Configure IPv4 address and gateway',
      '  ip <address>/<cidr> <gateway> Configure IPv4 address with CIDR prefix',
      '  ping <address> [count <n>]    Ping an IPv4 address',
      '  clear                        Clear the screen',
      '  quit                         Close the console',
    ];
  }

  private show(args: string[]): string[] {
    const sub = (args[0] ?? '').toLowerCase();
    if (sub !== '' && sub !== 'ip') return [`Unknown command: show ${args.join(' ')}`];

    const headers = ['NAME', 'IP/MASK', 'GATEWAY', 'MAC'];
    const ipMask = this.stateValue.ip
      ? `${this.stateValue.ip}/${this.stateValue.cidr ?? 24}`
      : UNASSIGNED_IP;
    const rows = [[this.stateValue.name, ipMask, this.stateValue.gateway ?? UNASSIGNED_IP, this.stateValue.mac]];
    return this.table(headers, rows);
  }

  private setName(args: string[]): string[] {
    if (args.length !== 1) return ['Usage: set <name>'];
    this.stateValue.name = args[0];
    return [];
  }

  private configIp(args: string[]): string[] {
    if (args.length < 1 || args.length > 3) {
      return ['Usage: ip <address> <gateway> [mask]'];
    }

    const address = parseAddress(args[0]);
    if (!address) {
      return [`Invalid IP address or mask: ${args[0]}`, 'Usage: ip <address> <gateway> [mask]'];
    }

    let gateway: string | null = null;
    if (args.length >= 2 && args[1].toLowerCase() !== 'gateway') {
      if (!isIpv4(args[1])) return [`Invalid gateway address: ${args[1]}`];
      gateway = args[1];
    } else if (args.length >= 3) {
      if (!isIpv4(args[2])) return [`Invalid gateway address: ${args[2]}`];
      gateway = args[2];
    }

    if (args.length === 3 && args[1].toLowerCase() === 'gateway') {
      if (!isIpv4(args[2])) return [`Invalid gateway address: ${args[2]}`];
      gateway = args[2];
    }

    let cidr = address.cidr;
    let mask = address.mask;
    if (args.length >= 3 && args[1].toLowerCase() !== 'gateway') {
      const parsedMask = parseMaskToken(args[2]);
      if (parsedMask === null) return [`Invalid netmask: ${args[2]}`];
      cidr = parsedMask;
      mask = cidrToMask(parsedMask);
    }

    if (cidr < 0 || cidr > 32) return [`Invalid CIDR prefix: /${cidr}`];
    if (cidr < 31 && address.address === UNASSIGNED_IP) return ['0.0.0.0 cannot be assigned to an interface.'];

    if (gateway && !sameIpv4Subnet(gateway, address.address, cidr)) {
      return [`Gateway ${gateway} is not in the same subnet as ${address.address}/${cidr}.`];
    }

    this.stateValue.ip = address.address;
    this.stateValue.cidr = cidr;
    this.stateValue.mask = mask;
    this.stateValue.gateway = gateway;

    return [
      `IP ${address.address}/${cidr} set on ${this.stateValue.name}`,
      gateway ? `Gateway ${gateway} set` : 'No gateway configured',
    ];
  }

  private ping(args: string[]): string[] {
    if (args.length === 0) return ['Usage: ping <address> [count <n>]'];
    const target = args[0];
    if (!isIpv4(target)) return [`Invalid target address: ${target}`];

    let count = 5;
    let rapid = false;
    for (let index = 1; index < args.length; index += 1) {
      const arg = args[index].toLowerCase();
      if (arg === 'count') {
        const parsed = Number(args[index + 1]);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          return ['Usage: ping <address> [count <n>]'];
        }
        count = parsed;
        index += 1;
      } else if (arg === '-c' || arg === '-n') {
        const parsed = Number(args[index + 1]);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          return ['Usage: ping <address> [-c <n>]'];
        }
        count = parsed;
        index += 1;
      } else if (arg === 'rapid' || arg === '-f') {
        rapid = true;
      } else if (arg === 'ipv6' || arg === 'ipv4') {
        continue;
      } else {
        return [`Unknown ping option: ${args[index]}`];
      }
    }

    const localIp = this.stateValue.ip;
    if (!localIp) {
      return ['No IP address configured. Use "ip <address> <gateway>" first.'];
    }

    const targetInt = ipv4ToInt(target);
    const localInt = ipv4ToInt(localIp);
    let reachable = true;
    if (targetInt !== null && localInt !== null && this.stateValue.cidr !== null) {
      reachable = sameIpv4Subnet(target, localIp, this.stateValue.cidr) || this.stateValue.gateway !== null;
    }

    const lines: string[] = [];
    if (rapid) {
      for (let sequence = 1; sequence <= count; sequence += 1) {
        lines.push(`84 bytes from ${target} icmp_seq=${sequence} ttl=64 time=${randomMs(sequence).toFixed(1)} ms`);
      }
      lines.push('');
      lines.push(`--- ${target} ping statistics ---`);
      lines.push(`${count} packets transmitted, ${count} received, 0% packet loss`);
      lines.push('round-trip min/avg/max = 0.4/0.6/0.8 ms');
      return lines;
    }

    for (let sequence = 1; sequence <= count; sequence += 1) {
      if (reachable) {
        lines.push(`84 bytes from ${target} icmp_seq=${sequence} ttl=64 time=${randomMs(sequence).toFixed(1)} ms`);
      } else {
        lines.push(`Request timeout for icmp_seq ${sequence}`);
      }
    }

    lines.push('');
    lines.push(`--- ${target} ping statistics ---`);
    if (reachable) {
      lines.push(`${count} packets transmitted, ${count} received, 0% packet loss`);
      lines.push('round-trip min/avg/max = 0.4/0.6/0.8 ms');
    } else {
      lines.push(`${count} packets transmitted, 0 received, 100% packet loss`);
    }
    return lines;
  }

  private table(headers: string[], rows: string[][]): string[] {
    const widths = headers.map((header, column) =>
      Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
    );
    const format = (row: string[]) =>
      row.map((cell, column) => (cell ?? '').padEnd(widths[column])).join('  ').trimEnd();
    return [format(headers), ...rows.map(format)];
  }
}

export class VpcsEngineRegistry {
  private readonly engines = new Map<string, VpcsEngine>();

  getOrCreate(nodeId: string, init: VpcsInit): VpcsEngine {
    const existing = this.engines.get(nodeId);
    if (existing) return existing;
    const engine = new VpcsEngine(nodeId, init);
    this.engines.set(nodeId, engine);
    return engine;
  }

  get(nodeId: string): VpcsEngine | undefined {
    return this.engines.get(nodeId);
  }

  remove(nodeId: string): boolean {
    return this.engines.delete(nodeId);
  }

  reset(nodeId: string, init: VpcsInit): VpcsEngine {
    const engine = this.engines.get(nodeId) ?? new VpcsEngine(nodeId, init);
    engine.reset(init);
    this.engines.set(nodeId, engine);
    return engine;
  }

  resetAll(): void {
    this.engines.clear();
  }

  entries(): VpcsRegistryEntry[] {
    return [...this.engines.values()].map((engine) => ({
      nodeId: engine.nodeId,
      name: engine.state.name,
      state: engine.state,
    }));
  }

  get size(): number {
    return this.engines.size;
  }
}

export function createVpcsEngineRegistry(): VpcsEngineRegistry {
  return new VpcsEngineRegistry();
}
