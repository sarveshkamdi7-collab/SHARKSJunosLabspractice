export function caretLine(line: string, column: number, prompt = ''): string {
  return `${' '.repeat(prompt.length + Math.max(0, column))}^`;
}

export function formatCaretError(
  line: string,
  column: number,
  message: string,
  prompt = '',
): string {
  return `${line}\n${caretLine(line, column, prompt)}\n${message}`;
}

export const ERRORS = {
  unknown: 'unknown command.',
  syntax: 'syntax error.',
  missingArgument: 'missing argument.',
  ambiguous: 'Ambiguous command:',
} as const;

export function formatCompletions(completions: { value: string; help?: string }[]): string {
  const width = completions.reduce((max, c) => Math.max(max, c.value.length), 0);
  return [
    'Possible completions:',
    ...completions.map(
      (c) => `  ${c.value.padEnd(width + 4)}${c.help ? c.help : ''}`.trimEnd(),
    ),
  ].join('\n');
}
