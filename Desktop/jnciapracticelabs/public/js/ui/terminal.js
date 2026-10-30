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

  function tabFor(name) {
    for (var i = 0; i < tabs.length; i++) if (tabs[i].name === name) return tabs[i];
    return null;
  }

  function activeTab() { return tabFor(active); }

  function showDock() {
    var dock = $('#terminalDock');
    if (!dock) return;
    dock.classList.remove('hidden');
    if (customHeight) dock.style.height = customHeight + 'px';
    setTimeout(function () { var t = activeTab(); if (t) t.term.focus(); }, 20);
  }

  function openConsoleById(id) {
    var node = APP.nodeById(id);
    if (!node) { APP.toast('Device not found', 'error', 'warning'); return; }
    openConsoleForNode(node);
  }
  APP.openConsoleById = openConsoleById;

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
    APP.setStatus('Console connected to ' + node.name + ' · localhost:' + node.consolePort);
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
      }
      maximized = minimized = floating = false;
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
      html += '<div class="terminal-tab' + (active === t.name ? ' active' : '') + (running ? '' : ' offline') + '" data-tab="' + esc(t.name) + '" role="tab" tabindex="0" title="' + esc(t.name + ' · ' + (t.node ? t.node.model : 'console')) + '">' +
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
      if ($('#terminalWindowTitle')) $('#terminalWindowTitle').textContent = 'Console — ' + t.name;
      if ($('#terminalConnection')) $('#terminalConnection').textContent = 'telnet localhost:' + (t.node ? t.node.consolePort : '');
    }
    syncStatus();
  }
  APP.renderTabs = renderTabs;

  function syncStatus() {
    var t = activeTab();
    if (!t) return;
    var conn = $('#terminalConnection');
    if (conn) conn.textContent = t.node && t.node.status === 'running' ? 'telnet localhost:' + t.node.consolePort : 'session paused · ' + t.name;
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

  function bindWindowControls() {
    var dock = $('#terminalDock');
    if (!dock) return;
    if ($('#terminalClose')) $('#terminalClose').addEventListener('click', function () { if (active) closeTerminal(active); });
    if ($('#terminalMinimize')) $('#terminalMinimize').addEventListener('click', function () {
      minimized = !minimized;
      dock.classList.toggle('minimized', minimized);
      if (!minimized) { var t = activeTab(); if (t) t.term.focus(); }
    });
    if ($('#terminalMaximize')) $('#terminalMaximize').addEventListener('click', function () {
      maximized = !maximized;
      minimized = false;
      dock.classList.remove('minimized');
      dock.classList.toggle('maximized', maximized);
    });
    if ($('#terminalDetach')) $('#terminalDetach').addEventListener('click', function () {
      if (!floating) {
        floating = true;
        maximized = false;
        dock.classList.remove('maximized', 'docked');
        dock.classList.add('floating');
        dock.style.left = Math.max(20, global.innerWidth - 780) + 'px';
        dock.style.top = Math.max(60, global.innerHeight - 520) + 'px';
        dock.style.width = '740px';
        dock.style.height = '430px';
        customHeight = 430;
        APP.setStatus('Console detached · drag the title bar to move');
      } else {
        floating = false;
        dock.classList.remove('floating');
        dock.classList.add('docked');
        dock.style.left = ''; dock.style.top = ''; dock.style.width = ''; dock.style.height = '';
        customHeight = null;
        dock.style.height = '';
        APP.setStatus('Console docked to bottom');
      }
    });
    if ($('#terminalDockBtn')) $('#terminalDockBtn').addEventListener('click', function () {
      floating = false; maximized = false; minimized = false;
      dock.classList.remove('floating', 'maximized', 'minimized');
      dock.classList.add('docked');
      dock.style.left = ''; dock.style.top = ''; dock.style.width = '';
      dock.style.height = customHeight ? customHeight + 'px' : '';
      APP.setStatus('Console docked to bottom');
    });
    if ($('#terminalNewTab')) $('#terminalNewTab').addEventListener('click', openConsolePicker);

    var titlebar = $('#terminalTitlebar');
    if (titlebar) {
      titlebar.addEventListener('pointerdown', function (e) {
        if (!floating || e.target.closest('button')) return;
        var sx = e.clientX, sy = e.clientY;
        var left = parseFloat(dock.style.left) || dock.getBoundingClientRect().left;
        var top = parseFloat(dock.style.top) || dock.getBoundingClientRect().top;
        var pid = e.pointerId;
        titlebar.setPointerCapture(pid);
        function move(ev) {
          dock.style.left = Math.max(-200, left + ev.clientX - sx) + 'px';
          dock.style.top = Math.max(0, top + ev.clientY - sy) + 'px';
        }
        function up() {
          titlebar.removeEventListener('pointermove', move);
          titlebar.removeEventListener('pointerup', up);
        }
        titlebar.addEventListener('pointermove', move);
        titlebar.addEventListener('pointerup', up);
      });
      titlebar.addEventListener('dblclick', function (e) {
        if (e.target.closest('button')) return;
        if ($('#terminalMaximize')) $('#terminalMaximize').click();
      });
    }

    var handle = $('#terminalResizeHandle');
    if (handle) {
      handle.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var sy = e.clientY;
        var startH = dock.getBoundingClientRect().height;
        handle.setPointerCapture(e.pointerId);
        function move(ev) {
          var h = Math.max(170, Math.min(global.innerHeight * .86, startH - (ev.clientY - sy)));
          customHeight = Math.round(h);
          dock.style.height = customHeight + 'px';
          if (floating) dock.style.top = Math.max(0, global.innerHeight - customHeight - 12) + 'px';
        }
        function up() {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
        }
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });
    }
  }

  APP.initTerminal = function () {
    bindWindowControls();
    renderTabs();
  };

})(typeof window !== 'undefined' ? window : globalThis);
