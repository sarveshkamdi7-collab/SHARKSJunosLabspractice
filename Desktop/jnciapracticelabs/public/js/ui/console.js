(function (global) {
  'use strict';

  var J = global.JJ || {};
  var APP = (J.app = J.app || {});

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    return d;
  }

  function shellPrompt(sess, host) {
    var user = sess && sess.user ? sess.user : 'root';
    return user + '@' + host + ':~ % ';
  }

  function opPrompt(sess, host) {
    var user = sess && sess.user ? sess.user : 'user';
    var h = host || 'R1';
    return user + '@' + h + '> ';
  }

  var OP_COMMANDS = ['clear', 'configure', 'edit', 'exit', 'help', 'monitor', 'ping', 'quit', 'request', 'show', 'ssh', 'start', 'telnet', 'traceroute'];
  var SHOW_TREE = ['arp', 'bgp', 'chassis', 'configuration', 'ethernet-switching', 'interfaces', 'lldp', 'log', 'ospf', 'route', 'spanning-tree', 'system', 'version', 'vlans'];
  var CFG_COMMANDS = ['commit', 'delete', 'edit', 'exit', 'help', 'insert', 'rename', 'rollback', 'run', 'set', 'show', 'top', 'up', 'wildcard'];
  var SHELL_COMMANDS = ['cat', 'cli', 'date', 'df', 'exit', 'freebsd-version', 'hostname', 'ifconfig', 'ls', 'netstat', 'ping', 'pwd', 'route', 'show', 'ssh', 'top', 'traceroute', 'uname', 'uptime', 'whoami'];

  function words(cmd, prefix) {
    var s = String(prefix || '').toLowerCase();
    return cmd.filter(function (x) { return x.toLowerCase().indexOf(s) === 0; });
  }

  function completionFor(sess, line) {
    var parts = String(line).split(/\s+/);
    var trailing = /\s$/.test(line);
    var idx = trailing ? parts.length : parts.length - 1;
    var word = trailing ? '' : parts[idx];
    var before = parts.slice(0, idx).filter(Boolean);
    var mode = sess.mode;
    var list = [];

    if (mode === 'cli-cfg') {
      if (idx === 0) list = words(CFG_COMMANDS, word);
      else if (before[0] === 'edit' || before[0] === 'set' || before[0] === 'delete') list = ['system', 'interfaces', 'protocols', 'routing-options', 'security', 'vlans', 'policy-options'];
      else if (before[0] === 'run') list = words(OP_COMMANDS, word);
      else list = [];
    } else if (mode === 'shell') {
      if (idx === 0) list = words(SHELL_COMMANDS, word);
      else list = [];
    } else {
      if (idx === 0) list = words(OP_COMMANDS, word);
      else if (before[0] === 'show') {
        if (idx === 1) list = words(SHOW_TREE, word);
        else if (before[1] === 'interfaces') list = words(['terse', 'detail', 'extensive', 'diagnostics'], word);
        else if (before[1] === 'ospf') list = words(['neighbor', 'database', 'interface', 'overview'], word);
        else if (before[1] === 'route') list = words(['summary', 'detail', 'exact', 'protocol'], word);
        else if (before[1] === 'system') list = words(['uptime', 'commit', 'processes', 'storage', 'users'], word);
        else list = [];
      } else if (before[0] === 'ping' || before[0] === 'traceroute') list = ['count', 'source', 'rapid', 'inet'];
      else if (before[0] === 'monitor' && idx === 1) list = words(['traffic', 'interface', 'start'], word);
      else list = [];
    }

    if (list.length === 1) {
      list = [list[0] + (idx === 0 ? ' ' : ' ')];
      var completed = parts.slice(0, idx).concat(list[0]).join(' ');
      return { text: completed, lines: [] };
    }
    if (list.length > 1) {
      var common = list[0];
      list.forEach(function (v) { while (common && v.toLowerCase().indexOf(common.toLowerCase()) !== 0) common = common.slice(0, -1); });
      if (common && common.length > word.length) {
        var cparts = parts.slice(0, idx).concat([common]);
        return { text: cparts.join(' ') + (list.length === 1 ? ' ' : ''), lines: [] };
      }
      return { text: line, lines: ['Possible completions:', '  ' + list.join('  ')] };
    }
    return { text: line, lines: [] };
  }

  function createConsole(host, opts) {
    opts = opts || {};
    var node = opts.node || opts;
    var session = opts.session || null;
    var isHost = node && node.junos === false;
    var input = '';
    var history = [];
    var hidx = history.length;
    var maxLines = opts.maxLines || 2200;
    var started = false;

    host.innerHTML = '';
    host.classList.add('term-surface');
    host.classList.add(isHost ? 'term-host' : 'term-junos');
    host.tabIndex = 0;
    host.setAttribute('role', 'application');
    host.setAttribute('aria-label', (node && node.name ? node.name : 'Device') + ' console');

    var scroll = el('div', 'term-scroll');
    var out = el('div', 'term-out');
    scroll.appendChild(out);
    var inputLine = el('div', 'term-in');
    var promptEl = el('span', 'term-prompt');
    var textEl = el('span', 'term-text');
    var cursor = el('span', 'term-cursor', ' ');
    var capture = el('input');
    capture.type = 'text';
    capture.className = 'term-capture';
    capture.setAttribute('autocapitalize', 'off');
    capture.setAttribute('autocomplete', 'off');
    capture.setAttribute('autocorrect', 'off');
    capture.setAttribute('spellcheck', 'false');
    capture.setAttribute('aria-hidden', 'true');
    inputLine.appendChild(promptEl); inputLine.appendChild(textEl); inputLine.appendChild(cursor); inputLine.appendChild(capture);
    scroll.appendChild(inputLine);
    host.appendChild(scroll);

    function renderInput() {
      textEl.textContent = input;
      try { capture.value = input; } catch (e) {}
      cursor.style.display = 'inline-block';
      scroll.scrollTop = scroll.scrollHeight;
    }
    function setPrompt(s) {
      promptEl.textContent = s || '';
      renderInput();
    }
    function writeLine(line, cls) {
      var d = el('div', 'term-line' + (cls ? ' ' + cls : ''));
      d.textContent = line == null ? '' : String(line);
      out.appendChild(d);
      while (out.children.length > maxLines) out.removeChild(out.firstChild);
      scroll.scrollTop = scroll.scrollHeight;
      return d;
    }
    function writeLines(lines, cls) {
      if (!lines) return;
      if (!Array.isArray(lines)) lines = [lines];
      for (var i = 0; i < lines.length; i++) writeLine(lines[i], cls);
    }
    function echo(promptText, line) {
      var d = el('div', 'term-echo');
      var p = el('span', 'term-echo-prompt', promptText);
      var c = el('span', 'term-echo-cmd', line);
      d.appendChild(p); d.appendChild(c);
      out.appendChild(d);
      scroll.scrollTop = scroll.scrollHeight;
    }
    function clear() { out.innerHTML = ''; }
    function focus() {
      try { capture.focus({ preventScroll: true }); } catch (e) { try { capture.focus(); } catch (_) {} }
      try { host.focus({ preventScroll: true }); } catch (e) { try { host.focus(); } catch (_) {} }
    }
    function currentPrompt() {
      if (isHost) return hostPrompt();
      if (!session) return (node.name || 'R1') + '>';
      return J.machine.promptFor(session);
    }
    function hostPrompt() { return (node.name || 'Host-A') + '> '; }

    function boot(showBanner) {
      if (started) return;
      started = true;
        if (isHost) {
          if (showBanner !== false) {
            writeLines([
              'VPCS v0.8.3, Virtual PC Simulator',
              node.name + ', eth0 ' + (node.ip || '10.0.3.20') + '/24, gateway ' + (node.gateway || '10.0.3.1'),
              'Type "help" for available commands.',
              ''
            ]);
          }
          setPrompt(hostPrompt());
          setTimeout(focus, 50);
          return;
        }
        var rt = session && session.rt;
        var ver = (rt && rt.spec && rt.spec.version) || '21.4R1';
        if (showBanner !== false) {
          writeLines([
            'JUNOS ' + ver + ' - vSRX 3.0',
            'Console connected to ' + (node ? node.name : 'R1') + ' - localhost:' + ((node && node.consolePort) || 5001),
            'Type "cli" from the shell to enter operational mode.',
            ''
          ]);
        }
        setPrompt(currentPrompt());
        setTimeout(focus, 50);
    }

    function hostCommand(line) {
      var toks = line.trim().split(/\s+/);
      var cmd = (toks[0] || '').toLowerCase();
      var ip = node.ip || '10.0.3.20';
      var gw = node.gateway || '10.0.3.1';
      if (!cmd) return;
      if (cmd === 'help' || cmd === '?') {
        writeLines(['', '  ping <ip>          ping an address', '  trace <ip>         traceroute an address', '  show ip            show IPv4 address', '  show arp           show ARP table', '  ip <addr>/<len> <gw>  configure address', '  clear              clear the screen', '  quit               close this console', '']);
        return;
      }
      if (cmd === 'clear') { clear(); return; }
      if (cmd === 'quit' || cmd === 'exit') { writeLine('Goodbye'); if (opts.onClose) opts.onClose(); return; }
      if (cmd === 'show' && toks[1] === 'ip') { writeLine(node.name + ': ip ' + ip + '/24 gateway ' + gw); return; }
      if (cmd === 'show' && toks[1] === 'arp') {
        writeLines(['IP              MAC                Iface', gw + '      02:00:00:00:00:01      eth0']);
        return;
      }
      if (cmd === 'show') {
        writeLines(['NAME        IP/MASK              GATEWAY           MAC', (node.name + '        ' + ip + '/24' + Array(Math.max(1, 22 - (ip.length + 4))).join(' ') + gw + '         00:50:79:66:68:0' + (node.name === 'Host-B' ? '2' : '1'))]);
        return;
      }
      if (cmd === 'ip' && toks[1]) {
        node.ip = toks[1].split('/')[0];
        if (toks[2]) node.gateway = toks[2];
        writeLine('IP address configured: ' + node.ip + '/24' + (node.gateway ? ' gateway ' + node.gateway : ''));
        APP.scheduleSave();
        return;
      }
      if (cmd === 'ping') {
        var dst = toks[1];
        if (!dst) { writeLine('ping: missing address'); return; }
        var world = APP.getWorld ? APP.getWorld() : null;
        var result = { ok: false, hops: [] };
        if (world && J.net && J.net.pingDev) {
          try { result = J.net.pingDev(world, node.name, dst, null); } catch (e) { result = { ok: false }; }
        }
        writeLines(['PING ' + dst + ' (' + dst + '): 56 data bytes']);
        if (result && result.ok) {
          for (var i = 0; i < 5; i++) writeLine('64 bytes from ' + dst + ': icmp_seq=' + i + ' ttl=64 time=' + (0.8 + Math.random() * 1.2).toFixed(3) + ' ms');
          writeLines(['', '--- ' + dst + ' ping statistics ---', '5 packets transmitted, 5 packets received, 0% packet loss', 'round-trip min/avg/max/stddev = 0.814/1.046/1.327/0.102 ms']);
        } else {
          writeLines(['Request timeout for icmp_seq 0', 'Request timeout for icmp_seq 1', 'Request timeout for icmp_seq 2', 'Request timeout for icmp_seq 3', 'Request timeout for icmp_seq 4', '', '--- ' + dst + ' ping statistics ---', '5 packets transmitted, 0 packets received, 100.0% packet loss']);
        }
        return;
      }
      if (cmd === 'trace' || cmd === 'traceroute') {
        var dst2 = toks[1];
        if (!dst2) { writeLine('traceroute: missing address'); return; }
        var w = APP.getWorld ? APP.getWorld() : null;
        var tr = { ok: false, hops: [] };
        if (w && J.net && J.net.tracePath) {
          try { tr = J.net.tracePath(w, node.name, dst2); } catch (e) { tr = { ok: false }; }
        }
        writeLines(['traceroute to ' + dst2 + ' (' + dst2 + '), 30 hops max, 40 byte packets']);
        if (tr && tr.ok && tr.hops && tr.hops.length) {
          tr.hops.forEach(function (h, i) { writeLine(' ' + (i + 1) + '  ' + (h.ip || h.node || h) + '  ' + (0.9 + Math.random()).toFixed(3) + ' ms  ' + (0.8 + Math.random()).toFixed(3) + ' ms  ' + (0.7 + Math.random()).toFixed(3) + ' ms'); });
        } else if (tr && tr.ok) {
          writeLine(' 1  ' + dst2 + '  1.126 ms  1.044 ms  0.982 ms');
        } else {
          writeLine('traceroute: sendto: No route to host');
        }
        return;
      }
      writeLine(toks[0] + ': command not found');
    }

    function submit() {
      var line = input;
      var promptText = currentPrompt();
      echo(promptText, line);
      input = '';
      if (line.trim()) {
        if (history[history.length - 1] !== line) history.push(line);
        hidx = history.length;
      } else {
        hidx = history.length;
      }
      renderInput();
      if (isHost) {
        hostCommand(line);
        setPrompt(hostPrompt());
        if (opts.onCommand) opts.onCommand(line);
        return;
      }
      if (!session) { writeLine('% Console session unavailable', 'term-error'); return; }
      if (line.trim() === 'clear') { clear(); setPrompt(currentPrompt()); focus(); return; }
      if (line.trim() === 'help') {
        writeLines(['', 'Junos quick help:', '  show version | interfaces terse | route | ospf neighbor | configuration', '  configure / edit → set … / commit / rollback', '  ping <host>, traceroute <host>, monitor traffic interface ge-0/0/0', '  exit (config → operational → shell), cli (shell → operational)', '']);
        setPrompt(currentPrompt());
        focus();
        return;
      }
      try { session.world = APP.rebuildWorld ? APP.rebuildWorld() : session.world; } catch (e) {}
      var res;
      try { res = J.machine.feed(session, line); }
      catch (e) { res = { lines: ['error: ' + e.message], prompt: currentPrompt() }; }
      writeLines(res.lines || []);
      setPrompt(res.prompt || currentPrompt());
      if (opts.onCommand) opts.onCommand(line, session);
      if (APP.scheduleSave) APP.scheduleSave();
      focus();
    }

    host.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        submit(); focus(); return;
      }
      if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (isHost) {
          var toks = input.trim().split(/\s+/);
          var base = toks[0] || '';
          var options = ['ping', 'trace', 'show', 'ip', 'clear', 'help', 'quit'];
          var matches = options.filter(function (x) { return x.indexOf(base) === 0; });
          if (matches.length === 1) input = matches[0] + (toks.length === 1 ? ' ' : '');
          else if (matches.length > 1) writeLines(['Possible completions:', '  ' + matches.join('  ')]);
          renderInput();
          focus();
          return;
        }
        if (!session) return;
        var c = completionFor(session, input);
        if (c.lines && c.lines.length) writeLines(c.lines);
        if (c.text != null) input = c.text;
        renderInput();
        focus();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        if (!history.length) return;
        if (hidx > 0) hidx--; else if (hidx < 0) hidx = history.length - 1;
        input = history[hidx] || '';
        renderInput(); focus(); return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        if (!history.length) return;
        if (hidx < history.length - 1) hidx++; else hidx = history.length;
        input = hidx === history.length ? '' : (history[hidx] || '');
        renderInput(); focus(); return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation();
        input = input.slice(0, -1); renderInput(); focus(); return;
      }
      if (e.key === 'Delete') {
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault(); e.stopPropagation();
        writeLine(currentPrompt() + input + '^C'); input = ''; renderInput(); focus(); return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'l') {
        e.preventDefault(); e.stopPropagation(); clear(); renderInput(); focus(); return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'u') {
        e.preventDefault(); e.stopPropagation(); input = ''; renderInput(); focus(); return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault(); e.stopPropagation(); return;
      }
      if (e.key === 'Escape') { e.stopPropagation(); return; }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); e.stopPropagation(); input += e.key; renderInput(); focus(); return;
      }
    });

    host.addEventListener('paste', function (e) {
      e.preventDefault(); e.stopPropagation();
      var text = (e.clipboardData || global.clipboardData).getData('text');
      if (!text) return;
      text = text.replace(/\r/g, '');
      var lines = text.split('\n');
      for (var i = 0; i < lines.length; i++) {
        if (i > 0) submit();
        input += lines[i];
      }
      renderInput();
    });

    host.addEventListener('click', function (e) {
      e.preventDefault();
      focus();
    });
    scroll.addEventListener('click', function (e) {
      e.preventDefault();
      focus();
    });
    inputLine.addEventListener('click', function (e) {
      e.preventDefault();
      focus();
    });
    host.addEventListener('focus', function () { cursor.classList.add('focused'); focus(); });
    host.addEventListener('blur', function () { cursor.classList.remove('focused'); });
    capture.addEventListener('focus', function () { cursor.classList.add('focused'); });
    capture.addEventListener('blur', function () { cursor.classList.remove('focused'); });

    if (session) {
      if (!session.user) session.user = 'user';
      if (session.mode === 'login') session.mode = 'cli-op';
    }
    boot(opts.banner !== false);

    return {
      writeLine: writeLine,
      writeLines: writeLines,
      setPrompt: setPrompt,
      clear: clear,
      focus: focus,
      boot: boot,
      runCommand: function (cmd, quiet) {
        if (quiet) { input = cmd; submit(); }
        else { input = cmd; focus(); }
      },
      reset: function (newSession) { session = newSession; started = false; clear(); boot(true); },
      getSession: function () { return session; },
      submit: submit,
      type: function (text) { input += text; renderInput(); }
    };
  }

  J.ui = J.ui || {};
  J.ui.console = { createConsole: createConsole, completionFor: completionFor, shellPrompt: shellPrompt, opPrompt: opPrompt };
})(typeof window !== 'undefined' ? window : globalThis);
