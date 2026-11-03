import { describe, expect, it } from 'vitest';
import { ConfigTree } from './tree';
import { renderConfig, renderDisplaySet } from './render';
import { diffTrees, renderCompare } from './diff';
import { ConfigManager } from './commit';
import { configCommands } from './commands';
import { CommandRegistry } from '../parser/registry';
import { JunosSession } from '../modes/session';

function apply(tree: ConfigTree, ...lines: string[]): ConfigTree {
  for (const line of lines) tree.setWords(line.split(/\s+/));
  return tree;
}

function makeSession(manager: ConfigManager): JunosSession {
  const registry = new CommandRegistry().registerAll(configCommands(manager));
  return new JunosSession({
    hostname: 'R1',
    registry,
    hasUncommittedChanges: () => manager.isDirty(),
  });
}

describe('configuration tree', () => {
  it('stores nested set statements', () => {
    const tree = apply(
      new ConfigTree(),
      'system host-name R1',
      'interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30',
    );
    expect(tree.get(['system', 'host-name'])?.values).toEqual(['R1']);
    expect(
      tree.get(['interfaces', 'ge-0/0/0', 'unit', '0', 'family', 'inet', 'address'])?.values,
    ).toEqual(['10.0.12.1/30']);
  });

  it('accumulates list leaves', () => {
    const tree = apply(
      new ConfigTree(),
      'interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30',
      'interfaces ge-0/0/0 unit 0 family inet address 10.0.12.5/30',
    );
    expect(
      tree.get(['interfaces', 'ge-0/0/0', 'unit', '0', 'family', 'inet', 'address'])?.values,
    ).toEqual(['10.0.12.1/30', '10.0.12.5/30']);
  });

  it('renders hierarchical braces', () => {
    const tree = apply(
      new ConfigTree(),
      'system host-name R1',
      'interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30',
    );
    expect(renderConfig(tree)).toBe(
      [
        'system {',
        '    host-name R1;',
        '}',
        'interfaces {',
        '    ge-0/0/0 {',
        '        unit 0 {',
        '            family inet {',
        '                address 10.0.12.1/30;',
        '            }',
        '        }',
        '    }',
        '}',
      ].join('\n'),
    );
  });

  it('renders display set in hierarchy order', () => {
    const tree = apply(
      new ConfigTree(),
      'interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30',
      'system host-name R1',
    );
    expect(renderDisplaySet(tree)).toEqual([
      'set system host-name R1',
      'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30',
    ]);
  });

  it('deletes a subtree', () => {
    const tree = apply(
      new ConfigTree(),
      'interfaces ge-0/0/0 description core',
      'interfaces ge-0/0/1 description edge',
    );
    expect(tree.delete(['interfaces', 'ge-0/0/0'])).toBe(true);
    expect(tree.get(['interfaces', 'ge-0/0/0'])).toBeUndefined();
    expect(tree.get(['interfaces', 'ge-0/0/1'])).toBeDefined();
  });

  it('marks inactive statements', () => {
    const tree = apply(new ConfigTree(), 'interfaces ge-0/0/0 description core');
    expect(tree.setInactive(['interfaces', 'ge-0/0/0'], true)).toBe(true);
    expect(renderConfig(tree)).toContain('inactive: ge-0/0/0 {');
    expect(renderDisplaySet(tree)).toContain('deactivate interfaces ge-0/0/0');
  });

  it('clones without aliasing', () => {
    const tree = apply(new ConfigTree(), 'system host-name R1');
    const copy = tree.clone();
    copy.set(['system', 'host-name'], 'R2');
    expect(tree.get(['system', 'host-name'])?.values).toEqual(['R1']);
    expect(tree.equals(copy)).toBe(false);
  });

  it('compares structurally', () => {
    const a = apply(new ConfigTree(), 'system host-name R1');
    const b = a.clone();
    expect(a.equals(b)).toBe(true);
    b.set(['system', 'domain-name'], 'example.com');
    expect(a.equals(b)).toBe(false);
  });
});

describe('configuration diff', () => {
  it('shows added leaves under an edit header', () => {
    const active = apply(new ConfigTree(), 'system services ssh');
    const candidate = active.clone();
    candidate.set(['system', 'host-name'], 'R1');
    expect(diffTrees(active, candidate)).toEqual(['[edit system]', '+   host-name R1;']);
  });

  it('shows removed leaves', () => {
    const active = apply(new ConfigTree(), 'system host-name R1');
    const candidate = active.clone();
    candidate.delete(['system', 'host-name']);
    expect(diffTrees(active, candidate)).toEqual(['[edit system]', '-   host-name R1;']);
  });

  it('shows a new interface subtree', () => {
    const active = apply(new ConfigTree(), 'system host-name R1');
    const candidate = active.clone();
    apply(candidate, 'interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30');
    const diff = diffTrees(active, candidate);
    expect(diff[0]).toBe('[edit interfaces]');
    expect(diff).toContain('+   ge-0/0/0 {');
    expect(diff).toContain('+       unit 0 {');
    expect(diff).toContain('+           family inet {');
    expect(diff).toContain('+               address 10.0.12.1/30;');
  });

  it('shows changes in a nested subtree', () => {
    const active = apply(
      new ConfigTree(),
      'interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30',
    );
    const candidate = active.clone();
    candidate.set(['interfaces', 'ge-0/0/0', 'unit', '0', 'family', 'inet', 'address'], '10.0.12.5/30');
    expect(diffTrees(active, candidate)).toEqual([
      '[edit interfaces ge-0/0/0 unit 0 family inet]',
      '+   address 10.0.12.5/30;',
    ]);
  });

  it('reports no differences', () => {
    const active = apply(new ConfigTree(), 'system host-name R1');
    expect(renderCompare(active, active.clone())).toBe('No differences');
  });
});

describe('commit and rollback', () => {
  it('isolates the candidate from the active config', () => {
    const manager = new ConfigManager(apply(new ConfigTree(), 'system host-name R1'));
    manager.candidate.set(['system', 'host-name'], 'R2');
    expect(manager.active.get(['system', 'host-name'])?.values).toEqual(['R1']);
    expect(manager.isDirty()).toBe(true);
    manager.commit();
    expect(manager.active.get(['system', 'host-name'])?.values).toEqual(['R2']);
    expect(manager.isDirty()).toBe(false);
  });

  it('keeps a rollback history', () => {
    const manager = new ConfigManager(apply(new ConfigTree(), 'system host-name R1'));
    manager.candidate.set(['system', 'host-name'], 'R2');
    manager.commit();
    manager.candidate.set(['system', 'host-name'], 'R3');
    manager.commit();
    expect(manager.historySize()).toBe(3);
    expect(manager.rollback(1).ok).toBe(true);
    expect(manager.candidate.get(['system', 'host-name'])?.values).toEqual(['R2']);
    expect(manager.active.get(['system', 'host-name'])?.values).toEqual(['R3']);
    expect(manager.rollback(2).ok).toBe(true);
    expect(manager.candidate.get(['system', 'host-name'])?.values).toEqual(['R1']);
  });

  it('rejects out-of-range rollback numbers', () => {
    const manager = new ConfigManager();
    expect(manager.rollback(50).ok).toBe(false);
    expect(manager.rollback(9).ok).toBe(false);
  });

  it('auto-rolls back a confirmed commit', () => {
    let now = 0;
    const manager = new ConfigManager(apply(new ConfigTree(), 'system host-name R1'), () => now);
    manager.candidate.set(['system', 'host-name'], 'R2');
    const result = manager.commit({ confirmedMinutes: 1 });
    expect(result.rollbackInMinutes).toBe(1);
    expect(manager.pending).toBeDefined();
    now = 60_000;
    expect(manager.tick()).toBe(true);
    expect(manager.active.get(['system', 'host-name'])?.values).toEqual(['R1']);
    expect(manager.pending).toBeUndefined();
  });

  it('confirms a pending commit', () => {
    let now = 0;
    const manager = new ConfigManager(apply(new ConfigTree(), 'system host-name R1'), () => now);
    manager.candidate.set(['system', 'host-name'], 'R2');
    manager.commit({ confirmedMinutes: 1 });
    manager.commit();
    now = 120_000;
    expect(manager.tick()).toBe(false);
    expect(manager.active.get(['system', 'host-name'])?.values).toEqual(['R2']);
  });
});

describe('config CLI commands', () => {
  it('edits, shows and commits through the session', () => {
    const manager = new ConfigManager();
    const session = makeSession(manager);
    session.process('root');
    session.process('cli');
    session.process('configure');
    session.process('set system host-name R1');
    expect(manager.candidate.get(['system', 'host-name'])?.values).toEqual(['R1']);
    expect(session.process('show')).toContain('host-name R1;');
    expect(session.process('show | compare')).toBe('[edit system]\n+   host-name R1;');
    expect(session.process('commit check')).toBe('configuration check succeeds');
    expect(session.process('commit')).toBe('commit complete');
    expect(manager.isDirty()).toBe(false);
    expect(session.process('exit')).toBe('');
    expect(session.mode).toBe('operational');
  });

  it('uses the edit path for relative set statements', () => {
    const manager = new ConfigManager();
    const session = makeSession(manager);
    session.process('root');
    session.process('cli');
    session.process('configure');
    session.process('edit interfaces');
    session.process('set ge-0/0/0 description core');
    expect(manager.candidate.get(['interfaces', 'ge-0/0/0', 'description'])?.values).toEqual([
      'core',
    ]);
  });

  it('renders display set from the candidate', () => {
    const manager = new ConfigManager();
    const session = makeSession(manager);
    session.process('root');
    session.process('cli');
    session.process('configure');
    session.process('set system host-name R1');
    expect(session.process('show | display set')).toBe('set system host-name R1');
  });

  it('supports deactivate and activate', () => {
    const manager = new ConfigManager();
    const session = makeSession(manager);
    session.process('root');
    session.process('cli');
    session.process('configure');
    session.process('set interfaces ge-0/0/0 description core');
    session.process('deactivate interfaces ge-0/0/0');
    expect(session.process('show')).toContain('inactive: ge-0/0/0 {');
    session.process('activate interfaces ge-0/0/0');
    expect(session.process('show')).not.toContain('inactive:');
  });

  it('rolls back through the CLI', () => {
    const manager = new ConfigManager();
    const session = makeSession(manager);
    session.process('root');
    session.process('cli');
    session.process('configure');
    session.process('set system host-name R1');
    session.process('commit');
    session.process('set system host-name R2');
    session.process('commit');
    expect(session.process('rollback 1')).toBe('load complete');
    expect(manager.candidate.get(['system', 'host-name'])?.values).toEqual(['R1']);
    expect(session.process('commit')).toBe('commit complete');
    expect(manager.active.get(['system', 'host-name'])?.values).toEqual(['R1']);
  });

  it('commit and-quit returns to operational mode', () => {
    const manager = new ConfigManager();
    const session = makeSession(manager);
    session.process('root');
    session.process('cli');
    session.process('configure');
    session.process('set system host-name R1');
    expect(session.process('commit and-quit')).toBe('commit complete');
    expect(session.mode).toBe('operational');
  });
});
