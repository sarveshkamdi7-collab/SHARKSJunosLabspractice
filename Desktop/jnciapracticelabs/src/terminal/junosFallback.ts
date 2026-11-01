import type { JunosStateStore } from './junosStateStore';

/**
 * The lab is fully deterministic and offline: this module never opens a network
 * connection. The option fields are kept for source compatibility with earlier
 * callers, but they are intentionally ignored.
 */
export interface JunosFallbackOptions {
  endpoint?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export interface JunosFallbackPayload {
  instruction: string;
  command: string;
  diff: string[];
}

export interface JunosFallbackRequest {
  offline: true;
  timeoutMs: number;
}

const DEFAULT_INSTRUCTION = [
  'Offline Junos lab: every command is answered by the local deterministic engine.',
  'No external model, API, or network request is used.',
].join(' ');

export function buildJunosFallbackPayload(
  command: string,
  store: JunosStateStore,
  instruction = DEFAULT_INSTRUCTION,
): JunosFallbackPayload {
  return {
    instruction,
    command,
    diff: store.diff(),
  };
}

export function resolveFallbackRequest(options: JunosFallbackOptions = {}): JunosFallbackRequest {
  return {
    offline: true,
    timeoutMs: options.timeoutMs ?? 0,
  };
}

export async function requestJunosFallback(
  _command: string,
  _store: JunosStateStore,
  _options: JunosFallbackOptions = {},
): Promise<string[] | null> {
  void _command;
  void _store;
  void _options;
  return null;
}
