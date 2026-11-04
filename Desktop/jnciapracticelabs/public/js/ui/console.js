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
    return user + '@' + host + ':~ ' + (user === 'root' ? '# ' : '% ');
  }

  function opPrompt(sess, host) {
    var user = sess && sess.user ? sess.user : 'user';
    var h = host || 'R1';
    return user + '@' + h + '> ';
  }

  var DeviceType = { JUNOS: 'junos', VPCS: 'vpcs' };

  var DEVICE_PROFILES = {
    junos: {
      type: DeviceType.JUNOS,
      label: 'JUNOS',
      host: false,
      prompt: { shell: '~ % ', operational: '> ', configuration: '# ' },
      commands: ['configure', 'edit', 'run', 'set', 'delete', 'commit', 'rollback', 'show', 'ping', 'traceroute', 'clear', 'help', 'exit', 'quit']
    },
    vpcs: {
      type: DeviceType.VPCS,
      label: 'VPCS',
      host: true,
      prompt: { host: '> ' },
      commands: ['ip', 'show ip', 'ping', 'trace', 'clear arp', 'help', '?']
    }
  };

  function profileFor(node) {
    return (node && node.junos === false) ? DEVICE_PROFILES[DeviceType.VPCS] : DEVICE_PROFILES[DeviceType.JUNOS];
  }

  function deviceTypeFor(node) {
    return profileFor(node).type;
  }

  function commandsFor(node) {
    return profileFor(node).commands.slice();
  }

  var HOST_OPTIONS = ['ping', 'trace', 'show', 'ip', 'clear', 'help', 'quit'];

  function partsOf(line) {
    return String(line).split(/\s+/).filter(function (x) { return /\S/.test(x); });
  }

  function splitLines(text) {
    return String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }

  function createConsole(host, opts) {
    opts = opts || {};
    var node = opts.node || opts;
    var session = opts.session || null;
    var profile = profileFor(node);
    var isHost = profile.type === DeviceType.VPCS;
    var input = '';
    var history = [];
    var hidx = history.length;
    var maxLines = opts.maxLines || 2200;
    var started = false;
    var timers = {};
    var disposed = false;
    var vpcs = isHost && J.vpcs ? J.vpcs.createEngine({
      id: node.id || node.name,
      name: node.name || 'Host-A',
      ip: node.ip,
      gateway: node.gateway
    }) : null;

    function abortTimers() {
      Object.keys(timers).forEach(function (key) {
        try { clearTimeout(Number(key)); } catch (e) {}
        delete timers[key];
      });
    }
    function hasTimers() { return Object.keys(timers).length > 0; }
    function schedule(fn, ms) {
      var handle = setTimeout(function () {
        delete timers[String(handle)];
        if (!disposed) fn();
      }, ms);
      timers[String(handle)] = handle;
      return handle;
    }

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
      var parts = splitLines(line);
      var last = null;
      for (var i = 0; i < parts.length; i++) {
        var d = el('div', 'term-line' + (cls ? ' ' + cls : ''));
        d.textContent = parts[i];
        out.appendChild(d);
        last = d;
      }
      while (out.children.length > maxLines) out.removeChild(out.firstChild);
      scroll.scrollTop = scroll.scrollHeight;
      return last;
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
    function clear() {
      abortTimers();
      out.innerHTML = '';
      setPrompt(currentPrompt());
    }
    function focusCapture() {
      try { capture.focus({ preventScroll: true }); } catch (e) { try { capture.focus(); } catch (_) {} }
    }
    function focus() {
      focusCapture();
      try { host.focus({ preventScroll: true }); } catch (e) { try { host.focus(); } catch (_) {} }
    }
    function currentPrompt() {
      if (isHost) return hostPrompt();
      if (!session) return (node.name || 'R1') + '> ';
      return J.machine.promptFor(session);
    }
    function hostPrompt() { return vpcs ? vpcs.prompt() : ((node.name || 'Host-A') + '> '); }

    // ---------- output pager (set cli screen-length N) ----------

    function morePrompt() {
      var p = session.pager;
      var pct = Math.min(99, Math.max(0, Math.round((p.pos / p.list.length) * 100)));
      return '---(more ' + pct + '%)---';
    }
    function advancePager() {
      var p = session.pager;
      var end = Math.min(p.pos + p.page, p.list.length);
      var chunk = p.list.slice(p.pos, end);
      p.pos = end;
      if (chunk.length) writeLines(chunk);
      if (p.pos >= p.list.length) closePager();
      else setPrompt(morePrompt());
      renderInput();
      focus();
    }
    function closePager() {
      session.pager = null;
      setPrompt(currentPrompt());
      renderInput();
      focus();
    }
    function writeAndPage(lines) {
      var sl = session && session.screenLen ? session.screenLen : 0;
      if (!sl || !lines || lines.length <= sl) { writeLines(lines); return; }
      writeLines(lines.slice(0, sl));
      session.pager = { open: true, list: lines, pos: sl, page: sl };
      setPrompt(morePrompt());
    }

    // ---------- completions (delegated to the Junos engine) ----------

    function candidatesFor() {
      if (!session) return { rows: [] };
      var trailing = /\s$/.test(input);
      var parts = partsOf(input);
      try { return J.machine.candidateWords(session, parts, trailing) || { rows: [] }; }
      catch (err) { return { rows: [] }; }
    }

    function fillTo(word, baseParts) {
      var head = baseParts.join(' ');
      return (head ? head + ' ' : '') + word + ' ';
    }

    function tabComplete() {
      var res = candidatesFor();
      var rows = res.rows || [];
      if (!rows.length) return;
      var trailing = /\s$/.test(input);
      var parts = partsOf(input);
      var last = trailing ? '' : (parts.length ? parts[parts.length - 1] : '');
      if (rows.length === 1) {
        if (trailing) return; // token already complete
        input = fillTo(rows[0][0], parts.slice(0, -1));
        renderInput();
        return;
      }
      var lcp = rows[0][0].toLowerCase();
      for (var k = 1; k < rows.length; k++) {
        var v = String(rows[k][0]).toLowerCase();
        var n = Math.min(lcp.length, v.length), c2 = 0;
        while (c2 < n && lcp.charAt(c2) === v.charAt(c2)) c2++;
        lcp = lcp.slice(0, c2);
      }
      if (lcp.length > last.length) {
        input = (trailing ? parts.join(' ') : parts.slice(0, -1).join(' '));
        if (input) input += ' ';
        input += lcp;
        renderInput();
        return;
      }
      writeLine(currentPrompt() + input);
      var blk = J.machine.completionsBlock ? J.machine.completionsBlock(rows) : rows.map(function (r) { return '  ' + r[0]; });
      writeLines(blk);
      renderInput();
    }

    function queryCompletions() {
      writeLine(currentPrompt() + input + '?');
      var res = candidatesFor();
      var rows = res.rows || [];
      if (!rows.length) return;
      var blk = J.machine.completionsBlock ? J.machine.completionsBlock(rows) : rows.map(function (r) { return '  ' + r[0]; });
      writeLines(blk);
    }

    // ---------- boot banner from the node model ----------

    function boot(showBanner) {
      if (started) return;
      started = true;
      if (isHost) {
        if (showBanner !== false) {
          writeLines([
            'VPCS v0.8.3, Virtual PC Simulator',
            node.name + ', eth0 ' + (vpcs ? vpcs.addr() : ((node.ip || '10.0.3.20') + '/24')) + ', gateway ' + (vpcs ? vpcs.gateway : (node.gateway || '10.0.3.2')),
            'Type "help" for available commands.',
            ''
          ]);
        }
        setPrompt(hostPrompt());
        setTimeout(focus, 50);
        return;
      }
      var rt = session && session.rt;
      var spec = (rt && rt.spec) || {};
      var ver = spec.version || '20.4R2-S2.1';
      var model = String(spec.model || (node && node.model) || 'mx240').toLowerCase();
      if (showBanner !== false) {
        writeLines([
          'Console connected to ' + (node ? node.name : 'R1') + ((node && node.consolePort) ? ' (console port ' + node.consolePort + ')' : ''),
          '',
          'JUNOS ' + ver,
          'Model: ' + model,
          ''
        ]);
      }
      if (session && session.screenLen == null) session.screenLen = 0;
      setPrompt(currentPrompt());
      setTimeout(focus, 50);
    }

    function syncHostNode() {
      if (!vpcs) return;
      node.ip = vpcs.ip;
      node.gateway = vpcs.gateway;
    }

    function startPing(plan) {
      writeLine('PING ' + plan.target + ' (' + plan.target + '): 56 data bytes');
      var seq = 1;
      function tick() {
        if (seq > plan.count) {
          writeLines(vpcs.pingSummary(plan));
          setPrompt(hostPrompt());
          focus();
          return;
        }
        writeLine(vpcs.pingLines(plan, seq), plan.reachable ? null : 'term-error');
        seq++;
        schedule(tick, 260);
      }
      schedule(tick, 260);
    }

    function hostTrace(dst) {
      if (!dst) { writeLine('traceroute: missing address', 'term-error'); return; }
      var w = APP.getWorld ? APP.getWorld() : null;
      var tr = { ok: false, hops: [] };
      if (w && J.net && J.net.tracePath) {
        try { tr = J.net.tracePath(w, node.name, dst); } catch (e) { tr = { ok: false }; }
      }
      writeLines(['traceroute to ' + dst + ' (' + dst + '), 30 hops max, 40 byte packets']);
      if (tr && tr.ok && tr.hops && tr.hops.length) {
        tr.hops.forEach(function (h, i) {
          var hip = i === 0 ? (vpcs && vpcs.gateway !== '0.0.0.0' ? vpcs.gateway : (h.to || h.dev)) : (h.to || h.via || h.dev);
          var t1 = (1.024 + i * 0.073).toFixed(3);
          var t2 = (0.982 + i * 0.061).toFixed(3);
          var t3 = (0.941 + i * 0.052).toFixed(3);
          writeLine(' ' + (i + 1) + '  ' + hip + '  ' + t1 + ' ms  ' + t2 + ' ms  ' + t3 + ' ms');
        });
      } else if (tr && tr.ok) {
        writeLine(' 1  ' + dst + '  1.126 ms  1.044 ms  0.982 ms');
      } else {
        writeLine('traceroute: sendto: No route to host', 'term-error');
      }
    }

    function hostCommand(line) {
      var trimmed = line.trim();
      if (!trimmed) return;
      var toks = trimmed.split(/\s+/);
      var cmd = toks[0].toLowerCase();
      if (cmd === 'trace' || cmd === 'traceroute') { hostTrace(toks[1]); return; }
      if (!vpcs) { writeLine(trimmed + ': command not found', 'term-error'); return; }
      var res;
      try { res = vpcs.execute(trimmed); }
      catch (e) { res = { error: 'error: ' + e.message }; }
      if (res.clear) { clear(); return; }
      if (res.error) { writeLine(res.error, 'term-error'); return; }
      if (res.ping) {
        if (res.ping.error) { writeLine(res.ping.error, 'term-error'); return; }
        startPing(res.ping);
        return;
      }
      if (res.lines) writeLines(res.lines);
      syncHostNode();
      if (cmd === 'ip' || cmd === 'gateway' || cmd === 'gw') {
        if (APP.scheduleSave) APP.scheduleSave();
      }
      if (res.quit && opts.onClose) opts.onClose();
    }

    function submit() {
      var line = input;
      if (hasTimers()) {
        abortTimers();
        writeLine('^C');
      }
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
      try { session.world = APP.rebuildWorld ? APP.rebuildWorld() : session.world; } catch (e) {}
      var res;
      try { res = J.machine.feed(session, line); }
      catch (e) { res = { lines: ['error: ' + e.message] }; }
      if (res.prompt) {
        writeLines(res.lines || []);
        setPrompt(res.prompt);
      } else {
        writeAndPage(res.lines || []);
        if (!(session && session.pager)) setPrompt(currentPrompt());
      }
      if (opts.onCommand) opts.onCommand(line, session);
      if (APP.scheduleSave) APP.scheduleSave();
      focus();
    }

    host.addEventListener('keydown', function (e) {
      if (!isHost && session && session.pager && session.pager.open) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'q' || e.key === 'Q') closePager();
        else advancePager();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        submit(); focus(); return;
      }
      if (e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (isHost) {
          var toks = input.trim().split(/\s+/);
          var base = toks[0] || '';
          var matches = HOST_OPTIONS.filter(function (x) { return x.indexOf(base) === 0; });
          if (matches.length === 1) input = matches[0] + (toks.length === 1 ? ' ' : '');
          else if (matches.length > 1) writeLines(['Possible completions:', '  ' + matches.join('  ')]);
          renderInput();
          focus();
          return;
        }
        if (!session) return;
        tabComplete();
        renderInput();
        focus();
        return;
      }
      if (!isHost && e.key === '?') {
        e.preventDefault(); e.stopPropagation();
        if (session) queryCompletions();
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
        abortTimers();
        writeLine(currentPrompt() + input + '^C'); input = '';
        setPrompt(currentPrompt()); renderInput(); focus(); return;
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
    host.addEventListener('focus', function () { cursor.classList.add('focused'); focusCapture(); });
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
      reset: function (newSession) {
        abortTimers();
        session = newSession;
        started = false;
        clear();
        boot(true);
      },
      dispose: function () { disposed = true; abortTimers(); },
      getSession: function () { return session; },
      submit: submit,
      type: function (text) { input += text; renderInput(); }
    };
  }

  J.ui = J.ui || {};
  J.ui.console = {
    createConsole: createConsole,
    shellPrompt: shellPrompt,
    opPrompt: opPrompt,
    DeviceType: DeviceType,
    DEVICE_PROFILES: DEVICE_PROFILES,
    profileFor: profileFor,
    deviceTypeFor: deviceTypeFor,
    commandsFor: commandsFor
  };
  J.deviceProfiles = {
    DeviceType: DeviceType,
    profiles: DEVICE_PROFILES,
    forNode: profileFor,
    typeFor: deviceTypeFor,
    commandsFor: commandsFor
  };
})(typeof window !== 'undefined' ? window : globalThis);
