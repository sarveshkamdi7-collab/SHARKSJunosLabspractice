(function (global) {
  'use strict';

  var J = global.JJ || {};

  var IDENT_PARENTS = { unit: 1, address: 1, interface: 1, neighbor: 1, route: 1, user: 1, area: 1, group: 1, term: 1, filter: 1, application: 1, family: 1, zone: 1, community: 1 };
  var LEAF_VALUES = { description: 1, members: 1, 'vlan-id': 1, 'next-hop': 1, 'l3-interface': 1, 'peer-as': 1, cost: 1, priority: 1, 'hold-time': 1, mtu: 1, 'host-name': 1, 'domain-name': 1, 'router-id': 1, type: 1, mode: 1, region: 1, 'local-address': 1, text: 1, protocol: 1, level: 1, community: 1, metric: 1, all: 1, 'protocol-version': 1, 'connection-limit': 1, 'interface-mode': 1, 'port-mode': 1 };
  var MULTI_LIST = { members: 1 };

  function create(name) {
    return { name: name === null || name === undefined ? null : name, values: [], children: [], inactive: false, comment: null };
  }

  function clone(node) {
    var n = { name: node.name, values: node.values.slice(), inactive: !!node.inactive, comment: node.comment, children: [] };
    for (var i = 0; i < node.children.length; i++) n.children.push(clone(node.children[i]));
    return n;
  }

  function child(node, name) {
    if (!node) return null;
    for (var i = 0; i < node.children.length; i++) if (node.children[i].name === name) return node.children[i];
    return null;
  }

  function childOrCreate(node, name) {
    var c = child(node, name);
    if (c) return c;
    c = create(name);
    node.children.push(c);
    return c;
  }

  function nodeAt(root, path, forWrite) {
    var cur = root;
    for (var i = 0; i < path.length; i++) {
      if (forWrite) cur = childOrCreate(cur, path[i]);
      else {
        cur = child(cur, path[i]);
        if (!cur) return null;
      }
    }
    return cur;
  }

  function indexOfValue(node, value) {
    for (var i = 0; i < node.values.length; i++) if (node.values[i] === value) return i;
    return -1;
  }

  function set(root, tokens) {
    var cur = root, i = 0;
    while (i < tokens.length) {
      var t = tokens[i];
      i += 1;
      if (cur && cur.name !== null && IDENT_PARENTS[cur.name]) {
        cur = (child(cur, t) || childOrCreate(cur, t));
        continue;
      }
      var made = null;
      if (IDENT_PARENTS[t]) {
        made = childOrCreate(cur, t);
      } else if (LEAF_VALUES[t]) {
        made = childOrCreate(cur, t);
        if (i < tokens.length) {
          var v = tokens[i];
          i += 1;
          if (indexOfValue(made, v) < 0) made.values.push(v);
        }
      } else {
        made = childOrCreate(cur, t);
      }
      cur = made;
    }
  }

  // add/insert support (JunOS-like) - simplified
  function add(root, tokens) { return set(root, tokens); }
  function insert(root, tokens) { return set(root, tokens); }

  function del(root, tokens, value) {
    if (!tokens.length) return false;
    var target = nodeAt(root, tokens, false);
    if (!target) return false;
    var parent = nodeAt(root, tokens.slice(0, -1), false);
    if (!parent) return false;
    if (value !== undefined) {
      var vi = indexOfValue(target, value);
      if (vi < 0) return false;
      target.values.splice(vi, 1);
      if (!target.values.length && !target.children.length && LEAF_VALUES[target.name]) {
        removeChild(parent, target);
      }
      return true;
    }
    removeChild(parent, target);
    return true;
  }

  function removeChild(parent, target) {
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i] === target) {
        parent.children.splice(i, 1);
        return;
      }
    }
  }

  function setInactive(root, tokens, mode) {
    var n = nodeAt(root, tokens, false);
    if (!n) return false;
    n.inactive = !!mode;
    return true;
  }

  function annotate(root, tokens, comment) {
    var n = nodeAt(root, tokens, false);
    if (!n) return false;
    n.comment = comment;
    return true;
  }

  function stripMeta(n) {
    var c = [];
    for (var i = 0; i < n.children.length; i++) c.push(stripMeta(n.children[i]));
    return { n: n.name, v: n.values.slice(), i: !!n.inactive, c: c };
  }

  function equal(a, b) {
    return JSON.stringify(stripMeta(a)) === JSON.stringify(stripMeta(b));
  }

  function activeChildren(node, activeOnly) {
    var out = [];
    if (!node) return out;
    if (activeOnly && node.inactive) return out;
    for (var i = 0; i < node.children.length; i++) {
      if (activeOnly && node.children[i].inactive) continue;
      out.push(node.children[i]);
    }
    return out;
  }

  function chainOf(node) {
    var chain = [node];
    var cur = node;
    while (cur.values.length === 0 && cur.children.length === 1 && IDENT_PARENTS[cur.name]) {
      cur = cur.children[0];
      chain.push(cur);
    }
    return chain;
  }

  function quoteVal(v, stmtName) {
    v = String(v);
    if (/[\s"]/.test(v)) return '"' + v + '"';
    if (stmtName === 'description') return '"' + v + '"';
    return v;
  }

  function emitBrace(node, depth, lines, activeOnly) {
    var chain = chainOf(node);
    var anyInactive = false, comment = null;
    for (var i = 0; i < chain.length; i++) {
      if (chain[i].inactive) anyInactive = true;
      if (chain[i].comment && !comment) comment = chain[i].comment;
    }
    if (activeOnly && anyInactive) return;
    var headNames = chain.map(function (n) { return n.name; }).join(' ');
    var base = J.padR('', depth * 4);
    if (comment) base += '/* ' + comment + ' */ ';
    var mark = anyInactive ? 'inactive: ' : '';
    var cur = chain[chain.length - 1];
    var parentStmt = chain.length > 1 ? chain[chain.length - 2] : node;
    var stmtOwner = chain.length > 1 ? parentStmt.name : node.name;
    if (cur.values.length === 0 && cur.children.length === 0) {
      lines.push(base + mark + headNames + ';');
      return;
    }
    if (cur.values.length === 0) {
      lines.push(base + mark + headNames + ' {');
      var kids = activeChildren(cur, activeOnly);
      for (var c = 0; c < kids.length; c++) emitBrace(kids[c], depth + 1, lines, activeOnly);
      lines.push(base + '}');
      return;
    }
    if (MULTI_LIST[stmtOwner] && cur.values.length > 1) {
      lines.push(base + mark + headNames + ' [ ' + cur.values.join(' ') + ' ];');
      return;
    }
    for (var v = 0; v < cur.values.length; v++) {
      lines.push(base + mark + headNames + ' ' + quoteVal(cur.values[v], stmtOwner) + ';');
    }
    if (cur.children.length > 0) {
      lines.push(base + mark + headNames + ' {');
      var ck = activeChildren(cur, activeOnly);
      for (var k = 0; k < ck.length; k++) emitBrace(ck[k], depth + 1, lines, activeOnly);
      lines.push(base + '}');
    }
  }

  function braceRender(root, startPath, activeOnly) {
    var start = root;
    if (startPath && startPath.length) {
      start = nodeAt(root, startPath, false);
      if (!start) return null;
      if (!start.children.length && !start.values.length) return [start.name + ';'];
    }
    if (!start.children.length && !start.values.length) return [];
    var lines = [];
    var kids = activeChildren(start, activeOnly);
    for (var i = 0; i < kids.length; i++) emitBrace(kids[i], 0, lines, activeOnly);
    return lines;
  }

  function emitSet(node, path, out, inheritedInactive) {
    var chain = chainOf(node);
    var tok = path.slice();
    for (var i = 0; i < chain.length; i++) tok.push(chain[i].name);
    var inactive = inheritedInactive;
    for (var q = 0; q < chain.length; q++) if (chain[q].inactive) inactive = true;
    var cur = chain[chain.length - 1];
    if (cur.values.length === 0 && cur.children.length === 0) {
      out.push({ tokens: tok, value: null, inactive: inactive });
      return;
    }
    for (var v = 0; v < cur.values.length; v++) {
      out.push({ tokens: tok, value: cur.values[v], inactive: inactive });
    }
    for (var c = 0; c < cur.children.length; c++) {
      emitSet(cur.children[c], tok, out, inactive);
    }
  }

  function setLines(root, activeOnly) {
    var out = [];
    var kids = activeChildren(root, activeOnly);
    for (var i = 0; i < kids.length; i++) emitSet(kids[i], [], out, false);
    return out;
  }

  function stmtText(entry) {
    var s = entry.tokens.join(' ');
    if (entry.value !== null) {
      var stmtName = entry.tokens.length > 1 ? entry.tokens[entry.tokens.length - 2] : '';
      s += ' ' + quoteVal(entry.value, stmtName);
    }
    return s;
  }

  function chainLineFor(node, wantInactiveLabel) {
    var ch = chainOf(node);
    var cur = ch[ch.length - 1];
    var s = ch.map(function (n) { return n.name; }).join(' ');
    var inactive = false;
    for (var i = 0; i < ch.length; i++) if (ch[i].inactive) inactive = true;
    if (wantInactiveLabel === true) inactive = true;
    if (wantInactiveLabel === false) inactive = false;
    if (cur.values.length > 0) {
      s += ' ' + quoteVal(cur.values[0], ch.length > 1 ? ch[ch.length - 2].name : '');
    }
    if (cur.values.length > 1) {
      s += ' [ ' + cur.values.slice(1).join(' ') + ' ]';
    }
    if (cur.children.length > 0) s += ' {';
    else s += ';';
    if (inactive) s = 'inactive: ' + s;
    return s;
  }

  function compareTrees(committed, candidate) {
    var out = [];
    var lastGroup = null;
    function ensureHeader(group) {
      var key = '|' + group.join('|') + '|';
      if (lastGroup === key) return;
      out.push('[edit' + (group.length ? ' ' + group.join(' ') : '') + ']');
      lastGroup = key;
    }
    function walk(o, n, group) {
      var names = [], seen = {};
      function add(node) {
        if (!node) return;
        for (var i = 0; i < node.children.length; i++) {
          var nm = node.children[i].name;
          if (!seen[nm]) { seen[nm] = 1; names.push(nm); }
        }
      }
      add(n); add(o);
      names.sort(J.cmpTokens);
      for (var x = 0; x < names.length; x++) {
        var nm = names[x];
        var co = child(o, nm), cn = child(n, nm);
        if (co && !cn) {
          ensureHeader(group);
          var dl = braceRender(rootSide(co), [], false);
          for (var i = 0; i < dl.length; i++) out.push('- ' + dl[i]);
          continue;
        }
        if (cn && !co) {
          ensureHeader(group);
          var ax = braceRender(rootSide(cn), [], false);
          for (var j = 0; j < ax.length; j++) out.push('+ ' + ax[j]);
          continue;
        }
        if (!co || !cn) continue;
        if (equal(co, cn)) continue;
        if (equalIgnoreInactive(co, cn)) {
          ensureHeader(group);
          out.push('! ' + chainLineFor(cn, null));
          continue;
        }
        var chain = chainOf(cn);
        var tail = chain[chain.length - 1];
        var vs = diffValues(co, cn);
        if (vs.length) {
          ensureHeader(group);
          var chainTxt = chain.map(function (w) { return w.name; }).join(' ');
          for (var k = 0; k < vs.length; k++) {
            out.push(vs[k][1] + ' ' + chainTxt + ' ' + stmtTailText(tail, vs[k][0]) + ';');
          }
          continue;
        }
        var chainO = chainOf(co);
        var tailO = chainO[chainO.length - 1];
        walk(tailO, tail, group.concat(chain.map(function (w) { return w.name; })));
      }
      function stmtTailText(tail, val) {
        return quoteVal(val, tail.name);
      }
      function diffValues(co, cn) {
        var so = {}, sn = {}, res = [];
        for (var i = 0; i < co.values.length; i++) so[co.values[i]] = 1;
        for (var j = 0; j < cn.values.length; j++) sn[cn.values[j]] = 1;
        for (var k in sn) if (!(k in so)) res.push([k, '+']);
        for (var m in so) if (!(m in sn)) res.push([m, '-']);
        res.sort(function (a, b) { return J.cmpTokens([a[0]], [b[0]]); });
        return res;
      }
    }
    function rootSide(node) {
      var r = create(null);
      r.children.push(node);
      return r;
    }
    function equalIgnoreInactive(a, b) {
      var sa = JSON.parse(JSON.stringify(stripIgnore(a)));
      var sb = JSON.parse(JSON.stringify(stripIgnore(b)));
      return JSON.stringify(sa) === JSON.stringify(sb);
    }
    function stripIgnore(n) {
      var c = [];
      for (var i = 0; i < n.children.length; i++) c.push(stripIgnore(n.children[i]));
      return { n: n.name, v: n.values.slice(), c: c };
    }
    walk(committed, candidate, []);
    return out;
  }

  var api = {
    create: create,
    clone: clone,
    child: child,
    childOrCreate: childOrCreate,
    nodeAt: nodeAt,
    set: set,
    add: add,
    insert: insert,
    del: del,
    setInactive: setInactive,
    activate: function(root, tokens){ return setInactive(root, tokens, false); },
    deactivate: function(root, tokens){ return setInactive(root, tokens, true); },
    annotate: annotate,
    equal: equal,
    braceRender: braceRender,
    setLines: setLines,
    compareTrees: compareTrees,
    activeChildren: activeChildren,
    stmtText: stmtText,
    chainOf: chainOf
  };

  global.JJ = global.JJ || {};
  global.JJ.db = api;
})(typeof window !== 'undefined' ? window : globalThis);
