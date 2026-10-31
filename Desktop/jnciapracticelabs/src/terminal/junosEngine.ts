export type JunosMode = 'operational' | 'configuration';

export interface JunosEngineOptions {
  nodeId: string;
  hostname?: string;
  username?: string;
  model?: string;
  version?: string;
  serialNumber?: string;
  setLines?: string[];
  now?: () => Date;
}

export interface JunosSessionState {
  nodeId: string;
  mode: JunosMode;
  editPath: string[];
  prompt: string;
  hostname: string;
}

interface ConfigNode {
  children: Map<string, ConfigNode>;
  value?: string;
}

interface InterfaceEntry {
  ifname: string;
  unit?: string;
  address?: string;
  vlanId?: string;
  etherSwitching?: boolean;
  description?: string;
}

interface RouteEntry {
  destination: string;
  protocol: string;
  preference: string;
  nextHop: string;
  age: string;
}

type CompletionRow = [word: string, description?: string];

const CRLF = '\r\n';
const COMPOUND_HEADS = new Set([
  'area',
  'family',
  'group',
  'interface',
  'policy-statement',
  'route',
  'rule',
  'rule-set',
  'term',
  'unit',
]);

const VALUE_KEYWORDS = new Set([
  'address',
  'autonomous-system',
  'community',
  'connection-limit',
  'cost',
  'count',
  'dead-interval',
  'description',
  'destination',
  'domain-name',
  'domain-search',
  'export',
  'facility',
  'filter',
  'from',
  'hello-interval',
  'host-name',
  'import',
  'input',
  'interface',
  'interval',
  'level',
  'local-address',
  'log',
  'match',
  'maximum-prefix',
  'members',
  'metric',
  'mtu',
  'name-server',
  'next-hop',
  'output',
  'peer-as',
  'port-mode',
  'preference',
  'priority',
  'protocol',
  'protocol-version',
  'rate-limit',
  'route-filter',
  'router-id',
  'size',
  'source',
  'source-address',
  'then',
  'time-zone',
  'timeout',
  'type',
  'vlan-id',
]);

const OPERATIONAL_COMMANDS: CompletionRow[] = [
  ['configure', 'Enter configuration mode'],
  ['exit', 'Close the console'],
  ['help', 'Show available commands'],
  ['ping', 'Ping a host'],
  ['quit', 'Close the console'],
  ['show', 'Show operational information'],
];

const SHOW_COMMANDS: CompletionRow[] = [
  ['configuration', 'Show the configuration'],
  ['interfaces', 'Show interface information'],
  ['ospf', 'Show OSPF information'],
  ['route', 'Show the routing table'],
  ['system', 'Show system information'],
  ['version', 'Show software version'],
];

const SYSTEM_COMMANDS: CompletionRow[] = [
  ['information', 'Show hardware and software information'],
  ['services', 'Show service status'],
  ['uptime', 'Show uptime and load averages'],
];

const INTERFACE_COMMANDS: CompletionRow[] = [
  ['detail', 'Show detailed interface information'],
  ['terse', 'Show interface status in terse format'],
];

const ROUTE_COMMANDS: CompletionRow[] = [
  ['brief', 'Show brief route information'],
  ['detail', 'Show detailed route information'],
  ['protocol', 'Show routes by protocol'],
  ['summary', 'Show route summary'],
  ['table', 'Show a routing table'],
];

const OSPF_COMMANDS: CompletionRow[] = [
  ['interface', 'OSPF interfaces'],
  ['neighbor', 'OSPF neighbors'],
];

const CONFIG_COMMANDS: CompletionRow[] = [
  ['commit', 'Commit the configuration'],
  ['delete', 'Remove a configuration statement'],
  ['edit', 'Enter a configuration hierarchy'],
  ['exit', 'Leave configuration mode or move up'],
  ['help', 'Show available commands'],
  ['rollback', 'Discard uncommitted changes'],
  ['run', 'Run an operational command'],
  ['set', 'Add a configuration statement'],
  ['show', 'Show the current hierarchy'],
  ['top', 'Return to the top of the configuration'],
  ['up', 'Move up one or more levels'],
];

const CONFIG_DESCRIPTIONS: Record<string, string> = {
  address: 'Address/prefix',
  'area 0.0.0.0': 'OSPF backbone area',
  bgp: 'BGP routing process',
  description: 'Interface description',
  'family ethernet-switching': 'Layer 2 switching family',
  'family inet': 'IPv4 family',
  'ge-0/0/0': 'WAN interface',
  'ge-0/0/1': 'LAN/trunk interface',
  'host-name': 'System hostname',
  interfaces: 'Interface configuration',
  'lo0': 'Loopback interface',
  'lo0.0': 'Loopback unit',
  ospf: 'OSPF routing process',
  'passive': 'Do not send hellos',
  'policy-options': 'Routing policy',
  protocols: 'Routing protocols',
  'routing-options': 'Routing options',
  services: 'System services',
  'time-zone': 'System time zone',
  'unit 0': 'Logical unit 0',
  'unit 10': 'Staff VLAN unit',
  'unit 20': 'Guest VLAN unit',
  'vlan-id': '802.1Q VLAN ID',
  vlans: 'VLAN definitions',
};

function createNode(): ConfigNode {
  return { children: new Map<string, ConfigNode>() };
}

function stripQuotes(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/^"|"$/g, '');
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  return tokens;
}

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

function networkAddress(address: string, cidr: number): string {
  const value = ipv4ToInt(address);
  if (value === null) return address;
  const mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
  return intToIpv4((value & mask) >>> 0);
}

function looksLikeValue(token: string): boolean {
  return (
    /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(token) ||
    /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(token)
  );
}

function formatConfigValue(keyword: string, value: string): string {
  if (keyword === 'description' || keyword === 'community') {
    return `"${stripQuotes(value) ?? ''}"`;
  }
  return value;
}

function ensureTokenPath(root: ConfigNode, tokens: string[]): ConfigNode {
  let node = root;
  let index = 0;
  while (index < tokens.length) {
    let segment = tokens[index];
    let consumed = 1;
    if (COMPOUND_HEADS.has(segment) && index + 1 < tokens.length) {
      segment = `${segment} ${tokens[index + 1]}`;
      consumed = 2;
    }
    let child = node.children.get(segment);
    if (!child) {
      child = createNode();
      node.children.set(segment, child);
    }
    node = child;
    index += consumed;
  }
  return node;
}

function ensureSegments(root: ConfigNode, segments: string[]): ConfigNode {
  let node = root;
  for (const segment of segments) {
    let child = node.children.get(segment);
    if (!child) {
      child = createNode();
      node.children.set(segment, child);
    }
    node = child;
  }
  return node;
}

function resolveSegments(root: ConfigNode, segments: string[]): ConfigNode | null {
  let node = root;
  for (const segment of segments) {
    const child = node.children.get(segment);
    if (!child) return null;
    node = child;
  }
  return node;
}

function tokensToSegments(tokens: string[]): string[] {
  const segments: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (COMPOUND_HEADS.has(token) && index + 1 < tokens.length) {
      segments.push(`${token} ${tokens[index + 1]}`);
      index += 1;
    } else {
      segments.push(token);
    }
  }
  return segments;
}

function setLeaf(parent: ConfigNode, name: string, value?: string): ConfigNode {
  let node = parent.children.get(name);
  if (!node) {
    node = createNode();
    parent.children.set(name, node);
  }
  if (value === undefined) {
    delete node.value;
  } else {
    node.value = value;
  }
  return node;
}

function setUnder(node: ConfigNode, tokens: string[]): void {
  if (tokens.length === 0) return;
  const last = tokens[tokens.length - 1];
  const previous = tokens.length >= 2 ? tokens[tokens.length - 2] : '';
  const isValue =
    (VALUE_KEYWORDS.has(previous) && !COMPOUND_HEADS.has(previous)) || looksLikeValue(last);

  if (isValue && tokens.length >= 2) {
    const parent = ensureTokenPath(node, tokens.slice(0, -1));
    parent.value = formatConfigValue(previous, last);
    return;
  }

  ensureTokenPath(node, tokens);
}

function deleteUnder(node: ConfigNode, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const segments = tokensToSegments(tokens);
  if (segments.length === 0) return false;
  const parentSegments = segments.slice(0, -1);
  const parent = resolveSegments(node, parentSegments);
  if (!parent) return false;
  return parent.children.delete(segments[segments.length - 1]);
}

function renderChildren(node: ConfigNode, indent: number): string[] {
  const lines: string[] = [];
  const prefix = ' '.repeat(indent * 4);
  node.children.forEach((child, name) => {
    if (child.children.size === 0) {
      lines.push(`${prefix}${name}${child.value !== undefined ? ` ${child.value}` : ''};`);
      return;
    }
    lines.push(`${prefix}${name} {`);
    lines.push(...renderChildren(child, indent + 1));
    lines.push(`${prefix}}`);
  });
  return lines;
}

function renderBlock(segment: string, node: ConfigNode): string[] {
  return [`${segment} {`, ...renderChildren(node, 1), '}'];
}

function renderSetLines(node: ConfigNode, prefixSegments: string[] = []): string[] {
  const lines: string[] = [];
  const walk = (current: ConfigNode, path: string[]): void => {
    current.children.forEach((child, segment) => {
      const next = [...path, segment];
      if (child.children.size > 0) {
        walk(child, next);
      } else {
        lines.push(`set ${next.join(' ')}${child.value !== undefined ? ` ${child.value}` : ''}`);
      }
    });
  };
  walk(node, prefixSegments);
  return lines;
}

function table(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const render = (row: string[]): string =>
    row.map((cell, column) => (cell ?? '').padEnd(widths[column])).join('  ').trimEnd();
  return [render(headers), ...rows.map(render)];
}

function formatCompletions(rows: CompletionRow[]): string {
  const seen = new Set<string>();
  const unique = rows.filter(([word]) => {
    if (seen.has(word)) return false;
    seen.add(word);
    return true;
  });
  unique.sort((a, b) => a[0].localeCompare(b[0]));
  const lines = ['Possible completions:'];
  for (const [word, description] of unique) {
    lines.push(description ? `  ${word.padEnd(26)} ${description}` : `  ${word}`);
  }
  return lines.join(CRLF) + CRLF;
}

function formatUtc(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}

function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function addUnit(
  iface: ConfigNode,
  unitId: string,
  address: string,
  vlanId?: string,
  description?: string,
): ConfigNode {
  const unit = ensureSegments(iface, [`unit ${unitId}`]);
  if (vlanId !== undefined) setLeaf(unit, 'vlan-id', vlanId);
  if (description !== undefined) setLeaf(unit, 'description', `"${description}"`);
  const family = ensureSegments(unit, ['family inet']);
  setLeaf(family, 'address', address);
  return unit;
}

function seedConfig(hostname: string): ConfigNode {
  const root = createNode();
  const system = ensureSegments(root, ['system']);
  setLeaf(system, 'host-name', hostname);
  setLeaf(system, 'time-zone', 'UTC');
  const services = ensureSegments(system, ['services']);
  setLeaf(services, 'ssh');

  const interfaces = ensureSegments(root, ['interfaces']);
  const loopback = ensureSegments(interfaces, ['lo0']);
  addUnit(loopback, '0', '1.1.1.1/32');

  const wan = ensureSegments(interfaces, ['ge-0/0/0']);
  setLeaf(wan, 'description', '"LINK-TO-R2"');
  addUnit(wan, '0', '10.0.12.1/30');

  const lan = ensureSegments(interfaces, ['ge-0/0/1']);
  setLeaf(lan, 'description', '"TRUNK-TO-SW1"');
  setLeaf(lan, 'vlan-tagging');
  addUnit(lan, '0', '10.0.10.1/24', '10', 'STAFF-VLAN');
  addUnit(lan, '20', '10.0.20.1/24', '20', 'GUEST-VLAN');

  const protocols = ensureSegments(root, ['protocols']);
  const ospf = ensureSegments(protocols, ['ospf']);
  const area = ensureSegments(ospf, ['area 0.0.0.0']);
  ensureSegments(area, ['interface ge-0/0/0.0']);
  ensureSegments(area, ['interface ge-0/0/1.0']);
  ensureSegments(area, ['interface ge-0/0/1.20']);
  setLeaf(ensureSegments(area, ['interface lo0.0']), 'passive');

  return root;
}

export class JunosEngine {
  readonly nodeId: string;
  private config: ConfigNode;
  private modeValue: JunosMode = 'operational';
  private editPathValue: string[] = [];
  private readonly hostnameValue: string;
  private readonly username: string;
  private readonly model: string;
  private readonly version: string;
  private readonly serialNumber: string;
  private readonly clock: () => Date;

  constructor(options: JunosEngineOptions | string) {
    const normalized = typeof options === 'string' ? { nodeId: options } : options;
    this.nodeId = normalized.nodeId;
    this.hostnameValue = normalized.hostname ?? 'R1';
    this.username = normalized.username ?? 'user';
    this.model = normalized.model ?? 'vsrx';
    this.version = normalized.version ?? '21.4R3.15';
    this.serialNumber = normalized.serialNumber ?? 'JN1234567890';
    this.clock = normalized.now ?? (() => new Date());

    const setLines = normalized.setLines;
    this.config = setLines !== undefined ? createNode() : seedConfig(this.hostnameValue);
    for (const line of setLines ?? []) {
      setUnder(this.config, tokenize(line.replace(/^\s*set\s+/i, '')));
    }
  }

  get mode(): JunosMode {
    return this.modeValue;
  }

  get editPath(): string[] {
    return [...this.editPathValue];
  }

  get hostname(): string {
    const configured = stripQuotes(this.config.children.get('system')?.children.get('host-name')?.value);
    return configured ?? this.hostnameValue;
  }

  get prompt(): string {
    const identity = `${this.username}@${this.hostname}`;
    if (this.modeValue === 'operational') return `${identity}> `;
    const path = this.editPathValue.length > 0 ? ` ${this.editPathValue.join(' ')}` : '';
    return `[edit${path}]${CRLF}${identity}# `;
  }

  get state(): JunosSessionState {
    return {
      nodeId: this.nodeId,
      mode: this.modeValue,
      editPath: [...this.editPathValue],
      prompt: this.prompt,
      hostname: this.hostname,
    };
  }

  renderPrompt(clearLine = true): string {
    return `${clearLine ? '\x1b[2K\r' : ''}${this.prompt}`;
  }

  reset(): void {
    this.config = seedConfig(this.hostnameValue);
    this.modeValue = 'operational';
    this.editPathValue = [];
  }

  getRunningConfig(): string {
    return renderChildren(this.config, 0).join(CRLF) + CRLF;
  }

  getSetCommands(): string {
    return renderSetLines(this.config).join(CRLF) + CRLF;
  }

  executeCommand(rawCmd: string): string {
    const raw = String(rawCmd ?? '').replace(/[\r\n]+/g, ' ').trim();
    if (raw.length === 0) return '';

    if (raw.includes('?')) {
      const before = raw.slice(0, raw.indexOf('?')).trim();
      const tokens = tokenize(before);
      return this.modeValue === 'configuration'
        ? this.completeConfiguration(tokens)
        : this.completeOperational(tokens);
    }

    const tokens = tokenize(raw);
    if (tokens.length === 0) return '';
    const command = tokens[0].toLowerCase();
    const lower = tokens.map((token) => token.toLowerCase());

    if (this.modeValue === 'configuration') {
      if (lower[0] === 'top' && lower[1] === 'show') {
        const displaySet =
          lower.includes('|') && lower.includes('display') && lower.includes('set');
        return displaySet
          ? renderSetLines(this.config).join(CRLF) + CRLF
          : renderChildren(this.config, 0).join(CRLF) + CRLF;
      }

      switch (command) {
        case 'set':
          return this.configSet(tokens.slice(1));
        case 'delete':
          return this.configDelete(tokens.slice(1));
        case 'edit':
          return this.configEdit(tokens.slice(1));
        case 'up':
          return this.configUp(tokens.slice(1));
        case 'top':
          this.editPathValue = [];
          return '';
        case 'show':
          return this.configShow(tokens.slice(1));
        case 'run':
          return this.configRun(tokens.slice(1));
        case 'commit':
          return `commit complete${CRLF}`;
        case 'rollback':
          return `load complete${CRLF}`;
        case 'exit':
        case 'quit':
          return this.configExit();
        case 'help':
          return this.helpConfiguration();
        case 'configure':
          return `% Not in operational mode.${CRLF}`;
        default:
          return `% Unknown command: ${tokens.join(' ')}${CRLF}`;
      }
    }

    switch (command) {
      case 'configure':
        if (tokens.length > 1 && tokens[1].toLowerCase() !== 'exclusive') {
          return `% Unknown command: ${tokens.join(' ')}${CRLF}`;
        }
        this.modeValue = 'configuration';
        this.editPathValue = [];
        return `Entering configuration mode${CRLF}`;
      case 'show':
        return this.showOperational(tokens.slice(1));
      case 'ping':
        return this.ping(tokens.slice(1));
      case 'help':
        return this.helpOperational();
      case 'clear':
        return '\x1b[2J\x1b[H';
      case 'exit':
      case 'quit':
        return `Connection closed by foreign host.${CRLF}`;
      default:
        return `% Unknown command: ${tokens.join(' ')}${CRLF}`;
    }
  }

  execute(rawCmd: string): string {
    return this.executeCommand(rawCmd);
  }

  private currentNode(): ConfigNode | null {
    return resolveSegments(this.config, this.editPathValue);
  }

  private configSet(tokens: string[]): string {
    if (tokens.length === 0) return `% Incomplete command.${CRLF}`;
    const node = this.currentNode();
    if (!node) return `% Unknown command: set ${tokens.join(' ')}${CRLF}`;
    setUnder(node, tokens);
    return '';
  }

  private configDelete(tokens: string[]): string {
    if (tokens.length === 0) return `% Incomplete command.${CRLF}`;
    const node = this.currentNode();
    if (!node) return `% Unknown command: delete ${tokens.join(' ')}${CRLF}`;
    if (!deleteUnder(node, tokens)) {
      return `warning: statement not found: ${tokens[tokens.length - 1]}${CRLF}`;
    }
    return '';
  }

  private configEdit(tokens: string[]): string {
    if (tokens.length === 0) return `% Incomplete command.${CRLF}`;
    const segments = tokensToSegments(tokens);
    const next = [...this.editPathValue, ...segments];
    ensureSegments(this.config, next);
    this.editPathValue = next;
    return '';
  }

  private configUp(tokens: string[]): string {
    const count = tokens.length === 0 ? 1 : Number(tokens[0]);
    if (!Number.isInteger(count) || count < 1) {
      return `% Unknown command: up ${tokens.join(' ')}${CRLF}`;
    }
    this.editPathValue = this.editPathValue.slice(0, Math.max(0, this.editPathValue.length - count));
    return '';
  }

  private configExit(): string {
    if (this.editPathValue.length > 0) {
      this.editPathValue = this.editPathValue.slice(0, -1);
      return '';
    }
    this.modeValue = 'operational';
    return `Exiting configuration mode${CRLF}`;
  }

  private configShow(tokens: string[]): string {
    if (tokens.length > 0 && tokens[0] === '|') {
      const displaySet = tokens.some((token) => token.toLowerCase() === 'display') &&
        tokens.some((token) => token.toLowerCase() === 'set');
      if (displaySet) {
        const node = this.currentNode();
        if (!node) return '';
        return renderSetLines(node, this.editPathValue).join(CRLF) + CRLF;
      }
    }

    if (tokens.length === 0) {
      const node = this.currentNode();
      if (!node) return `% Unknown command: show${CRLF}`;
      if (this.editPathValue.length === 0) {
        return renderChildren(node, 0).join(CRLF) + CRLF;
      }
      return renderBlock(this.editPathValue[this.editPathValue.length - 1], node).join(CRLF) + CRLF;
    }

    const segments = tokensToSegments(tokens);
    const full = [...this.editPathValue, ...segments];
    const node = resolveSegments(this.config, full);
    if (!node) return `% Unknown command: show ${tokens.join(' ')}${CRLF}`;
    return renderBlock(segments[segments.length - 1], node).join(CRLF) + CRLF;
  }

  private configRun(tokens: string[]): string {
    if (tokens.length === 0) return `% Incomplete command.${CRLF}`;
    const savedMode = this.modeValue;
    const savedPath = this.editPathValue;
    this.modeValue = 'operational';
    this.editPathValue = [];
    const output = this.executeCommand(tokens.join(' '));
    this.modeValue = savedMode;
    this.editPathValue = savedPath;
    return output;
  }

  private helpOperational(): string {
    return [
      'Operational commands:',
      '  configure                    Enter configuration mode',
      '  show system information      Show hardware and software information',
      '  show system uptime           Show uptime and load averages',
      '  show interfaces terse        Show interface status',
      '  show route                   Show the routing table',
      '  ping <host> [count <n>]      Ping a host',
      '  exit                         Close the console',
    ].join(CRLF) + CRLF;
  }

  private helpConfiguration(): string {
    return [
      'Configuration commands:',
      '  set <statement>              Add a configuration statement',
      '  delete <statement>           Remove a configuration statement',
      '  edit <path>                  Enter a configuration hierarchy',
      '  up [n]                       Move up one or more levels',
      '  top                          Return to the top of the configuration',
      '  show                         Show the current hierarchy',
      '  show | display set           Show the configuration as set commands',
      '  run <command>                Run an operational command',
      '  commit                       Commit the configuration',
      '  exit                         Leave configuration mode',
    ].join(CRLF) + CRLF;
  }

  private showOperational(tokens: string[]): string {
    if (tokens.length === 0) return `% Incomplete command.${CRLF}`;
    const section = tokens[0].toLowerCase();
    const rest = tokens.slice(1);

    if (section === 'system') {
      if (rest.length === 0) return `% Incomplete command.${CRLF}`;
      const sub = rest[0].toLowerCase();
      if (sub === 'uptime' && rest.length === 1) return this.showSystemUptime();
      if (sub === 'information' && rest.length === 1) return this.showSystemInformation();
      if (sub === 'services' && rest.length === 1) return `SSH service is enabled.${CRLF}`;
      return `% Unknown command: show ${tokens.join(' ')}${CRLF}`;
    }

    if (section === 'interfaces') {
      if (rest.length === 0) return this.showInterfacesSummary();
      if (rest[0].toLowerCase() === 'terse') return this.showInterfacesTerse();
      if (rest[0].toLowerCase() === 'detail') {
        return this.showInterfaceDetail(rest[1]);
      }
      return this.showInterfaceDetail(rest[0]);
    }

    if (section === 'route') return this.showRoute();
    if (section === 'ospf') return this.showOspf(rest);
    if (section === 'version') return this.showVersion();
    if (section === 'configuration') return this.showConfiguration(rest);

    return `% Unknown command: show ${tokens.join(' ')}${CRLF}`;
  }

  private showSystemUptime(): string {
    const now = this.clock();
    const boot = new Date(now.getTime() - (1 * 86400 + 2 * 3600 + 47 * 60 + 12) * 1000);
    const protocols = new Date(boot.getTime() + 30 * 1000);
    const configured = new Date(now.getTime() - 2 * 60 * 1000);
    const time = formatUtc(now).slice(11, 16);
    return [
      `Current time: ${formatUtc(now)}`,
      `System booted: ${formatUtc(boot)} (${formatDuration(Math.floor((now.getTime() - boot.getTime()) / 1000))} ago)`,
      `Protocols started: ${formatUtc(protocols)} (${formatDuration(Math.floor((now.getTime() - protocols.getTime()) / 1000))} ago)`,
      `Last configured: ${formatUtc(configured)} (00:02:00 ago) by ${this.username}`,
      ` ${time}  up 1 day,  2:47, 1 user, load averages: 0.05, 0.07, 0.09`,
    ].join(CRLF) + CRLF;
  }

  private showSystemInformation(): string {
    return [
      `Model: ${this.model}`,
      `Junos version: ${this.version}`,
      `Hostname: ${this.hostname}`,
      `Serial number: ${this.serialNumber}`,
    ].join(CRLF) + CRLF;
  }

  private showVersion(): string {
    return [
      `Hostname: ${this.hostname}`,
      `Model: ${this.model}`,
      `Junos version: ${this.version}`,
      `JUNOS Software Release [${this.version}]`,
    ].join(CRLF) + CRLF;
  }

  private showConfiguration(tokens: string[]): string {
    const displaySet = tokens.some((token) => token.toLowerCase() === 'display') &&
      tokens.some((token) => token.toLowerCase() === 'set');
    return displaySet
      ? renderSetLines(this.config).join(CRLF) + CRLF
      : renderChildren(this.config, 0).join(CRLF) + CRLF;
  }

  private interfaceEntries(): InterfaceEntry[] {
    const interfaces = this.config.children.get('interfaces');
    if (!interfaces) return [];
    const entries: InterfaceEntry[] = [];

    interfaces.children.forEach((iface, ifname) => {
      const description = stripQuotes(iface.children.get('description')?.value);
      let hasUnit = false;
      iface.children.forEach((unit, segment) => {
        if (!segment.startsWith('unit ')) return;
        hasUnit = true;
        const unitId = segment.slice('unit '.length).trim();
        const address = unit.children.get('family inet')?.children.get('address')?.value;
        entries.push({
          ifname,
          unit: unitId,
          address,
          vlanId: unit.children.get('vlan-id')?.value,
          etherSwitching: unit.children.has('family ethernet-switching'),
          description: stripQuotes(unit.children.get('description')?.value) ?? description,
        });
      });
      if (!hasUnit) entries.push({ ifname, description });
    });

    return entries;
  }

  private showInterfacesTerse(): string {
    const entries = this.interfaceEntries();
    const rows: string[][] = [];
    const physicalSeen = new Set<string>();

    for (const entry of entries) {
      if (!physicalSeen.has(entry.ifname)) {
        physicalSeen.add(entry.ifname);
        rows.push([entry.ifname, 'up', 'up', '', '', '']);
      }
      if (entry.unit === undefined) continue;
      const logical = `${entry.ifname}.${entry.unit}`;
      if (entry.vlanId !== undefined) rows.push([logical, 'up', 'up', 'vlan', entry.vlanId, '']);
      if (entry.etherSwitching) rows.push([logical, 'up', 'up', 'eth-switch', '', '']);
      if (entry.address !== undefined) rows.push([logical, 'up', 'up', 'inet', entry.address, '']);
    }

    return table(['Interface', 'Admin', 'Link', 'Proto', 'Local', 'Remote'], rows).join(CRLF) + CRLF;
  }

  private showInterfacesSummary(): string {
    const entries = this.interfaceEntries();
    const byPhysical = new Map<string, InterfaceEntry[]>();
    for (const entry of entries) {
      const list = byPhysical.get(entry.ifname) ?? [];
      list.push(entry);
      byPhysical.set(entry.ifname, list);
    }

    const lines: string[] = [];
    let index = 128;
    byPhysical.forEach((units, ifname) => {
      lines.push(`Physical interface: ${ifname}, Enabled, Physical link is Up`);
      lines.push(`  Description: ${units[0].description ?? 'Unconfigured'}`);
      lines.push('  Type: Ethernet, Link-level type: Ethernet, MTU: 1500, Speed: 1000mbps');
      for (const unit of units) {
        if (unit.unit === undefined) continue;
        index += 1;
        lines.push(`  Logical interface ${ifname}.${unit.unit} (Index ${index})`);
        if (unit.vlanId !== undefined) lines.push(`    Flags: Up VLAN-Tag [ 0x8100.${unit.vlanId} ]`);
        if (unit.etherSwitching) lines.push('    Protocol ethernet-switching, MTU: 1514');
        if (unit.address !== undefined) {
          lines.push('    Protocol inet, MTU: 1500');
          lines.push('      Addresses, Flags: Is-Preferred Is-Primary');
          lines.push(`        Local: ${unit.address}`);
        }
      }
      index += 1;
      lines.push('');
    });

    return lines.length > 0 ? lines.slice(0, -1).join(CRLF) + CRLF : `No interfaces configured.${CRLF}`;
  }

  private showInterfaceDetail(name: string | undefined): string {
    const entries = this.interfaceEntries().filter((entry) =>
      name === undefined ? true : entry.ifname === name || `${entry.ifname}.${entry.unit}` === name,
    );
    if (entries.length === 0) {
      return `error: interface ${name ?? ''} not found${CRLF}`;
    }

    const lines: string[] = [];
    for (const entry of entries) {
      const logical = entry.unit === undefined ? entry.ifname : `${entry.ifname}.${entry.unit}`;
      lines.push(`Physical interface: ${entry.ifname}, Enabled, Physical link is Up`);
      lines.push(`  Description: ${entry.description ?? 'Unconfigured'}`);
      lines.push('  Type: Ethernet, Link-level type: Ethernet, MTU: 1500, Speed: 1000mbps');
      if (entry.unit !== undefined) {
        lines.push(`  Logical interface ${logical}`);
        if (entry.vlanId !== undefined) lines.push(`    Flags: Up VLAN-Tag [ 0x8100.${entry.vlanId} ]`);
        if (entry.etherSwitching) lines.push('    Protocol ethernet-switching, MTU: 1514');
        if (entry.address !== undefined) {
          lines.push('    Protocol inet, MTU: 1500');
          lines.push('      Addresses, Flags: Is-Preferred Is-Primary');
          lines.push(`        Local: ${entry.address}`);
        }
      }
      lines.push('');
    }

    return lines.slice(0, -1).join(CRLF) + CRLF;
  }

  private routes(): RouteEntry[] {
    const routes: RouteEntry[] = [];
    const seen = new Set<string>();
    const push = (route: RouteEntry): void => {
      if (seen.has(route.destination)) return;
      seen.add(route.destination);
      routes.push(route);
    };

    for (const entry of this.interfaceEntries()) {
      if (entry.address === undefined) continue;
      const [address, prefixText] = entry.address.split('/');
      const prefix = Number(prefixText);
      if (!Number.isInteger(prefix)) continue;
      const logical = entry.unit === undefined ? entry.ifname : `${entry.ifname}.${entry.unit}`;
      push({
        destination: `${networkAddress(address, prefix)}/${prefix}`,
        protocol: 'Direct',
        preference: '0',
        nextHop: `via ${logical}`,
        age: '00:02:14',
      });
      push({
        destination: `${address}/32`,
        protocol: 'Local',
        preference: '0',
        nextHop: `Local via ${logical}`,
        age: '00:02:14',
      });
    }

    if (this.config.children.get('protocols')?.children.get('ospf')) {
      const samples: Record<string, string[]> = {
        R1: ['2.2.2.2/32', '3.3.3.3/32', '10.0.23.0/30'],
        R2: ['1.1.1.1/32', '3.3.3.3/32', '10.0.10.0/24', '10.0.20.0/24'],
        R3: ['1.1.1.1/32', '2.2.2.2/32', '10.0.12.0/30', '10.0.10.0/24', '10.0.20.0/24'],
      };
      for (const destination of samples[this.hostname] ?? []) {
        push({
          destination,
          protocol: 'OSPF',
          preference: '10',
          nextHop: '> to 10.0.12.1 via ge-0/0/0.0',
          age: '00:01:03',
        });
      }
    }

    const staticRoutes = this.config.children.get('routing-options')?.children.get('static')?.children;
    staticRoutes?.forEach((route, segment) => {
      if (!segment.startsWith('route ')) return;
      const destination = segment.slice('route '.length).trim();
      const nextHop = route.children.get('next-hop')?.value ?? 'discard';
      push({
        destination,
        protocol: 'Static',
        preference: '5',
        nextHop: nextHop === 'discard' ? 'Discard' : `> to ${nextHop}`,
        age: '00:00:18',
      });
    });

    if (this.config.children.get('protocols')?.children.get('bgp')) {
      push({
        destination: '203.0.113.0/24',
        protocol: 'BGP',
        preference: '170',
        nextHop: '> to 10.0.12.2 via ge-0/0/0.0',
        age: '00:03:22',
      });
    }

    return routes;
  }

  private showRoute(): string {
    const routes = this.routes();
    const lines = [
      `inet.0: ${routes.length} destinations, ${routes.length} routes (${routes.length} active, 0 holddown, 0 hidden)`,
      '+ = Active Route, - = Last Active, * = Both',
      '',
    ];
    for (const route of routes) {
      lines.push(`${route.destination.padEnd(20)} *[${route.protocol}/${route.preference}] ${route.age}`);
      lines.push(`                    ${route.nextHop}`);
    }
    return lines.join(CRLF) + CRLF;
  }

  private showOspf(tokens: string[]): string {
    if (!this.config.children.get('protocols')?.children.get('ospf')) {
      return `OSPF is not configured.${CRLF}`;
    }
    const sub = (tokens[0] ?? 'neighbor').toLowerCase();
    if (sub === 'neighbor' || sub === 'neighbors') {
      return table(
        ['Address', 'Interface', 'State', 'ID', 'Pri', 'Dead'],
        [['10.0.12.2', 'ge-0/0/0.0', 'Full', '2.2.2.2', '128', '39']],
      ).join(CRLF) + CRLF;
    }
    if (sub === 'interface') {
      return table(
        ['Interface', 'State', 'Area', 'DR', 'BDR'],
        [
          ['ge-0/0/0.0', 'DR', '0.0.0.0', '10.0.12.1', '10.0.12.2'],
          ['lo0.0', 'Passive', '0.0.0.0', '0.0.0.0', '0.0.0.0'],
        ],
      ).join(CRLF) + CRLF;
    }
    return `OSPF overview: Router ID ${this.hostname === 'R2' ? '2.2.2.2' : this.hostname === 'R3' ? '3.3.3.3' : '1.1.1.1'}${CRLF}`;
  }

  private ping(tokens: string[]): string {
    if (tokens.length === 0) return `% Incomplete command.${CRLF}`;
    const target = tokens[0];
    if (ipv4ToInt(target) === null) {
      return `ping: cannot resolve ${target}: Unknown host${CRLF}`;
    }

    let count = 5;
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index].toLowerCase();
      if (token === 'count') {
        const parsed = Number(tokens[index + 1]);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          return `% Incomplete command.${CRLF}`;
        }
        count = parsed;
        index += 1;
      } else if (token === 'rapid' || token === 'source') {
        if (token === 'source') index += 1;
      } else {
        return `% Unknown command: ping ${tokens.slice(1).join(' ')}${CRLF}`;
      }
    }

    const local = this.interfaceEntries()
      .map((entry) => entry.address?.split('/')[0])
      .find((address) => address !== undefined && address === target);

    const lines = [`PING ${target} (${target}): 56 data bytes`];
    const times: number[] = [];
    for (let sequence = 0; sequence < count; sequence += 1) {
      const time = local ? 0 : 0.421 + sequence * 0.032;
      times.push(time);
      lines.push(`64 bytes from ${target}: icmp_seq=${sequence} ttl=64 time=${time.toFixed(3)} ms`);
    }
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((sum, value) => sum + value, 0) / times.length;
    lines.push('');
    lines.push(`--- ${target} ping statistics ---`);
    lines.push(`${count} packets transmitted, ${count} packets received, 0% packet loss`);
    lines.push(
      `round-trip min/avg/max/stddev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/0.000 ms`,
    );
    return lines.join(CRLF) + CRLF;
  }

  private completeOperational(tokens: string[]): string {
    if (tokens.length === 0) return formatCompletions(OPERATIONAL_COMMANDS);

    const command = tokens[0].toLowerCase();
    if (command === 'show') {
      if (tokens.length === 1) return formatCompletions(SHOW_COMMANDS);
      const second = tokens[1].toLowerCase();
      if (tokens.length === 2) {
        if ('system'.startsWith(second)) return formatCompletions(SYSTEM_COMMANDS);
        if ('interfaces'.startsWith(second)) return formatCompletions(INTERFACE_COMMANDS);
        if ('route'.startsWith(second)) return formatCompletions(ROUTE_COMMANDS);
        if ('ospf'.startsWith(second)) {
          return formatCompletions(OSPF_COMMANDS);
        }
        if ('configuration'.startsWith(second)) {
          return formatCompletions([['| display set', 'Show configuration as set commands']]);
        }
        return formatCompletions(SHOW_COMMANDS.filter(([word]) => word.startsWith(second)));
      }
      if (second === 'system') {
        return formatCompletions(
          SYSTEM_COMMANDS.filter(([word]) => word.startsWith((tokens[2] ?? '').toLowerCase())),
        );
      }
      if (second === 'interfaces') {
        return formatCompletions(
          INTERFACE_COMMANDS.filter(([word]) => word.startsWith((tokens[2] ?? '').toLowerCase())),
        );
      }
      if (second === 'route') {
        return formatCompletions(
          ROUTE_COMMANDS.filter(([word]) => word.startsWith((tokens[2] ?? '').toLowerCase())),
        );
      }
      if (second === 'ospf') {
        return formatCompletions(
          OSPF_COMMANDS.filter(([word]) => word.startsWith((tokens[2] ?? '').toLowerCase())),
        );
      }
      return '';
    }

    if (command === 'ping') {
      return formatCompletions([
        ['count', 'Number of echo requests'],
        ['rapid', 'Send requests rapidly'],
        ['source', 'Source address'],
      ]);
    }

    return formatCompletions(
      OPERATIONAL_COMMANDS.filter(([word]) => word.startsWith(command)),
    );
  }

  private completeConfiguration(tokens: string[]): string {
    const current = this.currentNode();
    if (!current) return '';

    let node = current;
    let working = tokens.slice();
    let hadCommand = false;
    if (working.length > 0 && CONFIG_COMMANDS.some(([command]) => command === working[0].toLowerCase())) {
      hadCommand = true;
      working = working.slice(1);
    }

    let index = 0;
    while (index < working.length) {
      const token = working[index];
      const exact = node.children.get(token);
      const compound = index + 1 < working.length ? node.children.get(`${token} ${working[index + 1]}`) : undefined;
      if (exact) {
        node = exact;
        index += 1;
        continue;
      }
      if (compound) {
        node = compound;
        index += 2;
        continue;
      }
      break;
    }

    const prefix = index < working.length ? working[index].toLowerCase() : '';
    const rows: CompletionRow[] = [];
    node.children.forEach((_child, segment) => {
      rows.push([segment, CONFIG_DESCRIPTIONS[segment] ?? CONFIG_DESCRIPTIONS[segment.split(' ')[0]] ?? '']);
    });

    const currentSegment = this.editPathValue[this.editPathValue.length - 1] ?? '';
    if (currentSegment.startsWith('unit ')) {
      rows.push(['description', 'Interface description']);
      rows.push(['vlan-id', '802.1Q VLAN ID']);
      rows.push(['family inet', 'IPv4 family']);
      rows.push(['family ethernet-switching', 'Layer 2 switching family']);
    } else if (currentSegment === 'family inet') {
      rows.push(['address', 'IPv4 address/prefix']);
    } else if (currentSegment === 'protocols' || currentSegment === 'ospf' || currentSegment === 'area 0.0.0.0') {
      rows.push(['interface', 'OSPF interface']);
      rows.push(['area', 'OSPF area']);
    } else if (currentSegment === 'interfaces') {
      rows.push(['ge-0/0/0', 'WAN interface']);
      rows.push(['ge-0/0/1', 'LAN/trunk interface']);
      rows.push(['lo0', 'Loopback interface']);
    } else if (this.editPathValue.length === 0 && !hadCommand) {
      rows.push(['interfaces', 'Interface configuration']);
      rows.push(['protocols', 'Routing protocols']);
      rows.push(['routing-options', 'Routing options']);
      rows.push(['system', 'System configuration']);
      rows.push(['vlans', 'VLAN definitions']);
    }

    const filtered = prefix ? rows.filter(([word]) => word.toLowerCase().startsWith(prefix)) : rows;
    if (!hadCommand && working.length === 0) {
      return formatCompletions([...CONFIG_COMMANDS, ...filtered]);
    }
    return formatCompletions(filtered);
  }
}

export class JunosEngineRegistry {
  private readonly engines = new Map<string, JunosEngine>();

  getOrCreate(nodeId: string, options: Omit<JunosEngineOptions, 'nodeId'>): JunosEngine {
    const existing = this.engines.get(nodeId);
    if (existing) return existing;
    const engine = new JunosEngine({ ...options, nodeId });
    this.engines.set(nodeId, engine);
    return engine;
  }

  get(nodeId: string): JunosEngine | undefined {
    return this.engines.get(nodeId);
  }

  remove(nodeId: string): boolean {
    return this.engines.delete(nodeId);
  }

  execute(nodeId: string, rawCmd: string): string {
    const engine = this.engines.get(nodeId);
    if (!engine) return `% Console session unavailable.${CRLF}`;
    return engine.executeCommand(rawCmd);
  }

  resetAll(): void {
    this.engines.clear();
  }

  get size(): number {
    return this.engines.size;
  }
}

export function createJunosEngineRegistry(): JunosEngineRegistry {
  return new JunosEngineRegistry();
}
