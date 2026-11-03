export interface ConfigNode {
  name: string;
  leaf: boolean;
  values: string[];
  children: Map<string, ConfigNode>;
  inactive: boolean;
}

const FLAG_WORDS = new Set([
  'disable',
  'passive',
  'discard',
  'reject',
  'no-resolve',
  'no-readvertise',
  'no-eligible',
  'ssh',
  'telnet',
  'ftp',
  'http',
  'https',
  'inet',
  'inet6',
  'ethernet-switching',
  'enable',
  'shutdown',
]);

const LIST_LEAVES = new Set([
  'address',
  'next-hop',
  'interface',
  'neighbor',
  'name-server',
  'domain-search',
  'vlan',
  'community',
]);

export const KEYED_CONTAINERS = new Set([
  'unit',
  'family',
  'area',
  'route',
  'interface',
  'vlan',
  'neighbor',
  'peer',
  'group',
  'zone',
  'policy',
  'prefix-list',
  'filter',
]);

const TOP_LEVEL_ORDER = [
  'system',
  'chassis',
  'interfaces',
  'forwarding-options',
  'routing-options',
  'protocols',
  'policy-options',
  'security',
  'vlans',
  'snmp',
  'class-of-service',
  'firewall',
  'applications',
];

function createNode(name: string): ConfigNode {
  return {
    name,
    leaf: false,
    values: [],
    children: new Map(),
    inactive: false,
  };
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
}

export function orderedKeys(node: ConfigNode): string[] {
  const keys = [...node.children.keys()];
  if (!node.name) {
    const order = new Map(TOP_LEVEL_ORDER.map((key, index) => [key, index]));
    return keys.sort((a, b) => {
      const ai = order.has(a) ? order.get(a)! : TOP_LEVEL_ORDER.length;
      const bi = order.has(b) ? order.get(b)! : TOP_LEVEL_ORDER.length;
      if (ai !== bi) return ai - bi;
      return naturalCompare(a, b);
    });
  }
  return keys.sort(naturalCompare);
}

export function formatValue(value: string): string {
  if (/^\S+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function childOrCreate(parent: ConfigNode, name: string): ConfigNode {
  let child = parent.children.get(name);
  if (!child) {
    child = createNode(name);
    parent.children.set(name, child);
  }
  return child;
}

function convertLeafToContainer(node: ConfigNode): void {
  if (!node.leaf) return;
  const values = [...node.values];
  node.leaf = false;
  node.values = [];
  for (const value of values) {
    const child = childOrCreate(node, value);
    child.leaf = true;
  }
}

export class ConfigTree {
  readonly root: ConfigNode;

  constructor(root?: ConfigNode) {
    this.root = root ?? createNode('');
  }

  static fromSetLines(lines: string[]): ConfigTree {
    const tree = new ConfigTree();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('set ')) {
        tree.setWords(trimmed.split(/\s+/).slice(1));
      } else if (trimmed.startsWith('deactivate ')) {
        tree.setInactive(trimmed.split(/\s+/).slice(1), true);
      } else if (trimmed.startsWith('activate ')) {
        tree.setInactive(trimmed.split(/\s+/).slice(1), false);
      }
    }
    return tree;
  }

  clone(): ConfigTree {
    return new ConfigTree(cloneNode(this.root));
  }

  isEmpty(): boolean {
    return this.root.children.size === 0;
  }

  get(path: string[]): ConfigNode | undefined {
    let node: ConfigNode = this.root;
    for (const part of path) {
      const next = node.children.get(part);
      if (!next) return undefined;
      node = next;
    }
    return node;
  }

  ensure(path: string[]): ConfigNode {
    let node = this.root;
    for (const part of path) {
      let next = node.children.get(part);
      if (!next) {
        next = createNode(part);
        node.children.set(part, next);
      }
      if (next.leaf && next.children.size === 0) {
        convertLeafToContainer(next);
      }
      node = next;
    }
    return node;
  }

  set(path: string[], value?: string, replace = false): void {
    if (path.length === 0) return;
    const parent = this.ensure(path.slice(0, -1));
    const name = path[path.length - 1];
    let node = parent.children.get(name);
    if (!node) {
      node = createNode(name);
      parent.children.set(name, node);
    }
    node.leaf = true;
    if (value === undefined) {
      node.values = [];
      node.children.clear();
      return;
    }
    const listLeaf = LIST_LEAVES.has(name);
    if (replace || !listLeaf || node.values.length === 0) {
      node.values = [value];
    } else if (!node.values.includes(value)) {
      node.values.push(value);
    }
    node.children.clear();
  }

  setWords(words: string[]): string[] {
    if (words.length === 0) return [];
    const last = words[words.length - 1];
    const flag = FLAG_WORDS.has(last);
    if (flag) {
      this.set(words, undefined);
      return words;
    }
    this.set(words.slice(0, -1), last);
    return words.slice(0, -1);
  }

  delete(path: string[]): boolean {
    if (path.length === 0) {
      const had = this.root.children.size > 0;
      this.root.children.clear();
      return had;
    }
    const parent = this.get(path.slice(0, -1));
    if (!parent) return false;
    return parent.children.delete(path[path.length - 1]);
  }

  setInactive(path: string[], inactive: boolean): boolean {
    const node = this.get(path);
    if (!node) return false;
    node.inactive = inactive;
    return true;
  }

  isInactive(path: string[]): boolean {
    let node: ConfigNode = this.root;
    for (const part of path) {
      const next = node.children.get(part);
      if (!next) return false;
      node = next;
      if (node.inactive) return true;
    }
    return false;
  }

  leaves(): { path: string[]; value?: string; inactive: boolean }[] {
    const out: { path: string[]; value?: string; inactive: boolean }[] = [];
    const walk = (node: ConfigNode, path: string[], inactive: boolean) => {
      const nowInactive = inactive || node.inactive;
      if (node.leaf) {
        if (node.values.length === 0) {
          out.push({ path, inactive: nowInactive });
        } else {
          for (const value of node.values) out.push({ path, value, inactive: nowInactive });
        }
        return;
      }
      for (const key of orderedKeys(node)) {
        const child = node.children.get(key);
        if (child) walk(child, [...path, key], nowInactive);
      }
    };
    for (const key of orderedKeys(this.root)) {
      const child = this.root.children.get(key);
      if (child) walk(child, [key], false);
    }
    return out;
  }

  equals(other: ConfigTree): boolean {
    return canonical(this.root) === canonical(other.root);
  }
}

function cloneNode(node: ConfigNode): ConfigNode {
  const copy: ConfigNode = {
    name: node.name,
    leaf: node.leaf,
    values: [...node.values],
    children: new Map(),
    inactive: node.inactive,
  };
  for (const [key, child] of node.children) {
    copy.children.set(key, cloneNode(child));
  }
  return copy;
}

function canonical(node: ConfigNode): string {
  const children = [...node.children.entries()]
    .map(([key, child]) => `${key}:${canonical(child)}`)
    .sort();
  return `${node.leaf ? 'L' : 'C'}${node.inactive ? 'I' : ''}(${node.values.join('|')}){${children.join(',')}}`;
}
