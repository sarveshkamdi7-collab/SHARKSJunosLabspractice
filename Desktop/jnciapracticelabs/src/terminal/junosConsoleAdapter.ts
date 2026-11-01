import { JunosEngine, JunosEngineOptions, JunosSessionState } from './junosEngine';

export type JunosConsoleMode = 'shell' | 'cli-op' | 'cli-cfg';

export interface JunosConsoleFeedResult {
  lines: string[];
  output: string;
  prompt: string;
  mode: JunosConsoleMode;
  state: JunosSessionState;
}

export class JunosConsoleAdapter {
  readonly engine: JunosEngine;
  private modeValue: JunosConsoleMode = 'shell';
  private readonly promptHost: string;

  constructor(options: JunosEngineOptions | string | JunosEngine) {
    this.engine = options instanceof JunosEngine ? options : new JunosEngine(options);
    const username =
      options instanceof JunosEngine || typeof options === 'string'
        ? 'user'
        : options.username ?? 'user';
    this.promptHost = `${username}@${this.engine.hostname}`;
  }

  get mode(): JunosConsoleMode {
    return this.modeValue;
  }

  get prompt(): string {
    if (this.modeValue === 'shell') return `${this.promptHost}> `;
    return this.engine.prompt;
  }

  get state(): JunosSessionState {
    return this.engine.state;
  }

  feed(rawCmd: string): JunosConsoleFeedResult {
    const raw = String(rawCmd ?? '').trim();
    if (raw.length === 0) return this.result('', '');

    const lower = raw.toLowerCase();

    if (this.modeValue === 'shell') {
      if (lower === 'cli') {
        this.modeValue = 'cli-op';
        return this.result('', '');
      }
      if (lower === 'root' || lower === 'login' || lower === 'exit' || lower === 'logout') {
        return this.result('', '');
      }
      if (lower === 'edit' || lower === 'configure') {
        this.modeValue = 'cli-cfg';
        return this.result(this.engine.executeCommand('configure'), '');
      }
      return this.result(`% Unknown command: ${raw}\r\n`, '');
    }

    if (this.modeValue === 'cli-op' && lower === 'edit') {
      this.modeValue = 'cli-cfg';
      return this.result(this.engine.executeCommand('configure'), '');
    }

    const output = this.engine.executeCommand(raw);
    this.syncMode();
    if (output.includes('Connection closed by foreign host.')) this.modeValue = 'shell';
    return this.result(output, output);
  }

  async feedAsync(rawCmd: string): Promise<JunosConsoleFeedResult> {
    const raw = String(rawCmd ?? '').trim();
    if (raw.length === 0) return this.result('', '');

    const lower = raw.toLowerCase();
    if (this.modeValue === 'shell') {
      if (lower === 'cli') {
        this.modeValue = 'cli-op';
        return this.result('', '');
      }
      if (lower === 'edit' || lower === 'configure') {
        this.modeValue = 'cli-cfg';
        return this.result(this.engine.executeCommand('configure'), '');
      }
      return this.result(`% Unknown command: ${raw}\r\n`, '');
    }

    if (this.modeValue === 'cli-op' && lower === 'edit') {
      this.modeValue = 'cli-cfg';
      return this.result(this.engine.executeCommand('configure'), '');
    }

    const output = await this.engine.executeCommandAsync(raw);
    this.syncMode();
    if (output.includes('Connection closed by foreign host.')) this.modeValue = 'shell';
    return this.result(output, output);
  }

  promptFor(): string {
    return this.prompt;
  }

  candidateWords(prefix = ''): string[] {
    const output = this.engine.executeCommand(`${prefix}?`);
    const words = output
      .replace(/\r\n/g, '\n')
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
    return [...new Set(words)];
  }

  setMode(mode: JunosConsoleMode): void {
    this.modeValue = mode;
    if (mode === 'cli-cfg' && this.engine.mode !== 'configuration') {
      this.engine.executeCommand('configure');
    } else if (mode === 'cli-op' && this.engine.mode === 'configuration') {
      while (this.engine.mode === 'configuration') this.engine.executeCommand('exit');
    }
  }

  reset(): void {
    this.engine.reset();
    this.modeValue = 'shell';
  }

  private syncMode(): void {
    if (this.engine.mode === 'configuration') this.modeValue = 'cli-cfg';
    else if (this.modeValue !== 'shell') this.modeValue = 'cli-op';
  }

  private result(output: string, fallbackPrompt: string): JunosConsoleFeedResult {
    const normalized = output.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.length > 0 ? normalized.replace(/\n$/, '').split('\n') : [];
    return {
      lines,
      output,
      prompt: this.prompt || fallbackPrompt,
      mode: this.modeValue,
      state: this.engine.state,
    };
  }
}

export function createJunosConsoleAdapter(
  options: JunosEngineOptions | string | JunosEngine,
): JunosConsoleAdapter {
  return new JunosConsoleAdapter(options);
}
