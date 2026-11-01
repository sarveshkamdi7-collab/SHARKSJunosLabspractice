import { JunosFallbackOptions, requestJunosFallback } from './junosFallback';
import { ConfigNode } from './junosConfig';
import { parseJunosCommand, ParsedJunosCommand, parseRollbackIndex } from './junosParser';
import {
  applyPipes,
  collectInterfaces,
  ConfigShape,
  renderArp,
  renderConfig,
  renderHelp,
  renderInterfacesDetail,
  renderInterfacesTerse,
  renderRouteSummary,
  renderRoutes,
  renderShowCompare,
  renderUptime,
  renderVersion,
  JunosRenderContext,
} from './junosRenderers';
import { JunosStateStore } from './junosStateStore';
import { findJunosTemplate } from './junosTemplates';
import { tokensToSegments } from './junosTokenizer';

export type JunosMode = 'operational' | 'configuration';

export interface JunosEngineOptions {
  nodeId: string;
  hostname?: string;
  username?: string;
  model?: string;
  version?: string;
  serialNumber?: string;
  setLines?: string[];
  maxRollbacks?: number;
  now?: () => Date;
  fallback?: JunosFallbackOptions;
}

export interface JunosSessionState {
  nodeId: string;
  mode: JunosMode;
  editPath: string[];
  prompt: string;
  hostname: string;
}

type CompletionRow = [word: string, description?: string];

const CRLF = '\r\n';

const OPERATIONAL_COMMANDS: CompletionRow[] = [
  ['configure', 'Enter configuration mode'],
  ['exit', 'Close the console'],
  ['help', 'Show available commands'],
  ['ping', 'Ping a host'],
  ['quit', 'Close the console'],
  ['show', 'Show operational information'],
];

const SHOW_COMMANDS: CompletionRow[] = [
  ['arp', 'Show ARP entries'],
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
  lo0: 'Loopback interface',
  'lo0.0': 'Loopback unit',
  ospf: 'OSPF routing process',
  passive: 'Do not send hellos',
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

export class JunosEngine {
  readonly nodeId: string;
  private readonly store: JunosStateStore;
  private readonly username: string;
  private readonly model: string;
  private readonly version: string;
  private readonly serialNumber: string;
  private readonly clock: () => Date;
  private readonly fallback: JunosFallbackOptions;

  constructor(options: JunosEngineOptions | string) {
    const normalized = typeof options === 'string' ? { nodeId: options } : options;
    this.nodeId = normalized.nodeId;
    this.username = normalized.username ?? 'user';
    this.model = normalized.model ?? 'vsrx';
    this.version = normalized.version ?? '21.4R3.15';
    this.serialNumber = normalized.serialNumber ?? 'JN1234567890';
    this.clock = normalized.now ?? (() => new Date());
    this.fallback = normalized.fallback ?? {};
    this.store = new JunosStateStore({
      nodeId: normalized.nodeId,
      hostname: normalized.hostname,
      username: this.username,
      setLines: normalized.setLines,
      maxRollbacks: normalized.maxRollbacks,
      now: this.clock,
    });
  }

  get mode(): JunosMode {
    return this.store.mode;
  }

  get editPath(): string[] {
    return this.store.editPath;
  }

  get hostname(): string {
    return this.store.hostname;
  }

  get prompt(): string {
    return this.store.prompt;
  }

  get state(): JunosSessionState {
    return {
      nodeId: this.nodeId,
      mode: this.store.mode,
      editPath: this.store.editPath,
      prompt: this.prompt,
      hostname: this.hostname,
    };
  }

  get activeConfig(): unknown {
    return this.store.activeConfig;
  }

  get candidateConfig(): unknown {
    return this.store.candidateConfig;
  }

  renderPrompt(clearLine = true): string {
    return `${clearLine ? '\x1b[2K\r' : ''}${this.prompt}`;
  }

  reset(): void {
    this.store.reset();
  }

  getRunningConfig(): string {
    const lines = this.store.activeRender();
    return lines.length > 0 ? lines.join(CRLF) + CRLF : '';
  }

  getSetCommands(): string {
    const lines = this.store.activeSetLines();
    return lines.length > 0 ? lines.join(CRLF) + CRLF : '';
  }

  getActiveConfig(): string {
    return this.getRunningConfig();
  }

  getActiveSetCommands(): string {
    return this.getSetCommands();
  }

  getCandidateConfig(): string {
    const lines = this.store.candidateRender();
    return lines.length > 0 ? lines.join(CRLF) + CRLF : '';
  }

  getCandidateSetCommands(): string {
    const lines = this.store.candidateSetLines();
    return lines.length > 0 ? lines.join(CRLF) + CRLF : '';
  }

  showCompare(): string {
    const diff = this.store.diff();
    return diff.length > 0 ? diff.join(CRLF) + CRLF : '';
  }

  executeCommand(rawCmd: string): string {
    const parsed = parseJunosCommand(rawCmd);
    if (parsed.raw.length === 0) return '';

    if (parsed.completion) {
      return this.store.mode === 'configuration'
        ? this.completeConfiguration(parsed.tokens)
        : this.completeOperational(parsed.tokens);
    }

    if (this.store.mode === 'configuration') return this.executeConfiguration(parsed);

    const output = this.executeOperational(parsed, this.store.activeRoot);
    if (output !== null) return this.finish(output, parsed);

    const template = findJunosTemplate({
      store: this.store,
      command: parsed.command,
      args: parsed.args,
    });
    if (template) return this.finish(template, parsed);

    return `% Unknown command: ${parsed.tokens.join(' ')}${CRLF}`;
  }

  async executeCommandAsync(rawCmd: string): Promise<string> {
    const local = this.executeCommand(rawCmd);
    if (!local.startsWith('% Unknown command:')) return local;

    const lines = await requestJunosFallback(String(rawCmd ?? '').trim(), this.store, this.fallback);
    if (!lines) return local;

    const parsed = parseJunosCommand(rawCmd);
    return this.finish(lines, parsed);
  }

  execute(rawCmd: string): string {
    return this.executeCommand(rawCmd);
  }

  executeAsync(rawCmd: string): Promise<string> {
    return this.executeCommandAsync(rawCmd);
  }

  private context(): JunosRenderContext {
    return {
      hostname: this.hostname,
      lastConfigured: this.store.lastConfigured,
      now: this.clock(),
    };
  }

  private finish(lines: string[], parsed: ParsedJunosCommand): string {
    const output = applyPipes(lines, parsed.pipes);
    return output.length > 0 ? output.join(CRLF) + CRLF : '';
  }

  private executeConfiguration(parsed: ParsedJunosCommand): string {
    const command = parsed.command;
    const args = parsed.args;

    if (command === 'top' && (args[0] ?? '').toLowerCase() === 'show') {
      this.store.top();
      const showCommand: ParsedJunosCommand = {
        ...parsed,
        command: 'show',
        args: args.slice(1),
      };
      return this.configShow(showCommand);
    }

    switch (command) {
      case 'set':
        if (args.length === 0) return `% Incomplete command.${CRLF}`;
        return this.store.set(args) ? '' : `% Unknown command: set ${args.join(' ')}${CRLF}`;
      case 'delete':
        if (args.length === 0) return `% Incomplete command.${CRLF}`;
        if (!this.store.delete(args)) {
          return `warning: statement not found: ${args[args.length - 1]}${CRLF}`;
        }
        return '';
      case 'edit':
        if (args.length === 0) return `% Incomplete command.${CRLF}`;
        this.store.edit(args);
        return '';
      case 'up': {
        const count = args.length === 0 ? 1 : Number(args[0]);
        if (!Number.isInteger(count) || count < 1) {
          return `% Unknown command: up ${args.join(' ')}${CRLF}`;
        }
        this.store.up(count);
        return '';
      }
      case 'top':
        this.store.top();
        return '';
      case 'show':
        return this.configShow(parsed);
      case 'run': {
        if (args.length === 0) return `% Incomplete command.${CRLF}`;
        const pipeText = parsed.pipes.map((pipe) => ` | ${pipe.join(' ')}`).join('');
        return this.runOperational(args.join(' ') + pipeText);
      }
      case 'commit':
        return this.commit(args);
      case 'rollback':
        return this.rollback(args);
      case 'exit':
      case 'quit':
        return this.store.exitConfiguration();
      case 'help':
        return this.helpConfiguration();
      case 'configure':
        return `% Not in operational mode.${CRLF}`;
      default:
        return `% Unknown command: ${parsed.tokens.join(' ')}${CRLF}`;
    }
  }

  private configShow(parsed: ParsedJunosCommand): string {
    if (parsed.pipes.some((pipe) => (pipe[0] ?? '').toLowerCase() === 'compare')) {
      return this.showCompare();
    }

    const shape: ConfigShape = parsed.pipes.some(
      (pipe) =>
        (pipe[0] ?? '').toLowerCase() === 'display' &&
        (pipe[1] ?? '').toLowerCase() === 'set',
    )
      ? 'set'
      : 'default';

    if (parsed.args.length === 0) {
      const lines = renderConfig(
        this.store.candidateRoot,
        this.store.configPathSegments(),
        this.context(),
        shape,
      );
      return this.finish(lines, parsed);
    }

    const lowered = parsed.args.map((arg) => arg.toLowerCase());
    let segments: string[];
    if (lowered[0] === 'configuration') {
      segments = tokensToSegments(parsed.args.slice(1));
    } else {
      segments = this.store.configPathSegments().concat(tokensToSegments(parsed.args));
    }

    const node = this.resolveConfig(this.store.candidateRoot, segments);
    if (!node) {
      const loweredArgs = parsed.args.map((arg) => arg.toLowerCase());
      const operationalSections = new Set([
        'arp',
        'bgp',
        'chassis',
        'ethernet-switching',
        'lldp',
        'ospf',
        'route',
        'system',
        'version',
      ]);
      const interfaceOperational =
        (loweredArgs[0] === 'interfaces' || loweredArgs[0] === 'interface') &&
        ['brief', 'detail', 'extensive', 'statistics', 'terse'].includes(loweredArgs[1] ?? '');
      if (operationalSections.has(loweredArgs[0] ?? '') || interfaceOperational) {
        const output = this.showOperational(parsed, this.store.candidateRoot);
        if (output) return this.finish(output, parsed);
      }
      return `warning: statement not found: ${segments.join(' ')}${CRLF}`;
    }

    const lines = renderConfig(this.store.candidateRoot, segments, this.context(), shape);
    return this.finish(lines, parsed);
  }

  private commit(args: string[]): string {
    const first = (args[0] ?? '').toLowerCase();
    if (first === 'check') return `configuration check succeeds${CRLF}`;
    if (first === 'confirmed') {
      this.store.commit();
      return `commit confirmed${CRLF}`;
    }
    if (first === 'comment' || first === 'and-quit') {
      this.store.commit();
      return `commit complete${CRLF}`;
    }
    if (args.length > 0) return `% Unknown command: commit ${args.join(' ')}${CRLF}`;

    this.store.commit();
    return `commit complete${CRLF}`;
  }

  private rollback(args: string[]): string {
    const index = parseRollbackIndex(args);
    if (index === null) return `% Unknown command: rollback ${args.join(' ')}${CRLF}`;
    const result = this.store.rollback(index);
    return result.ok ? `load complete${CRLF}` : result.message;
  }

  private executeOperational(parsed: ParsedJunosCommand, root: ConfigNode): string[] | null {
    switch (parsed.command) {
      case 'configure':
        if (parsed.args.length > 0 && (parsed.args[0] ?? '').toLowerCase() !== 'exclusive') {
          return null;
        }
        this.store.enterConfiguration();
        return ['Entering configuration mode'];
      case 'show':
        return this.showOperational(parsed, root);
      case 'ping':
        return this.ping(parsed.args, root);
      case 'help':
        return renderHelp();
      case 'clear':
        return ['\x1b[2J\x1b[H'];
      case 'exit':
      case 'quit':
        return ['Connection closed by foreign host.'];
      default:
        return null;
    }
  }

  private showOperational(parsed: ParsedJunosCommand, root: ConfigNode): string[] | null {
    if (parsed.pipes.some((pipe) => (pipe[0] ?? '').toLowerCase() === 'compare')) {
      const diff = renderShowCompare(this.store.diff());
      return diff.length > 0 ? diff : null;
    }

    if (parsed.args.length === 0) return ['% Incomplete command.'];
    const section = (parsed.args[0] ?? '').toLowerCase();
    const rest = parsed.args.slice(1);
    const lowered = rest.map((arg) => arg.toLowerCase());

    if (section === 'configuration') {
      const shape: ConfigShape = parsed.pipes.some(
        (pipe) =>
          (pipe[0] ?? '').toLowerCase() === 'display' &&
          (pipe[1] ?? '').toLowerCase() === 'set',
      )
        ? 'set'
        : 'default';
      const segments = tokensToSegments(rest);
      if (segments.length > 0 && !this.resolveConfig(root, segments)) {
        return [`warning: statement not found: ${segments.join(' ')}`];
      }
      return renderConfig(root, segments, this.context(), shape);
    }

    if (section === 'interfaces' || section === 'interface') {
      if (lowered[0] === 'terse') return renderInterfacesTerse(root);
      const qualifies = ['brief', 'detail', 'extensive', 'statistics'].includes(lowered[0] ?? '');
      const name = qualifies ? rest[1] : rest[0];
      return renderInterfacesDetail(root, name);
    }

    if (section === 'route') {
      if (lowered.includes('summary')) return renderRouteSummary(root);
      return renderRoutes(root);
    }

    if (section === 'arp') return renderArp(root);

    if (section === 'version') {
      return renderVersion(this.context(), this.model, this.version);
    }

    if (section === 'system') {
      if (rest.length === 0) return ['% Incomplete command.'];
      if (lowered[0] === 'uptime') return renderUptime(this.context());
      if (lowered[0] === 'information') {
        return [
          `Model: ${this.model}`,
          `Junos version: ${this.version}`,
          `Hostname: ${this.hostname}`,
          `Serial number: ${this.serialNumber}`,
        ];
      }
      if (lowered[0] === 'services') return ['SSH service is enabled.'];
      return findJunosTemplate({
        store: this.store,
        command: parsed.command,
        args: parsed.args,
      });
    }

    if (section === 'ospf' && rest.length === 0) {
      const routerId =
        this.hostname === 'R2' ? '2.2.2.2' : this.hostname === 'R3' ? '3.3.3.3' : '1.1.1.1';
      return [`OSPF overview: Router ID ${routerId}`];
    }

    return findJunosTemplate({
      store: this.store,
      command: parsed.command,
      args: parsed.args,
    });
  }

  private ping(tokens: string[], root: ConfigNode): string[] | null {
    if (tokens.length === 0) return ['% Incomplete command.'];
    const target = tokens[0];
    if (ipv4ToInt(target) === null) {
      return [`ping: cannot resolve ${target}: Unknown host`];
    }

    let count = 5;
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index].toLowerCase();
      if (token === 'count') {
        const parsed = Number(tokens[index + 1]);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
          return ['% Incomplete command.'];
        }
        count = parsed;
        index += 1;
      } else if (token === 'rapid' || token === 'source') {
        if (token === 'source') index += 1;
      } else {
        return null;
      }
    }

    const local = collectInterfaces(root)
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
    return lines;
  }

  private runOperational(raw: string): string {
    const parsed = parseJunosCommand(raw);
    const output = this.executeOperational(parsed, this.store.candidateRoot);
    if (output !== null) return this.finish(output, parsed);
    return `% Unknown command: ${parsed.tokens.join(' ')}${CRLF}`;
  }

  private resolveConfig(root: ConfigNode, segments: string[]): ConfigNode | null {
    let node = root;
    for (const segment of segments) {
      const child = node.children.get(segment);
      if (!child) return null;
      node = child;
    }
    return node;
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
      '  show | compare               Compare candidate with active configuration',
      '  run <command>                Run an operational command',
      '  commit                       Commit the configuration',
      '  exit                         Leave configuration mode',
    ].join(CRLF) + CRLF;
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
        if ('ospf'.startsWith(second)) return formatCompletions(OSPF_COMMANDS);
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
    const current = this.store.candidateAtCurrentPath();
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
      const compound =
        index + 1 < working.length ? node.children.get(`${token} ${working[index + 1]}`) : undefined;
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

    const path = this.store.configPathSegments();
    const currentSegment = path[path.length - 1] ?? '';
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
    } else if (path.length === 0 && !hadCommand) {
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

  async executeAsync(nodeId: string, rawCmd: string): Promise<string> {
    const engine = this.engines.get(nodeId);
    if (!engine) return `% Console session unavailable.${CRLF}`;
    return engine.executeCommandAsync(rawCmd);
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
