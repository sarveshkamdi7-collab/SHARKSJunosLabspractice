(function (global) {
  'use strict';

  var J = global.JJ;
  var APP = J.app = J.app || {};
  var $ = APP.$;

  function setServerChrome() {
    var host = global.location.hostname || '127.0.0.1';
    var port = global.location.port || '3000';
    var addr = document.querySelector('.server-address');
    if (addr) addr.textContent = host + ':' + port;
  }

  function showEmptyTerminalHint() {
    var dock = $('#terminalDock');
    if (dock && !dock.querySelector('.term-pane')) dock.classList.add('hidden');
  }

  function boot() {
    try { APP.bootCore(); }
    catch (e) {
      APP.toast('Could not load the saved project: ' + e.message, 'error', 'warning');
      APP.setState(APP.defaultState());
      APP.createAllRuntimes();
      APP.rebuildWorld();
    }
    APP.initModals();
    APP.initInteractions();
    APP.initTerminal();
    APP.renderAll(false);
    APP.applyDockState();
    APP.setupStats();
    setServerChrome();
    showEmptyTerminalHint();
    setTimeout(function () {
      APP.applyView();
      var cv = $('#canvas');
      if (cv && !APP.getState().savedAt) APP.fitView();
    }, 90);

    global.addEventListener('beforeunload', function () {
      try { APP.saveProject(true); } catch (e) {}
    });
    global.addEventListener('resize', function () {
      APP.applyView();
    });
    APP.setStatus('Local server connected');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(typeof window !== 'undefined' ? window : globalThis);
