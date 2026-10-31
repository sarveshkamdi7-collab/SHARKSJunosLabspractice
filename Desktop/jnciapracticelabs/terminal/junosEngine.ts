export type JunosMode = 'operational' | 'configuration';

export interface JunosEngineOptions {
  nodeId: string;
  hostName?: string;
  userName?: string;
  model?: string;
  setLines?: string[];
}

export interface JunosCommandResult {
  lines: string[];
  prompt: string;
  mode: JunosMode;
  clear?: boolean;
  closed?: boolean;
}

interface JunosConfigNode {
  children: Map<string, JunosConfigNode>;
  value?: string;
}

interface IfaceEntry {
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

type CompletionRow = [string, string];

const OPER_VERBS = ['configure', 'exit', 'help', 'ping', 'quit', 'show'];
const CONFIG_COMMANDS = [
  'annotate',
  'commit',
  'delete',
  'edit',
  'exit',
  'help',
  'rollback',
  'run',
  'set',
  'show',
  'status',
  'top',
  'up',
];

const COMPOUND_KEYWORDS = new Set([
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

const OP_COMMANDS: CompletionRow[] = [
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

const SYSTEM_SUBCOMMANDS: CompletionRow[] = [
  ['commit', 'Show commit information'],
  ['information', 'Show hardware and software information'],
  ['services', 'Show service status'],
  ['uptime', 'Show uptime and load averages'],
];

const INTERFACE_SUBCOMMANDS: CompletionRow[] = [
  ['detail', 'Show detailed interface information'],
  ['terse', 'Show interface status in terse format'],
];

const ROUTE_SUBCOMMANDS: CompletionRow[] = [
  ['brief', 'Show brief route information'],
  ['detail', 'Show detailed route information'],
  ['protocol', 'Show routes by protocol'],
  ['summary', 'Show route summary'],
  ['table', 'Show a routing table'],
];

const OSPF_SUBCOMMANDS: CompletionRow[] = [
  ['interface', 'OSPF interfaces'],
  ['neighbor', 'OSPF neighbors'],
];

const PING_SUBCOMMANDS: CompletionRow[] = [
  ['count', 'Number of echo requests'],
  ['rapid', 'Send requests rapidly'],
  ['source', 'Source address'],
];

const CONFIG_DESCRIPTIONS: Record<string, string> = {
  address: 'Address/prefix',
  area: 'OSPF area',
  'autonomous-system': 'Autonomous system number',
  bgp: 'BGP routing process',
  chassis: 'Chassis configuration',
  description: 'Interface description',
  'ethernet-switching': 'Layer 2 switching family',
  export: 'Export policy',
  family: 'Protocol family',
  'family ethernet-switching': 'Layer 2 switching family',
  'family inet': 'IPv4 family',
  from: 'Match conditions',
  group: 'Peer group',
  'host-name': 'System hostname',
  'interface ge-0/0/0.0': 'OSPF interface',
  interface: 'Interface',
  interfaces: 'Interface configuration',
  inet: 'IPv4 family',
  'local-address': 'Source address',
  members: 'VLAN membership',
  'next-hop': 'Next-hop address',
  ospf: 'OSPF routing process',
  passive: 'Do not send hellos',
  'peer-as': 'Peer autonomous system',
  'policy-options': 'Routing policy',
  'policy-statement': 'Routing policy',
  'port-mode': 'Switch port mode',
  protocols: 'Routing protocols',
  route: 'Static route',
  'routing-options': 'Routing options',
  security: 'Security configuration',
  services: 'System services',
  snmp: 'SNMP configuration',
  static: 'Static routing',
  system: 'System configuration',
  term: 'Policy term',
  then: 'Actions',
  'time-zone': 'System time zone',
  type: 'BGP peer type',
  unit: 'Logical interface unit',
  'vlan-id': '802.1Q VLAN ID',
  vlan: 'VLAN configuration',
  vlan_t: 'VLAN tagging',
  'vlan-tagging': 'Enable 802.1Q tagging',
  vlans: 'VLAN definitions',
};

function createNode(): JunosConfigNode {
  return { children: new Map<string, JunosConfigNode>() };
}

function pad(indent: number): string {
  return ' '.repeat(indent * 4);
}

function stripQuotes(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/^"|"$/g, '');
}

function sameCmd(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function resolveVerb(token: string): string | null {
  const lower = token.toLowerCase();
  if (OPER_VERBS.includes(lower)) return lower;
  const matches = OPER_VERBS.filter((verb) => verb.startsWith(lower));
  return matches.length === 1 ? matches[0] : null;
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

function cidrToMask(cidr: number): number {
  return cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
}

function networkAddress(address: string, cidr: number): string {
  const value = ipv4ToInt(address);
  if (value === null) return address;
  return intToIpv4((value & cidrToMask(cidr)) >>> 0);
}

function looksLikeValue(token: string): boolean {
  return (
    /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(token) ||
    /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(token)
  );
}

function formatValue(keyword: string, value: string): string {
  if (keyword === 'description' || keyword === 'community') {
    return `"${stripQuotes(value) ?? ''}"`;
  }
  return value;
}

function findChild(
  node: JunosConfigNode,
  tokens: string[],
  start: number,
): { name: string; node: JunosConfigNode; consumed: number } | null {
  const max = Math.min(3, tokens.length - start);
  for (let take = max; take >= 1; take -= 1) {
    const name = tokens.slice(start, start + take).join(' ');
    const child = node.children.get(name);
    if (child) return { name, node: child, consumed: take };
  }
  return null;
}

function ensurePath(root: JunosConfigNode, tokens: string[]): JunosConfigNode {
  let node = root;
  let index = 0;
  while (index < tokens.length) {
    const hit = findChild(node, tokens, index);
    if (hit) {
      node = hit.node;
      index += hit.consumed;
      continue;
    }
    let name = tokens[index];
    let consumed = 1;
    if (COMPOUND_KEYWORDS.has(name) && index + 1 < tokens.length) {
      name = `${name} ${tokens[index + 1]}`;
      consumed = 2;
    }
    const child = createNode();
    node.children.set(name, child);
    node = child;
    index += consumed;
  }
  return node;
}

function setLeaf(parent: JunosConfigNode, name: string, value?: string): JunosConfigNode {
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

function applySetTokens(root: JunosConfigNode, tokens: string[]): void {
  if (tokens.length === 0) return;
  const last = tokens[tokens.length - 1];
  const previous = tokens.length >= 2 ? tokens[tokens.length - 2] : '';
  const isValue =
    (VALUE_KEYWORDS.has(previous) && !COMPOUND_KEYWORDS.has(previous)) || looksLikeValue(last);

  if (isValue && tokens.length >= 2) {
    const parent = ensurePath(root, tokens.slice(0, -1));
    parent.value = formatValue(previous, last);
    return;
  }

  ensurePath(root, tokens);
}

function resolveWithName(
  root: JunosConfigNode,
  tokens: string[],
): { node: JunosConfigNode; name: string } | null {
  let node = root;
  let name = '';
  let index = 0;
  while (index < tokens.length) {
    const hit = findChild(node, tokens, index);
    if (!hit) return null;
    node = hit.node;
    name = hit.name;
    index += hit.consumed;
  }
  return { node, name };
}

function deletePath(root: JunosConfigNode, tokens: string[]): boolean {
  let node = root;
  let parent: JunosConfigNode | null = null;
  let lastName = '';
  let index = 0;
  while (index < tokens.length) {
    const hit = findChild(node, tokens, index);
    if (!hit) return false;
    parent = node;
    lastName = hit.name;
    node = hit.node;
    index += hit.consumed;
  }
  if (parent) {
    parent.children.delete(lastName);
    return true;
  }
  return false;
}

function renderChildren(node: JunosConfigNode, indent: number): string[] {
  const lines: string[] = [];
  node.children.forEach((child, name) => {
    if (child.children.size === 0) {
      lines.push(`${pad(indent)}${name}${child.value !== undefined ? ` ${child.value}` : ''};`);
      return;
    }
    lines.push(`${pad(indent)}${name} {`);
    lines.push(...renderChildren(child, indent + 1));
    lines.push(`${pad(indent)}}`);
  });
  return lines;
}

function renderBlock(name: string, node: JunosConfigNode): string[] {
  return [`${name} {`, ...renderChildren(node, 1), '}'];
}

function renderSetLines(root: JunosConfigNode): string[] {
  const lines: string[] = [];
  const walk = (node: JunosConfigNode, path: string[]): void => {
    node.children.forEach((child, name) => {
      const next = [...path, name];
      if (child.children.size > 0) {
        walk(child, next);
      } else {
        lines.push(`set ${next.join(' ')}${child.value !== undefined ? ` ${child.value}` : ''}`);
      }
    });
  };
  walk(root, []);
  return lines;
}

function formatTable(headers: string[], rows: string[][]): string[] {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const render = (row: string[]): string =>
    row.map((cell, column) => (cell ?? '').padEnd(widths[column])).join('  ').trimEnd();
  return [render(headers), ...rows.map(render)];
}

function formatCompletions(rows: CompletionRow[]): string[] {
  const seen = new Set<string>();
  const uniqueRows = rows.filter(([word]) => {
    if (seen.has(word)) return false;
    seen.add(word);
    return true;
  });
  uniqueRows.sort((a, b) => a[0].localeCompare(b[0]));
  return uniqueRows.map(([word, description]) =>
    description ? `  ${word.padEnd(26)} ${description}` : `  ${word}`,
  );
}

function configRows(node: JunosConfigNode): CompletionRow[] {
  return [...node.children.keys()].map((name) => [
    name,
    CONFIG_DESCRIPTIONS[name] ?? CONFIG_DESCRIPTIONS[name.split(' ')[0]] ?? '',
  ]);
}

function addRow(rows: CompletionRow[], row: CompletionRow): void {
  if (!rows.some(([word]) => word === row[0])) rows.push(row);
}

function removeLastPathSegment(path: string[]): string[] {
  if (path.length === 0) return [];
  const last = path[path.length - 1];
  const previous = path.length >= 2 ? path[path.length - 2] : '';
  if (
    (previous === 'unit' && /^\d+$/.test(last)) ||
    previous === 'area' ||
    previous === 'term' ||
    previous === 'group' ||
    previous === 'interface' ||
    previous === 'rule' ||
    previous === 'rule-set'
  ) {
    return path.slice(0, -2);
  }
  return path.slice(0, -1);
}

function addUnit(
  iface: JunosConfigNode,
  unitId: string,
  address?: string,
  vlanId?: string,
  description?: string,
): JunosConfigNode {
  const unit = ensurePath(iface, ['unit', unitId]);
  if (vlanId !== undefined) setLeaf(unit, 'vlan-id', vlanId);
  if (description !== undefined) setLeaf(unit, 'description', `"${description}"`);
  if (address !== undefined) {
    const family = ensurePath(unit, ['family', 'inet']);
    setLeaf(family, 'address', address);
  }
  return unit;
}

function seedConfig(hostName: string): JunosConfigNode {
  const root = createNode();
  const system = ensurePath(root, ['system']);
  setLeaf(system, 'host-name', hostName);
  setLeaf(system, 'time-zone', 'UTC');
  const services = ensurePath(system, ['services']);
  setLeaf(services, 'ssh');

  const protocols = ensurePath(root, ['protocols']);
  const ospf = ensurePath(protocols, ['ospf']);
  const area = ensurePath(ospf, ['area', '0.0.0.0']);
  const interfaces = ensurePath(root, ['interfaces']);

  const loopback = ensurePath(interfaces, ['lo0']);
  const loopbackAddress =
    hostName === 'R2' ? '2.2.2.2/32' : hostName === 'R3' ? '3.3.3.3/32' : '1.1.1.1/32';
  addUnit(loopback, '0', loopbackAddress);

  if (hostName === 'R2') {
    const ge0 = ensurePath(interfaces, ['ge-0/0/0']);
    setLeaf(ge0, 'description', '"LINK-TO-R1"');
    addUnit(ge0, '0', '10.0.12.2/30');
    const ge1 = ensurePath(interfaces, ['ge-0/0/1']);
    setLeaf(ge1, 'description', '"LINK-TO-R3"');
    addUnit(ge1, '0', '10.0.23.1/30');
    ensurePath(area, ['interface', 'ge-0/0/0.0']);
    ensurePath(area, ['interface', 'ge-0/0/1.0']);
    setLeaf(ensurePath(area, ['interface', 'lo0.0']), 'passive');
  } else if (hostName === 'R3') {
    const ge0 = ensurePath(interfaces, ['ge-0/0/0']);
    setLeaf(ge0, 'description', '"LINK-TO-R2"');
    addUnit(ge0, '0', '10.0.23.2/30');
    ensurePath(area, ['interface', 'ge-0/0/0.0']);
    setLeaf(ensurePath(area, ['interface', 'lo0.0']), 'passive');
  } else {
    const ge0 = ensurePath(interfaces, ['ge-0/0/0']);
    setLeaf(ge0, 'description', '"LINK-TO-R2"');
    addUnit(ge0, '0', '10.0.12.1/30');
    const ge1 = ensurePath(interfaces, ['ge-0/0/1']);
    setLeaf(ge1, 'description', '"TRUNK-TO-SW1"');
    setLeaf(ge1, 'vlan-tagging');
    addUnit(ge1, '0', '10.0.10.1/24', '10', 'STAFF-VLAN');
    addUnit(ge1, '20', '10.0.20.1/24', '20', 'GUEST-VLAN');
    ensurePath(area, ['interface', 'ge-0/0/0.0']);
    ensurePath(area, ['interface', 'ge-0/0/1.0']);
    ensurePath(area, ['interface', 'ge-0/0/1.20']);
    setLeaf(ensurePath(area, ['interface', 'lo0.0']), 'passive');
  }

  return root;
}

function utcDate(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function utcTime(value: Date): string {
  const hours = String(value.getUTCHours()).padStart(2, '0');
  const minutes = String(value.getUTCMinutes()).padStart(2, '0');
  const seconds = String(value.getUTCSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function formatDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export class JunosEngine {
  readonly nodeId: string;
  readonly model: string;
  private configValue: JunosConfigNode;
  private modeValue: JunosMode = 'operational';
  private editPathValue: string[] = [];
  private commitStatusValue: string[] = [];
  private readonly hostNameValue: string;
  private readonly userNameValue: string;

  constructor(options: JunosEngineOptions) {
    this.nodeId = options.nodeId;
    this.hostNameValue = options.hostName ?? 'R1';
    this.userNameValue = options.userName ?? 'user';
    this.model = options.model ?? 'vsrx';
    const setLines = options.setLines ?? [];
    this.configValue = setLines.length > 0 ? createNode() : seedConfig(this.hostNameValue);
    for (const line of setLines) {
      const tokens = tokenize(line.replace(/^\s*set\s+/i, ''));
      applySetTokens(this.configValue, tokens);
    }
  }

  get mode(): JunosMode {
    return this.modeValue;
  }

  get editPath(): string[] {
    return [...this.editPathValue];
  }

  get host(): string {
    return stripQuotes(this.configValue.children.get('system')?.children.get('host-name')?.value) ?? this.hostNameValue;
  }

  get prompt(): string {
    const userHost = `${this.userNameValue}@${this.host}`;
    if (this.modeValue === 'operational') return `${userHost}> `;
    const path = this.editPathValue.length > 0 ? ` ${this.editPathValue.join(' ')}` : '';
    return `[edit${path}]\n${userHost}# `;
  }

  reset(): void {
    this.configValue = seedConfig(this.hostNameValue);
    this.modeValue = 'operational';
    this.editPathValue = [];
    this.commitStatusValue = [];
  }

  renderResult(result: JunosCommandResult): string {
    const clear = result.clear ? '\x1b[2K\r' : '';
    return clear + result.lines.join('\r\n') + (result.lines.length > 0 ? '\r\n' : '');
  }

  execute(input: string): JunosCommandResult {
    const cleaned = input.replace(/[\r\n]+/g, ' ').trim();
    if (cleaned.length === 0) return this.result([]);

    if (cleaned.includes('?')) {
      const before = cleaned.slice(0, cleaned.indexOf('?'));
      const tokens = tokenize(before);
      const lines =
        this.modeValue === 'configuration'
          ? this.completeConfiguration(tokens)
          : this.completeOperational(tokens);
      return this.result(lines);
    }

    const tokens = tokenize(cleaned);
    const command = (tokens[0] ?? '').toLowerCase();
    const normalized = tokens.join(' ');

    if (this.modeValue === 'configuration') {
      switch (command) {
        case 'set':
          return this.result(this.configSet(tokens.slice(1)));
        case 'delete':
          return this.result(this.configDelete(tokens.slice(1)));
        case 'edit':
          return this.result(this.configEdit(tokens.slice(1)));
        case 'up':
          return this.result(this.configUp());
        case 'top':
          return this.result(this.configTop());
        case 'exit':
        case 'quit':
          return this.configExit();
        case 'show':
          return this.result(this.configShow(tokens.slice(1)));
        case 'run':
          return this.result(this.configRun(tokens.slice(1)));
        case 'commit':
          return this.result(this.configCommit());
        case 'rollback':
          return this.result(this.configRollback());
        case 'annotate':
          return this.result(this.configAnnotate(tokens.slice(1)));
        case 'status':
          return this.result(this.configStatus());
        case 'help':
          return this.result(this.helpConfiguration());
        case 'configure':
          return this.result(['% Not in operational mode.']);
        default:
          return this.result([`% Unknown command: ${normalized}`]);
      }
    }

    switch (command) {
      case 'configure':
        return this.enterConfiguration(tokens.slice(1));
      case 'show':
        return this.result(this.showOperational(tokens.slice(1)));
      case 'ping':
        return this.result(this.ping(tokens.slice(1)));
      case 'exit':
      case 'quit':
        return { lines: [], prompt: this.prompt, mode: this.modeValue, closed: true };
      case 'help':
        return this.result(this.helpOperational());
      case 'clear':
        return this.result([], true);
      case 'request':
        return this.result(this.request(tokens.slice(1)));
      default:
        return this.result([`% Unknown command: ${normalized}`]);
    }
  }

  complete(input: string): JunosCommandResult {
    const before = input.includes('?') ? input.slice(0, input.indexOf('?')) : input;
    const tokens = tokenize(before);
    const lines =
      this.modeValue === 'configuration'
        ? this.completeConfiguration(tokens)
        : this.completeOperational(tokens);
    return this.result(lines);
  }

  showRunningConfig(): string[] {
    return renderChildren(this.configValue, 0);
  }

  showSetCommands(): string[] {
    return renderSetLines(this.configValue);
  }

  private result(lines: string[], clear = false): JunosCommandResult {
    return { lines, prompt: this.prompt, mode: this.modeValue, clear };
  }

  private enterConfiguration(args: string[]): JunosCommandResult {
    if (args.length > 0 && !sameCmd(args[0], 'exclusive')) {
      return this.result([`% Unknown command: configure ${args.join(' ')}`]);
    }
    this.modeValue = 'configuration';
    this.editPathValue = [];
    return this.result(args.length > 0 ? ['Entering configuration mode', ''] : ['']);
  }

  private configSet(tokens: string[]): string[] {
    if (tokens.length === 0) return ['% Incomplete command.'];
    applySetTokens(this.configValue, this.editPathValue.concat(tokens));
    this.commitStatusValue.push(`set ${tokens.join(' ')}`);
    return [];
  }

  private configDelete(tokens: string[]): string[] {
    if (tokens.length === 0) return ['% Incomplete command.'];
    const full = this.editPathValue.concat(tokens);
    if (!deletePath(this.configValue, full)) {
      return [`warning: statement not found: ${tokens[tokens.length - 1]}`];
    }
    this.commitStatusValue.push(`delete ${tokens.join(' ')}`);
    return [];
  }

  private configEdit(tokens: string[]): string[] {
    if (tokens.length === 0) return ['% Incomplete command.'];
    const full = this.editPathValue.concat(tokens);
    ensurePath(this.configValue, full);
    this.editPathValue = full;
    return [];
  }

  private configUp(): string[] {
    this.editPathValue = removeLastPathSegment(this.editPathValue);
    return [];
  }

  private configTop(): string[] {
    this.editPathValue = [];
    return [];
  }

  private configExit(): JunosCommandResult {
    if (this.editPathValue.length > 0) {
      this.editPathValue = removeLastPathSegment(this.editPathValue);
      return this.result([]);
    }
    this.modeValue = 'operational';
    return this.result([]);
  }

  private configShow(tokens: string[]): string[] {
    if (tokens.length === 0 || (tokens[0] === '|' && tokens[1]?.toLowerCase() === 'display')) {
      const current = resolveWithName(this.configValue, this.editPathValue);
      if (!current) return ['error: configuration path not found'];
      if (this.editPathValue.length === 0) return renderChildren(current.node, 0);
      return renderBlock(current.name, current.node);
    }

    const full = this.editPathValue.concat(tokens);
    const current = resolveWithName(this.configValue, full);
    if (!current) return [`error: statement not found: ${tokens[tokens.length - 1]}`];
    return current.name ? renderBlock(current.name, current.node) : renderChildren(current.node, 0);
  }

  private configRun(tokens: string[]): string[] {
    if (tokens.length === 0) return ['% Incomplete command.'];
    const savedMode = this.modeValue;
    const savedPath = this.editPathValue;
    this.modeValue = 'operational';
    this.editPathValue = [];
    const result = this.execute(tokens.join(' '));
    this.modeValue = savedMode;
    this.editPathValue = savedPath;
    return result.lines;
  }

  private configCommit(): string[] {
    this.commitStatusValue = [];
    return ['commit complete'];
  }

  private configRollback(): string[] {
    this.commitStatusValue = [];
    return ['load complete'];
  }

  private configAnnotate(tokens: string[]): string[] {
    const path = this.editPathValue.length > 0 ? ` ${this.editPathValue.join(' ')}` : '';
    return [`[edit${path}]`, `/* ${tokens.join(' ')} */`];
  }

  private configStatus(): string[] {
    if (this.commitStatusValue.length === 0) return ['No configuration changes to commit.'];
    return this.commitStatusValue.slice();
  }

  private helpOperational(): string[] {
    return [
      'Operational commands:',
      '  configure                    Enter configuration mode',
      '  show system information      Show hardware and software information',
      '  show system uptime           Show uptime and load averages',
      '  show interfaces terse        Show interface status',
      '  show route                   Show the routing table',
      '  ping <host> [count <n>]      Ping a host',
      '  exit                         Close the console',
    ];
  }

  private helpConfiguration(): string[] {
    return [
      'Configuration commands:',
      '  set <statement>              Add a configuration statement',
      '  delete <statement>           Remove a configuration statement',
      '  edit <path>                  Enter a configuration hierarchy',
      '  up / top                     Move up or return to the top',
      '  show                         Show the current hierarchy',
      '  show | display set           Show the configuration as set commands',
      '  run <command>                Run an operational command',
      '  commit                       Commit the configuration',
      '  exit                         Leave configuration mode',
    ];
  }

  private showOperational(tokens: string[]): string[] {
    if (tokens.length === 0) return ['% Incomplete command.'];
    const section = tokens[0].toLowerCase();
    const rest = tokens.slice(1);

    if (section === 'system') {
      if (rest.length === 0) return ['% Incomplete command.'];
      const sub = rest[0].toLowerCase();
      if (sub === 'uptime') return this.showSystemUptime();
      if (sub === 'information') return this.showSystemInformation();
      if (sub === 'services') return ['SSH service is enabled.'];
      if (sub === 'commit') return ['No commit history available.'];
      return [`% Unknown command: show system ${rest.join(' ')}`];
    }

    if (section === 'interfaces') {
      if (rest.length === 0) return this.showInterfacesSummary();
      if (rest[0].toLowerCase() === 'terse') return this.showInterfacesTerse();
      if (rest[0].toLowerCase() === 'detail') return this.showInterfaceDetail(rest[1]);
      return this.showInterfaceDetail(rest[0]);
    }

    if (section === 'route') return this.showRoute(rest);
    if (section === 'ospf') return this.showOspf(rest);
    if (section === 'version') return this.showVersion();
    if (section === 'configuration') return this.showConfiguration(rest);

    return [`% Unknown command: show ${tokens.join(' ')}`];
  }

  private showSystemUptime(): string[] {
    const now = new Date();
    const boot = new Date(now.getTime() - (1 * 86400 + 2 * 3600 + 47 * 60 + 12) * 1000);
    const protocolsStarted = new Date(boot.getTime() + 30 * 1000);
    const lastConfigured = new Date(now.getTime() - 2 * 60 * 1000);
    return [
      `Current time: ${utcDate(now)} ${utcTime(now)} UTC`,
      `System booted: ${utcDate(boot)} ${utcTime(boot)} UTC (${formatDuration(Math.floor((now.getTime() - boot.getTime()) / 1000))} ago)`,
      `Protocols started: ${utcDate(protocolsStarted)} ${utcTime(protocolsStarted)} UTC (${formatDuration(Math.floor((now.getTime() - protocolsStarted.getTime()) / 1000))} ago)`,
      `Last configured: ${utcDate(lastConfigured)} ${utcTime(lastConfigured)} UTC (00:02:00 ago) by ${this.userNameValue}`,
      ` ${utcTime(now).slice(0, 5)}  up 1 day,  2:47, 1 user, load averages: 0.05, 0.07, 0.09`,
    ];
  }

  private showSystemInformation(): string[] {
    return [
      'Hostname: ' + this.host,
      'Model: ' + this.model,
      'Family: junos',
      'Junos: 21.4R3.15',
      'JUNOS Software Release [21.4R3.15]',
    ];
  }

  private showVersion(): string[] {
    return [
      `Hostname: ${this.host}`,
      `Model: ${this.model}`,
      'Junos: 21.4R3.15',
      'JUNOS Software Release [21.4R3.15]',
    ];
  }

  private showConfiguration(tokens: string[]): string[] {
    const displaySet = tokens.some((token) => sameCmd(token, 'display')) && tokens.some((token) => sameCmd(token, 'set'));
    return displaySet ? renderSetLines(this.configValue) : renderChildren(this.configValue, 0);
  }

  private interfaceEntries(): IfaceEntry[] {
    const interfaces = this.configValue.children.get('interfaces');
    if (!interfaces) return [];
    const entries: IfaceEntry[] = [];

    interfaces.children.forEach((iface, ifname) => {
      const description = stripQuotes(iface.children.get('description')?.value);
      let hasUnit = false;
      iface.children.forEach((unit, unitName) => {
        if (!unitName.startsWith('unit ')) return;
        hasUnit = true;
        const unitId = unitName.slice('unit '.length).trim();
        const vlanId = unit.children.get('vlan-id')?.value;
        const inet = unit.children.get('family inet');
        const address = inet?.children.get('address')?.value;
        const etherSwitching = unit.children.has('family ethernet-switching');
        entries.push({
          ifname,
          unit: unitId,
          address,
          vlanId,
          etherSwitching,
          description: stripQuotes(unit.children.get('description')?.value) ?? description,
        });
      });
      if (!hasUnit) entries.push({ ifname, description });
    });

    return entries;
  }

  private showInterfacesTerse(): string[] {
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

    return formatTable(['Interface', 'Admin', 'Link', 'Proto', 'Local', 'Remote'], rows);
  }

  private showInterfacesSummary(): string[] {
    const entries = this.interfaceEntries();
    const byPhysical = new Map<string, IfaceEntry[]>();
    for (const entry of entries) {
      const list = byPhysical.get(entry.ifname) ?? [];
      list.push(entry);
      byPhysical.set(entry.ifname, list);
    }

    const lines: string[] = [];
    let index = 128;
    byPhysical.forEach((units, ifname) => {
      const description = units[0].description ?? 'Unconfigured';
      lines.push(`Physical interface: ${ifname}, Enabled, Physical link is Up`);
      lines.push(`  Interface index: ${index}, SNMP ifIndex: ${index + 384}`);
      lines.push(`  Description: ${description}`);
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

    return lines.length > 0 ? lines.slice(0, -1) : ['No interfaces configured.'];
  }

  private showInterfaceDetail(name: string | undefined): string[] {
    const entries = this.interfaceEntries().filter((entry) =>
      name === undefined ? true : entry.ifname === name || `${entry.ifname}.${entry.unit}` === name,
    );
    if (entries.length === 0) return [`error: interface ${name ?? ''} not found`];

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
    return lines.slice(0, -1);
  }

  private configuredRoutes(): RouteEntry[] {
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

    const ospf = this.configValue.children.get('protocols')?.children.get('ospf');
    if (ospf) {
      const samples: Record<string, string[]> = {
        R1: ['2.2.2.2/32', '3.3.3.3/32', '10.0.23.0/30'],
        R2: ['1.1.1.1/32', '3.3.3.3/32', '10.0.10.0/24', '10.0.20.0/24'],
        R3: ['1.1.1.1/32', '2.2.2.2/32', '10.0.12.0/30', '10.0.10.0/24', '10.0.20.0/24'],
      };
      for (const destination of samples[this.host] ?? []) {
        push({
          destination,
          protocol: 'OSPF',
          preference: '10',
          nextHop: '> to 10.0.12.1 via ge-0/0/0.0',
          age: '00:01:03',
        });
      }
    }

    const staticRoutes = this.configValue.children.get('routing-options')?.children.get('static')?.children;
    staticRoutes?.forEach((route, name) => {
      if (!name.startsWith('route ')) return;
      const destination = name.slice('route '.length).trim();
      const nextHop = route.children.get('next-hop')?.value ?? 'discard';
      push({
        destination,
        protocol: 'Static',
        preference: '5',
        nextHop: nextHop === 'discard' ? 'Discard' : `> to ${nextHop}`,
        age: '00:00:18',
      });
    });

    if (this.configValue.children.get('protocols')?.children.get('bgp')) {
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

  private showRoute(tokens: string[]): string[] {
    const routes = this.configuredRoutes();
    const header = `inet.0: ${routes.length} destinations, ${routes.length} routes (${routes.length} active, 0 holddown, 0 hidden)`;
    const lines = [header, '+ = Active Route, - = Last Active, * = Both', ''];
    for (const route of routes) {
      lines.push(
        `${route.destination.padEnd(20)} *[${route.protocol}/${route.preference}] ${route.age}`,
      );
      lines.push(`                    ${route.nextHop}`);
    }
    if (tokens.length > 0 && tokens[0].toLowerCase() === 'summary') {
      const byProtocol = new Map<string, number>();
      for (const route of routes) byProtocol.set(route.protocol, (byProtocol.get(route.protocol) ?? 0) + 1);
      lines.push('');
      lines.push('Route summary:');
      byProtocol.forEach((count, protocol) => lines.push(`  ${protocol}: ${count}`));
    }
    return lines;
  }

  private showOspf(tokens: string[]): string[] {
    if (!this.configValue.children.get('protocols')?.children.get('ospf')) {
      return ['OSPF is not configured.'];
    }
    const sub = (tokens[0] ?? 'neighbor').toLowerCase();
    if (sub === 'neighbor' || sub === 'neighbors') {
      return formatTable(
        ['Address', 'Interface', 'State', 'ID', 'Pri', 'Dead'],
        [['10.0.12.2', 'ge-0/0/0.0', 'Full', '2.2.2.2', '128', '39']],
      );
    }
    if (sub === 'interface') {
      return formatTable(
        ['Interface', 'State', 'Area', 'DR', 'BDR'],
        [
          ['ge-0/0/0.0', 'DR', '0.0.0.0', '10.0.12.1', '10.0.12.2'],
          ['lo0.0', 'Passive', '0.0.0.0', '0.0.0.0', '0.0.0.0'],
        ],
      );
    }
    return ['OSPF overview: Router ID ' + (this.host === 'R2' ? '2.2.2.2' : this.host === 'R3' ? '3.3.3.3' : '1.1.1.1')];
  }

  private ping(tokens: string[]): string[] {
    if (tokens.length === 0) return ['% Incomplete command.'];
    const target = tokens[0];
    if (ipv4ToInt(target) === null) return [`ping: cannot resolve ${target}: Unknown host`];

    let count = 5;
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index].toLowerCase();
      if (token === 'count') {
        const parsed = Number(tokens[index + 1]);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return ['% Invalid count value.'];
        count = parsed;
        index += 1;
      } else if (token === 'rapid' || token === 'source') {
        if (token === 'source') index += 1;
      } else {
        return [`% Unknown command: ping ${tokens.slice(1).join(' ')}`];
      }
    }

    const localAddress = this.interfaceEntries()
      .map((entry) => entry.address?.split('/')[0])
      .find((address) => address !== undefined && address === target);

    const lines = [`PING ${target} (${target}): 56 data bytes`];
    const times: number[] = [];
    for (let sequence = 0; sequence < count; sequence += 1) {
      const time = localAddress ? 0 : 0.421 + sequence * 0.032;
      times.push(time);
      lines.push(`64 bytes from ${target}: icmp_seq=${sequence} ttl=64 time=${time.toFixed(3)} ms`);
    }
    const total = times.reduce((sum, value) => sum + value, 0);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = total / times.length;
    lines.push('');
    lines.push(`--- ${target} ping statistics ---`);
    lines.push(`${count} packets transmitted, ${count} packets received, 0% packet loss`);
    lines.push(
      `round-trip min/avg/max/stddev = ${min.toFixed(3)}/${avg.toFixed(3)}/${max.toFixed(3)}/0.000 ms`,
    );
    return lines;
  }

  private request(tokens: string[]): string[] {
    const joined = tokens.join(' ').toLowerCase();
    if (joined === 'system reboot' || joined === 'system halt') {
      return ['Shutdown NOW!', 'System going down immediately.'];
    }
    return [`% Unknown command: request ${tokens.join(' ')}`];
  }

  private completeOperational(tokens: string[]): string[] {
    if (tokens.length === 0) return formatCompletions(OP_COMMANDS);

    const verb = resolveVerb(tokens[0]);
    if (verb === null) {
      return formatCompletions(OP_COMMANDS.filter(([word]) => word.startsWith(tokens[0].toLowerCase())));
    }

    if (tokens.length === 1) {
      if (verb === 'show') return formatCompletions(SHOW_COMMANDS);
      if (verb === 'ping') return formatCompletions(PING_SUBCOMMANDS);
      if (verb === 'configure') return formatCompletions([['exclusive', 'Enter exclusive configuration mode']]);
      return formatCompletions(OP_COMMANDS);
    }

    if (verb === 'show') {
      const second = tokens[1].toLowerCase();
      if (tokens.length === 2) {
        const rows: CompletionRow[] = [];
        if ('system'.startsWith(second)) rows.push(...SYSTEM_SUBCOMMANDS);
        if ('interfaces'.startsWith(second)) rows.push(...INTERFACE_SUBCOMMANDS);
        if ('route'.startsWith(second)) rows.push(...ROUTE_SUBCOMMANDS);
        if ('ospf'.startsWith(second)) rows.push(...OSPF_SUBCOMMANDS);
        if ('configuration'.startsWith(second)) rows.push(['| display set', 'Show configuration as set commands']);
        return formatCompletions(rows);
      }

      if (second === 'system') {
        return formatCompletions(SYSTEM_SUBCOMMANDS.filter(([word]) => word.startsWith(tokens[2].toLowerCase())));
      }
      if (second === 'interfaces') {
        const prefix = tokens[2]?.toLowerCase() ?? '';
        return formatCompletions(
          this.interfaceEntries()
            .map((entry): CompletionRow => [
              entry.unit === undefined ? entry.ifname : `${entry.ifname}.${entry.unit}`,
              entry.address ?? entry.description ?? '',
            ])
            .filter(([word]) => word.toLowerCase().startsWith(prefix)),
        );
      }
      if (second === 'route') {
        return formatCompletions(ROUTE_SUBCOMMANDS.filter(([word]) => word.startsWith((tokens[2] ?? '').toLowerCase())));
      }
      if (second === 'ospf') {
        return formatCompletions(
          OSPF_SUBCOMMANDS.filter(([word]) => word.startsWith((tokens[2] ?? '').toLowerCase())),
        );
      }
      return [];
    }

    if (verb === 'ping') {
      return formatCompletions(PING_SUBCOMMANDS.filter(([word]) => word.startsWith((tokens[1] ?? '').toLowerCase())));
    }

    return [];
  }

  private completeConfiguration(tokens: string[]): string[] {
    const current = resolveWithName(this.configValue, this.editPathValue);
    if (!current) return [];

    let node = current.node;
    let working = tokens.slice();
    let hadCommand = false;
    if (working.length > 0 && CONFIG_COMMANDS.some((command) => sameCmd(command, working[0]))) {
      hadCommand = true;
      working = working.slice(1);
    }

    const exact = working.length > 0 ? resolveWithName(node, working) : null;
    let prefix = '';
    if (exact) {
      node = exact.node;
    } else {
      prefix = working.length > 0 ? working[working.length - 1].toLowerCase() : '';
    }

    const rows = configRows(node);
    const key = exact ? exact.name : current.name;

    if (key.startsWith('unit ')) {
      addRow(rows, ['description', 'Interface description']);
      addRow(rows, ['vlan-id', '802.1Q VLAN ID']);
      addRow(rows, ['family inet', 'IPv4 family']);
      addRow(rows, ['family ethernet-switching', 'Layer 2 switching family']);
    } else if (key === 'family inet') {
      addRow(rows, ['address', 'IPv4 address/prefix']);
    } else if (key === 'protocols' || key === 'ospf' || key === 'area 0.0.0.0') {
      addRow(rows, ['interface', 'OSPF interface']);
      addRow(rows, ['area', 'OSPF area']);
    } else if (key === 'interfaces') {
      addRow(rows, ['ge-0/0/0', 'WAN interface']);
      addRow(rows, ['ge-0/0/1', 'LAN/trunk interface']);
      addRow(rows, ['lo0', 'Loopback interface']);
    } else if (key === '') {
      addRow(rows, ['interfaces', 'Interface configuration']);
      addRow(rows, ['protocols', 'Routing protocols']);
      addRow(rows, ['routing-options', 'Routing options']);
      addRow(rows, ['system', 'System configuration']);
      addRow(rows, ['vlans', 'VLAN definitions']);
    }

    const filtered = prefix ? rows.filter(([word]) => word.toLowerCase().startsWith(prefix)) : rows;
    const lines = formatCompletions(filtered);

    if (!hadCommand && working.length === 0) {
      return formatCompletions([...CONFIG_COMMANDS.map((command): CompletionRow => [command, '']), ...filtered]);
    }
    return lines;
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

  reset(nodeId: string, options: Omit<JunosEngineOptions, 'nodeId'>): JunosEngine {
    const engine = this.engines.get(nodeId) ?? new JunosEngine({ ...options, nodeId });
    engine.reset();
    this.engines.set(nodeId, engine);
    return engine;
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
