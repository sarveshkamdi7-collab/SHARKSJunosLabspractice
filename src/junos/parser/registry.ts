import type {
  CommandDefinition,
  Completion,
  Mode,
  Token,
} from '../types';

export type ResolveResult =
  | {
      kind: 'ok';
      command: CommandDefinition;
      consumed: number;
      args: Token[];
    }
  | {
      kind: 'ambiguous';
      tokenIndex: number;
      token: string;
      completions: Completion[];
    }
  | { kind: 'unknown'; tokenIndex: number; token: string }
  | { kind: 'incomplete'; tokenIndex: number; completions: Completion[] };

export class CommandRegistry {
  private commands: CommandDefinition[] = [];

  register(command: CommandDefinition): this {
    this.commands.push(command);
    return this;
  }

  registerAll(commands: CommandDefinition[]): this {
    for (const command of commands) this.register(command);
    return this;
  }

  all(): readonly CommandDefinition[] {
    return this.commands;
  }

  commandsForMode(mode: Mode): CommandDefinition[] {
    return this.commands.filter((command) => command.modes.includes(mode));
  }

  resolve(tokens: Token[], mode: Mode): ResolveResult {
    const pool = this.commandsForMode(mode);
    if (tokens.length === 0) {
      return {
        kind: 'incomplete',
        tokenIndex: 0,
        completions: this.topLevel(pool),
      };
    }

    let candidates = pool;
    let consumed = 0;

    while (consumed < tokens.length) {
      const token = tokens[consumed];
      const next = candidates.filter(
        (command) =>
          command.path.length > consumed &&
          command.path[consumed].toLowerCase().startsWith(token.value.toLowerCase()),
      );

      if (next.length === 0) {
        const complete = candidates.filter((command) => command.path.length === consumed);
        if (complete.length > 0) {
          const chosen = this.chooseExact(complete, consumed);
          if ('kind' in chosen) return chosen;
          return {
            kind: 'ok',
            command: chosen.command,
            consumed,
            args: tokens.slice(consumed),
          };
        }
        return { kind: 'unknown', tokenIndex: consumed, token: token.value };
      }

      const exact = next.filter(
        (command) => command.path[consumed].toLowerCase() === token.value.toLowerCase(),
      );
      candidates = exact.length > 0 ? exact : next;
      consumed++;
    }

    const complete = candidates.filter((command) => command.path.length === consumed);
    if (complete.length > 0) {
      const chosen = this.chooseExact(complete, consumed);
      if ('kind' in chosen) return chosen;
      return { kind: 'ok', command: chosen.command, consumed, args: [] };
    }

    let expanded = candidates;
    let position = consumed;

    for (;;) {
      if (expanded.length === 0) {
        return { kind: 'unknown', tokenIndex: tokens.length - 1, token: tokens[tokens.length - 1].value };
      }

      const groups = new Map<string, CommandDefinition[]>();
      for (const command of expanded) {
        if (command.path.length <= position) continue;
        const key = command.path[position];
        const bucket = groups.get(key) ?? [];
        bucket.push(command);
        groups.set(key, bucket);
      }

      if (groups.size === 0) {
        return {
          kind: 'incomplete',
          tokenIndex: tokens.length,
          completions: [],
        };
      }

      if (groups.size > 1) {
        const completions = [...groups.entries()]
          .map(([value, group]) => ({ value, help: group[0].help }))
          .sort((a, b) => a.value.localeCompare(b.value));
        return {
          kind: 'ambiguous',
          tokenIndex: Math.max(0, tokens.length - 1),
          token: tokens[tokens.length - 1]?.value ?? '',
          completions,
        };
      }

      const [keyword, group] = [...groups.entries()][0];
      position++;
      expanded = group;

      const finished = expanded.filter((command) => command.path.length === position);
      if (finished.length > 0) {
        const chosen = this.chooseExact(finished, position);
        if ('kind' in chosen) return chosen;
        return {
          kind: 'ok',
          command: chosen.command,
          consumed: position,
          args: [],
        };
      }
      void keyword;
    }
  }

  complete(tokens: string[], mode: Mode, partialLast = true): Completion[] {
    const pool = this.commandsForMode(mode);
    if (tokens.length === 0) return this.topLevel(pool);

    if (partialLast) {
      const partial = tokens[tokens.length - 1];
      const prefix = tokens.slice(0, -1);
      const candidates = this.matchPrefixes(pool, prefix);
      const position = prefix.length;
      const found = new Map<string, Completion>();
      for (const command of candidates) {
        if (command.path.length <= position) continue;
        const value = command.path[position];
        if (!value.toLowerCase().startsWith(partial.toLowerCase())) continue;
        if (!found.has(value)) found.set(value, { value, help: command.help });
      }
      return [...found.values()].sort((a, b) => a.value.localeCompare(b.value));
    }

    const candidates = this.matchPrefixes(pool, tokens);
    const position = tokens.length;
    const found = new Map<string, Completion>();
    for (const command of candidates) {
      if (command.path.length <= position) {
        for (const arg of command.args ?? []) {
          const value = `<${arg.name}>`;
          if (!found.has(value)) {
            found.set(value, { value, help: arg.help ?? (arg.required ? 'required' : 'optional') });
          }
        }
        continue;
      }
      const value = command.path[position];
      if (!found.has(value)) found.set(value, { value, help: command.help });
    }
    return [...found.values()].sort((a, b) => a.value.localeCompare(b.value));
  }

  private matchPrefixes(pool: CommandDefinition[], tokens: string[]): CommandDefinition[] {
    return pool.filter((command) => {
      if (command.path.length < tokens.length) return false;
      return tokens.every((token, index) =>
        command.path[index].toLowerCase().startsWith(token.toLowerCase()),
      );
    });
  }

  private topLevel(pool: CommandDefinition[]): Completion[] {
    const found = new Map<string, Completion>();
    for (const command of pool) {
      const value = command.path[0];
      if (!found.has(value)) found.set(value, { value, help: command.help });
    }
    return [...found.values()].sort((a, b) => a.value.localeCompare(b.value));
  }

  private chooseExact(
    complete: CommandDefinition[],
    position: number,
  ):
    | { command: CommandDefinition }
    | { kind: 'ambiguous'; tokenIndex: number; token: string; completions: Completion[] } {
    const paths = new Set(complete.map((command) => command.path.join(' ')));
    if (paths.size > 1) {
      const values = new Map<string, Completion>();
      for (const command of complete) {
        const value = command.path[position - 1];
        if (!values.has(value)) values.set(value, { value, help: command.help });
      }
      return {
        kind: 'ambiguous',
        tokenIndex: Math.max(0, position - 1),
        token: '',
        completions: [...values.values()].sort((a, b) => a.value.localeCompare(b.value)),
      };
    }
    return { command: complete[0] };
  }
}
