(function (global) {
  'use strict';

  var J = global.JJ;
  var APP = J.app = J.app || {};
  var $ = APP.$, $$ = APP.$$, esc = APP.esc, icon = APP.icon;

  var modalState = null;

  function openModal(opts) {
    opts = opts || {};
    var backdrop = $('#modalBackdrop');
    var modal = $('#modal');
    if (!backdrop || !modal) return;
    closeModal();
    modal.className = 'modal ' + (opts.size || '');
    var head = '<div class="modal-head"><span class="modal-head-icon">' + icon(opts.icon || 'settings') + '</span><div class="modal-title">' + esc(opts.title || '') + (opts.sub ? '<div class="modal-sub">' + esc(opts.sub) + '</div>' : '') + '</div><button class="icon-btn" data-modal-close title="Close">' + icon('close') + '</button></div>';
    var body = '<div class="modal-body">' + (opts.body || '') + '</div>';
    var foot = opts.footer === false ? '' : '<div class="modal-foot">' + (opts.footer || '<button class="btn" data-modal-close>Close</button>') + '</div>';
    modal.innerHTML = head + body + foot;
    backdrop.classList.remove('hidden');
    modalState = { opts: opts, modal: modal };
    $$('[data-modal-close]', modal).forEach(function (b) { b.addEventListener('click', function () { closeModal(); }); });
    if (opts.onMount) opts.onMount(modal);
    var focus = modal.querySelector('[autofocus], input:not([type=checkbox]):not([type=radio]), textarea, select');
    if (focus) setTimeout(function () { try { focus.focus(); } catch (e) {} }, 30);
    return modal;
  }
  APP.openModal = openModal;

  function closeModal(force) {
    var backdrop = $('#modalBackdrop');
    if (!backdrop || backdrop.classList.contains('hidden')) return;
    if (modalState && modalState.opts.onClose && !force) {
      try { modalState.opts.onClose(); } catch (e) {}
    }
    backdrop.classList.add('hidden');
    if ($('#modal')) $('#modal').innerHTML = '';
    modalState = null;
  }
  APP.closeModal = closeModal;

  function bindBackdrop() {
    var backdrop = $('#modalBackdrop');
    if (!backdrop) return;
    backdrop.addEventListener('mousedown', function (e) { if (e.target === backdrop) closeModal(); });
  }

  function confirm(message, onYes, yesLabel) {
    openModal({
      title: 'Confirm Action', icon: 'warning', size: 'narrow',
      body: '<p style="margin:0;color:#d8d9dc">' + esc(message) + '</p>',
      footer: '<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="confirmYes">' + esc(yesLabel || 'Continue') + '</button>',
      onMount: function (m) {
        $('#confirmYes', m).addEventListener('click', function () { closeModal(true); onYes(); });
        $('#confirmYes', m).focus();
      }
    });
  }
  APP.confirm = confirm;

  function promptModal(opts) {
    opts = opts || {};
    var value = opts.value == null ? '' : String(opts.value);
    var field = opts.multiline
      ? '<textarea class="textarea" id="promptValue" placeholder="' + esc(opts.placeholder || '') + '">' + esc(value) + '</textarea>'
      : '<input class="input" id="promptValue" value="' + esc(value) + '" placeholder="' + esc(opts.placeholder || '') + '" autofocus>';
    openModal({
      title: opts.title || 'Input', icon: opts.icon || 'note', size: 'narrow',
      body: (opts.note ? '<p class="modal-note">' + esc(opts.note) + '</p>' : '') + '<div class="form-row" style="align-items:flex-start"><label>' + esc(opts.label || 'Value') + '</label><div style="flex:1">' + field + (opts.hint ? '<p class="modal-note" style="margin:6px 0 0">' + esc(opts.hint) + '</p>' : '') + '</div></div>',
      footer: '<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="promptOk">' + esc(opts.okLabel || 'OK') + '</button>',
      onMount: function (m) {
        var input = $('#promptValue', m);
        function done() {
          var v = input.value;
          if (opts.required && !String(v).trim()) { input.focus(); input.style.borderColor = '#8a8b8f'; return; }
          closeModal(true); if (opts.onOk) opts.onOk(v);
        }
        $('#promptOk', m).addEventListener('click', done);
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !opts.multiline) { e.preventDefault(); done(); } });
        if (!opts.multiline) setTimeout(function () { input.select(); }, 60);
      }
    });
  }
  APP.promptModal = promptModal;

  // ------------------------------------------------------------- save as
  function openSaveAs() {
    var s = APP.getState();
    promptModal({
      title: 'Save Project As', icon: 'save', label: 'Project name',
      value: s.title, required: true, okLabel: 'Save Project',
      hint: 'The project is stored in this browser. Use File → Export for a portable JSON file.',
      onOk: function (name) {
        s.title = String(name).trim();
        APP.updateProjectChrome();
        APP.saveProject();
        APP.toast('Project saved as "' + s.title + '"', 'success', 'save');
      }
    });
  }
  APP.openSaveAs = openSaveAs;

  // ----------------------------------------------------------- preferences
  function openPreferences() {
    var s = APP.getState();
    openModal({
      title: 'Preferences', icon: 'settings', sub: 'Workspace and canvas behavior',
      body: '<h3>Canvas</h3>' +
        '<div class="form-row"><label>Dashboard grid</label><label style="display:flex;align-items:center;gap:7px;width:auto"><input type="checkbox" id="prefGrid" ' + (s.settings.grid ? 'checked' : '') + '> Show dot grid</label></div>' +
        '<div class="form-row"><label>Interface labels</label><label style="display:flex;align-items:center;gap:7px;width:auto"><input type="checkbox" id="prefLabels" ' + (s.settings.labels ? 'checked' : '') + '> Show link and port labels</label></div>' +
        '<div class="form-row"><label>Device palette</label><label style="display:flex;align-items:center;gap:7px;width:auto"><input type="checkbox" id="prefLeft" ' + (s.settings.leftDock ? 'checked' : '') + '> Show left dock</label></div>' +
        '<div class="form-row"><label>Summary panels</label><label style="display:flex;align-items:center;gap:7px;width:auto"><input type="checkbox" id="prefRight" ' + (s.settings.rightDock ? 'checked' : '') + '> Show right dock</label></div>' +
        '<h3>Project</h3>' +
        '<div class="form-row"><label>Autosave</label><span class="modal-note" style="margin:0">Projects are saved to localStorage 1.2 seconds after each change.</span></div>' +
        '<div class="form-row"><label>Storage key</label><code>' + esc(APP.STORAGE_KEY) + '</code></div>',
      footer: '<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="prefSave">Apply Preferences</button>',
      onMount: function (m) {
        $('#prefSave', m).addEventListener('click', function () {
          s.settings.grid = $('#prefGrid', m).checked;
          s.settings.labels = $('#prefLabels', m).checked;
          s.settings.leftDock = $('#prefLeft', m).checked;
          s.settings.rightDock = $('#prefRight', m).checked;
          APP.renderCanvasSettings(); APP.applyDockState(); APP.scheduleSave(); closeModal(true);
          APP.toast('Preferences applied', 'success', 'settings');
        });
      }
    });
  }
  APP.openPreferences = openPreferences;

  // -------------------------------------------------------------- consoles
  function consoleRows(filter) {
    var s = APP.getState();
    return s.nodes.filter(function (n) {
      if (!filter) return true;
      return (n.name + ' ' + n.model + ' ' + n.status).toLowerCase().indexOf(String(filter).toLowerCase()) >= 0;
    }).map(function (n) {
      return '<div class="console-row" data-console-node="' + esc(n.id) + '"><span class="dev-ico">' + icon(APP.nodeIconId(n)) + '</span><div class="console-row-main"><b>' + esc(n.name) + ' <span class="status-pill ' + (n.status === 'running' ? 'up' : n.status === 'paused' ? 'warn' : 'down') + '">' + esc(n.status) + '</span></b><span>' + esc(n.model) + ', telnet localhost:' + n.consolePort + '</span></div><button class="btn primary" data-connect="' + esc(n.id) + '">Connect</button></div>';
    }).join('');
  }

  function bindConsoleRows(m) {
    $$('[data-connect]', m).forEach(function (b) {
      b.addEventListener('click', function () { closeModal(true); APP.openConsoleById(b.dataset.connect); });
    });
  }

  function openConsoleManager() {
    var s = APP.getState();
    openModal({
      title: 'Console Manager', icon: 'terminal', sub: 'Local server on 127.0.0.1',
      body: '<p class="modal-note">Each device exposes a telnet console. Click a device to open a terminal tab.</p><div class="console-list">' + (consoleRows('') || '<p class="modal-note">No devices in this project.</p>') + '</div>',
      footer: '<button class="btn" data-modal-close>Close</button><button class="btn primary" id="cmAll">Connect to All Running</button>',
      onMount: function (m) {
        bindConsoleRows(m);
        $('#cmAll', m).addEventListener('click', function () { closeModal(true); APP.openAllConsoles(); });
      }
    });
  }
  APP.openConsoleManager = openConsoleManager;

  function openConsolePickerModal() {
    openModal({
      title: 'Open Console', icon: 'terminal', sub: 'Choose a device console',
      body: '<div class="console-list">' + (consoleRows('') || '<p class="modal-note">No devices in this project.</p>') + '</div>',
      footer: '<button class="btn" data-modal-close>Cancel</button>',
      onMount: bindConsoleRows
    });
  }
  APP.openConsolePickerModal = openConsolePickerModal;

  // -------------------------------------------------------------- interfaces
  function openInterfaces(id) {
    var node = APP.nodeById(id);
    if (!node) return;
    var rows = APP.getInterfaceRows(node);
    var html = '<p class="modal-note">' + esc(node.name + ', ' + node.model) + '. Interface IP changes are committed directly to the candidate configuration.</p>';
    if (!rows.length) {
      html += '<p>No interfaces are available for this device.</p>';
    } else {
      html += '<table class="data-table"><thead><tr><th>Interface</th><th>Admin</th><th>Link</th><th>Family</th><th>Address / members</th><th></th></tr></thead><tbody>';
      rows.forEach(function (r, i) {
        html += '<tr><td class="mono">' + esc(r.name) + '</td><td><span class="status-pill ' + (r.admin ? 'up' : 'down') + '">' + (r.admin ? 'up' : 'down') + '</span></td><td><span class="status-pill ' + (r.link ? 'up' : 'down') + '">' + (r.link ? 'up' : 'down') + '</span></td><td>' + esc(r.family) + '</td><td><input class="input" data-iface-row="' + i + '" value="' + esc(r.address) + '" placeholder="' + (r.kind === 'switching' ? 'VLAN members' : '192.0.2.1/24') + '" ' + (node.junos ? '' : 'data-host="1"') + '></td><td><span class="console-chip">' + esc(r.kind) + '</span></td></tr>';
      });
      html += '</tbody></table>';
    }
    html += '<p class="modal-note" style="margin-top:12px">Tip: host consoles can also be configured with <code>ip 10.0.3.20/24 10.0.3.1</code>.</p>';
    openModal({
      title: 'Configure Interfaces', icon: 'settings', sub: node.name, size: 'wide',
      body: html,
      footer: '<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="ifApply">Apply &amp; Commit</button>',
      onMount: function (m) {
        $('#ifApply', m).addEventListener('click', function () {
          var inputs = $$('[data-iface-row]', m);
          if (!node.junos) {
            var hostInput = inputs[0];
            if (hostInput) { node.ip = hostInput.value.split('/')[0]; }
            APP.scheduleSave(); closeModal(true); APP.toast('Host interface updated', 'success', 'check');
            return;
          }
          var rt = APP.ensureRuntime(node);
          if (!rt) { APP.toast('Runtime unavailable for ' + node.name, 'error', 'warning'); return; }
          var candidate = J.db.clone(rt.committed || rt.config);
          var changed = 0;
          inputs.forEach(function (inp) {
            var row = rows[Number(inp.dataset.ifaceRow)];
            if (!row || row.kind === 'switching') return;
            var val = String(inp.value || '').trim();
            if (!val || val === row.address) return;
            if (row.kind === 'phys') {
              try { J.db.del(candidate, ['interfaces', row.name, 'unit', '0', 'family', 'inet', 'address']); } catch (e) {}
              J.db.set(candidate, ['interfaces', row.name, 'unit', '0', 'family', 'inet', 'address', val]);
              changed++;
            } else if (row.kind === 'mgmt') {
              try { J.db.del(candidate, ['interfaces', row.name, 'unit', '0', 'family', 'inet', 'address']); } catch (e) {}
              J.db.set(candidate, ['interfaces', row.name, 'unit', '0', 'family', 'inet', 'address', val]);
              changed++;
            }
          });
          if (!changed) { closeModal(true); APP.toast('No interface changes to commit', 'info', 'check'); return; }
          rt.candidate = candidate;
          rt.committed = J.db.clone(candidate);
          rt.config = rt.committed;
          rt.lastConfigured = Date.now();
          rt.commitCount = (rt.commitCount || 0) + 1;
          APP.rebuildWorld(); APP.renderAll(); APP.scheduleSave(); closeModal(true);
          APP.toast(changed + ' interface change' + (changed === 1 ? '' : 's') + ' committed', 'success', 'check');
        });
      }
    });
  }
  APP.openInterfaces = openInterfaces;

  // ---------------------------------------------------------------- capture
  function openCapture(id) {
    var node = APP.nodeById(id);
    if (!node) return;
    var base = node.ip ? node.ip.split('.').slice(0, 3).join('.') : '10.0.12';
    var ifs = APP.getInterfaceRows(node).filter(function (r) { return r.kind !== 'lo'; }).slice(0, 10);
    var opts = ifs.map(function (r) { return '<option>' + esc(r.name) + '</option>'; }).join('');
    openModal({
      title: 'Packet Capture', icon: 'packet', sub: node.name + ', console', size: 'wide',
      body: '<div class="capture-toolbar"><select class="select" id="capIface" style="max-width:180px">' + (opts || '<option>ge-0/0/0</option>') + '</select><input class="input" id="capFilter" placeholder="tcpdump filter (e.g. icmp or port 22)"><button class="btn primary" id="capStart">Start</button><button class="btn" id="capStop" disabled>Stop</button><span class="console-chip" id="capCount">0 packets</span></div>' +
        '<div style="max-height:280px;overflow:auto;border:1px solid #232326;border-radius:4px"><table class="data-table capture-table"><thead><tr><th>Time</th><th>Source</th><th>Destination</th><th>Proto</th><th>Len</th><th>Info</th></tr></thead><tbody id="capBody"></tbody></table></div><div class="capture-detail" id="capDetail">Select a packet to inspect its decoded headers.</div>',
      footer: '<button class="btn" data-modal-close>Close</button>',
      onClose: function () { if (captureTimer) clearInterval(captureTimer); captureTimer = null; },
      onMount: function (m) {
        var count = 0, timer = null;
        captureTimer = null;
        var body = $('#capBody', m), detail = $('#capDetail', m), cnt = $('#capCount', m);
        var start = $('#capStart', m), stop = $('#capStop', m);
        var seq = 0;
        function packet() {
          seq++;
          var protos = ['OSPF', 'ICMP', 'TCP', 'TCP', 'ARP'];
          var proto = protos[Math.floor(Math.random() * protos.length)];
          var a = base + '.' + (Math.random() > .5 ? '1' : '2');
          var b = base + '.' + (Math.random() > .5 ? '1' : '2');
          if (node.name === 'R1') { a = '10.0.12.1'; b = proto === 'OSPF' ? '224.0.0.5' : '10.0.12.2'; }
          var info = proto === 'OSPF' ? 'OSPFv2 Hello' : proto === 'ICMP' ? 'Echo (ping) request id=' + (300 + seq) + ', seq=' + seq : proto === 'ARP' ? 'Who has ' + b + '? Tell ' + a : '56334 → ' + (proto === 'TCP' ? '22' : '179') + ' [ACK] Seq=' + (seq * 1420) + ' Ack=' + (seq * 980) + ' Win=65535';
          var tr = document.createElement('tr');
          var t = new Date().toLocaleTimeString('en-GB', { hour12: false });
          tr.innerHTML = '<td>' + t + '.' + String(Math.floor(Math.random() * 999)).padStart(3, '0') + '</td><td>' + a + '</td><td>' + b + '</td><td class="proto-' + proto.toLowerCase() + '">' + proto + '</td><td>' + (proto === 'ARP' ? 42 : proto === 'ICMP' ? 74 : 90) + '</td><td>' + esc(info) + '</td>';
          tr.addEventListener('click', function () {
            detail.innerHTML = '<b>Frame ' + seq + ', ' + proto + '</b><br>Source: ' + a + '<br>Destination: ' + b + '<br>' + (proto === 'OSPF' ? 'IP 224.0.0.5 > 224.0.0.5: OSPFv2, Hello, length 44' : proto === 'ICMP' ? 'IP ' + a + ' > ' + b + ': ICMP echo request, id ' + (300 + seq) + ', seq ' + seq : proto === 'ARP' ? 'ARP, Request who-has ' + b + ' tell ' + a + ', length 28' : 'IP ' + a + ' > ' + b + ': tcp, length 52');
          });
          body.insertBefore(tr, body.firstChild);
          while (body.children.length > 80) body.removeChild(body.lastChild);
          count++; cnt.textContent = count + ' packets';
        }
        start.addEventListener('click', function () {
          if (timer) return;
          timer = setInterval(packet, 900);
          captureTimer = timer;
          start.disabled = true; stop.disabled = false;
          packet();
          APP.setStatus('Packet capture running on ' + $('#capIface', m).value);
        });
        stop.addEventListener('click', function () {
          if (timer) clearInterval(timer);
          timer = null; captureTimer = null;
          start.disabled = false; stop.disabled = true;
          APP.setStatus('Packet capture stopped, ' + count + ' packets');
        });
        $('#capFilter', m).addEventListener('keydown', function (e) {
          if (e.key === 'Enter') APP.toast('Filter accepted: ' + (this.value || 'none'), 'info', 'packet');
        });
      }
    });
  }
  var captureTimer = null;
  APP.openCapture = openCapture;

  // ------------------------------------------------------------ annotations
  function openAddNote(x, y) {
    var s = APP.getState();
    if (x == null || y == null) {
      var cv = $('#canvas');
      if (cv) { var p = APP.screenToWorld(cv.getBoundingClientRect().left + cv.clientWidth / 2, cv.getBoundingClientRect().top + cv.clientHeight / 2); x = p.x - 70; y = p.y - 30; }
      else { x = 120; y = 120; }
    }
    promptModal({
      title: 'Add Text Note', icon: 'note', label: 'Note text', multiline: true,
      value: 'JNCIA practice note\nAdd your observation here.',
      hint: 'Line breaks are preserved. The note is placed on the topology canvas.',
      okLabel: 'Place Note',
      onOk: function (text) {
        if (!String(text).trim()) return;
        APP.addTextNote(String(text).replace(/\r/g, ''), Math.round(x), Math.round(y));
      }
    });
  }
  APP.openAddNote = openAddNote;

  function openRenameNode(id) {
    var node = APP.nodeById(id);
    if (!node) return;
    promptModal({
      title: 'Rename Node', icon: 'router', label: 'Device name', value: node.name, required: true,
      onOk: function (name) {
        name = String(name).trim();
        if (!name) return;
        if (APP.nodeByName(name) && APP.nodeByName(name).id !== node.id) { APP.toast('That device name is already in use', 'error', 'warning'); return; }
        APP.captureHistory();
        var old = node.name;
        if (APP.closeTerminal) APP.closeTerminal(old, true);
        if (node.junos) {
          var rt = APP.getRuntimes()[old];
          if (rt) { delete APP.getRuntimes()[old]; rt.key = name; APP.getRuntimes()[name] = rt; }
        }
        node.name = name;
        APP.rebuildWorld(); APP.renderAll(); APP.scheduleSave();
        APP.toast('Device renamed to ' + name, 'success', 'check');
      }
    });
  }
  APP.openRenameNode = openRenameNode;

  function openLinkLabel(id) {
    var l = APP.linkById(id);
    if (!l) return;
    promptModal({
      title: 'Edit Link Label', icon: 'tag', label: 'Label', value: l.label || '',
      placeholder: 'e.g. 10.0.12.0/30, OSPF area 0',
      onOk: function (v) {
        APP.captureHistory(); l.label = String(v).trim(); APP.renderLinks(); APP.scheduleSave();
        APP.toast('Link label updated', 'success', 'tag');
      }
    });
  }
  APP.openLinkLabel = openLinkLabel;

  // ------------------------------------------------------------ command ref
  var COMMANDS = [
    ['Operational', 'show version', 'Display Junos software and hardware version.', 'show version'],
    ['Operational', 'show interfaces terse', 'Summarize interface admin/link state and addresses.', 'show interfaces terse'],
    ['Operational', 'show route', 'Display the inet.0 routing table and preferences.', 'show route'],
    ['Operational', 'show ospf neighbor', 'Display OSPF adjacency state and dead timers.', 'show ospf neighbor'],
    ['Operational', 'show configuration', 'Display the committed configuration.', 'show configuration'],
    ['Operational', 'show ethernet-switching table', 'Display learned MAC addresses on a switch.', 'show ethernet-switching table'],
    ['Operational', 'show vlans', 'Display configured VLANs and member interfaces.', 'show vlans'],
    ['Operational', 'show lldp neighbors', 'Display directly connected LLDP peers.', 'show lldp neighbors'],
    ['Operational', 'show arp', 'Display the ARP table.', 'show arp'],
    ['Operational', 'ping 10.0.23.2', 'Test reachability with ICMP echo requests.', 'ping 10.0.23.2'],
    ['Operational', 'traceroute 3.3.3.3', 'Trace the forwarding path to a destination.', 'traceroute 3.3.3.3'],
    ['Operational', 'monitor traffic interface ge-0/0/0', 'Capture live traffic on an interface.', 'monitor traffic interface ge-0/0/0'],
    ['Operational', 'request system reboot', 'Reboot the routing engine (simulated).', 'request system reboot'],
    ['Configuration', 'configure', 'Enter configuration mode.', 'configure'],
    ['Configuration', 'set system host-name R1', 'Configure the device hostname.', 'set system host-name R1'],
    ['Configuration', 'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30', 'Configure an interface address.', 'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30'],
    ['Configuration', 'set protocols ospf area 0.0.0.0 interface ge-0/0/0.0', 'Enable OSPF on an interface.', 'set protocols ospf area 0.0.0.0 interface ge-0/0/0.0'],
    ['Configuration', 'show | compare', 'Compare candidate configuration with committed.', 'show | compare'],
    ['Configuration', 'commit check', 'Validate the candidate configuration.', 'commit check'],
    ['Configuration', 'commit', 'Commit the candidate configuration.', 'commit'],
    ['Configuration', 'commit confirmed 5', 'Commit with automatic rollback after 5 minutes.', 'commit confirmed 5'],
    ['Configuration', 'rollback 0', 'Discard candidate changes and load committed config.', 'rollback 0'],
    ['Shell', '% → cli', 'Start the Junos CLI from the FreeBSD shell.', 'cli'],
    ['Shell', 'exit', 'Leave operational/configuration mode.', 'exit']
  ];

  function openCommandRef() {
    openModal({
      title: 'Junos Command Reference', icon: 'terminal', sub: 'JNCIA quick reference, runs on the selected device', size: 'wide',
      body: '<div class="form-row"><label>Search</label><input class="input" id="cmdSearch" placeholder="Filter commands, e.g. ospf, commit, interface" autofocus></div><div id="cmdList"></div>',
      footer: '<button class="btn" data-modal-close>Close</button>',
      onMount: function (m) {
        function render(q) {
          q = String(q || '').toLowerCase();
          var rows = COMMANDS.filter(function (c) { return (c.join(' ')).toLowerCase().indexOf(q) >= 0; });
          var html = '<table class="data-table"><thead><tr><th>Mode</th><th>Command</th><th>Description</th><th></th></tr></thead><tbody>';
          rows.forEach(function (c, i) {
            html += '<tr><td><span class="console-chip">' + esc(c[0]) + '</span></td><td class="mono">' + esc(c[1]) + '</td><td>' + esc(c[2]) + '</td><td><button class="btn" data-run-cmd="' + esc(c[3]) + '">Run</button></td></tr>';
          });
          html += '</tbody></table>';
          if (!rows.length) html = '<p class="modal-note">No matching commands.</p>';
          $('#cmdList', m).innerHTML = html;
          $$('[data-run-cmd]', m).forEach(function (b) {
            b.addEventListener('click', function () { runCommandOnSelection(b.dataset.runCmd); });
          });
        }
        render('');
        $('#cmdSearch', m).addEventListener('input', function () { render(this.value); });
      }
    });
  }
  APP.openCommandRef = openCommandRef;

  function runCommandOnSelection(cmd) {
    var node = APP.selectedNode() || APP.getState().nodes.filter(function (n) { return n.junos && n.status === 'running'; })[0];
    if (!node) { APP.toast('Select a Junos device first', 'warn', 'warning'); return; }
    closeModal(true);
    var tab = APP.openConsoleById(node.id);
    if (!tab) return;
    setTimeout(function () {
      try { tab.term.runCommand(cmd, true); } catch (e) { APP.toast('Could not run command: ' + e.message, 'error', 'warning'); }
    }, 180);
  }
  APP.runCommandOnSelection = runCommandOnSelection;

  // ----------------------------------------------------------------- guide
  function openGuide() {
    var steps = [
      ['Inspect the baseline', 'Open R1, R2, and R3 consoles. Run <code>show version</code>, <code>show interfaces terse</code>, and <code>show route</code>.'],
      ['Verify physical links', 'Confirm ge-0/0/0 and ge-0/0/1 are up on each router and that host-facing switch ports are active.'],
      ['Check OSPF adjacencies', 'Run <code>show ospf neighbor</code> on R1 and R2. Adjacencies should reach <code>Full</code>.'],
      ['Trace a path', 'From R1 run <code>ping 3.3.3.3</code> and <code>traceroute 3.3.3.3</code>. Note the next hop at each router.'],
      ['Make a configuration change', 'On R2: <code>configure</code>, <code>set system domain-name jncia.local</code>, <code>show | compare</code>, then <code>commit</code>.'],
      ['Practice rollback', 'Change a statement, run <code>rollback 0</code>, then inspect the configuration with <code>show</code>.'],
      ['Validate Layer 2', 'On SW1 run <code>show ethernet-switching table</code> and <code>show vlans</code> to inspect MAC learning and VLAN membership.'],
      ['Capture traffic', 'Use Node → Packet Capture or <code>monitor traffic interface ge-0/0/0</code> and identify OSPF hello packets.']
    ];
    openModal({
      title: 'JNCIA Lab Guide', icon: 'help', sub: 'Basic routing, OSPF, VLANs, and Junos CLI workflow', size: 'wide',
      body: '<p class="modal-note">This simulated lab mirrors the Juniper vLabs workflow. Configurations persist in this browser and can be exported as JSON.</p><div class="guide-steps">' +
        steps.map(function (s) { return '<div class="guide-step"><div><b>' + esc(s[0]) + '</b><p>' + s[1] + '</p></div></div>'; }).join('') +
        '</div><h3 style="margin-top:16px">Useful starting commands</h3><p><code>show ospf neighbor</code>, <code>show route</code>, <code>show interfaces terse</code>, <code>show configuration</code></p>',
      footer: '<button class="btn" data-modal-close>Close</button><button class="btn primary" id="guideRun">Open R1 Console</button>',
      onMount: function (m) {
        $('#guideRun', m).addEventListener('click', function () {
          var r1 = APP.nodeByName('R1') || APP.getState().nodes[0];
          if (r1) { closeModal(true); APP.openConsoleById(r1.id); }
        });
      }
    });
  }
  APP.openGuide = openGuide;

  function openShortcuts() {
    var rows = [
      ['New project', 'Ctrl+N'], ['Open project', 'Ctrl+O'], ['Save project', 'Ctrl+S'], ['Save as', 'Ctrl+Shift+S'],
      ['Undo / redo', 'Ctrl+Z / Ctrl+Y'], ['Fit to screen', 'Ctrl+0'], ['Zoom', 'Ctrl++ / Ctrl+-'],
      ['Start all nodes', 'Ctrl+Shift+U'], ['Stop all nodes', 'Ctrl+Shift+W'], ['Reload all', 'Ctrl+Shift+R'],
      ['Connect all consoles', 'Ctrl+Shift+C'], ['Open selected console', 'Ctrl+Enter'], ['Delete selection', 'Delete'],
      ['Cancel mode / close dialog', 'Esc'], ['Full screen', 'F11'], ['This dialog', '?']
    ];
    openModal({
      title: 'Keyboard Shortcuts', icon: 'help', sub: 'Workspace navigation',
      body: '<div class="modal-kbd-grid">' + rows.map(function (r) { return '<div><span>' + esc(r[0]) + '</span><kbd>' + esc(r[1]) + '</kbd></div>'; }).join('') + '</div>',
      footer: '<button class="btn" data-modal-close>Close</button>'
    });
  }
  APP.openShortcuts = openShortcuts;

  function openAbout() {
    var s = APP.getState();
    openModal({
      title: 'About JNCIA Junos Lab', icon: 'logo', sub: 'JNCIA network simulator, standalone',
      body: '<div style="display:flex;gap:16px;align-items:center;margin-bottom:14px"><div style="width:64px;height:64px;color:var(--accent-dim)">' + icon('logo') + '</div><div><h3 style="margin:0 0 3px;font-size:15px">JNCIA Junos Lab</h3><p style="margin:0;color:var(--text-muted)">A browser-based topology workspace with an interactive Junos CLI for JNCIA practice.</p></div></div>' +
        '<table class="data-table"><tbody><tr><td>Project</td><td>' + esc(s.title) + '</td></tr><tr><td>Devices</td><td>' + s.nodes.length + ' nodes, ' + s.links.length + ' links</td></tr><tr><td>Junos emulation</td><td>21.4R1 simulation engine</td></tr><tr><td>Local storage</td><td><code>' + esc(APP.STORAGE_KEY) + '</code></td></tr><tr><td>Server</td><td>127.0.0.1, Node.js static server</td></tr></tbody></table>' +
        '<p class="modal-note" style="margin-top:12px">No external CDN assets are used. All icons and visuals are embedded or rendered locally.</p>',
      footer: '<button class="btn" data-modal-close>Close</button><button class="btn primary" id="aboutGuide">Open Lab Guide</button>',
      onMount: function (m) { $('#aboutGuide', m).addEventListener('click', function () { closeModal(true); openGuide(); }); }
    });
  }
  APP.openAbout = openAbout;

  function openServerPrefs() {
    var host = global.location.hostname || 'localhost';
    var port = global.location.port || '3000';
    openModal({
      title: 'Server Preferences', icon: 'server', sub: 'Local GNS3-compatible server',
      body: '<div class="form-row"><label>Server host</label><code>' + esc(host) + '</code></div>' +
        '<div class="form-row"><label>Console proxy port</label><code>' + esc(port) + '</code></div>' +
        '<div class="form-row"><label>Console summary</label><span>' + APP.getState().nodes.filter(function (n) { return n.status === 'running'; }).length + ' running / ' + APP.getState().nodes.length + ' total</span></div>' +
        '<div class="form-row"><label>Project autosave</label><span>Enabled, localStorage</span></div>' +
        '<p class="modal-note">The static Node.js server hosts this application. No remote compute or VMware backend is required for the simulation.</p>',
      footer: '<button class="btn" data-modal-close>Close</button>',
      onMount: function () {}
    });
  }
  APP.openServerPrefs = openServerPrefs;

  APP.initModals = function () { bindBackdrop(); };

})(typeof window !== 'undefined' ? window : globalThis);
