import {
  ConfigJson,
  ConfigNode,
  cloneConfigNode,
  configFromSetLines,
  configToJson,
  deleteUnder,
  diffConfigs,
  ensureEditSegments,
  flattenConfig,
  pruneVirtual,
  renderChildren,
  renderSetLines,
  resolveSegments,
  setUnder,
} from './junosConfig';
import { segmentsToTokens, stripQuotes, tokensToSegments } from './junosTokenizer';

export interface JunosStateStoreOptions {
  nodeId: string;
  hostname?: string;
  username?: string;
  setLines?: string[];
  maxRollbacks?: number;
  now?: () => Date;
}

export interface JunosRollbackResult {
  ok: boolean;
  message: string;
}

export class JunosStateStore {
  readonly nodeId: string;
  private readonly username: string;
  private readonly hostnameFallback: string;
  private readonly maxRollbacks: number;
  private readonly clock: () => Date;
  private readonly baselineRoot: ConfigNode;
  private activeValue: ConfigNode;
  private candidateValue: ConfigNode;
  private rollbackRoots: ConfigNode[] = [];
  private modeValue: 'operational' | 'configuration' = 'operational';
  private editPathValue: string[] = [];
  private dirtyValue = false;
  private commitCountValue = 0;
  private lastConfiguredValue: Date;

  constructor(options: JunosStateStoreOptions) {
    this.nodeId = options.nodeId;
    this.username = options.username ?? 'user';
    this.hostnameFallback = options.hostname ?? 'R1';
    this.maxRollbacks = Math.max(1, options.maxRollbacks ?? 50);
    this.clock = options.now ?? (() => new Date());
    this.baselineRoot = configFromSetLines(options.setLines, this.hostnameFallback);
    this.activeValue = cloneConfigNode(this.baselineRoot);
    this.candidateValue = cloneConfigNode(this.baselineRoot);
    this.lastConfiguredValue = this.clock();
  }

  get mode(): 'operational' | 'configuration' {
    return this.modeValue;
  }

  get editPath(): string[] {
    return [...this.editPathValue];
  }

  get dirty(): boolean {
    return this.dirtyValue;
  }

  get commitCount(): number {
    return this.commitCountValue;
  }

  get rollbackDepth(): number {
    return this.rollbackRoots.length;
  }

  get lastConfigured(): Date {
    return this.lastConfiguredValue;
  }

  get hostname(): string {
    const configured = stripQuotes(
      this.candidateValue.children.get('system')?.children.get('host-name')?.value,
    );
    return configured ?? this.hostnameFallback;
  }

  get activeRoot(): ConfigNode {
    return this.activeValue;
  }

  get candidateRoot(): ConfigNode {
    return this.candidateValue;
  }

  get activeConfig(): ConfigJson {
    return configToJson(this.activeValue);
  }

  get candidateConfig(): ConfigJson {
    return configToJson(this.candidateValue);
  }

  get prompt(): string {
    const identity = `${this.username}@${this.hostname}`;
    if (this.modeValue === 'operational') return `${identity}> `;
    const path = this.editPathValue.length > 0 ? ` ${this.editPathValue.join(' ')}` : '';
    return `[edit${path}]\r\n${identity}# `;
  }

  setMode(mode: 'operational' | 'configuration'): void {
    this.modeValue = mode;
    if (mode === 'configuration') this.editPathValue = [];
  }

  enterConfiguration(): void {
    this.modeValue = 'configuration';
    this.editPathValue = [];
  }

  exitConfiguration(): string {
    if (this.editPathValue.length > 0) {
      this.up(1);
      return '';
    }
    this.modeValue = 'operational';
    return 'Exiting configuration mode\r\n';
  }

  configPathSegments(): string[] {
    return tokensToSegments(this.editPathValue);
  }

  candidateAtCurrentPath(): ConfigNode | null {
    return resolveSegments(this.candidateValue, this.configPathSegments());
  }

  candidateAt(tokens: string[]): ConfigNode | null {
    return resolveSegments(this.candidateValue, this.configPathSegments().concat(tokensToSegments(tokens)));
  }

  edit(tokens: string[]): void {
    if (tokens.length === 0) return;
    this.editPathValue = [...this.editPathValue, ...tokens];
    ensureEditSegments(this.candidateValue, this.configPathSegments());
  }

  up(count = 1): void {
    let remaining = Math.max(0, count);
    while (remaining > 0 && this.editPathValue.length > 0) {
      const segments = tokensToSegments(this.editPathValue);
      segments.pop();
      this.editPathValue = segmentsToTokens(segments);
      remaining -= 1;
    }
  }

  top(): void {
    this.editPathValue = [];
  }

  set(tokens: string[]): boolean {
    const node = this.candidateAtCurrentPath();
    if (!node || tokens.length === 0) return false;
    setUnder(node, tokens);
    this.dirtyValue = true;
    this.lastConfiguredValue = this.clock();
    return true;
  }

  delete(tokens: string[]): boolean {
    const node = this.candidateAtCurrentPath();
    if (!node || tokens.length === 0) return false;
    const changed = deleteUnder(node, tokens);
    if (changed) {
      this.dirtyValue = true;
      this.lastConfiguredValue = this.clock();
    }
    return changed;
  }

  diff(): string[] {
    return diffConfigs(this.activeValue, this.candidateValue);
  }

  commit(): void {
    this.rollbackRoots.unshift(cloneConfigNode(this.activeValue));
    if (this.rollbackRoots.length > this.maxRollbacks) this.rollbackRoots.pop();
    const committed = cloneConfigNode(this.candidateValue);
    pruneVirtual(committed);
    this.activeValue = committed;
    this.candidateValue = cloneConfigNode(committed);
    this.commitCountValue += 1;
    this.dirtyValue = false;
    this.lastConfiguredValue = this.clock();
  }

  rollback(index = 0): JunosRollbackResult {
    if (!Number.isInteger(index) || index < 0 || index > 49) {
      return { ok: false, message: `error: rollback ${index}: invalid rollback index\r\n` };
    }

    if (index === 0) {
      this.candidateValue = cloneConfigNode(this.activeValue);
      this.dirtyValue = false;
      return { ok: true, message: '' };
    }

    const target = this.rollbackRoots[index - 1];
    if (!target) {
      return {
        ok: false,
        message: `error: rollback ${index}: no previous configuration\r\n`,
      };
    }

    this.candidateValue = cloneConfigNode(target);
    this.dirtyValue = this.diff().length > 0;
    return { ok: true, message: '' };
  }

  reset(): void {
    this.activeValue = cloneConfigNode(this.baselineRoot);
    this.candidateValue = cloneConfigNode(this.baselineRoot);
    this.rollbackRoots = [];
    this.modeValue = 'operational';
    this.editPathValue = [];
    this.dirtyValue = false;
    this.commitCountValue = 0;
    this.lastConfiguredValue = this.clock();
  }

  activeSetLines(): string[] {
    return renderSetLines(this.activeValue);
  }

  candidateSetLines(): string[] {
    return renderSetLines(this.candidateValue);
  }

  activeRender(): string[] {
    return renderChildren(this.activeValue, 0);
  }

  candidateRender(): string[] {
    return renderChildren(this.candidateValue, 0);
  }

  activeLeaves(): ReturnType<typeof flattenConfig> {
    return flattenConfig(this.activeValue);
  }

  candidateLeaves(): ReturnType<typeof flattenConfig> {
    return flattenConfig(this.candidateValue);
  }
}
