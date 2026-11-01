import { splitCommand, tokenize } from './junosTokenizer';

export interface ParsedJunosCommand {
  raw: string;
  tokens: string[];
  main: string[];
  pipes: string[][];
  command: string;
  args: string[];
  completion: boolean;
}

export function parseJunosCommand(rawCmd: string): ParsedJunosCommand {
  const raw = String(rawCmd ?? '').replace(/[\r\n]+/g, ' ').trim();
  const completion = raw.includes('?');
  const beforeCompletion = completion ? raw.slice(0, raw.indexOf('?')).trim() : raw;
  const tokens = tokenize(beforeCompletion);
  const split = splitCommand(tokens);
  return {
    raw,
    tokens,
    main: split.main,
    pipes: split.pipes,
    command: (split.main[0] ?? '').toLowerCase(),
    args: split.main.slice(1),
    completion,
  };
}

export function pipeNames(parsed: ParsedJunosCommand): string[] {
  return parsed.pipes.map((pipe) => (pipe[0] ?? '').toLowerCase());
}

export function hasPipe(parsed: ParsedJunosCommand, name: string): boolean {
  return pipeNames(parsed).includes(name);
}

export function parseRollbackIndex(tokens: string[]): number | null {
  if (tokens.length === 0) return 0;
  if (tokens.length > 1) return null;
  if (!/^\d{1,2}$/.test(tokens[0])) return null;
  return Number(tokens[0]);
}

export function regexFromTokens(tokens: string[]): RegExp | null {
  const source = tokens.join(' ');
  if (source.length === 0) return null;
  const match = source.match(/^\/(.*)\/([a-z]*)$/i);
  try {
    return match ? new RegExp(match[1], match[2]) : new RegExp(source);
  } catch {
    return null;
  }
}
