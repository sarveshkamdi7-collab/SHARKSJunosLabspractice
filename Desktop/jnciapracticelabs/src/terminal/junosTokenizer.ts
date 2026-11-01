export interface SplitCommand {
  main: string[];
  pipes: string[][];
}

export const COMPOUND_HEADS = new Set([
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

export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === '"') {
        quote = false;
        continue;
      }
      if (char === '\\' && index + 1 < input.length) {
        index += 1;
        current += input[index];
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"') {
      quote = true;
      continue;
    }

    if (char === '|') {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      tokens.push('|');
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) tokens.push(current);
  return tokens;
}

export function splitCommand(tokens: string[]): SplitCommand {
  const pipeIndex = tokens.indexOf('|');
  if (pipeIndex < 0) return { main: tokens, pipes: [] };

  const main = tokens.slice(0, pipeIndex);
  const pipes: string[][] = [];
  let current: string[] = [];

  for (const token of tokens.slice(pipeIndex + 1)) {
    if (token === '|') {
      if (current.length > 0) pipes.push(current);
      current = [];
    } else {
      current.push(token);
    }
  }

  if (current.length > 0) pipes.push(current);
  return { main, pipes };
}

export function stripQuotes(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.replace(/^"|"$/g, '');
}

export function tokensToSegments(tokens: string[]): string[] {
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

export function segmentsToTokens(segments: string[]): string[] {
  return segments.flatMap((segment) => segment.split(/\s+/).filter(Boolean));
}
