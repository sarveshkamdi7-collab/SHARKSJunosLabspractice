import { ConfigTree } from './tree';
import { diffTrees } from './diff';

export interface CommitCheckResult {
  ok: boolean;
  errors: string[];
}

export interface CommitResult {
  ok: boolean;
  confirmed: boolean;
  rollbackInMinutes?: number;
  errors: string[];
}

export interface RollbackResult {
  ok: boolean;
  index: number;
  error?: string;
}

export interface PendingRollback {
  deadline: number;
  minutes: number;
  previous: ConfigTree;
}

export const MAX_ROLLBACK = 50;

export class ConfigManager {
  active: ConfigTree;
  candidate: ConfigTree;
  history: ConfigTree[];
  pending?: PendingRollback;
  lastComment?: string;
  private clock: () => number;

  constructor(initial: ConfigTree = new ConfigTree(), clock: () => number = () => Date.now()) {
    this.active = initial.clone();
    this.candidate = initial.clone();
    this.history = [this.active.clone()];
    this.clock = clock;
  }

  isDirty(): boolean {
    return !this.active.equals(this.candidate);
  }

  diff(): string[] {
    return diffTrees(this.active, this.candidate);
  }

  commitCheck(): CommitCheckResult {
    return { ok: true, errors: [] };
  }

  commit(options: { comment?: string; confirmedMinutes?: number } = {}): CommitResult {
    const check = this.commitCheck();
    if (!check.ok) {
      return { ok: false, confirmed: false, errors: check.errors };
    }

    if (this.pending) {
      this.pending = undefined;
      this.candidate = this.active.clone();
      return { ok: true, confirmed: true, errors: [] };
    }

    this.active = this.candidate.clone();
    this.history.unshift(this.active.clone());
    this.history = this.history.slice(0, MAX_ROLLBACK);
    this.candidate = this.active.clone();
    if (options.comment !== undefined) this.lastComment = options.comment;

    if (options.confirmedMinutes !== undefined && options.confirmedMinutes > 0) {
      const minutes = options.confirmedMinutes;
      this.pending = {
        deadline: this.clock() + minutes * 60_000,
        minutes,
        previous: this.history[1]?.clone() ?? new ConfigTree(),
      };
      return { ok: true, confirmed: false, rollbackInMinutes: minutes, errors: [] };
    }

    return { ok: true, confirmed: false, errors: [] };
  }

  confirm(): boolean {
    if (!this.pending) return false;
    this.pending = undefined;
    this.candidate = this.active.clone();
    return true;
  }

  rollback(index = 0): RollbackResult {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_ROLLBACK) {
      return { ok: false, index, error: 'rollback index out of range' };
    }
    if (index >= this.history.length) {
      return { ok: false, index, error: 'rollback index out of range' };
    }
    this.candidate = this.history[index].clone();
    return { ok: true, index };
  }

  historySize(): number {
    return this.history.length;
  }

  tick(now = this.clock()): boolean {
    if (!this.pending) return false;
    if (now < this.pending.deadline) return false;
    const previous = this.pending.previous.clone();
    this.pending = undefined;
    this.history = this.history.slice(1);
    if (this.history.length === 0) this.history = [previous.clone()];
    this.active = previous;
    this.candidate = previous.clone();
    return true;
  }

  timeToRollback(now = this.clock()): number | undefined {
    if (!this.pending) return undefined;
    return Math.max(0, this.pending.deadline - now);
  }
}
