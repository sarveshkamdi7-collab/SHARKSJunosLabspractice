(function (global) {
  'use strict';

  var J = global.JJ;
  var APP = J.app = J.app || {};
  var $ = APP.$, $$ = APP.$$, esc = APP.esc, icon = APP.icon;

  var tabs = [];
  var active = null;
  var maximized = false;
  var minimized = false;
  var floating = false;
  var customHeight = null;
  var preMax = null; // geometry remembered while maximized

  function tabFor(name) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].name === name) return tabs[i];
    return null;
  }

  function activeTab() { return tabFor(active); }

  function showDock() {
    var dock = $('#terminalDock');
    if (!dock) return;
    dock.classList.remove('hidden');
    if (!floating && !maximized && !minimized && !dock.classList.contains('docked')) {
      dock.classList.add('docked');
      dock.classList.remove('floating', 'maximized', 'minimized');
    }
    if (dock.classList.contains('docked') && !maximized && !minimized) applyDockGeo();
    else if (customHeight && !maximized && !minimized) dock.style.height = customHeight + 'px';
    setTimeout(function () { var t = activeTab(); if (t) t.term.focus(); }, 20);
  }

  function openConsoleById(id) {
    var node = APP.nodeById(id);
    if (!node) { APP.toast('Device not found', 'error', 'warning'); return null; }
    return openConsoleForNode(node);
  }
  APP.openConsoleById = openConsoleById;

  // SDN-style push: declarative set lines -> console transaction (configure ... commit)
  APP.pushConfig = function (node, lines) {
    if (!node) return 0;
    var tab = openConsoleById(node.id);
    if (!tab || !tab.term) { APP.toast('Console unavailable for ' + node.name, 'error', 'warning'); return 0; }
    var n = 0;
    try {
      if (tab.session && tab.session.mode !== 'cli-cfg') tab.term.runCommand('configure', true);
      lines.forEach(function (l) { tab.term.runCommand(l, true); n++; });
      tab.term.runCommand('commit', true);
      APP.setStatus('Intent pushed to ' + node.name + ' - ' + n + ' statements committed');
    } catch (e) {
      APP.toast('Config push failed: ' + e.message, 'error', 'warning');
      return n;
    }
    return n;
  };

  function openConsoleForNode(node) {
    var existing = tabFor(node.name);
    if (existing) { activate(node.name); showDock(); existing.term.focus(); return existing; }

    var pane = document.createElement('div');
    pane.className = 'term-pane';
    pane.dataset.termName = node.name;
    var body = $('#terminalBody');
    if (!body) return null;
    body.appendChild(pane);

    var session = null;
    var term;
    if (node.junos === false) {
      term = J.ui.vpcs.createVpcs(pane, {
        node: node,
        onClose: function () { closeTerminal(node.name); }
      });
    } else {
      var rt = APP.ensureRuntime(node);
      if (!rt) { APP.toast('No Junos runtime available for ' + node.name, 'error', 'warning'); pane.remove(); return null; }
      session = J.machine.createSession(rt, APP.rebuildWorld());
      session.user = 'user';
      session.mode = 'cli-op';
      term = J.ui.console.createConsole(pane, {
        node: node,
        session: session,
        onClose: function () { closeTerminal(node.name); },
        onCommand: function () { syncStatus(); }
      });
    }

    var tab = { name: node.name, nodeId: node.id, node: node, session: session, term: term, pane: pane };
    tabs.push(tab);
    activate(node.name);
    showDock();
    renderTabs();
    APP.setStatus('Console connected to ' + node.name + ' (port ' + node.consolePort + ')');
    setTimeout(function () { term.focus(); }, 50);
    return tab;
  }

  function activate(name) {
    active = name;
    $$('.term-pane').forEach(function (p) { p.classList.toggle('active', p.dataset.termName === name); });
    renderTabs();
  }

  function closeTerminal(name, force) {
    var idx = -1;
    for (var i = 0; i < tabs.length; i++) if (tabs[i].name === name) { idx = i; break; }
    if (idx < 0) return;
    var tab = tabs[idx];
    try { tab.pane.remove(); } catch (e) {}
    tabs.splice(idx, 1);
    if (active === name) active = tabs.length ? tabs[Math.max(0, idx - 1)].name : null;
    if (!tabs.length) {
      active = null;
      var dock = $('#terminalDock');
      if (dock) {
        dock.classList.add('hidden');
        dock.classList.remove('maximized', 'floating', 'minimized');
        ['left', 'top', 'width', 'height'].forEach(function (k) { dock.style[k] = ''; });
      }
      maximized = minimized = floating = false;
      customHeight = null;
      preMax = null;
    } else {
      activate(active);
    }
    renderTabs();
    if (!force) APP.setStatus('Console closed');
  }
  APP.closeTerminal = closeTerminal;

  function closeAllTerminals(silent) {
    var names = tabs.map(function (t) { return t.name; });
    names.forEach(function (n) { closeTerminal(n, true); });
    if (!silent) APP.setStatus('All consoles closed');
  }
  APP.closeAllTerminals = closeAllTerminals;

  function renderTabs() {
    var host = $('#terminalTabs');
    if (!host) return;
    if (!tabs.length) {
      host.innerHTML = '';
      if ($('#terminalDock')) $('#terminalDock').classList.add('hidden');
      return;
    }
    var html = '';
    tabs.forEach(function (t) {
      var running = t.node && t.node.status === 'running';
      html += '<div class="terminal-tab' + (active === t.name ? ' active' : '') + (running ? '' : ' offline') + '" data-tab="' + esc(t.name) + '" role="tab" tabindex="0" title="' + esc(t.name + ', ' + (t.node ? t.node.model : 'console')) + '">' +
        '<span class="term-tab-dot"></span><span class="term-tab-name">' + esc(t.name) + '</span><button class="term-tab-close" data-close-tab="' + esc(t.name) + '" title="Close console">' + icon('close') + '</button></div>';
    });
    host.innerHTML = html;
    $$('.terminal-tab', host).forEach(function (b) {
      b.addEventListener('click', function (e) {
        if (e.target.closest('[data-close-tab]')) return;
        var name = b.dataset.tab;
        activate(name); showDock();
        var t = tabFor(name); if (t) t.term.focus();
      });
      b.addEventListener('auxclick', function (e) { if (e.button === 1) { e.preventDefault(); closeTerminal(b.dataset.tab); } });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(b.dataset.tab); showDock(); var t = tabFor(b.dataset.tab); if (t) t.term.focus(); }
      });
    });
    $$('[data-close-tab]', host).forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); closeTerminal(b.dataset.closeTab); });
    });
    var t = activeTab();
    if (t) {
      if ($('#terminalWindowTitle')) $('#terminalWindowTitle').textContent = 'Console';
      if ($('#terminalConnection')) $('#terminalConnection').textContent = 'console port ' + (t.node ? t.node.consolePort : '');
    }
    syncStatus();
  }
  APP.renderTabs = renderTabs;

  function syncStatus() {
    var t = activeTab();
    if (!t) return;
    var conn = $('#terminalConnection');
    if (conn) conn.textContent = t.node && t.node.status === 'running' ? 'console port ' + t.node.consolePort : 'session paused, ' + t.name;
    $$('.terminal-tab').forEach(function (b) {
      var tb = tabFor(b.dataset.tab);
      b.classList.toggle('offline', !!(tb && tb.node && tb.node.status !== 'running'));
    });
  }
  APP.syncTerminalTabStatus = syncStatus;

  function openAllConsoles() {
    var s = APP.getState();
    var running = s.nodes.filter(function (n) { return n.status === 'running'; });
    if (!running.length) { APP.toast('Start a device before connecting a console', 'warn', 'warning'); return; }
    running.forEach(function (n) { openConsoleForNode(n); });
    APP.toast('Opened ' + running.length + ' console' + (running.length === 1 ? '' : 's'), 'success', 'terminal');
  }
  APP.openAllConsoles = openAllConsoles;

  function openConsolePicker() {
    if (APP.openConsolePickerModal) APP.openConsolePickerModal();
    else {
      var n = APP.getState().nodes[0];
      if (n) openConsoleForNode(n);
    }
  }

  // ---------------------------------------------------------- window manager
  // One geometry model for the console: docked | floating | maximized | minimized.
  // Drag and resize listen on window, so they never die when markup is re-rendered.

  var termGeo = null;
  try { termGeo = JSON.parse(global.localStorage.getItem('slab.termGeo') || 'null'); } catch (e) { termGeo = null; }
  if (termGeo && termGeo.height) customHeight = termGeo.height;

  function persistGeo() {
    try { global.localStorage.setItem('slab.termGeo', JSON.stringify({ height: customHeight || null })); } catch (e) {}
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function canvasRect() {
    var ws = document.querySelector('.canvas-wrap') || document.querySelector('.workspace');
    if (!ws) return { left: 0, top: 38, width: global.innerWidth, height: global.innerHeight - 66 };
    return ws.getBoundingClientRect();
  }

  function applyGeo(rect) {
    var d = document.getElementById('terminalDock');
    if (!d) return;
    ['left', 'top', 'width', 'height'].forEach(function (k) {
      d.style[k] = Math.round(rect[k]) + 'px';
    });
  }

  // Docked console = a window that sits inside the canvas area, never over the panels.
  function applyDockGeo() {
    var d = document.getElementById('terminalDock');
    if (!d) return;
    var r = canvasRect();
    var w = Math.round(Math.min(1000, r.width - 24));
    var h = Math.round(clamp(customHeight || Math.min(420, global.innerHeight * 0.42), 220, Math.max(240, r.height - 16)));
    d.style.left = Math.round(r.left + (r.width - w) / 2) + 'px';
    d.style.width = w + 'px';
    d.style.height = h + 'px';
    d.style.top = 'auto';
    d.style.right = 'auto';
    d.style.bottom = '';
  }

  // Maximized console fills the canvas area, still inside the panels and above the status bar.
  function applyMaxGeo() {
    var d = document.getElementById('terminalDock');
    if (!d) return;
    var r = canvasRect();
    var w = Math.round(r.width - 24);
    var h = Math.round(Math.max(260, r.height - 16));
    d.style.left = Math.round(r.left + 12) + 'px';
    d.style.width = w + 'px';
    d.style.height = h + 'px';
    d.style.top = 'auto';
    d.style.right = 'auto';
    d.style.bottom = '38px';
  }

  function bindWindowControls() {
    var dock = $('#terminalDock');
    if (!dock) return;
    if (dock.dataset.wmBound === '1') return;
    dock.dataset.wmBound = '1';

    function toFloating(rect) {
      maximized = false; minimized = false; preMax = null; floating = true;
      dock.classList.remove('docked', 'maximized', 'minimized');
      dock.classList.add('floating');
      applyGeo(rect);
      customHeight = Math.round(rect.height || customHeight || 440);
      persistGeo();
    }

    function syncWindowButtons() {
      var minBtn = $('#terminalMinimize'), maxBtn = $('#terminalMaximize');
      if (minBtn) {
        minBtn.querySelector('use').setAttribute('href', minimized ? '#i-chevron-up' : '#i-minus');
        minBtn.title = minimized ? 'Restore console' : 'Minimize';
      }
      if (maxBtn) {
        maxBtn.querySelector('use').setAttribute('href', maximized ? '#i-restore' : '#i-square');
        maxBtn.title = maximized ? 'Restore size' : 'Maximize';
      }
    }

    function toggleMinimize() {
      if (maximized) toggleMaximize();
      minimized = !minimized;
      dock.classList.toggle('minimized', minimized);
      if (minimized) {
        dock.style.height = '';
        APP.setStatus('Console minimized');
      } else {
        dock.style.height = customHeight ? customHeight + 'px' : '';
        var t = activeTab(); if (t) t.term.focus();
        APP.setStatus('Console restored');
      }
      syncWindowButtons();
    }

    function toggleMaximize() {
      if (!maximized) {
        preMax = {
          floating: floating, customHeight: customHeight,
          left: dock.style.left, top: dock.style.top, width: dock.style.width, height: dock.style.height
        };
        maximized = true; minimized = false;
        dock.classList.remove('minimized', 'floating', 'docked');
        dock.classList.add('maximized');
        applyMaxGeo();
        APP.setStatus('Console maximized');
      } else {
        maximized = false;
        dock.classList.remove('maximized');
        if (preMax && preMax.floating) {
          floating = true;
          dock.classList.add('floating');
          applyGeo({
            left: parseFloat(preMax.left) || 40, top: parseFloat(preMax.top) || 80,
            width: parseFloat(preMax.width) || 740, height: parseFloat(preMax.height) || 430
          });
          customHeight = Math.round(parseFloat(preMax.height) || 430);
        } else {
          floating = false;
          dock.classList.add('docked');
          customHeight = preMax ? preMax.customHeight : customHeight;
          applyDockGeo();
        }
        preMax = null;
        var t2 = activeTab(); if (t2) t2.term.focus();
        APP.setStatus('Console restored');
      }
      syncWindowButtons();
      persistGeo();
    }

    function setDetached() {
      var b = canvasRect();
      var w = Math.min(760, Math.max(420, b.width - 24));
      var h = customHeight || 440;
      toFloating({
        left: clamp(b.left + b.width - w - 16, b.left + 4, Math.max(b.left + 4, b.left + b.width - w - 4)),
        top: clamp(b.top + b.height - h - 16, b.top + 4, Math.max(b.top + 4, b.top + b.height - h - 4)),
        width: w, height: h
      });
      APP.setStatus('Console detached - drag the title bar to move it');
    }

    function setDocked() {
      floating = false; maximized = false; minimized = false; preMax = null;
      dock.classList.remove('floating', 'maximized', 'minimized');
      dock.classList.add('docked');
      dock.style.top = '';
      applyDockGeo();
      persistGeo();
      APP.setStatus('Console docked to bottom');
    }

    function beginDrag(e) {
      if (maximized || minimized || e.target.closest('button, input, select, textarea')) return;
      var sx = e.clientX, sy = e.clientY;
      var startRect = dock.getBoundingClientRect();
      var grabX = e.clientX - startRect.left;
      var grabY = e.clientY - startRect.top;
      var dragging = false;
      function move(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        var b = canvasRect();
        if (!dragging) {
          if (Math.abs(dx) + Math.abs(dy) < 4) return;
          dragging = true;
          if (!floating) {
            // leaving the dock: become a normal window under the cursor
            var w = Math.min(900, Math.max(420, b.width - 24));
            toFloating({
              left: clamp(ev.clientX - grabX, b.left + 4, Math.max(b.left + 4, b.left + b.width - w - 4)),
              top: clamp(ev.clientY - grabY, b.top + 4, Math.max(b.top + 4, b.top + b.height - startRect.height - 4)),
              width: w, height: startRect.height
            });
            startRect = dock.getBoundingClientRect();
            sx = ev.clientX; sy = ev.clientY; dx = 0; dy = 0;
          }
          document.body.classList.add('window-dragging');
        }
        var w2 = dock.getBoundingClientRect().width;
        var h2 = dock.getBoundingClientRect().height;
        dock.style.left = clamp(startRect.left + dx, b.left + 4, Math.max(b.left + 4, b.left + b.width - w2 - 4)) + 'px';
        dock.style.top = clamp(startRect.top + dy, b.top + 4, Math.max(b.top + 4, b.top + b.height - h2 - 4)) + 'px';
        dock.style.right = 'auto';
        dock.style.bottom = 'auto';
      }
      function up() {
        global.removeEventListener('pointermove', move);
        global.removeEventListener('pointerup', up);
        document.body.classList.remove('window-dragging');
        if (dragging) persistGeo();
      }
      global.addEventListener('pointermove', move);
      global.addEventListener('pointerup', up);
      e.preventDefault();
    }

    function beginResize(e) {
      if (maximized || minimized) return;
      e.preventDefault();
      var sx = e.clientX, sy = e.clientY;
      var r0 = dock.getBoundingClientRect();
      var both = !!floating;
      function move(ev) {
        var dx = ev.clientX - sx, dy = ev.clientY - sy;
        var b = canvasRect();
        if (both) {
          var w = clamp(r0.width + dx, 420, Math.max(420, b.width - 8));
          var h = clamp(r0.height + dy, 190, Math.max(190, b.height - 8));
          customHeight = Math.round(h);
          dock.style.width = Math.round(w) + 'px';
          dock.style.height = customHeight + 'px';
        } else {
          var h2 = clamp(r0.height - dy, 180, Math.max(180, b.height - 8));
          customHeight = Math.round(h2);
          dock.style.height = customHeight + 'px';
        }
      }
      function up() {
        global.removeEventListener('pointermove', move);
        global.removeEventListener('pointerup', up);
        persistGeo();
      }
      global.addEventListener('pointermove', move);
      global.addEventListener('pointerup', up);
    }

    function on(id, fn) { var el = $('#' + id); if (el) el.addEventListener('click', fn); }
    on('terminalClose', function () { if (active) closeTerminal(active); });
    on('terminalMinimize', toggleMinimize);
    on('terminalMaximize', toggleMaximize);
    on('terminalDetach', function () { if (floating) setDocked(); else setDetached(); });
    on('terminalDockBtn', setDocked);

    var titlebar = $('#terminalTitlebar');
    if (titlebar) {
      titlebar.addEventListener('pointerdown', beginDrag);
      titlebar.addEventListener('dblclick', function (e) {
        if (e.target.closest('button')) return;
        toggleMaximize();
      });
    }
    var handle = $('#terminalResizeHandle');
    if (handle) handle.addEventListener('pointerdown', beginResize);

    global.addEventListener('resize', function () {
      if (minimized || floating) return;
      if (maximized) applyMaxGeo();
      else if (dock.classList.contains('docked')) applyDockGeo();
    });
  }

  APP.initTerminal = function () {
    bindWindowControls();
    renderTabs();
  };

})(typeof window !== 'undefined' ? window : globalThis);
