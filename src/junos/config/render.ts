import {
  ConfigTree,
  KEYED_CONTAINERS,
  type ConfigNode,
  formatValue,
  orderedKeys,
} from './tree';

function renderNode(node: ConfigNode, depth: number, lines: string[]): void {
  const indent = '    '.repeat(depth);
  const inactive = node.inactive ? 'inactive: ' : '';

  if (node.leaf) {
    const values = node.values.map(formatValue).join(' ');
    lines.push(`${indent}${inactive}${node.name}${values ? ` ${values}` : ''};`);
    return;
  }

  if (KEYED_CONTAINERS.has(node.name) && node.children.size > 0) {
    for (const key of orderedKeys(node)) {
      const child = node.children.get(key)!;
      const childInactive = node.inactive || child.inactive ? 'inactive: ' : '';
      if (child.leaf) {
        const values = child.values.map(formatValue).join(' ');
        lines.push(
          `${indent}${childInactive}${node.name} ${key}${values ? ` ${values}` : ''};`,
        );
      } else {
        lines.push(`${indent}${childInactive}${node.name} ${key} {`);
        renderChildren(child, depth + 1, lines);
        lines.push(`${indent}}`);
      }
    }
    return;
  }

  lines.push(`${indent}${inactive}${node.name} {`);
  renderChildren(node, depth + 1, lines);
  lines.push(`${indent}}`);
}

function renderChildren(node: ConfigNode, depth: number, lines: string[]): void {
  for (const key of orderedKeys(node)) {
    const child = node.children.get(key);
    if (child) renderNode(child, depth, lines);
  }
}

export function renderConfig(tree: ConfigTree): string {
  const lines: string[] = [];
  renderChildren(tree.root, 0, lines);
  return lines.join('\n');
}

export function renderDisplaySet(tree: ConfigTree): string[] {
  const lines: string[] = [];

  const walk = (node: ConfigNode, path: string[]): void => {
    if (path.length > 0 && node.inactive) {
      lines.push(`deactivate ${path.join(' ')}`);
      return;
    }
    if (node.leaf) {
      if (node.values.length === 0) {
        lines.push(`set ${path.join(' ')}`);
      } else {
        for (const value of node.values) {
          lines.push(`set ${path.join(' ')} ${formatValue(value)}`);
        }
      }
      return;
    }
    for (const key of orderedKeys(node)) {
      const child = node.children.get(key);
      if (child) walk(child, [...path, key]);
    }
  };

  walk(tree.root, []);
  return lines;
}
