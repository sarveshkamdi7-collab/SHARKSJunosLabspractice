export interface VPCSEngineOptions {
  nodeId: string;
  name?: string;
  mac?: string;
  ip?: string;
  mask?: string;
  cidr?: number;
  gateway?: string;
  now?: () => Date;
}

export interface VPCSSessionState {
  nodeId: string;
  name: string;
  ip: string;
  mask: string;
  cidr: number;
  gateway: string;
  mac: string;
  prompt: string;
}

interface ParsedCidr {
  ip: string;
  mask: string;
  cidr: number;
}

const CRLF = '\r\n';

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

function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');
}

function maskForCidr(cidr: number): string {
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return intToIpv4(mask);
}

function cidrForMask(mask: string): number | null {
  const value = ipv4ToInt(mask);
  if (value === null) return null;
  let count = 0;
  let seenZero = false;
  for (let bit = 31; bit >= 0; bit -= 1) {
    const set = ((value >>> bit) & 1) === 1;
    if (set && seenZero) return null;
    if (set) count += 1;
    else seenZero = true;
  }
  return count;
}

function parseCidr(value: string): ParsedCidr | null {
  const parts = value.split('/');
  if (parts.length !== 2) return null;
  const address = parts[0];
  if (ipv4ToInt(address) === null) return null;
  if (!/^\d{1,2}$/.test(parts[1])) return null;
  const cidr = Number(parts[1]);
  if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) return null;
  return { ip: address, mask: maskForCidr(cidr), cidr };
}

function networkOf(address: string, cidr: number): string | null {
  const value = ipv4ToInt(address);
  if (value === null) return null;
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return intToIpv4((value & mask) >>> 0);
}

function normalizeMac(value: string): string {
  const cleaned = value.replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (cleaned.length !== 12) return value.toLowerCase();
  return cleaned.match(/.{2}/g)?.join(':') ?? value.toLowerCase();
}

function defaultMac(nodeId: string): string {
  let hash = 0;
  for (const char of nodeId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const last = hash % 256;
  return `00:50:79:66:68:${last.toString(16).padStart(2, '0')}`;
}

export class VPCSEngine {
  readonly nodeId: string;
  private nameValue: string;
  private ipValue: string;
  private cidrValue: number;
  private gatewayValue: string;
  private macValue: string;

  constructor(options: VPCSEngineOptions | string) {
    const normalized = typeof options === 'string' ? { nodeId: options } : options;
    this.nodeId = normalized.nodeId;
    this.nameValue = normalized.name ?? 'PC1';
    this.macValue = normalizeMac(normalized.mac ?? defaultMac(normalized.nodeId));

    if (normalized.ip !== undefined) {
      const parsedIp = parseCidr(normalized.ip.includes('/') ? normalized.ip : `${normalized.ip}/24`);
      if (parsedIp) {
        this.ipValue = parsedIp.ip;
        this.cidrValue = normalized.cidr ?? parsedIp.cidr;
      } else {
        this.ipValue = '0.0.0.0';
        this.cidrValue = 0;
      }
    } else {
      this.ipValue = '0.0.0.0';
      this.cidrValue = 0;
    }

    if (normalized.mask !== undefined) {
      const maskCidr = cidrForMask(normalized.mask);
      if (maskCidr !== null) this.cidrValue = maskCidr;
    }
    if (normalized.cidr !== undefined) {
      this.cidrValue = Math.max(0, Math.min(32, normalized.cidr));
    }
    this.gatewayValue =
      normalized.gateway && ipv4ToInt(normalized.gateway) !== null ? normalized.gateway : '0.0.0.0';
  }

  get name(): string {
    return this.nameValue;
  }

  get ip(): string {
    return this.ipValue;
  }

  get mask(): string {
    return maskForCidr(this.cidrValue);
  }

  get cidr(): number {
    return this.cidrValue;
  }

  get gateway(): string {
    return this.gatewayValue;
  }

  get mac(): string {
    return this.macValue;
  }

  get prompt(): string {
    return `${this.nameValue}> `;
  }

  get state(): VPCSSessionState {
    return {
      nodeId: this.nodeId,
      name: this.nameValue,
      ip: this.ipValue,
      mask: this.mask,
      cidr: this.cidrValue,
      gateway: this.gatewayValue,
      mac: this.macValue,
      prompt: this.prompt,
    };
  }

  renderPrompt(clearLine = true): string {
    return `${clearLine ? '\x1b[2K\r' : ''}${this.prompt}`;
  }

  reset(): void {
    this.nameValue = 'PC1';
    this.ipValue = '0.0.0.0';
    this.cidrValue = 0;
    this.gatewayValue = '0.0.0.0';
    this.macValue = defaultMac(this.nodeId);
  }

  setName(name: string): void {
    const trimmed = name.trim();
    if (trimmed.length > 0) this.nameValue = trimmed;
  }

  executeCommand(rawCmd: string): string {
    const raw = String(rawCmd ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (raw.length === 0) return '';

    if (raw === '?') return this.help();
    const tokens = raw.split(/\s+/);
    const command = tokens[0].toLowerCase();

    switch (command) {
      case 'help':
        return this.help();
      case 'show':
        return this.show(tokens.slice(1));
      case 'ip':
        return this.configureIp(tokens.slice(1), raw);
      case 'gateway':
      case 'gw':
        return this.configureGateway(tokens.slice(1), raw);
      case 'ping':
        return this.ping(tokens.slice(1), raw);
      case 'arp':
        return this.arp();
      case 'route':
        return this.route();
      case 'clear':
        return '\x1b[2J\x1b[H';
      case 'set':
        return this.set(tokens.slice(1), raw);
      case 'quit':
      case 'exit':
        return `Connection closed by foreign host.${CRLF}`;
      default:
        return this.invalid(raw);
    }
  }

  execute(rawCmd: string): string {
    return this.executeCommand(rawCmd);
  }

  private invalid(raw: string): string {
    return `Invalid command: "${raw}". Type "?" or "help" for available commands.${CRLF}`;
  }

  private help(): string {
    return [
      'VPCS commands:',
      '  show [ip|arp|route|mac]       Show host information',
      '  ip <address>/<cidr> [gateway] Configure the IPv4 address',
      '  gateway <address>             Configure the default gateway',
      '  ping <host> [-c count]        Ping a host',
      '  arp                           Show the ARP table',
      '  route                         Show the host routing table',
      '  clear                         Clear the screen',
      '  quit                          Quit the console',
    ].join(CRLF) + CRLF;
  }

  private show(tokens: string[]): string {
    if (tokens.length === 0 || tokens[0].toLowerCase() === 'ip') return this.showIp();
    const sub = tokens[0].toLowerCase();
    if (sub === 'mac') return `MAC: ${this.macValue}${CRLF}`;
    if (sub === 'arp') return this.arp();
    if (sub === 'route') return this.route();
    return this.invalid(['show', ...tokens].join(' '));
  }

  private showIp(): string {
    const address = `${this.ipValue}/${this.cidrValue}`;
    return [
      `NAME        : ${this.nameValue}`,
      `IP/MASK     : ${address}`,
      `GATEWAY     : ${this.gatewayValue}`,
      `DNS         : 0.0.0.0`,
      `MAC         : ${this.macValue}`,
      `DHCP        : OFF`,
    ].join(CRLF) + CRLF;
  }

  private configureIp(tokens: string[], raw: string): string {
    if (tokens.length === 0) return this.showIp();
    if (tokens[0].toLowerCase() === 'dhcp') {
      return `DHCP is not available in this lab.${CRLF}`;
    }

    const parsedCidr = parseCidr(tokens[0]);
    if (parsedCidr) {
      const gateway = tokens[1];
      if (gateway !== undefined && ipv4ToInt(gateway) === null) return this.invalid(raw);
      this.ipValue = parsedCidr.ip;
      this.cidrValue = parsedCidr.cidr;
      if (gateway !== undefined) this.gatewayValue = gateway;
      return '';
    }

    const address = tokens[0];
    const mask = tokens[1];
    const gateway = tokens[2];
    if (ipv4ToInt(address) === null || mask === undefined) return this.invalid(raw);
    const maskCidr = cidrForMask(mask);
    if (maskCidr === null) return this.invalid(raw);
    if (gateway !== undefined && ipv4ToInt(gateway) === null) return this.invalid(raw);

    this.ipValue = address;
    this.cidrValue = maskCidr;
    if (gateway !== undefined) this.gatewayValue = gateway;
    return '';
  }

  private configureGateway(tokens: string[], raw: string): string {
    if (tokens.length !== 1 || ipv4ToInt(tokens[0]) === null) return this.invalid(raw);
    this.gatewayValue = tokens[0];
    return '';
  }

  private set(tokens: string[], raw: string): string {
    if (tokens.length === 2 && tokens[0].toLowerCase() === 'pcname') {
      this.setName(tokens[1]);
      return '';
    }
    return this.invalid(raw);
  }

  private ping(tokens: string[], raw: string): string {
    if (tokens.length === 0) return this.invalid(raw);
    const target = tokens[0];
    if (ipv4ToInt(target) === null) return this.invalid(raw);

    let count = 5;
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index].toLowerCase();
      if (token === '-c' || token === 'count') {
        const parsed = Number(tokens[index + 1]);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return this.invalid(raw);
        count = parsed;
        index += 1;
      } else {
        return this.invalid(raw);
      }
    }

    if (this.ipValue === '0.0.0.0') {
      return `Can't ping: IP address not configured${CRLF}`;
    }

    const localNetwork = networkOf(this.ipValue, this.cidrValue);
    const remoteNetwork = networkOf(target, this.cidrValue);
    const direct = localNetwork !== null && remoteNetwork !== null && localNetwork === remoteNetwork;
    const viaGateway = this.gatewayValue !== '0.0.0.0';
    const reachable = direct || viaGateway;

    const lines: string[] = [`PING ${target} (${target}): 56 data bytes`];
    const times: number[] = [];
    for (let sequence = 1; sequence <= count; sequence += 1) {
      if (reachable) {
        const time = 0.412 + sequence * 0.037;
        times.push(time);
        lines.push(`84 bytes from ${target} icmp_seq=${sequence} ttl=64 time=${time.toFixed(3)} ms`);
      } else {
        lines.push(`Request timeout for icmp_seq ${sequence}`);
      }
    }
    lines.push('');
    lines.push(`--- ${target} ping statistics ---`);
    if (!reachable) {
      lines.push(`${count} packets transmitted, 0 packets received, 100% packet loss`);
      return lines.join(CRLF) + CRLF;
    }
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((sum, value) => sum + value, 0) / times.length;
    const variance = times.reduce((sum, value) => sum + (value - avg) ** 2, 0) / times.length;
    lines.push(`${count} packets transmitted, ${count} packets received, 0% packet loss`);
    lines.push(
      `round-trip min/avg/max/stddev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/${Math.sqrt(variance).toFixed(3)} ms`,
    );
    return lines.join(CRLF) + CRLF;
  }

  private arp(): string {
    const lines = ['Address                  HWtype  HWaddress           Flags  Mask  Iface'];
    const gateway = this.gatewayValue === '0.0.0.0' ? '0.0.0.0' : this.gatewayValue;
    lines.push(`${gateway.padEnd(25)} ether   ${this.macValue}   C      -     eth0`);
    return lines.join(CRLF) + CRLF;
  }

  private route(): string {
    if (this.ipValue === '0.0.0.0') {
      return `No route configured.${CRLF}`;
    }
    const network = networkOf(this.ipValue, this.cidrValue) ?? '0.0.0.0';
    const lines = [`C ${network}/${this.cidrValue} is directly connected, eth0`];
    if (this.gatewayValue !== '0.0.0.0') {
      lines.push(`S* 0.0.0.0/0 via ${this.gatewayValue}`);
    }
    return lines.join(CRLF) + CRLF;
  }
}

export class VPCSEngineRegistry {
  private readonly engines = new Map<string, VPCSEngine>();

  getOrCreate(nodeId: string, options: Omit<VPCSEngineOptions, 'nodeId'>): VPCSEngine {
    const existing = this.engines.get(nodeId);
    if (existing) return existing;
    const engine = new VPCSEngine({ ...options, nodeId });
    this.engines.set(nodeId, engine);
    return engine;
  }

  get(nodeId: string): VPCSEngine | undefined {
    return this.engines.get(nodeId);
  }

  remove(nodeId: string): boolean {
    return this.engines.delete(nodeId);
  }

  execute(nodeId: string, rawCmd: string): string {
    const engine = this.engines.get(nodeId);
    if (!engine) return `Invalid command: "${rawCmd}". Type "?" or "help" for available commands.${CRLF}`;
    return engine.executeCommand(rawCmd);
  }

  resetAll(): void {
    this.engines.clear();
  }

  get size(): number {
    return this.engines.size;
  }
}

export function createVPCSEngineRegistry(): VPCSEngineRegistry {
  return new VPCSEngineRegistry();
}
