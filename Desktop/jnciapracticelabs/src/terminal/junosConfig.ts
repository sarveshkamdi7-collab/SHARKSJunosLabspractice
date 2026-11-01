import {
  COMPOUND_HEADS,
  stripQuotes,
  tokenize,
  tokensToSegments,
} from './junosTokenizer';

export interface ConfigNode {
  children: Map<string, ConfigNode>;
  value?: string;
  virtual?: boolean;
}

export interface ConfigLeaf {
  segments: string[];
  value?: string;
}

export type ConfigJson = { [key: string]: ConfigJson | string };

const VALUE_KEYWORDS = new Set([
  'address',
  'autonomous-system',
  'community',
  'connection-limit',
  'cost',
  'count',
  'dead-interval',
  'description',
  'destination',
  'domain-name',
  'domain-search',
  'export',
  'facility',
  'filter',
  'from',
  'hello-interval',
  'host-name',
  'import',
  'input',
  'interval',
  'level',
  'local-address',
  'log',
  'match',
  'maximum-prefix',
  'members',
  'metric',
  'mtu',
  'name-server',
  'next-hop',
  'output',
  'peer-as',
  'port-mode',
  'preference',
  'priority',
  'protocol',
  'protocol-version',
  'rate-limit',
  'route-filter',
  'router-id',
  'size',
  'source',
  'source-address',
  'then',
  'time-zone',
  'timeout',
  'type',
  'vlan-id',
]);

export function createConfigNode(): ConfigNode {
  return { children: new Map<string, ConfigNode>() };
}

export function cloneConfigNode(node: ConfigNode): ConfigNode {
  const clone = createConfigNode();
  if (node.value !== undefined) clone.value = node.value;
  if (node.virtual) clone.virtual = true;
  node.children.forEach((child, name) => {
    clone.children.set(name, cloneConfigNode(child));
  });
  return clone;
}

export function ensureTokenPath(root: ConfigNode, tokens: string[]): ConfigNode {
  let node = root;
  let index = 0;

  while (index < tokens.length) {
    let segment = tokens[index];
    let consumed = 1;
    if (COMPOUND_HEADS.has(segment) && index + 1 < tokens.length) {
      segment = `${segment} ${tokens[index + 1]}`;
      consumed = 2;
    }
    let child = node.children.get(segment);
    if (!child) {
      child = createConfigNode();
      node.children.set(segment, child);
    }
    delete child.virtual;
    node = child;
    index += consumed;
  }

  return node;
}

export function ensureSegments(root: ConfigNode, segments: string[]): ConfigNode {
  let node = root;
  for (const segment of segments) {
    let child = node.children.get(segment);
    if (!child) {
      child = createConfigNode();
      node.children.set(segment, child);
    }
    node = child;
  }
  return node;
}

export function ensureEditSegments(root: ConfigNode, segments: string[]): ConfigNode {
  let node = root;
  for (const segment of segments) {
    let child = node.children.get(segment);
    if (!child) {
      child = createConfigNode();
      child.virtual = true;
      node.children.set(segment, child);
    }
    node = child;
  }
  return node;
}

export function resolveSegments(root: ConfigNode, segments: string[]): ConfigNode | null {
  let node = root;
  for (const segment of segments) {
    const child = node.children.get(segment);
    if (!child) return null;
    node = child;
  }
  return node;
}

export function setLeaf(parent: ConfigNode, name: string, value?: string): ConfigNode {
  let node = parent.children.get(name);
  if (!node) {
    node = createConfigNode();
    parent.children.set(name, node);
  }
  delete node.virtual;
  if (value === undefined) delete node.value;
  else node.value = value;
  return node;
}

function formatConfigValue(keyword: string, value: string): string {
  if (keyword === 'description' || keyword === 'community') {
    return `"${stripQuotes(value) ?? ''}"`;
  }
  return value;
}

function looksLikeValue(token: string): boolean {
  return (
    /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/.test(token) ||
    /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(token)
  );
}

export function setUnder(node: ConfigNode, tokens: string[]): void {
  if (tokens.length === 0) return;

  let valueIndex = -1;
  for (let index = 1; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (VALUE_KEYWORDS.has(token) && !COMPOUND_HEADS.has(token)) valueIndex = index;
  }

  if (valueIndex >= 0) {
    const keyword = tokens[valueIndex];
    const value = tokens.slice(valueIndex + 1).join(' ');
    const parent = ensureTokenPath(node, tokens.slice(0, valueIndex + 1));
    parent.value = formatConfigValue(keyword, value);
    return;
  }

  const last = tokens[tokens.length - 1];
  if (tokens.length >= 2 && looksLikeValue(last)) {
    const parent = ensureTokenPath(node, tokens.slice(0, -1));
    parent.value = formatConfigValue(tokens[tokens.length - 2], last);
    return;
  }

  ensureTokenPath(node, tokens);
}

export function deleteUnder(node: ConfigNode, tokens: string[]): boolean {
  if (tokens.length === 0) return false;
  const segments = tokensToSegments(tokens);
  if (segments.length === 0) return false;
  const parent = resolveSegments(node, segments.slice(0, -1));
  if (!parent) return false;
  return parent.children.delete(segments[segments.length - 1]);
}

export function renderChildren(node: ConfigNode, indent: number): string[] {
  const lines: string[] = [];
  const prefix = ' '.repeat(indent * 4);
  node.children.forEach((child, name) => {
    if (child.virtual && child.children.size === 0 && child.value === undefined) return;
    if (child.children.size === 0) {
      lines.push(`${prefix}${name}${child.value !== undefined ? ` ${child.value}` : ''};`);
      return;
    }
    lines.push(`${prefix}${name} {`);
    lines.push(...renderChildren(child, indent + 1));
    lines.push(`${prefix}}`);
  });
  return lines;
}

export function renderBlock(segment: string, node: ConfigNode): string[] {
  return [`${segment} {`, ...renderChildren(node, 1), '}'];
}

export function renderSetLines(node: ConfigNode, prefixSegments: string[] = []): string[] {
  const lines: string[] = [];
  const walk = (current: ConfigNode, path: string[]): void => {
    current.children.forEach((child, segment) => {
      if (child.virtual && child.children.size === 0 && child.value === undefined) return;
      const next = [...path, segment];
      if (child.children.size > 0) walk(child, next);
      else lines.push(`set ${next.join(' ')}${child.value !== undefined ? ` ${child.value}` : ''}`);
    });
  };
  walk(node, prefixSegments);
  return lines;
}

export function flattenConfig(node: ConfigNode, prefix: string[] = []): ConfigLeaf[] {
  const leaves: ConfigLeaf[] = [];
  node.children.forEach((child, segment) => {
    if (child.virtual && child.children.size === 0 && child.value === undefined) return;
    const next = [...prefix, segment];
    if (child.children.size > 0) leaves.push(...flattenConfig(child, next));
    else leaves.push({ segments: next, value: child.value });
  });
  return leaves;
}

export function pruneVirtual(node: ConfigNode): void {
  for (const [segment, child] of [...node.children.entries()]) {
    pruneVirtual(child);
    if (child.virtual && child.children.size === 0 && child.value === undefined) {
      node.children.delete(segment);
    }
  }
}

export function configToJson(node: ConfigNode): ConfigJson {
  const output: ConfigJson = {};
  node.children.forEach((child, segment) => {
    if (child.virtual && child.children.size === 0 && child.value === undefined) return;
    if (child.children.size > 0) {
      output[segment] = configToJson(child);
    } else {
      output[segment] = child.value ?? '';
    }
  });
  return output;
}

export function diffConfigs(active: ConfigNode, candidate: ConfigNode): string[] {
  const activeLeaves = new Map<string, ConfigLeaf>();
  const candidateLeaves = new Map<string, ConfigLeaf>();
  for (const leaf of flattenConfig(active)) activeLeaves.set(leaf.segments.join('\u0000'), leaf);
  for (const leaf of flattenConfig(candidate)) candidateLeaves.set(leaf.segments.join('\u0000'), leaf);

  const keys = new Set<string>([...activeLeaves.keys(), ...candidateLeaves.keys()]);
  const groups = new Map<string, string[]>();
  const orderedKeys = [...keys].sort();

  const push = (leaf: ConfigLeaf, sign: '+' | '-'): void => {
    const parent = leaf.segments.slice(0, -1);
    const header = parent.length > 0 ? `[edit ${parent.join(' ')}]` : '[edit]';
    const lines = groups.get(header) ?? [];
    const name = leaf.segments[leaf.segments.length - 1];
    lines.push(`${sign}  ${name}${leaf.value !== undefined ? ` ${leaf.value}` : ''};`);
    groups.set(header, lines);
  };

  for (const key of orderedKeys) {
    const before = activeLeaves.get(key);
    const after = candidateLeaves.get(key);
    if (before && !after) push(before, '-');
    else if (!before && after) push(after, '+');
    else if (before && after && before.value !== after.value) {
      push(before, '-');
      push(after, '+');
    }
  }

  const lines: string[] = [];
  groups.forEach((group, header) => {
    lines.push(header);
    lines.push(...group);
  });
  return lines;
}

export function seedConfig(hostname: string): ConfigNode {
  const root = createConfigNode();
  const system = ensureSegments(root, ['system']);
  setLeaf(system, 'host-name', hostname);
  setLeaf(system, 'time-zone', 'UTC');
  const services = ensureSegments(system, ['services']);
  setLeaf(services, 'ssh');

  const interfaces = ensureSegments(root, ['interfaces']);
  const loopback = ensureSegments(interfaces, ['lo0']);
  addUnit(loopback, '0', '1.1.1.1/32');

  const wan = ensureSegments(interfaces, ['ge-0/0/0']);
  setLeaf(wan, 'description', '"LINK-TO-R2"');
  addUnit(wan, '0', '10.0.12.1/30');

  const lan = ensureSegments(interfaces, ['ge-0/0/1']);
  setLeaf(lan, 'description', '"TRUNK-TO-SW1"');
  setLeaf(lan, 'vlan-tagging');
  addUnit(lan, '0', '10.0.10.1/24', '10', 'STAFF-VLAN');
  addUnit(lan, '20', '10.0.20.1/24', '20', 'GUEST-VLAN');

  const protocols = ensureSegments(root, ['protocols']);
  const ospf = ensureSegments(protocols, ['ospf']);
  const area = ensureSegments(ospf, ['area 0.0.0.0']);
  ensureSegments(area, ['interface ge-0/0/0.0']);
  ensureSegments(area, ['interface ge-0/0/1.0']);
  ensureSegments(area, ['interface ge-0/0/1.20']);
  setLeaf(ensureSegments(area, ['interface lo0.0']), 'passive');

  return root;
}

function addUnit(
  iface: ConfigNode,
  unitId: string,
  address: string,
  vlanId?: string,
  description?: string,
): ConfigNode {
  const unit = ensureSegments(iface, [`unit ${unitId}`]);
  if (vlanId !== undefined) setLeaf(unit, 'vlan-id', vlanId);
  if (description !== undefined) setLeaf(unit, 'description', `"${description}"`);
  const family = ensureSegments(unit, ['family inet']);
  setLeaf(family, 'address', address);
  return unit;
}

export function configFromSetLines(lines: string[] | undefined, hostname: string): ConfigNode {
  const root = lines === undefined ? seedConfig(hostname) : createConfigNode();
  for (const line of lines ?? []) {
    setUnder(root, tokenize(line.replace(/^\s*set\s+/i, '')));
  }
  return root;
}
