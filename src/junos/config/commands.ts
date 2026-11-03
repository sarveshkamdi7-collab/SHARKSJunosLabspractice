import type { CommandContext, CommandDefinition, CommandHandler } from '../types';
import { hasPipe } from '../parser/pipes';
import type { ConfigManager } from './commit';
import { renderConfig, renderDisplaySet } from './render';

const CONFIG_MODES = ['configure', 'config-nested'] as const;

function pathFromContext(ctx: CommandContext): string[] {
  return [...ctx.editPath, ...ctx.args];
}

function setHandler(manager: ConfigManager): CommandHandler {
  return (ctx) => {
    if (ctx.args.length === 0) return 'missing argument.';
    manager.candidate.setWords(pathFromContext(ctx));
    ctx.session.markDirty();
    return '';
  };
}

function deleteHandler(manager: ConfigManager): CommandHandler {
  return (ctx) => {
    const path = pathFromContext(ctx);
    if (path.length === 0) return 'missing argument.';
    manager.candidate.delete(path);
    ctx.session.markDirty();
    return '';
  };
}

function stateHandler(manager: ConfigManager, inactive: boolean): CommandHandler {
  return (ctx) => {
    const path = pathFromContext(ctx);
    if (path.length === 0) return 'missing argument.';
    if (!manager.candidate.setInactive(path, inactive)) {
      return 'error: statement not found';
    }
    ctx.session.markDirty();
    return '';
  };
}

function showHandler(manager: ConfigManager): CommandHandler {
  return (ctx) => {
    if (hasPipe(ctx.pipes, 'compare')) {
      return manager.diff();
    }
    if (hasPipe(ctx.pipes, 'displaySet')) {
      return renderDisplaySet(manager.candidate);
    }
    return renderConfig(manager.candidate).split('\n').filter((line) => line.length > 0);
  };
}

function commitHandler(manager: ConfigManager): CommandHandler {
  return (ctx) => {
    const args = [...ctx.args];
    if (args[0] === 'check') {
      const check = manager.commitCheck();
      return check.ok ? 'configuration check succeeds' : check.errors.join('\n');
    }

    let confirmedMinutes: number | undefined;
    let comment: string | undefined;
    let andQuit = false;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === 'confirmed') {
        const next = args[i + 1];
        if (next && /^\d+$/.test(next)) {
          confirmedMinutes = Number(next);
          i++;
        } else {
          confirmedMinutes = 10;
        }
      } else if (arg === 'and-quit') {
        andQuit = true;
      } else if (arg === 'comment') {
        comment = args.slice(i + 1).join(' ');
        break;
      }
    }

    const result = manager.commit({ comment, confirmedMinutes });
    if (!result.ok) return result.errors.join('\n');

    ctx.session.clearDirty();
    if (andQuit) {
      ctx.session.setMode('operational');
    }
    if (confirmedMinutes) {
      return [`commit complete`, `Commit confirmed, rollback in ${confirmedMinutes} minutes unless confirmed`];
    }
    return 'commit complete';
  };
}

function rollbackHandler(manager: ConfigManager): CommandHandler {
  return (ctx) => {
    const raw = ctx.args[0];
    const index = raw === undefined ? 0 : Number(raw);
    if (!Number.isInteger(index) || index < 0) {
      return 'syntax error.';
    }
    const result = manager.rollback(index);
    if (!result.ok) return 'Rollback number out of range.';
    ctx.session.markDirty();
    return 'load complete';
  };
}

export function configCommands(manager: ConfigManager): CommandDefinition[] {
  return [
    {
      path: ['set'],
      modes: [...CONFIG_MODES],
      help: 'Set a configuration statement',
      args: [{ name: 'statement', required: true, variadic: true }],
      handler: setHandler(manager),
    },
    {
      path: ['delete'],
      modes: [...CONFIG_MODES],
      help: 'Delete a configuration statement',
      args: [{ name: 'statement', required: false, variadic: true }],
      handler: deleteHandler(manager),
    },
    {
      path: ['activate'],
      modes: [...CONFIG_MODES],
      help: 'Activate a configuration statement',
      args: [{ name: 'statement', required: true, variadic: true }],
      handler: stateHandler(manager, false),
    },
    {
      path: ['deactivate'],
      modes: [...CONFIG_MODES],
      help: 'Deactivate a configuration statement',
      args: [{ name: 'statement', required: true, variadic: true }],
      handler: stateHandler(manager, true),
    },
    {
      path: ['show'],
      modes: [...CONFIG_MODES],
      help: 'Show candidate configuration',
      handler: showHandler(manager),
    },
    {
      path: ['commit'],
      modes: [...CONFIG_MODES],
      help: 'Commit the candidate configuration',
      handler: commitHandler(manager),
    },
    {
      path: ['rollback'],
      modes: [...CONFIG_MODES],
      help: 'Load a previous configuration into the candidate',
      args: [{ name: 'index', required: false, type: 'number' }],
      handler: rollbackHandler(manager),
    },
  ];
}
