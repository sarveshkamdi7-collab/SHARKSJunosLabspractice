import type { Token } from '../types';

export type PipeSpec =
  | { kind: 'match'; pattern: string; regex: RegExp }
  | { kind: 'except'; pattern: string; regex: RegExp }
  | { kind: 'count' }
  | { kind: 'displaySet' }
  | { kind: 'compare' }
  | { kind: 'noMore' };

export interface PipeParseResult {
  pipes: PipeSpec[];
  error?: string;
}

function compile(pattern: string): RegExp {
  return new RegExp(pattern);
}

export function parsePipes(segments: Token[][]): PipeParseResult {
  const pipes: PipeSpec[] = [];
  for (const segment of segments) {
    const words = segment.map((token) => token.value);
    if (words.length === 0) {
      return { pipes, error: 'syntax error.' };
    }
    const head = words[0].toLowerCase();

    if (head === 'match' || head === 'except') {
      if (words.length < 2) return { pipes, error: 'missing argument.' };
      const pattern = words.slice(1).join(' ');
      try {
        pipes.push({ kind: head, pattern, regex: compile(pattern) });
      } catch {
        return { pipes, error: `syntax error, invalid regular expression: ${pattern}` };
      }
      continue;
    }

    if (head === 'count') {
      if (words.length !== 1) return { pipes, error: 'syntax error.' };
      pipes.push({ kind: 'count' });
      continue;
    }

    if (head === 'display') {
      if (words.length === 2 && words[1].toLowerCase() === 'set') {
        pipes.push({ kind: 'displaySet' });
        continue;
      }
      return { pipes, error: 'syntax error.' };
    }

    if (head === 'compare') {
      if (words.length !== 1) return { pipes, error: 'syntax error.' };
      pipes.push({ kind: 'compare' });
      continue;
    }

    if (head === 'no-more') {
      if (words.length !== 1) return { pipes, error: 'syntax error.' };
      pipes.push({ kind: 'noMore' });
      continue;
    }

    return { pipes, error: 'unknown command.' };
  }
  return { pipes };
}

export interface PipeOptions {
  displaySet?: () => string[];
}

export function applyPipes(
  input: string[],
  pipes: PipeSpec[],
  options: PipeOptions = {},
): string[] {
  let lines = [...input];
  for (const pipe of pipes) {
    switch (pipe.kind) {
      case 'match':
        lines = lines.filter((line) => pipe.regex.test(line));
        break;
      case 'except':
        lines = lines.filter((line) => !pipe.regex.test(line));
        break;
      case 'count':
        lines = [`Count: ${lines.length} lines`];
        break;
      case 'displaySet':
        if (options.displaySet) lines = options.displaySet();
        break;
      case 'compare':
        break;
      case 'noMore':
        break;
    }
  }
  return lines;
}

export function hasPipe(pipes: PipeSpec[], kind: PipeSpec['kind']): boolean {
  return pipes.some((pipe) => pipe.kind === kind);
}
