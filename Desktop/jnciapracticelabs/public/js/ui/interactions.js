(function (global) {
  'use strict';

  var J = global.JJ;
  var APP = J.app = J.app || {};
  var $ = APP.$, $$ = APP.$$, esc = APP.esc, icon = APP.icon, clamp = APP.clamp;

  var menuOpen = false;
  var placement = null;
  var linkMode = null;
  var activeTool = null;
  var drawState = null;
  var panState = null;
  var contextState = null;

  function confirmAction(message, onYes, yesLabel) {
    if (APP.confirm) APP.confirm(message, onYes, yesLabel);
    else if (global.confirm(message)) onYes();
  }

  function selectionNode() { return APP.nodeById(APP.getSelectedNodeId()); }

  // ------------------------------------------------------------------ menus
  function closeMenus() {
    $$('.menu-root.open').forEach(function (r) { r.classList.remove('open'); });
    $$('.menu-pop.open').forEach(function (p) { p.classList.remove('open'); });
    menuOpen = false;
  }
  APP.closeMenus = closeMenus;

  function bindMenus() {
    $$('.menu-trigger').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var root = btn.parentNode;
        var was = root.classList.contains('open');
        closeMenus();
        if (!was) { root.classList.add('open'); btn.nextElementSibling.classList.add('open'); menuOpen = true; }
      });
      btn.addEventListener('mouseenter', function () {
        if (!menuOpen) return;
        var root = btn.parentNode;
        if (root.classList.contains('open')) return;
        closeMenus(); root.classList.add('open'); btn.nextElementSibling.classList.add('open'); menuOpen = true;
      });
    });
    document.addEventListener('click', function () { closeMenus(); });
    $$('.menu-pop').forEach(function (pop) {
      pop.addEventListener('click', function (e) {
        var b = e.target.closest('[data-action]');
        if (!b) return;
        e.stopPropagation();
        closeMenus();
        dispatch(b.dataset.action);
      });
    });
  }

  // ---------------------------------------------------------------- dispatch
  function dispatch(action, payload) {
    var n = selectionNode();
    switch (action) {
      case 'new-project':
        confirmAction('Start a new project? Your changes are saved in this browser.', function () {
          APP.saveProject(true); APP.resetProject('Untitled lab', true); APP.toast('New project started, the canvas is empty', 'success', 'new');
        });
        break;
      case 'open-project': $('#fileInput').click(); break;
      case 'save-project': APP.saveProject(); break;
      case 'save-as': if (APP.openSaveAs) APP.openSaveAs(); break;
      case 'rename-project': beginRename(); break;
      case 'import-project': $('#fileInput').click(); break;
      case 'export-project': exportProject(); break;
      case 'snapshot-save': saveSnapshot(); break;
      case 'snapshot-restore':
        if (global.localStorage.getItem(APP.SNAPSHOT_KEY)) confirmAction('Restore the saved snapshot and replace the current project?', function () { APP.restoreSnapshot(); });
        else APP.toast('No snapshot has been saved yet', 'warn', 'warning');
        break;
      case 'close-project':
        confirmAction('Close this project? The current topology stays saved in this browser.', function () {
          APP.saveProject(true); APP.resetProject('Untitled Lab'); APP.toast('Project closed', 'info', 'close');
        });
        break;

      case 'undo': APP.undo(); break;
      case 'redo': APP.redo(); break;
      case 'select-all':
        if (APP.getState().nodes[0]) { APP.selectNode(APP.getState().nodes[0].id); APP.toast('Selected first node. Multi-select is not enabled', 'info', 'check'); }
        break;
      case 'delete-selection': deleteSelection(); break;
      case 'preferences': if (APP.openPreferences) APP.openPreferences(); break;

      case 'zoom-in': APP.zoomBy(1.18); break;
      case 'zoom-out': APP.zoomBy(1 / 1.18); break;
      case 'fit-view': APP.fitView(); break;
      case 'zoom-reset': APP.zoomBy(1 / (APP.getState().view.zoom || 1)); break;
      case 'toggle-grid':
        APP.getState().settings.grid = !APP.getState().settings.grid;
        APP.renderCanvasSettings(); APP.scheduleSave();
        break;
      case 'toggle-labels':
        APP.getState().settings.labels = !APP.getState().settings.labels;
        APP.renderCanvasSettings(); APP.scheduleSave();
        break;
      case 'toggle-left': toggleDock('left'); break;
      case 'toggle-right': toggleDock('right'); break;
      case 'fullscreen': toggleFullscreen(); break;

      case 'start-all': APP.startAll(); break;
      case 'pause-all': APP.pauseAll(); break;
      case 'stop-all': APP.stopAll(); break;
      case 'reload-all': APP.reloadAll(); break;
      case 'console-all': if (APP.openAllConsoles) APP.openAllConsoles(); break;
      case 'console-manager': if (APP.openConsoleManager) APP.openConsoleManager(); break;

      case 'node-start': if (n) APP.startNode(n.id); break;
      case 'node-pause': if (n) APP.pauseNode(n.id); break;
      case 'node-stop': if (n) APP.stopNode(n.id); break;
      case 'node-restart': if (n) APP.restartNode(n.id); break;
      case 'node-console': if (n) APP.openConsoleById(n.id); break;
      case 'node-interfaces': if (n && APP.openInterfaces) APP.openInterfaces(n.id); break;
      case 'node-configure': if (n && APP.openDeviceConfigurator) APP.openDeviceConfigurator(n.id); break;
      case 'node-capture': if (n && APP.openCapture) APP.openCapture(n.id); break;
      case 'node-delete': if (n) confirmAction('Delete ' + n.name + ' and all of its links?', function () { APP.deleteNode(n.id); }); break;

      case 'add-note': if (APP.openAddNote) APP.openAddNote(); else startTool('note'); break;
      case 'tool-rect': startTool('rect'); break;
      case 'tool-ellipse': startTool('ellipse'); break;
      case 'tool-line': startTool('line'); break;
      case 'clear-annotations': confirmAction('Clear every annotation in this project?', function () { APP.clearAnnotations(); }); break;

      case 'command-reference': if (APP.openCommandRef) APP.openCommandRef(); break;
      case 'server-prefs': if (APP.openServerPrefs) APP.openServerPrefs(); break;
      case 'reset-lab':
        confirmAction('Reset the topology and all device configurations to the baseline lab?', function () {
          APP.resetProject('JNCIA Basic Routing'); APP.toast('Lab reset to baseline', 'success', 'reload');
        });
        break;
      case 'lab-guide': if (APP.openGuide) APP.openGuide(); break;
      case 'fleet': if (APP.openFleetIntent) APP.openFleetIntent(); break;
      case 'shortcuts': if (APP.openShortcuts) APP.openShortcuts(); break;
      case 'about': if (APP.openAbout) APP.openAbout(); break;
      default:
        APP.toast('Action not available: ' + action, 'warn', 'warning');
    }
  }
  APP.dispatch = dispatch;

  function deleteSelection() {
    if (APP.getSelectedNodeId()) { var n = selectionNode(); if (n) confirmAction('Delete ' + n.name + ' and its links?', function () { APP.deleteNode(n.id); }); }
    else if (APP.getSelectedLinkId()) APP.deleteLink(APP.getSelectedLinkId());
    else if (APP.getSelectedAnnotationId()) APP.deleteAnnotation(APP.getSelectedAnnotationId());
    else APP.toast('Select a node, link, or annotation first', 'info', 'help');
  }

  function bindToolbar() {
    $$('.tool-btn[data-action], .canvas-tool[data-action], .ws-action[data-action], .icon-btn[data-action], .dock-restore[data-action], .zoom-value[data-action]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); dispatch(b.dataset.action); });
    });
    var layout = $('#wsLayoutButton');
    if (layout) layout.addEventListener('click', autoLayout);
    if ($('#brandButton')) $('#brandButton').addEventListener('click', function () { if (APP.openAbout) APP.openAbout(); });
    if ($('#workspaceTabClose')) $('#workspaceTabClose').addEventListener('click', function () { dispatch('close-project'); });
    var tabTitle = $('#workspaceTabTitle');
    if (tabTitle) {
      tabTitle.title = 'Double-click to rename';
      tabTitle.addEventListener('dblclick', beginRename);
    }
    var addWs = $('.workspace-add');
    if (addWs) addWs.addEventListener('click', function () { dispatch('new-project'); });
  }

  // ---------------------------------------------------------- rename project
  function beginRename() {
    var span = $('#workspaceTabTitle');
    if (!span || span.dataset.editing === '1') return;
    var st = APP.getState();
    var current = st.title || 'Untitled Lab';
    var input = document.createElement('input');
    input.className = 'tab-rename';
    input.type = 'text';
    input.value = current;
    input.maxLength = 60;
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Project name');
    span.dataset.editing = '1';
    span.style.display = 'none';
    span.parentNode.insertBefore(input, span);
    input.focus();
    input.select();

    var finished = false;
    function finish(commit) {
      if (finished) return;
      finished = true;
      var next = String(input.value || '').trim().slice(0, 60);
      if (input.parentNode) input.parentNode.removeChild(input);
      span.style.display = '';
      span.dataset.editing = '0';
      if (!commit || !next || next === current) return;
      st.title = next;
      if (APP.updateProjectChrome) APP.updateProjectChrome();
      APP.saveProject();
      APP.toast('Project renamed to ' + next, 'success', 'tag');
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener('blur', function () { finish(true); });
  }

  // --------------------------------------------------------------- docking
  function toggleDock(side) {
    var shell = $('#appShell');
    var dock = side === 'left' ? $('#leftDock') : $('#rightDock');
    var s = APP.getState();
    if (side === 'left') {
      s.settings.leftDock = !s.settings.leftDock;
      shell.classList.toggle('left-collapsed', !s.settings.leftDock);
    } else {
      s.settings.rightDock = !s.settings.rightDock;
      shell.classList.toggle('right-collapsed', !s.settings.rightDock);
    }
    if (dock) dock.classList.toggle('hidden-dock', !(side === 'left' ? s.settings.leftDock : s.settings.rightDock));
    APP.applyView(); APP.scheduleSave();
  }
  APP.toggleDock = toggleDock;

  function applyDockState() {
    var s = APP.getState();
    $('#appShell').classList.toggle('left-collapsed', !s.settings.leftDock);
    $('#appShell').classList.toggle('right-collapsed', !s.settings.rightDock);
    if ($('#leftDock')) $('#leftDock').classList.toggle('hidden-dock', !s.settings.leftDock);
    if ($('#rightDock')) $('#rightDock').classList.toggle('hidden-dock', !s.settings.rightDock);
  }
  APP.applyDockState = applyDockState;

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      else APP.toast('Full screen is not supported by this browser', 'warn', 'warning');
    } else if (document.exitFullscreen) document.exitFullscreen();
  }

  // ---------------------------------------------------------------- palette
  function bindPalette() {
    if ($('#paletteSearch')) {
      $('#paletteSearch').addEventListener('input', function () { filterPalette(this.value); });
    }
    $$('.section-head').forEach(function (h) {
      h.addEventListener('click', function () { h.parentNode.classList.toggle('collapsed'); });
    });
    $$('.palette-item[data-device]').forEach(function (item) {
      var key = item.dataset.device;
      item.addEventListener('dragstart', function (e) {
        if (key === 'link' || key === 'console-cable') { e.preventDefault(); return; }
        try { e.dataTransfer.setData('text/plain', key); e.dataTransfer.effectAllowed = 'copy'; } catch (err) {}
      });
      item.addEventListener('click', function () {
        if (key === 'link' || key === 'console-cable') { beginLinkMode(); return; }
        startPlacement(key);
      });
      item.addEventListener('dblclick', function () {
        if (key === 'link' || key === 'console-cable') return;
        var cv = $('#canvas');
        var r = cv.getBoundingClientRect();
        var w = APP.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
        APP.addNode(key, Math.round(w.x), Math.round(w.y));
      });
    });
    var canvas = $('#canvas');
    canvas.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    canvas.addEventListener('drop', function (e) {
      e.preventDefault();
      var key = '';
      try { key = e.dataTransfer.getData('text/plain'); } catch (err) {}
      if (!key) return;
      var p = APP.screenToWorld(e.clientX, e.clientY);
      APP.addNode(key, Math.round(p.x), Math.round(p.y));
    });
    if ($('#placementCancel')) $('#placementCancel').addEventListener('click', function () { cancelPlacement(); });
  }

  function filterPalette(q) {
    q = String(q || '').toLowerCase().trim();
    var any = false;
    $$('.palette-item').forEach(function (item) {
      var search = (item.textContent + ' ' + (item.dataset.device || '')).toLowerCase();
      var show = !q || search.indexOf(q) >= 0;
      item.style.display = show ? '' : 'none';
      if (show) any = true;
    });
    $$('.palette-section').forEach(function (sec) {
      var visible = $$('.palette-item', sec).some(function (x) { return x.style.display !== 'none'; });
      sec.style.display = visible ? '' : 'none';
    });
    if ($('#paletteEmpty')) $('#paletteEmpty').classList.toggle('visible', !any);
  }

  function startPlacement(key) {
    placement = key;
    cancelTool(true);
    cancelLinkMode();
    var banner = $('#placementBanner'), txt = $('#placementText');
    if (banner) banner.classList.remove('hidden');
    var t = APP.TEMPLATES[key] || APP.TEMPLATES.router;
    if (txt) txt.textContent = 'Click on the canvas to place ' + (key === 'vsrx' ? 'vSRX' : t.model);
    var cv = $('#canvas'); if (cv) cv.classList.add('placing');
    APP.setStatus('Placement mode: click on the canvas to place a device');
  }
  function cancelPlacement() {
    placement = null;
    if ($('#placementBanner')) $('#placementBanner').classList.add('hidden');
    var cv = $('#canvas'); if (cv) cv.classList.remove('placing');
  }
  APP.cancelPlacement = cancelPlacement;

  // -------------------------------------------------------------- link mode
  function beginLinkMode(fromId) {
    cancelPlacement(); cancelTool(true);
    linkMode = { from: fromId || null };
    var banner = $('#placementBanner'), txt = $('#placementText');
    if (banner) banner.classList.remove('hidden');
    if (txt) txt.textContent = fromId ? 'Select the second device to complete the link, Esc to cancel' : 'Ethernet link: select the first device';
    $('#canvas').classList.add('linking');
    $$('.palette-item').forEach(function (i) { i.classList.toggle('active', i.dataset.device === 'link'); });
    APP.setStatus('Link mode active, click two devices');
  }
  function cancelLinkMode() {
    linkMode = null;
    if (!placement) { if ($('#placementBanner')) $('#placementBanner').classList.add('hidden'); }
    $('#canvas').classList.remove('linking');
    $$('.palette-item').forEach(function (i) { i.classList.remove('active'); });
  }
  APP.isLinkMode = function () { return !!linkMode; };
  APP.handleLinkNodeClick = function (id) {
    if (!linkMode) return;
    if (!linkMode.from) {
      linkMode.from = id;
      if ($('#placementText')) $('#placementText').textContent = 'Select the second device to complete the link, Esc to cancel';
      APP.setStatus('First device selected, choose the second device');
      return;
    }
    if (linkMode.from === id) { APP.toast('Choose a different device for the other end of the link', 'warn', 'warning'); return; }
    APP.createLinkBetween(linkMode.from, id);
    cancelLinkMode();
  };

  // ------------------------------------------------------------- annotations
  function startTool(tool) {
    cancelPlacement(); cancelLinkMode();
    activeTool = tool;
    var cv = $('#canvas');
    if (cv) {
      cv.classList.remove('tool-note', 'tool-rect', 'tool-ellipse', 'tool-line');
      cv.classList.add('tool-' + tool);
    }
    $$('.draw-tool').forEach(function (b) { b.classList.toggle('active', b.dataset.tool === tool); });
    APP.setStatus(tool === 'note' ? 'Click the canvas to place a note' : 'Click and drag on the canvas to draw a ' + tool);
  }
  function cancelTool(silent) {
    activeTool = null; drawState = null;
    var cv = $('#canvas');
    if (cv) cv.classList.remove('tool-note', 'tool-rect', 'tool-ellipse', 'tool-line');
    $$('.draw-tool').forEach(function (b) { b.classList.remove('active'); });
    if (!silent) APP.setStatus('Ready');
  }
  APP.startTool = startTool;
  APP.cancelTool = cancelTool;
  APP.isToolMode = function () { return !!activeTool; };

  // ---------------------------------------------------------------- canvas
  function bindCanvas() {
    var canvas = $('#canvas');
    if (!canvas) return;

    canvas.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.node') || e.target.closest('.canvas-tools') || e.target.closest('.canvas-hint') || e.target.closest('.placement-banner')) return;
      if (e.button === 2) return;
      var p = APP.screenToWorld(e.clientX, e.clientY);
      if (placement) {
        var key = placement;
        APP.addNode(key, Math.round(p.x), Math.round(p.y));
        if (!e.shiftKey) cancelPlacement();
        return;
      }
      if (activeTool) {
        if (activeTool === 'note') { startTool('note'); if (APP.openAddNote) APP.openAddNote(p.x, p.y); else APP.addTextNote('New note', p.x, p.y); cancelTool(true); return; }
        drawState = { tool: activeTool, sx: p.x, sy: p.y, x: p.x, y: p.y };
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      APP.selectNode(null);
      APP.updateSelectionStatus(e.clientX, e.clientY);
      panState = { sx: e.clientX, sy: e.clientY, px: APP.getState().view.panX, py: APP.getState().view.panY, moved: false };
      canvas.classList.add('panning');
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (drawState) {
        var p = APP.screenToWorld(e.clientX, e.clientY);
        drawState.x = p.x; drawState.y = p.y;
        previewAnnotation(drawState);
        return;
      }
      if (panState) {
        var dx = e.clientX - panState.sx, dy = e.clientY - panState.sy;
        if (Math.abs(dx) + Math.abs(dy) > 2) panState.moved = true;
        APP.getState().view.panX = panState.px + dx;
        APP.getState().view.panY = panState.py + dy;
        APP.applyView();
        return;
      }
      if (!e.target.closest('.node')) APP.updateSelectionStatus(e.clientX, e.clientY);
    });

    canvas.addEventListener('pointerup', function (e) {
      if (drawState) {
        var d = drawState; drawState = null;
        removePreview();
        finishAnnotation(d);
        cancelTool(true);
        return;
      }
      if (panState) {
        if (panState.moved) APP.scheduleSave();
        panState = null; canvas.classList.remove('panning');
      }
    });
    canvas.addEventListener('pointercancel', function () {
      drawState = null; removePreview(); panState = null; canvas.classList.remove('panning');
    });

    canvas.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 2) {
        e.preventDefault();
        var r = canvas.getBoundingClientRect();
        var factor = e.deltaY > 0 ? .9 : 1.1;
        APP.zoomAt(APP.getState().view.zoom * factor, e.clientX - r.left, e.clientY - r.top);
      }
    }, { passive: false });

    canvas.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.node') || e.target.closest('.link-group')) return;
      e.preventDefault(); showCanvasMenu(e.clientX, e.clientY);
    });
    canvas.addEventListener('dblclick', function (e) {
      var nel = e.target.closest('.node');
      if (nel && nel.dataset.nodeId) {
        e.preventDefault();
        APP.openConsoleById(nel.dataset.nodeId);
        return;
      }
      if (e.target.closest('.link-group')) return;
      var p = APP.screenToWorld(e.clientX, e.clientY);
      if (APP.openAddNote) APP.openAddNote(p.x, p.y);
    });

    document.addEventListener('pointermove', function (e) {
      if (e.target === canvas) APP.updateSelectionStatus(e.clientX, e.clientY);
    });
  }

  function previewAnnotation(d) {
    var layer = $('#annotationLayer');
    if (!layer) return;
    removePreview();
    var el;
    if (d.tool === 'line') {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      el.setAttribute('x1', d.sx); el.setAttribute('y1', d.sy); el.setAttribute('x2', d.x); el.setAttribute('y2', d.y);
      el.setAttribute('stroke', 'rgba(255,255,255,.5)'); el.setAttribute('stroke-width', '1.8'); el.setAttribute('stroke-dasharray', '5 4');
    } else {
      el = document.createElementNS('http://www.w3.org/2000/svg', d.tool === 'ellipse' ? 'ellipse' : 'rect');
      var x = Math.min(d.sx, d.x), y = Math.min(d.sy, d.y), w = Math.abs(d.x - d.sx), h = Math.abs(d.y - d.sy);
      if (d.tool === 'ellipse') {
        el.setAttribute('cx', x + w / 2); el.setAttribute('cy', y + h / 2); el.setAttribute('rx', w / 2); el.setAttribute('ry', h / 2);
      } else {
        el.setAttribute('x', x); el.setAttribute('y', y); el.setAttribute('width', w); el.setAttribute('height', h); el.setAttribute('rx', 4);
      }
      el.setAttribute('fill', 'rgba(255,255,255,.06)'); el.setAttribute('stroke', 'rgba(255,255,255,.5)'); el.setAttribute('stroke-width', '1.6'); el.setAttribute('stroke-dasharray', '5 4');
    }
    el.id = 'annotationPreview';
    layer.appendChild(el);
  }
  function removePreview() { var p = $('#annotationPreview'); if (p) p.remove(); }

  function finishAnnotation(d) {
    var x = Math.min(d.sx, d.x), y = Math.min(d.sy, d.y);
    var w = Math.abs(d.x - d.sx), h = Math.abs(d.y - d.sy);
    if (d.tool === 'line') {
      if (Math.abs(d.x - d.sx) + Math.abs(d.y - d.sy) < 8) return;
      APP.addAnnotation({ id: APP.uid('line'), type: 'line', x: d.sx, y: d.sy, x2: d.x, y2: d.y });
      return;
    }
    if (w < 12 || h < 12) return;
    APP.addAnnotation({ id: APP.uid(d.tool), type: d.tool, text: '', x: x, y: y, w: w, h: h });
  }

  // ---------------------------------------------------------- context menus
  function showMenu(html, x, y) {
    var m = $('#contextMenu');
    if (!m) return;
    m.innerHTML = html;
    m.classList.add('open', 'show');
    m.style.left = '0px'; m.style.top = '0px';
    var r = m.getBoundingClientRect();
    m.style.left = Math.min(x, global.innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, global.innerHeight - r.height - 8) + 'px';
    contextState = { x: x, y: y };
    setTimeout(function () { document.addEventListener('click', closeContext); }, 0);
  }
  function closeContext() {
    var m = $('#contextMenu');
    if (m) { m.classList.remove('open', 'show'); m.innerHTML = ''; }
    document.removeEventListener('click', closeContext);
  }
  APP.closeContextMenu = closeContext;

  function menuItem(action, label, iconName, danger) {
    return '<button class="ctx-item' + (danger ? ' danger' : '') + '" data-ctx="' + action + '">' + icon(iconName || 'chevron-right') + '<span>' + esc(label) + '</span></button>';
  }

  function showNodeMenu(id, x, y) {
    var n = APP.nodeById(id);
    if (!n) return;
    var h = '<div class="ctx-head">' + icon(APP.nodeIconId(n)) + '<span><b>' + esc(n.name) + '</b><small>' + esc(n.model) + ', ' + esc(n.status) + '</small></span></div><div class="ctx-sep"></div>';
    var running = n.status === 'running';
    if (running) h += menuItem('pause', 'Pause', 'pause') + menuItem('stop', 'Stop', 'stop') + menuItem('restart', 'Restart', 'reload');
    else h += menuItem('start', 'Start', 'play');
    h += '<div class="ctx-sep"></div>' + menuItem('console', 'Open Console', 'terminal') + menuItem('configure', 'Configure Device (GUI)…', 'settings') + menuItem('capture', 'Packet Capture…', 'packet');
    h += '<div class="ctx-sep"></div>' + menuItem('rename', 'Rename Node…', 'note') + menuItem('delete', 'Delete Node', 'trash', true);
    showMenu(h, x, y);
    $('#contextMenu').onclick = function (e) {
      var b = e.target.closest('[data-ctx]'); if (!b) return;
      closeContext();
      var act = b.dataset.ctx;
      if (act === 'start') APP.startNode(id);
      else if (act === 'pause') APP.pauseNode(id);
      else if (act === 'stop') APP.stopNode(id);
      else if (act === 'restart') APP.restartNode(id);
      else if (act === 'console') APP.openConsoleById(id);
      else if (act === 'configure' && APP.openDeviceConfigurator) APP.openDeviceConfigurator(id);
      else if (act === 'capture' && APP.openCapture) APP.openCapture(id);
      else if (act === 'rename' && APP.openRenameNode) APP.openRenameNode(id);
      else if (act === 'delete') confirmAction('Delete ' + n.name + ' and all of its links?', function () { APP.deleteNode(id); });
    };
  }
  APP.showNodeMenu = showNodeMenu;

  function showLinkMenu(id, x, y) {
    var l = APP.linkById(id);
    if (!l) return;
    var h = '<div class="ctx-head">' + icon('cable') + '<span><b>' + esc(l.aPort + ' ↔ ' + l.bPort) + '</b><small>Ethernet link, ' + esc(l.status) + '</small></span></div><div class="ctx-sep"></div>';
    h += menuItem('label', 'Edit Link Label…', 'tag') + menuItem('delete', 'Delete Link', 'trash', true);
    showMenu(h, x, y);
    $('#contextMenu').onclick = function (e) {
      var b = e.target.closest('[data-ctx]'); if (!b) return;
      closeContext();
      if (b.dataset.ctx === 'delete') APP.deleteLink(id);
      else if (b.dataset.ctx === 'label' && APP.openLinkLabel) APP.openLinkLabel(id);
    };
  }
  APP.showLinkMenu = showLinkMenu;

  function showCanvasMenu(x, y) {
    var h = '<div class="ctx-head">' + icon('new') + '<span><b>Canvas</b><small>Topology workspace</small></span></div><div class="ctx-sep"></div>';
    h += menuItem('note', 'Add Text Note…', 'note') + menuItem('rect', 'Draw Rectangle', 'rect') + menuItem('ellipse', 'Draw Ellipse', 'ellipse') + menuItem('line', 'Draw Line', 'line');
    h += '<div class="ctx-sep"></div>' + menuItem('fit', 'Fit to Screen', 'fit') + menuItem('grid', 'Toggle Grid', 'grid') + menuItem('fleet', 'Fleet Intent…', 'network');
    showMenu(h, x, y);
    $('#contextMenu').onclick = function (e) {
      var b = e.target.closest('[data-ctx]'); if (!b) return;
      closeContext();
      var act = b.dataset.ctx;
      if (act === 'note') { var p = APP.screenToWorld(x, y); if (APP.openAddNote) APP.openAddNote(p.x, p.y); }
      else if (act === 'rect' || act === 'ellipse' || act === 'line') startTool(act);
      else if (act === 'fit') APP.fitView();
      else if (act === 'grid') dispatch('toggle-grid');
      else if (act === 'fleet' && APP.openFleetIntent) APP.openFleetIntent();
    };
  }
  APP.showCanvasMenu = showCanvasMenu;

  // ---------------------------------------------------------------- presets
  function bindRightDock() {
    $$('.side-head').forEach(function (h) {
      h.addEventListener('click', function () { h.parentNode.classList.toggle('collapsed'); });
    });
    $$('.preset-card').forEach(function (card) {
      card.addEventListener('click', function () {
        var preset = card.dataset.preset;
        confirmAction('Load the "' + card.querySelector('b').textContent + '" preset? The current topology will be replaced.', function () { applyPreset(preset); });
      });
    });
  }

  function applyPreset(key) {
    var preset = APP.PRESETS[key];
    if (!preset) return;
    if (APP.closeAllTerminals) APP.closeAllTerminals(true);
    APP.captureHistory();
    var s = APP.getState();
    s.preset = key; s.title = preset.title;

    if (Array.isArray(preset.nodes) && Array.isArray(preset.topology)) {
      // full rebuild: fresh nodes + links + runtime configs from the preset spec
      var nodes = [];
      var byName = {};
      for (var i = 0; i < preset.nodes.length; i++) {
        var spec = preset.nodes[i];
        var tplKey = spec.template || 'router';
        var n = APP.makeNode('n-' + key + '-' + String(spec.name).toLowerCase(), spec.name, tplKey, 120 + i * 160, 140, 'running', 5001 + i);
        if (spec.model) n.model = spec.model;
        var hspec = null;
        if (preset.hosts) {
          for (var h = 0; h < preset.hosts.length; h++) if (preset.hosts[h].name === n.name) hspec = preset.hosts[h];
        }
        if (hspec) { n.ip = hspec.ip; n.gateway = hspec.gateway; }
        nodes.push(n); byName[n.name] = n;
      }
      var links = [];
      for (var li = 0; li < preset.topology.length; li++) {
        var t = preset.topology[li];
        var a = byName[t.a], b = byName[t.b];
        if (a && b) links.push(APP.makeLink('l-' + key + '-' + li, a.id, t.ap, b.id, t.bp, t.label || ''));
      }
      s.nodes = nodes;
      s.links = links;
      s.annotations = [];
      // runtime reboot
      APP.clearRuntimes();
      for (var ri = 0; ri < nodes.length; ri++) {
        APP.resetRuntime(nodes[ri].name, preset.configs && preset.configs[nodes[ri].name], preset.title, nodes[ri]);
      }
      APP.setSelectedNodeId(null);
    } else {
      // legacy path: reposition the existing canvas only
      s.nodes.forEach(function (n) {
        var p = preset.positions[n.name];
        if (p) { n.x = p.x; n.y = p.y; }
        else { var idx = s.nodes.indexOf(n); n.x = 120 + (idx % 4) * 180; n.y = 120 + Math.floor(idx / 4) * 160; }
      });
      s.annotations = [];
    }
    APP.rebuildWorld();
    APP.renderAll(true);
    APP.scheduleSave();
    APP.toast(preset.title + ' preset loaded', 'success', 'check');
  }
  APP.applyPreset = applyPreset;

  function autoLayout() {
    var s = APP.getState();
    if (!s.nodes.length) return;
    APP.captureHistory();
    var routers = s.nodes.filter(function (n) { return n.type === 'router'; });
    var switches = s.nodes.filter(function (n) { return n.type === 'switch'; });
    var hosts = s.nodes.filter(function (n) { return n.type === 'host'; });
    var firewalls = s.nodes.filter(function (n) { return n.type === 'firewall'; });
    var top = firewalls.concat(routers);
    var maxCols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(top.length))));
    top.forEach(function (n, i) {
      var col = i % maxCols, row = Math.floor(i / maxCols);
      n.x = 170 + col * 220 + row * 30;
      n.y = 120 + row * 190;
    });
    switches.forEach(function (n, i) { n.x = 390 + i * 220; n.y = 330; });
    hosts.forEach(function (n, i) { n.x = 270 + i * 210; n.y = 480 + Math.floor(i / 4) * 140; });
    APP.renderAll(true); APP.scheduleSave();
    APP.toast('Topology arranged automatically', 'success', 'fit');
  }
  APP.autoLayout = autoLayout;

  // ---------------------------------------------------------------- export
  function exportProject() {
    var data = APP.collectProject();
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (APP.getState().title || 'gns3-lab').replace(/[^\w.-]+/g, '-').toLowerCase() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    APP.toast('Project exported as JSON', 'success', 'save');
  }
  APP.exportProject = exportProject;

  function saveSnapshot() {
    try {
      localStorage.setItem(APP.SNAPSHOT_KEY, JSON.stringify(APP.collectProject()));
      APP.toast('Snapshot saved in this browser', 'success', 'snapshot');
    } catch (e) { APP.toast('Snapshot failed: ' + e.message, 'error', 'warning'); }
  }
  APP.saveSnapshot = saveSnapshot;

  function bindFileInput() {
    var input = $('#fileInput');
    if (!input) return;
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          APP.loadProjectData(data, 'Project imported');
          APP.renderAll(true);
        } catch (e) { APP.toast('Import failed: ' + e.message, 'error', 'warning'); }
        input.value = '';
      };
      reader.readAsText(file);
    });
  }

  // --------------------------------------------------------------- keyboard
  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      var inField = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
      if (e.key === 'Escape') {
        closeContext(); closeMenus(); cancelPlacement(); cancelLinkMode(); cancelTool();
        if (APP.closeModal) APP.closeModal();
        return;
      }
      if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }
      if (e.key === 'F2') { e.preventDefault(); beginRename(); return; }
      if (inField || document.activeElement.closest && document.activeElement.closest('#terminalDock')) return;
      var ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); dispatch('new-project'); }
      else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); dispatch('open-project'); }
      else if (ctrl && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); dispatch('save-project'); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); dispatch('save-as'); }
      else if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); APP.undo(); }
      else if (ctrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); APP.redo(); }
      else if (ctrl && (e.key === '+' || e.key === '=')) { e.preventDefault(); APP.zoomBy(1.18); }
      else if (ctrl && e.key === '-') { e.preventDefault(); APP.zoomBy(1 / 1.18); }
      else if (ctrl && e.key === '0') { e.preventDefault(); APP.fitView(); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); if (APP.openAllConsoles) APP.openAllConsoles(); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'u') { e.preventDefault(); APP.startAll(); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'w') { e.preventDefault(); APP.stopAll(); }
      else if (ctrl && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); APP.reloadAll(); }
      else if (ctrl && e.key === 'Enter') { e.preventDefault(); var n = selectionNode(); if (n) APP.openConsoleById(n.id); }
      else if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); dispatch('select-all'); }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (APP.getSelectedNodeId() || APP.getSelectedLinkId() || APP.getSelectedAnnotationId()) { e.preventDefault(); deleteSelection(); }
      } else if (e.key === '?' && !ctrl) { if (!inField) dispatch('shortcuts'); }
    });
  }

  // ------------------------------------------------------------------- init
  function initDockResize() {
    var store = {};
    try { store = JSON.parse(global.localStorage.getItem('slab.dockW') || '{}'); } catch (e) { store = {}; }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
    function apply(side, w) {
      var dock = side === 'left' ? $('#leftDock') : $('#rightDock');
      if (!dock) return;
      dock.style.flexBasis = w + 'px';
      dock.style.width = w + 'px';
    }
    function bind(side, gripId, minW, maxW) {
      var grip = $('#' + gripId);
      if (!grip) return;
      grip.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var dock = side === 'left' ? $('#leftDock') : $('#rightDock');
        if (!dock) return;
        var startW = dock.getBoundingClientRect().width;
        var sx = e.clientX;
        grip.classList.add('active');
        document.body.classList.add('window-resizing');
        function move(ev) {
          var dx = ev.clientX - sx;
          var w = side === 'left' ? clamp(startW + dx, minW, maxW) : clamp(startW - dx, minW, maxW);
          apply(side, Math.round(w));
          if (APP.applyView) APP.applyView();
        }
        function up() {
          global.removeEventListener('pointermove', move);
          global.removeEventListener('pointerup', up);
          grip.classList.remove('active');
          document.body.classList.remove('window-resizing');
          store[side] = Math.round(dock.getBoundingClientRect().width);
          try { global.localStorage.setItem('slab.dockW', JSON.stringify(store)); } catch (e2) {}
          if (APP.applyView) APP.applyView();
        }
        global.addEventListener('pointermove', move);
        global.addEventListener('pointerup', up);
      });
    }
    if (store.left) apply('left', clamp(store.left, 190, 300));
    if (store.right) apply('right', clamp(store.right, 236, 460));
    bind('left', 'leftDockGrip', 190, 300);
    bind('right', 'rightDockGrip', 236, 460);
  }

  APP.initInteractions = function () {
    bindMenus();
    bindToolbar();
    bindPalette();
    bindCanvas();
    bindRightDock();
    bindFileInput();
    bindKeys();
    applyDockState();
    initDockResize();
    if ($('#terminalDock')) {
      setInterval(function () {
        if ($('#terminalDock').classList.contains('hidden')) return;
        $$('.term-cursor').forEach(function (c) { c.classList.toggle('blink-off'); });
      }, 530);
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
