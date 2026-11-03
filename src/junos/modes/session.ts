import type { ArgSpec, CommandContext, Completion, Mode, Token } from '../types';
import { CommandRegistry } from '../parser/registry';
import { splitPipes, tokenize } from '../parser/tokenizer';
import { applyPipes, parsePipes, type PipeSpec } from '../parser/pipes';
import {
  ERRORS,
  formatCaretError,
  formatCompletions,
} from '../render/caret';

export interface SessionOptions {
  hostname: string;
  registry: CommandRegistry;
  hasUncommittedChanges?: () => boolean;
  clock?: () => number;
}

interface ParsedArgs {
  args: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(tokens: Token[]): ParsedArgs {
  const args: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.quoted && token.value.startsWith('-') && token.value.length > 1) {
      const key = token.value.replace(/^-+/, '');
      const next = tokens[i + 1];
      if (next && !next.quoted && !next.value.startsWith('-')) {
        flags[key] = next.value;
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    args.push(token.value);
  }
  return { args, flags };
}

function validateArgs(
  specs: ArgSpec[] | undefined,
  args: string[],
  argTokens: Token[],
): { error?: string; column?: number } {
  if (!specs || specs.length === 0) return {};
  let index = 0;
  for (const spec of specs) {
    if (spec.variadic) {
      return {};
    }
    if (index >= args.length) {
      if (spec.required) return { error: ERRORS.missingArgument };
      continue;
    }
    const value = args[index];
    const token = argTokens[index];
    if (spec.type === 'ipv4' && !/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(value)) {
      return { error: ERRORS.syntax, column: token?.start };
    }
    if (spec.type === 'number' && !/^\d+$/.test(value)) {
      return { error: ERRORS.syntax, column: token?.start };
    }
    if (spec.values && !spec.values.includes(value)) {
      return { error: ERRORS.syntax, column: token?.start };
    }
    index++;
  }
  if (args.length > specs.length && !specs[specs.length - 1]?.variadic) {
    return { error: ERRORS.syntax };
  }
  return {};
}

export class JunosSession {
  mode: Mode = 'login';
  username = '';
  hostname: string;
  editPath: string[] = [];
  readonly registry: CommandRegistry;

  private hasUncommittedChanges?: () => boolean;
  private dirty = false;
  private pendingExitConfirm = false;
  private pendingLines: string[] = [];
  private clock: () => number;

  constructor(options: SessionOptions) {
    this.hostname = options.hostname;
    this.registry = options.registry;
    this.hasUncommittedChanges = options.hasUncommittedChanges;
    this.clock = options.clock ?? (() => Date.now());
  }

  configChanged(): boolean {
    return this.hasUncommittedChanges ? this.hasUncommittedChanges() : this.dirty;
  }

  markDirty(): void {
    this.dirty = true;
  }

  clearDirty(): void {
    this.dirty = false;
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    if (mode === 'operational' || mode === 'shell' || mode === 'login') {
      this.editPath = [];
    }
  }

  setUsername(name: string): void {
    this.username = name;
  }

  top(): void {
    this.editPath = [];
  }

  up(): void {
    this.editPath = this.editPath.slice(0, -1);
  }

  edit(path: string[]): void {
    this.editPath = [...this.editPath, ...path];
  }

  prompt(): string {
    const user = this.username || 'root';
    if (this.mode === 'login') return 'login: ';
    if (this.mode === 'shell') return `${user}@${this.hostname}:~ # `;
    if (this.mode === 'operational') return `${user}@${this.hostname}> `;
    const context = this.editPath.length ? this.editPath.join(' ') : '';
    return `[edit${context ? ` ${context}` : ''}]\n${user}@${this.hostname}# `;
  }

  process(line: string): string {
    const trimmed = line.trim();

    if (this.mode === 'login') {
      if (!trimmed) return '';
      this.username = trimmed;
      this.mode = 'shell';
      return '';
    }

    if (this.pendingExitConfirm) {
      this.pendingExitConfirm = false;
      const answer = trimmed.toLowerCase();
      if (answer === '' || answer === 'yes' || answer === 'y') {
        this.editPath = [];
        this.setMode('operational');
        return '';
      }
      if (answer === 'no' || answer === 'n') {
        return '';
      }
      this.pendingExitConfirm = true;
      return 'Exit with uncommitted changes? [yes, no] (yes)';
    }

    if (line.includes('?')) {
      const base = line.slice(0, line.indexOf('?'));
      return formatCompletions(this.completeInput(base));
    }

    if (!trimmed) return '';

    if (this.mode === 'shell') {
      return this.processShell(trimmed);
    }

    if (this.mode === 'operational') {
      if (trimmed === 'configure' || trimmed === 'edit') {
        this.setMode('configure');
        this.editPath = [];
        return '';
      }
      if (trimmed === 'exit' || trimmed === 'quit' || trimmed === 'logout') {
        this.setMode('shell');
        return '';
      }
    }

    if (this.mode === 'configure' || this.mode === 'config-nested') {
      const handled = this.processConfigBuiltin(trimmed);
      if (handled !== undefined) return handled;
    }

    return this.dispatch(line, trimmed);
  }

  private processShell(line: string): string {
    if (line === 'cli') {
      this.setMode('operational');
      return '';
    }
    if (line === 'exit' || line === 'logout') {
      this.mode = 'login';
      this.username = '';
      return '';
    }
    if (line === 'pwd') return '/root';
    if (line === 'whoami') return this.username || 'root';
    return this.dispatch(line, line);
  }

  private processConfigBuiltin(line: string): string | undefined {
    const tokens = tokenize(line);
    const words = tokens.map((token) => token.value);
    const head = words[0]?.toLowerCase();

    if (head === 'top') {
      this.editPath = [];
      return '';
    }
    if (head === 'up') {
      this.up();
      return '';
    }
    if (head === 'edit') {
      const path = words.slice(1);
      if (path.length === 0) {
        this.editPath = [];
      } else {
        this.editPath = [...this.editPath, ...path];
      }
      this.mode = this.editPath.length ? 'config-nested' : 'configure';
      return '';
    }
    if (head === 'exit' || head === 'quit') {
      if (this.editPath.length > 0) {
        this.up();
        this.mode = this.editPath.length ? 'config-nested' : 'configure';
        return '';
      }
      if (this.configChanged()) {
        this.pendingExitConfirm = true;
        return 'Exit with uncommitted changes? [yes, no] (yes)';
      }
      this.setMode('operational');
      return '';
    }
    return undefined;
  }

  private dispatch(line: string, _trimmed: string): string {
    const tokens = tokenize(line);
    const { command: commandTokens, pipes: pipeSegments } = splitPipes(tokens);
    const parsedPipes = parsePipes(pipeSegments);
    if (parsedPipes.error) {
      return parsedPipes.error;
    }

    const resolved = this.registry.resolve(commandTokens, this.mode);
    if (resolved.kind === 'unknown') {
      const token = commandTokens[resolved.tokenIndex];
      return formatCaretError(line, token ? token.start : line.length, ERRORS.unknown);
    }
    if (resolved.kind === 'incomplete') {
      return formatCaretError(line, line.length, ERRORS.syntax);
    }
    if (resolved.kind === 'ambiguous') {
      return formatCompletions(resolved.completions);
    }

    const argTokens = commandTokens.slice(resolved.consumed);
    const { args, flags } = parseArgs(argTokens);
    const validation = validateArgs(resolved.command.args, args, argTokens);
    if (validation.error) {
      const column =
        validation.column !== undefined
          ? validation.column
          : argTokens[argTokens.length - 1]?.end ?? line.length;
      return formatCaretError(line, column, validation.error);
    }

    const context: CommandContext = {
      raw: line,
      command: [...resolved.command.path],
      args,
      flags,
      tokens: commandTokens,
      mode: this.mode,
      editPath: [...this.editPath],
      pipes: parsedPipes.pipes,
      session: this,
    };

    const result = resolved.command.handler(context);
    const lines = result === undefined ? [] : Array.isArray(result) ? result : result.split('\n');
    const piped = applyPipes(lines, parsedPipes.pipes, {
      displaySet: typeof (context as unknown as { displaySet?: unknown }).displaySet === 'function'
        ? (context as unknown as { displaySet: () => string[] }).displaySet
        : undefined,
    });
    return piped.join('\n');
  }

  completeInput(line: string): Completion[] {
    const tokens = tokenize(line);
    const { command } = splitPipes(tokens);
    const partial = !/\s$/.test(line);
    const values = command.map((token) => token.value);
    if (!partial && values.length === 0) return this.registry.complete([], this.mode, false);
    return this.registry.complete(values, this.mode, partial);
  }

  tabComplete(line: string): string {
    const completions = this.completeInput(line);
    if (completions.length === 0) return line;
    const tokens = tokenize(line);
    const { command } = splitPipes(tokens);
    const partial = !/\s$/.test(line);
    const last = command[command.length - 1];

    let common = completions[0].value;
    for (const completion of completions.slice(1)) {
      let i = 0;
      while (i < common.length && i < completion.value.length && common[i] === completion.value[i]) {
        i++;
      }
      common = common.slice(0, i);
    }

    if (completions.length === 1) {
      if (partial && last) {
        return line.slice(0, last.start) + completions[0].value + ' ';
      }
      return line + completions[0].value + ' ';
    }

    if (common.length === 0) return line;
    if (partial && last) {
      if (last.value.toLowerCase() === common.toLowerCase()) return line;
      return line.slice(0, last.start) + common;
    }
    return line + common;
  }

  linesWithPrompt(text: string): string {
    return text;
  }

  now(): number {
    return this.clock();
  }

  pending(): string[] {
    return this.pendingLines;
  }
}
