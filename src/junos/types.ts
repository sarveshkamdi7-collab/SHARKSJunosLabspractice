export type Mode = 'login' | 'shell' | 'operational' | 'configure' | 'config-nested';

export interface Token {
  value: string;
  raw: string;
  quoted: boolean;
  start: number;
  end: number;
  closed: boolean;
}

export interface Completion {
  value: string;
  help?: string;
}

export interface ArgSpec {
  name: string;
  required?: boolean;
  type?: 'string' | 'number' | 'ipv4' | 'interface' | 'enum' | 'regex';
  values?: string[];
  variadic?: boolean;
  help?: string;
}

export interface CommandContext {
  raw: string;
  command: string[];
  args: string[];
  flags: Record<string, string | boolean>;
  tokens: Token[];
  mode: Mode;
  editPath: string[];
  pipes: import('./parser/pipes').PipeSpec[];
  session: SessionView;
}

export type CommandHandler = (ctx: CommandContext) => string | string[] | void;

export interface CommandDefinition {
  path: string[];
  modes: Mode[];
  help: string;
  args?: ArgSpec[];
  handler: CommandHandler;
}

export interface SessionView {
  mode: Mode;
  username: string;
  hostname: string;
  editPath: string[];
  top(): void;
  up(): void;
  edit(path: string[]): void;
  setMode(mode: Mode): void;
  setUsername(name: string): void;
  markDirty(): void;
  clearDirty(): void;
  configChanged(): boolean;
}
