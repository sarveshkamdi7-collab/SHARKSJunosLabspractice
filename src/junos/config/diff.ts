import {
  ConfigTree,
  KEYED_CONTAINERS,
  type ConfigNode,
  formatValue,
} from './tree';

function unionKeys(a: ConfigNode, b: ConfigNode): string[] {
  const keys = new Set<string>([...a.children.keys(), ...b.children.keys()]);
  return [...keys].sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
}

function indentFor(depth: number): string {
  return '    '.repeat(depth);
}

function renderChildren(node: ConfigNode, depth: number, sign: '+' | '-', lines: string[]): void {
  for (const key of unionKeys(node, node)) {
    const child = node.children.get(key);
    if (child) renderSubtree(child, depth, sign, lines);
  }
}

function renderSubtree(
  node: ConfigNode,
  depth: number,
  sign: '+' | '-',
  lines: string[],
): void {
  const prefix = `${sign}   `;
  const indent = indentFor(depth);
  const inactive = node.inactive ? 'inactive: ' : '';

  if (node.leaf) {
    const values = node.values.map(formatValue).join(' ');
    lines.push(`${prefix}${indent}${inactive}${node.name}${values ? ` ${values}` : ''};`);
    return;
  }

  if (KEYED_CONTAINERS.has(node.name) && node.children.size > 0) {
    for (const key of unionKeys(node, node)) {
      const child = node.children.get(key)!;
      const childInactive = node.inactive || child.inactive ? 'inactive: ' : '';
      if (child.leaf) {
        const values = child.values.map(formatValue).join(' ');
        lines.push(
          `${prefix}${indent}${childInactive}${node.name} ${key}${values ? ` ${values}` : ''};`,
        );
      } else {
        lines.push(`${prefix}${indent}${childInactive}${node.name} ${key} {`);
        renderChildren(child, depth + 1, sign, lines);
        lines.push(`${prefix}${indent}}`);
      }
    }
    return;
  }

  lines.push(`${prefix}${indent}${inactive}${node.name} {`);
  renderChildren(node, depth + 1, sign, lines);
  lines.push(`${prefix}${indent}}`);
}

function diffNode(
  active: ConfigNode,
  candidate: ConfigNode,
  path: string[],
  out: string[],
): void {
  const direct: string[] = [];
  const nested: string[][] = [];

  for (const key of unionKeys(active, candidate)) {
    const a = active.children.get(key);
    const b = candidate.children.get(key);

    if (!a && b) {
      if (!b.leaf && !KEYED_CONTAINERS.has(b.name)) {
        const sub = [`[edit ${[...path, key].join(' ')}]`];
        renderChildren(b, 0, '+', sub);
        if (sub.length > 1) nested.push(sub);
      } else {
        renderSubtree(b, 0, '+', direct);
      }
      continue;
    }
    if (a && !b) {
      if (!a.leaf && !KEYED_CONTAINERS.has(a.name)) {
        const sub = [`[edit ${[...path, key].join(' ')}]`];
        renderChildren(a, 0, '-', sub);
        if (sub.length > 1) nested.push(sub);
      } else {
        renderSubtree(a, 0, '-', direct);
      }
      continue;
    }
    if (!a || !b) continue;

    if (a.leaf && b.leaf) {
      if (a.inactive !== b.inactive) {
        direct.push(
          b.inactive ? `+   inactive: ${key}` : `-   inactive: ${key}`,
        );
      }
      for (const value of b.values) {
        if (!a.values.includes(value)) {
          direct.push(`+   ${key} ${formatValue(value)};`);
        }
      }
      for (const value of a.values) {
        if (!b.values.includes(value)) {
          direct.push(`-   ${key} ${formatValue(value)};`);
        }
      }
      continue;
    }

    if (a.leaf !== b.leaf) {
      renderSubtree(a, 0, '-', direct);
      renderSubtree(b, 0, '+', direct);
      continue;
    }

    if (a.inactive !== b.inactive) {
      direct.push(b.inactive ? `+   inactive: ${key}` : `-   inactive: ${key}`);
    }
    const sub: string[] = [];
    diffNode(a, b, [...path, key], sub);
    if (sub.length > 0) nested.push(sub);
  }

  if (direct.length > 0) {
    out.push(`[edit ${path.join(' ')}]`.replace(/\s+$/, ''));
    out.push(...direct);
  }
  for (const sub of nested) out.push(...sub);
}

export function diffTrees(active: ConfigTree, candidate: ConfigTree): string[] {
  const out: string[] = [];
  diffNode(active.root, candidate.root, [], out);
  return out;
}

export function renderCompare(active: ConfigTree, candidate: ConfigTree): string {
  const lines = diffTrees(active, candidate);
  return lines.length === 0 ? 'No differences' : lines.join('\n');
}
