import type { Token } from '../types';

export function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
      i++;
      continue;
    }

    if (ch === '|') {
      tokens.push({
        value: '|',
        raw: '|',
        quoted: false,
        start: i,
        end: i + 1,
        closed: true,
      });
      i++;
      continue;
    }

    const start = i;
    let value = '';
    let quoted = false;
    let closed = true;

    if (ch === '"' || ch === "'") {
      quoted = true;
      const quote = ch;
      i++;
      let terminated = false;
      while (i < line.length) {
        const c = line[i];
        if (c === '\\' && quote === '"' && i + 1 < line.length) {
          value += line[i + 1];
          i += 2;
          continue;
        }
        if (c === quote) {
          terminated = true;
          i++;
          break;
        }
        value += c;
        i++;
      }
      closed = terminated;
    } else {
      while (i < line.length) {
        const c = line[i];
        if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '|') break;
        value += c;
        i++;
      }
    }

    tokens.push({
      value,
      raw: line.slice(start, i),
      quoted,
      start,
      end: i,
      closed,
    });
  }

  return tokens;
}

export function splitPipes(tokens: Token[]): { command: Token[]; pipes: Token[][] } {
  const command: Token[] = [];
  const pipes: Token[][] = [];
  let current: Token[] = command;
  for (const token of tokens) {
    if (token.value === '|' && !token.quoted) {
      current = [];
      pipes.push(current);
    } else {
      current.push(token);
    }
  }
  return { command, pipes };
}
