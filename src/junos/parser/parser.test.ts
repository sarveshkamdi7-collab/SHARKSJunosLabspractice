import { describe, expect, it } from 'vitest';
import { tokenize, splitPipes } from './tokenizer';
import { CommandRegistry } from './registry';
import { applyPipes, parsePipes } from './pipes';
import { formatCaretError, formatCompletions } from '../render/caret';
import { JunosSession } from '../modes/session';
import type { CommandDefinition } from '../types';

function makeRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  const commands: CommandDefinition[] = [
    {
      path: ['show', 'interfaces', 'terse'],
      modes: ['operational'],
      help: 'Show terse interface information',
      handler: () => [
        'Interface               Admin Link Proto    Local                 Remote',
        'ge-0/0/0                up    up',
        'ge-0/0/0.0              up    up   inet     10.0.12.1/30',
        'lo0                     up    up',
      ],
    },
    {
      path: ['show', 'interfaces', 'detail'],
      modes: ['operational'],
      help: 'Show detailed interface information',
      handler: () => ['Physical interface: ge-0/0/0, Enabled'],
    },
    {
      path: ['show', 'interfaces'],
      modes: ['operational'],
      help: 'Show interface information',
      handler: () => ['Physical interface: ge-0/0/0, Enabled'],
    },
    {
      path: ['show', 'version'],
      modes: ['operational'],
      help: 'Show software version',
      handler: () => ['Hostname: R1', 'Model: vMX'],
    },
    {
      path: ['show', 'route'],
      modes: ['operational'],
      help: 'Show routing table',
      handler: () => ['inet.0: 1 destinations, 1 routes (1 active, 0 holddown, 0 hidden)'],
    },
    {
      path: ['show', 'route', 'summary'],
      modes: ['operational'],
      help: 'Show routing table summary',
      handler: () => ['inet.0: 1 destinations, 1 routes'],
    },
    {
      path: ['show', 'rollback'],
      modes: ['operational'],
      help: 'Show rollback configuration',
      handler: () => ['rollback'],
    },
    {
      path: ['ping'],
      modes: ['operational'],
      help: 'Ping a host',
      args: [{ name: 'host', required: true, type: 'ipv4' }],
      handler: (ctx) => [`PING ${ctx.args[0]}`],
    },
    {
      path: ['clear', 'ospf', 'neighbor'],
      modes: ['operational'],
      help: 'Clear OSPF neighbors',
      handler: () => [''],
    },
  ];
  registry.registerAll(commands);
  return registry;
}

function makeSession(dirty = false): JunosSession {
  return new JunosSession({
    hostname: 'R1',
    registry: makeRegistry(),
    hasUncommittedChanges: () => dirty,
  });
}

describe('tokenizer', () => {
  it('splits plain words on whitespace', () => {
    const tokens = tokenize('show   interfaces\tterse');
    expect(tokens.map((t) => t.value)).toEqual(['show', 'interfaces', 'terse']);
  });

  it('preserves quoted strings and spaces', () => {
    const tokens = tokenize('set system host-name "R1 edge"');
    expect(tokens[3].value).toBe('R1 edge');
    expect(tokens[3].quoted).toBe(true);
    expect(tokens[3].raw).toBe('"R1 edge"');
  });

  it('handles escaped double quotes', () => {
    const tokens = tokenize('annotate "say \\"hi\\""');
    expect(tokens[1].value).toBe('say "hi"');
  });

  it('supports single quotes', () => {
    const tokens = tokenize("match 'ge-0/0/0'");
    expect(tokens[1].value).toBe('ge-0/0/0');
  });

  it('flags unterminated quotes', () => {
    const tokens = tokenize('set description "broken');
    expect(tokens[2].closed).toBe(false);
  });

  it('records byte offsets for carets', () => {
    const tokens = tokenize('show frobnicate');
    expect(tokens[1].start).toBe(5);
    expect(tokens[1].end).toBe(15);
  });

  it('tokenizes pipes separately', () => {
    const tokens = tokenize('show route | match static | count');
    expect(tokens.filter((t) => t.value === '|')).toHaveLength(2);
  });

  it('splits command and pipe segments', () => {
    const { command, pipes } = splitPipes(tokenize('show route | match static | count'));
    expect(command.map((t) => t.value)).toEqual(['show', 'route']);
    expect(pipes).toHaveLength(2);
    expect(pipes[0].map((t) => t.value)).toEqual(['match', 'static']);
  });
});

describe('prefix engine', () => {
  it('expands an unambiguous prefix to a full command', () => {
    const registry = makeRegistry();
    const result = registry.resolve(tokenize('sh int ter'), 'operational');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.command.path.join(' ')).toBe('show interfaces terse');
      expect(result.consumed).toBe(3);
    }
  });

  it('expands a one-word prefix', () => {
    const result = makeRegistry().resolve(tokenize('sh ver'), 'operational');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.command.path.join(' ')).toBe('show version');
  });

  it('chooses the exact keyword over longer subcommands', () => {
    const result = makeRegistry().resolve(tokenize('show route'), 'operational');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.command.path.join(' ')).toBe('show route');
  });

  it('reports ambiguous prefixes with completions', () => {
    const result = makeRegistry().resolve(tokenize('show r'), 'operational');
    expect(result.kind).toBe('ambiguous');
    if (result.kind === 'ambiguous') {
      expect(result.completions.map((c) => c.value).sort()).toEqual(['rollback', 'route']);
    }
  });

  it('returns an ambiguous top-level command', () => {
    const result = makeRegistry().resolve(tokenize('s'), 'operational');
    expect(result.kind).toBe('ambiguous');
  });

  it('returns unknown for a missing command', () => {
    const result = makeRegistry().resolve(tokenize('frobnicate'), 'operational');
    expect(result.kind).toBe('unknown');
  });

  it('treats trailing tokens as arguments', () => {
    const result = makeRegistry().resolve(tokenize('show route 10.0.0.0/8'), 'operational');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.command.path.join(' ')).toBe('show route');
      expect(result.args.map((t) => t.value)).toEqual(['10.0.0.0/8']);
    }
  });

  it('auto-expands a unique next keyword', () => {
    const registry = new CommandRegistry().register({
      path: ['show', 'interfaces', 'terse'],
      modes: ['operational'],
      help: 'terse',
      handler: () => '',
    });
    const result = registry.resolve(tokenize('show interfaces'), 'operational');
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.command.path.join(' ')).toBe('show interfaces terse');
  });

  it('respects mode filtering', () => {
    const result = makeRegistry().resolve(tokenize('show version'), 'configure');
    expect(result.kind).toBe('unknown');
  });

  it('offers top-level completions', () => {
    const values = makeRegistry().complete([], 'operational', false).map((c) => c.value);
    expect(values).toContain('show');
    expect(values).toContain('ping');
  });

  it('completes a partial last token', () => {
    const values = makeRegistry().complete(['show', 'r'], 'operational', true).map((c) => c.value);
    expect(values).toEqual(['rollback', 'route']);
  });
});

describe('pipes', () => {
  const base = ['line one static', 'line two ospf', 'line three static'];

  it('filters with match', () => {
    const parsed = parsePipes([
      tokenize('match static'),
    ]);
    expect(applyPipes(base, parsed.pipes)).toEqual(['line one static', 'line three static']);
  });

  it('filters with except', () => {
    const parsed = parsePipes([tokenize('except static')]);
    expect(applyPipes(base, parsed.pipes)).toEqual(['line two ospf']);
  });

  it('counts lines', () => {
    const parsed = parsePipes([tokenize('count')]);
    expect(applyPipes(base, parsed.pipes)).toEqual(['Count: 3 lines']);
  });

  it('chains pipes', () => {
    const parsed = parsePipes([tokenize('match static'), tokenize('count')]);
    expect(applyPipes(base, parsed.pipes)).toEqual(['Count: 2 lines']);
  });

  it('supports display set through a provider', () => {
    const parsed = parsePipes([tokenize('display set')]);
    expect(applyPipes(base, parsed.pipes, { displaySet: () => ['set system host-name R1'] })).toEqual([
      'set system host-name R1',
    ]);
  });

  it('supports no-more', () => {
    const parsed = parsePipes([tokenize('no-more')]);
    expect(applyPipes(base, parsed.pipes)).toEqual(base);
  });

  it('rejects an invalid regular expression', () => {
    const parsed = parsePipes([tokenize('match [')]);
    expect(parsed.error).toBeDefined();
  });
});

describe('error formatting', () => {
  it('places the caret under an unknown token', () => {
    const output = formatCaretError('show frobnicate', 5, 'unknown command.');
    expect(output).toBe('show frobnicate\n     ^\nunknown command.');
  });

  it('offsets the caret by the prompt width', () => {
    const output = formatCaretError('show x', 5, 'syntax error.', 'root@R1> ');
    expect(output.split('\n')[1]).toBe(`${' '.repeat(14)}^`);
  });

  it('formats a possible completions list', () => {
    const output = formatCompletions([
      { value: 'detail', help: 'Show details' },
      { value: 'terse', help: 'Show terse' },
    ]);
    expect(output).toContain('Possible completions:');
    expect(output).toContain('detail');
    expect(output).toContain('terse');
  });
});

describe('session state machine', () => {
  it('moves login -> shell -> operational -> configure', () => {
    const session = makeSession();
    expect(session.prompt()).toBe('login: ');
    session.process('root');
    expect(session.prompt()).toBe('root@R1:~ # ');
    session.process('cli');
    expect(session.prompt()).toBe('root@R1> ');
    session.process('configure');
    expect(session.prompt()).toBe('[edit]\nroot@R1# ');
  });

  it('navigates nested edit levels', () => {
    const session = makeSession();
    session.process('root');
    session.process('cli');
    session.process('configure');
    session.process('edit interfaces');
    expect(session.prompt()).toContain('[edit interfaces]');
    session.process('edit ge-0/0/0');
    expect(session.prompt()).toContain('[edit interfaces ge-0/0/0]');
    session.process('up');
    expect(session.prompt()).toContain('[edit interfaces]');
    session.process('top');
    expect(session.prompt()).toBe('[edit]\nroot@R1# ');
  });

  it('runs operational commands', () => {
    const session = makeSession();
    session.process('root');
    session.process('cli');
    const output = session.process('sh int ter');
    expect(output).toContain('ge-0/0/0.0');
  });

  it('emits a caret for an unknown command', () => {
    const session = makeSession();
    session.process('root');
    session.process('cli');
    expect(session.process('frobnicate')).toBe('frobnicate\n^\nunknown command.');
  });

  it('emits a caret under an unknown subcommand', () => {
    const session = makeSession();
    session.process('root');
    session.process('cli');
    expect(session.process('show frobnicate')).toBe(
      'show frobnicate\n     ^\nunknown command.',
    );
  });

  it('emits possible completions for ambiguity', () => {
    const session = makeSession();
    session.process('root');
    session.process('cli');
    const output = session.process('show r');
    expect(output).toContain('Possible completions:');
    expect(output).toContain('route');
    expect(output).toContain('rollback');
  });

  it('reports a missing argument', () => {
    const session = makeSession();
    session.process('root');
    session.process('cli');
    expect(session.process('ping')).toContain('missing argument.');
  });

  it('answers question-mark help', () => {
    const session = makeSession();
    session.process('root');
    session.process('cli');
    expect(session.process('show ?')).toContain('Possible completions:');
  });

  it('tab-completes a unique prefix', () => {
    const session = makeSession();
    session.process('root');
    session.process('cli');
    expect(session.tabComplete('sh')).toBe('show ');
  });

  it('applies pipes to command output', () => {
    const session = makeSession();
    session.process('root');
    session.process('cli');
    expect(session.process('show interfaces terse | match ge-0/0/0.0')).toBe(
      'ge-0/0/0.0              up    up   inet     10.0.12.1/30',
    );
    expect(session.process('show interfaces terse | count')).toBe('Count: 4 lines');
  });

  it('asks before exiting with uncommitted changes', () => {
    const session = makeSession(true);
    session.process('root');
    session.process('cli');
    session.process('configure');
    expect(session.process('exit')).toBe('Exit with uncommitted changes? [yes, no] (yes)');
    expect(session.mode).toBe('configure');
    session.process('no');
    expect(session.mode).toBe('configure');
    session.process('exit');
    session.process('yes');
    expect(session.mode).toBe('operational');
  });

  it('exits without a prompt when there are no changes', () => {
    const session = makeSession(false);
    session.process('root');
    session.process('cli');
    session.process('configure');
    expect(session.process('exit')).toBe('');
    expect(session.mode).toBe('operational');
  });
});
