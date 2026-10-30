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
      body: '<p style="margin:0;color:#d6d1c5">' + esc(message) + '</p>',
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
          if (opts.required && !String(v).trim()) { input.focus(); input.style.borderColor = '#6f6858'; return; }
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
      return '<div class="console-row" data-console-node="' + esc(n.id) + '"><span class="dev-ico">' + APP.glyph(APP.deviceGlyph(n)) + '</span><div class="console-row-main"><b>' + esc(n.name) + ' <span class="status-pill ' + (n.status === 'running' ? 'up' : n.status === 'paused' ? 'warn' : 'down') + '">' + esc(n.status) + '</span></b><span>' + esc(n.model) + ', telnet localhost:' + n.consolePort + '</span></div><button class="btn primary" data-connect="' + esc(n.id) + '">Connect</button></div>';
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
      title: 'Console Manager', icon: 'terminal', sub: 'Local console server',
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
      body: '<div class="capture-toolbar">' +
          '<select class="select" id="capIface">' + (opts || '<option>ge-0/0/0</option>') + '</select>' +
          '<input class="input" id="capFilter" placeholder="tcpdump filter (icmp, port 22)">' +
          '<button class="btn primary" id="capStart">Start</button><button class="btn" id="capStop" disabled>Stop</button>' +
          '<span class="console-chip" id="capCount">0 packets</span></div>' +
        '<div class="capture-scroll"><table class="data-table capture-table">' +
          '<colgroup><col class="c-time"><col class="c-src"><col class="c-dst"><col class="c-proto"><col class="c-len"><col></colgroup>' +
          '<thead><tr><th>Time</th><th>Source</th><th>Destination</th><th>Proto</th><th>Len</th><th>Info</th></tr></thead>' +
          '<tbody id="capBody"><tr class="cap-empty"><td colspan="6">No packets yet. Press Start to capture on this interface.</td></tr></tbody></table></div>' +
        '<div class="capture-detail" id="capDetail">Select a row to decode its headers.</div>',
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
          var emptyRow = body.querySelector('.cap-empty');
          if (emptyRow) emptyRow.remove();
          body.insertBefore(tr, body.firstChild);
          while (body.children.length > 80) body.removeChild(body.lastChild);
          count++; cnt.textContent = count + (count === 1 ? ' packet' : ' packets');
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
    ['Operational', 'show system information', 'Display platform model, serial, and Junos release.', 'show system information'],
    ['Operational', 'show system uptime', 'Display uptime and load averages.', 'show system uptime'],
    ['Operational', 'show system alarms', 'Display active system alarms.', 'show system alarms'],
    ['Operational', 'show chassis hardware', 'Display chassis inventory and components.', 'show chassis hardware'],
    ['Operational', 'show interfaces terse', 'Summarize interface admin/link state and addresses.', 'show interfaces terse'],
    ['Operational', 'show interfaces descriptions', 'Display configured interface descriptions.', 'show interfaces descriptions'],
    ['Operational', 'show interfaces extensive ge-0/0/0', 'Show packet and error counters per interface.', 'show interfaces extensive ge-0/0/0'],
    ['Operational', 'show arp', 'Display the ARP table.', 'show arp'],
    ['Operational', 'show route', 'Display the inet.0 routing table and preferences.', 'show route'],
    ['Operational', 'show configuration', 'Display the committed configuration.', 'show configuration'],
    ['Operational', 'show ethernet-switching table', 'Display learned MAC addresses on a switch.', 'show ethernet-switching table'],
    ['Operational', 'show vlans', 'Display configured VLANs and member interfaces.', 'show vlans'],
    ['Operational', 'show lldp neighbors', 'Display directly connected LLDP peers.', 'show lldp neighbors'],
    ['Operational', 'show route table inet.0 summary', 'Summarize routing table contents.', 'show route table inet.0 summary'],
    ['Operational', 'show route protocol static', 'Display static routes only.', 'show route protocol static'],
    ['Operational', 'show route hidden', 'Display hidden routes and reasons.', 'show route hidden'],
    ['Operational', 'show ospf neighbor', 'Display OSPF adjacency state and dead timers.', 'show ospf neighbor'],
    ['Operational', 'show ospf interface', 'Display OSPF-enabled interfaces and costs.', 'show ospf interface'],
    ['Operational', 'show ospf database', 'Display the OSPF link-state database.', 'show ospf database'],
    ['Operational', 'show bgp summary', 'Display BGP peer state per group.', 'show bgp summary'],
    ['Operational', 'show bgp neighbor', 'Display BGP session details and capabilities.', 'show bgp neighbor'],
    ['Operational', 'show bfd session', 'Display BFD sessions and detection state.', 'show bfd session'],
    ['Operational', 'show bfd session detail', 'Display BFD timers and registered clients.', 'show bfd session detail'],
    ['Operational', 'show ldp neighbor', 'Display LDP neighbors and transports.', 'show ldp neighbor'],
    ['Operational', 'show mpls interface', 'Display MPLS-enabled interfaces and label space.', 'show mpls interface'],
    ['Operational', 'show isis adjacency', 'Display IS-IS adjacencies.', 'show isis adjacency'],
    ['Operational', 'show vrrp', 'Display VRRP groups and master state.', 'show vrrp'],
    ['Operational', 'show security zones', 'Display security zones and member interfaces.', 'show security zones'],
    ['Operational', 'show security policies', 'Display security policies between zones.', 'show security policies'],
    ['Operational', 'show security policies hit-count', 'Display security policy hit counters.', 'show security policies hit-count'],
    ['Operational', 'show security flow session', 'Display active firewall flow sessions.', 'show security flow session'],
    ['Operational', 'show security nat source summary', 'Summarize source NAT rule-sets and rules.', 'show security nat source summary'],
    ['Operational', 'ping 10.0.23.2', 'Test reachability with ICMP echo requests.', 'ping 10.0.23.2'],
    ['Operational', 'traceroute 3.3.3.3', 'Trace the forwarding path to a destination.', 'traceroute 3.3.3.3'],
    ['Operational', 'show system commit', 'Display the commit history and comments.', 'show system commit'],
    ['Operational', 'file show /var/tmp/base.set', 'Display a file saved on the device.', 'file show /var/tmp/base.set'],
    ['Operational', 'monitor traffic interface ge-0/0/0', 'Capture live traffic on an interface.', 'monitor traffic interface ge-0/0/0'],
    ['Operational', 'request system reboot', 'Reboot the routing engine (simulated).', 'request system reboot'],
    ['Configuration', 'configure', 'Enter configuration mode.', 'configure'],
    ['Configuration', 'set system host-name R1', 'Configure the device hostname.', 'set system host-name R1'],
    ['Configuration', 'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30', 'Configure an interface address.', 'set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/30'],
    ['Configuration', 'set protocols ospf area 0.0.0.0 interface ge-0/0/0.0', 'Enable OSPF on an interface.', 'set protocols ospf area 0.0.0.0 interface ge-0/0/0.0'],
    ['Configuration', 'set routing-options autonomous-system 65001', 'Configure the local BGP AS number.', 'set routing-options autonomous-system 65001'],
    ['Configuration', 'set protocols bgp group EBGP type external', 'Create an external BGP peer group.', 'set protocols bgp group EBGP type external'],
    ['Configuration', 'set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT match source-address any', 'Build a security policy match (vSRX).', 'set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT match source-address any'],
    ['Configuration', 'show | compare', 'Compare candidate configuration with committed (config mode).', 'show | compare'],
    ['Configuration', 'show configuration | display set', 'Display the configuration as set commands.', 'show configuration | display set'],
    ['Configuration', 'load set terminal', 'Paste a set-style script at the terminal prompt (end with EOF).', 'load set terminal'],
    ['Configuration', 'load merge terminal', 'Merge a brace-style script at the terminal prompt (end with EOF).', 'load merge terminal'],
    ['Configuration', 'load override terminal', 'Replace the configuration with a brace-style script.', 'load override terminal'],
    ['Configuration', 'show configuration | save /var/tmp/base.set', 'Save the current configuration to a file.', 'show configuration | save /var/tmp/base.set'],
    ['Configuration', 'wildcard delete interfaces ge-9/*', 'Delete every statement matching a wildcard pattern.', 'wildcard delete interfaces ge-9/*'],
    ['Configuration', 'replace pattern OLDNAME NEWNAME', 'Replace text across the candidate configuration.', 'replace pattern OLDNAME NEWNAME'],
    ['Configuration', 'protect interfaces ge-0/0/1', 'Protect a configuration hierarchy from deletion.', 'protect interfaces ge-0/0/1'],
    ['Configuration', 'unprotect interfaces ge-0/0/1', 'Remove protection from a hierarchy.', 'unprotect interfaces ge-0/0/1'],
    ['Configuration', 'commit check', 'Validate the candidate configuration.', 'commit check'],
    ['Configuration', 'commit', 'Commit the candidate configuration.', 'commit'],
    ['Configuration', 'commit comment "baseline"', 'Commit with a change description.', 'commit comment "baseline"'],
    ['Configuration', 'commit at 23:30', 'Schedule an automatic commit for a specific time.', 'commit at 23:30'],
    ['Configuration', 'commit confirmed 5', 'Commit with automatic rollback after 5 minutes.', 'commit confirmed 5'],
    ['Configuration', 'commit synchronize', 'Synchronize the commit across routing engines.', 'commit synchronize'],
    ['Configuration', 'rollback 0', 'Discard candidate changes and load committed config (op mode).', 'rollback 0'],
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
  var LEGACY_STEPS = [
    ['Inspect the baseline', 'Open R1, R2, and R3 consoles. Run <code>show version</code>, <code>show interfaces terse</code>, and <code>show route</code>.'],
    ['Verify physical links', 'Confirm ge-0/0/0 and ge-0/0/1 are up on each router and that host-facing switch ports are active.'],
    ['Check OSPF adjacencies', 'Run <code>show ospf neighbor</code> on R1 and R2. Adjacencies should reach <code>Full</code>.'],
    ['Trace a path', 'From R1 run <code>ping 3.3.3.3</code> and <code>traceroute 3.3.3.3</code>. Note the next hop at each router.'],
    ['Make a configuration change', 'On R2: <code>configure</code>, <code>set system domain-name jncia.local</code>, <code>show | compare</code>, then <code>commit</code>.'],
    ['Practice rollback', 'Change a statement, run <code>rollback 0</code>, then inspect the configuration with <code>show</code>.'],
    ['Validate Layer 2', 'On SW1 run <code>show ethernet-switching table</code> and <code>show vlans</code> to inspect MAC learning and VLAN membership.'],
    ['Capture traffic', 'Use Node → Packet Capture or <code>monitor traffic interface ge-0/0/0</code> and identify OSPF hello packets.']
  ];

  // run one command in the console of a named device (guide + presets)
  function runCommandOnNode(devName, cmd, needCfg) {
    var node = APP.nodeByName(devName);
    if (!node) { APP.toast('Device not found: ' + devName, 'warn', 'warning'); return; }
    closeModal(true);
    var tab = APP.openConsoleById(node.id);
    if (!tab) return;
    setTimeout(function () {
      try {
        if (needCfg && tab.session && tab.session.mode === 'cli-op') tab.term.runCommand('configure', true);
        tab.term.runCommand(cmd, true);
      } catch (e) { APP.toast('Could not run command: ' + e.message, 'error', 'warning'); }
    }, 180);
  }

  function openGuide() {
    var s = APP.getState();
    var preset = APP.PRESETS[s.preset];
    var tasks = (preset && Array.isArray(preset.tasks)) ? preset.tasks : null;
    var sub, bodyHtml, firstDev, title;
    if (tasks && tasks.length) {
      title = preset.title + ' - Lab Guide';
      sub = 'Guided tasks with one-click Run, per-device console';
      firstDev = tasks[0].device;
      bodyHtml = '<p class="modal-note">Every step below runs in the live simulated CLI - the chip names the device whose console opens. Steps marked in config mode auto-enter <code>configure</code> when needed.</p><div class="guide-steps">';
      tasks.forEach(function (t) {
        var cmds = t.run.map(function (c) {
          return '<button class="guide-cmd" data-guide-run data-dev="' + esc(t.device) + '" data-cmd="' + esc(c[0]) + '" data-cfg="' + (t.sub === 'configure' ? '1' : '') + '"><code>' + esc(c[0]) + '</code><svg><use href="#i-play"></use></svg></button>';
        }).join('');
        var chip = '<span class="console-chip' + (t.sub === 'configure' ? ' guide-chip-cfg' : '') + '">' + esc(t.device) + (t.sub === 'configure' ? ' · config' : '') + '</span>';
        bodyHtml += '<div class="guide-step"><div><b>' + esc(t.title) + '</b><p>' + chip + cmds + '</p></div></div>';
      });
      bodyHtml += '</div><h3 class="guide-subhead">Free exploration</h3><p class="guide-free"><code>show configuration</code><code>show route</code><code>show interfaces terse</code><code>show system information</code></p>';
    } else {
      title = 'JNCIA Lab Guide';
      sub = 'Basic routing, OSPF, VLANs, and Junos CLI workflow';
      firstDev = 'R1';
      bodyHtml = '<p class="modal-note">This simulated lab mirrors the Juniper vLabs workflow. Configurations persist in this browser and can be exported as JSON.</p><div class="guide-steps">' +
        LEGACY_STEPS.map(function (st) { return '<div class="guide-step"><div><b>' + esc(st[0]) + '</b><p>' + st[1] + '</p></div></div>'; }).join('') +
        '</div><h3 class="guide-subhead">Useful starting commands</h3><p class="guide-free"><code>show ospf neighbor</code><code>show route</code><code>show interfaces terse</code><code>show configuration</code></p>';
    }
    openModal({
      title: title, icon: 'help', sub: sub, size: 'wide',
      body: bodyHtml,
      footer: '<button class="btn" data-modal-close>Close</button><button class="btn primary" id="guideRun">Open ' + esc(firstDev) + ' Console</button>',
      onMount: function (m) {
        $$('[data-guide-run]', m).forEach(function (b) {
          b.addEventListener('click', function () { runCommandOnNode(b.dataset.dev, b.dataset.cmd, b.dataset.cfg === '1'); });
        });
        $('#guideRun', m).addEventListener('click', function () {
          var n = APP.nodeByName(firstDev) || APP.getState().nodes[0];
          if (n) { closeModal(true); APP.openConsoleById(n.id); }
        });
      }
    });
  }
  APP.openGuide = openGuide;

  function openShortcuts() {
    var rows = [
      ['New project', 'Ctrl+N'], ['Open project', 'Ctrl+O'], ['Save project', 'Ctrl+S'], ['Save as', 'Ctrl+Shift+S'],
      ['Undo / redo', 'Ctrl+Z / Ctrl+Y'], ['Fit to screen', 'Ctrl+0'], ['Zoom in / out', 'Ctrl + / Ctrl -'],
      ['Start all nodes', 'Ctrl+Shift+U'], ['Stop all nodes', 'Ctrl+Shift+W'], ['Reload all', 'Ctrl+Shift+R'],
      ['Connect all consoles', 'Ctrl+Shift+C'], ['Open selected console', 'Ctrl+Enter'], ['Delete selection', 'Delete'],
      ['Cancel mode / close dialog', 'Esc'], ['Full screen', 'F11'], ['This dialog', '?']
    ];
    function column(list) {
      return '<div class="kbd-col">' + list.map(function (r) {
        return '<div><span>' + esc(r[0]) + '</span><kbd>' + esc(r[1]) + '</kbd></div>';
      }).join('') + '</div>';
    }
    var half = Math.ceil(rows.length / 2);
    openModal({
      title: 'Keyboard Shortcuts', icon: 'help', sub: 'Workspace navigation',
      body: '<div class="modal-kbd-cols">' + column(rows.slice(0, half)) + column(rows.slice(half)) + '</div>',
      footer: '<button class="btn" data-modal-close>Close</button>'
    });
  }
  APP.openShortcuts = openShortcuts;

  function openAbout() {
    var s = APP.getState();
    openModal({
      title: 'About SharkLab Studio', icon: 'logo', sub: 'JNCIA network simulator, standalone',
      body: '<div class="about-head"><div class="about-logo">' + icon('logo') + '</div><div class="about-copy"><h3>SharkLab Studio</h3><p>A browser-based topology workspace with an interactive Junos CLI for JNCIA practice.</p></div></div>' +
        '<table class="data-table about-table"><tbody><tr><td>Project</td><td>' + esc(s.title) + '</td></tr><tr><td>Devices</td><td>' + s.nodes.length + ' nodes, ' + s.links.length + ' links</td></tr><tr><td>Junos emulation</td><td>21.4R1 simulation engine</td></tr><tr><td>Local storage</td><td><code>' + esc(APP.STORAGE_KEY) + '</code></td></tr><tr><td>Server</td><td>127.0.0.1, Node.js static server</td></tr></tbody></table>' +
        '<p class="modal-note about-note">No external CDN assets are used. All icons and visuals are embedded or rendered locally.</p>',
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

  // ---------------------------------------------------------- device config studio
  // GUI intent designer: form -> declarative set lines -> transactional push.
  // Centralized intent (GUI) driving the same Junos model as the CLI -
  // controller-style push, per-device transaction, visible in the console.

  // Junos canonical area format: plain integers expand to dotted decimal (0 -> 0.0.0.0)
  function normOspfArea(s) {
    var t = String(s || '').trim();
    if (!t) return t;
    if (/^\d+$/.test(t)) return [t, '0', '0', '0'].join('.');
    return t;
  }

  function intentFromSetLines(rt) {    var vm = {
      hostname: '', routerId: '', localAs: '', interfaces: {}, statics: [],
      ospfOn: false, ospfArea: '0.0.0.0', ospfInts: [],
      bgpOn: false, bgpType: 'external', bgpGroup: 'EBGP', bgpBfd: false, bgExports: {}, exportProtos: {}, neighbors: [],
      zones: {}, policies: [], isSrx: false
    };
    var sess = null;
    try {
      sess = J.machine.createSession(rt, J.machine.getWorld());
      J.machine.feed(sess, 'user');
      var res = J.machine.feed(sess, 'show configuration | display set');
      var lines = (res && res.lines) || [];
      for (var i = 0; i < lines.length; i++) {
        var t = String(lines[i]).trim().split(/\s+/);
        if (t[0] !== 'set') continue;
        var rest = t.slice(1);
        var j = rest.join(' ');
        if (j.indexOf('system host-name ') === 0) { vm.hostname = rest[2]; continue; }
        if (j.indexOf('routing-options router-id ') === 0) { vm.routerId = rest[2]; continue; }
        if (j.indexOf('routing-options autonomous-system ') === 0) { vm.localAs = rest[2]; continue; }
        if (j.indexOf('routing-options static route ') === 0) {
          var dest = rest[3];
          var srow = null;
          for (var s = 0; s < vm.statics.length; s++) if (vm.statics[s].dest === dest) { srow = vm.statics[s]; break; }
          if (!srow) { srow = { dest: dest, nh: '' }; vm.statics.push(srow); }
          var ni = rest.indexOf('next-hop');
          if (ni >= 0 && rest[ni + 1]) srow.nh = rest[ni + 1];
          continue;
        }
        if (j.indexOf('protocols bgp group ') === 0) {
          var gname = rest[3];
          if (rest.length > 5 && rest[4] === 'neighbor') {
            var row2 = null;
            for (var n2 = 0; n2 < vm.neighbors.length; n2++) if (vm.neighbors[n2].group === gname && vm.neighbors[n2].ip === rest[5]) { row2 = vm.neighbors[n2]; break; }
            if (!row2) { row2 = { group: gname, ip: rest[5], peerAs: '' }; vm.neighbors.push(row2); }
            var ni2 = rest.indexOf('peer-as');
            if (ni2 > 0 && rest[ni2 + 1]) row2.peerAs = rest[ni2 + 1];
            vm.bgpOn = true;
            continue;
          }
          var sub2 = rest.slice(4).join(' ');
          if (sub2.indexOf('type ') === 0) { vm.bgpType = rest[5]; vm.bgpGroup = gname; vm.bgpOn = true; continue; }
          if (sub2.indexOf('bfd-liveness-detection') === 0) { vm.bgpBfd = true; vm.bgpOn = true; continue; }
          if (sub2.indexOf('export ') === 0) { vm.bgExports[rest[5]] = true; vm.bgpOn = true; continue; }
          continue;
        }
        if (j.indexOf('policy-options policy-statement ') === 0) {
          var pi = rest.indexOf('protocol');
          if (pi > 0 && rest[pi + 1]) vm.exportProtos[rest[pi + 1]] = rest[2];
          continue;
        }
        if (j.indexOf('protocols ospf area ') === 0) {
          vm.ospfOn = true;
          if (rest[3]) vm.ospfArea = normOspfArea(rest[3]);
          if (rest[4] === 'interface' && rest[5]) {
            var onm = rest[5].replace(/\.\d+$/, '');
            if (vm.ospfInts.indexOf(onm) < 0) vm.ospfInts.push(onm);
          }
          continue;
        }
        if (rest[0] === 'interfaces' && rest.length > 3) {
          var key3 = rest[1].replace(/\.0$/, '');
          var rec = vm.interfaces[key3] = vm.interfaces[key3] || { name: key3, desc: '', disabled: false, addr: '' };
          if (rest[2] === 'description' && rest[3]) rec.desc = rest.slice(3).join(' ');
          else if (rest[2] === 'disable') rec.disabled = true;
          else {
            var ai = rest.indexOf('address');
            if (ai >= 0 && rest[ai + 1]) rec.addr = rest[ai + 1];
          }
          continue;
        }
        if (j.indexOf('security zones security-zone ') === 0) {
          vm.isSrx = true;
          var zn = rest[3];
          var zr = vm.zones[zn] = vm.zones[zn] || { name: zn, ints: [] };
          if (rest[4] === 'interfaces' && rest[5]) {
            var iname2 = rest[5].replace(/\.0$/, '');
            if (zr.ints.indexOf(iname2) < 0) zr.ints.push(iname2);
          }
          continue;
        }
        if (j.indexOf('security policies from-zone ') === 0) {
          vm.isSrx = true;
          var fi = rest.indexOf('from-zone'), ti = rest.indexOf('to-zone'), pi = rest.indexOf('policy');
          if (fi > 0 && ti > 0 && pi > 0) {
            var prow = null, pn = rest[pi + 1] || '';
            for (var p3 = 0; p3 < vm.policies.length; p3++) if (vm.policies[p3].name === pn) { prow = vm.policies[p3]; break; }
            if (!prow) { prow = { name: pn, from: rest[fi + 1], to: rest[ti + 1], src: 'any', dst: 'any', app: 'any', action: 'permit' }; vm.policies.push(prow); }
            var mi = rest.indexOf('match');
            if (mi > 0) {
              var m1 = rest[mi + 1];
              if (m1 === 'source-address') prow.src = rest[mi + 2];
              else if (m1 === 'destination-address') prow.dst = rest[mi + 2];
              else if (m1 === 'application') prow.app = rest[mi + 2];
            }
            var th2 = rest.indexOf('then');
            if (th2 > 0 && rest[th2 + 1]) prow.action = rest[th2 + 1];
          }
          continue;
        }
      }
    } catch (e) {}
    return vm;
  }

  function buildIntentSets(f, cur) {
    var L = [];
    function setip(name, unit, fam, cidr) {
      L.push('delete interfaces ' + name + ' unit ' + unit + ' family ' + fam);
      L.push('set interfaces ' + name + ' unit ' + unit + ' family ' + fam + ' address ' + cidr);
    }
    if (f.hostname && f.hostname !== cur.hostname) L.push('set system host-name ' + f.hostname);
    if (f.routerId && f.routerId !== cur.routerId) L.push('set routing-options router-id ' + f.routerId);
    if (f.localAs && f.localAs !== cur.localAs) L.push('set routing-options autonomous-system ' + f.localAs);
    // interfaces
    for (var k in f.interfaces) {
      var fr = f.interfaces[k], cr = cur.interfaces[k] || { name: k, desc: '', disabled: false, addr: '' };
      if (fr.desc !== cr.desc) {
        if (fr.desc) L.push('set interfaces ' + k + ' description ' + fr.desc);
        else L.push('delete interfaces ' + k + ' description');
      }
      if (fr.disabled !== cr.disabled) {
        if (fr.disabled) L.push('set interfaces ' + k + ' disable');
        else L.push('delete interfaces ' + k + ' disable');
      }
      if (fr.addr && fr.addr !== cr.addr) setip(k, '0', 'inet', fr.addr);
    }
    // statics
    var curDests = {};
    cur.statics.forEach(function (r) { curDests[r.dest] = r; });
    f.statics.forEach(function (r) {
      var old = curDests[r.dest];
      if (!old) L.push('set routing-options static route ' + r.dest + ' next-hop ' + (r.nh || 'discard'));
      else if (r.nh !== old.nh) {
        L.push('delete routing-options static route ' + r.dest + ' next-hop' + (old.nh ? ' ' + old.nh : ''));
        if (r.nh) L.push('set routing-options static route ' + r.dest + ' next-hop ' + r.nh);
      }
      delete curDests[r.dest];
    });
    for (var dk in curDests) L.push('delete routing-options static route ' + dk);
    // ospf
    if (cur.ospfOn && !f.ospfOn) L.push('delete protocols ospf');
    if (f.ospfOn) {
      if (f.ospfArea) {
        var area = normOspfArea(f.ospfArea);
        f.ospfInts.forEach(function (inm) {
          if (cur.ospfInts.indexOf(inm) < 0) {
            var unit = /\.\d+$/.test(inm) ? inm : inm + '.0';
            L.push('set protocols ospf area ' + area + ' interface ' + unit);
          }
        });
      }
    }
    // bgp
    if (cur.bgpOn && !f.bgpOn) L.push('delete protocols bgp');
    else if (f.bgpOn && (f.localAs || f.neighbors.length)) {
      var grp = f.bgpGroup;
      var typeChanged = cur.bgpOn ? (cur.bgpType !== f.bgpType) : true;
      if (typeChanged) L.push('set protocols bgp group ' + grp + ' type ' + f.bgpType);
      f.neighbors.forEach(function (nr) {
        var have = cur.neighbors.some(function (c) { return c.ip === nr.ip; });
        if (!have) L.push('set protocols bgp group ' + grp + ' neighbor ' + nr.ip + (nr.peerAs ? ' peer-as ' + nr.peerAs : ''));
        else {
          var cr = cur.neighbors.filter(function (c) { return c.ip === nr.ip; })[0];
          if (nr.peerAs && nr.peerAs !== cr.peerAs) L.push('set protocols bgp group ' + grp + ' neighbor ' + nr.ip + ' peer-as ' + nr.peerAs);
        }
      });
      if (f.bgpBfd && !cur.bgpBfd) {
        L.push('set protocols bgp group ' + grp + ' bfd-liveness-detection minimum-interval 300');
        L.push('set protocols bgp group ' + grp + ' bfd-liveness-detection multiplier 3');
      }
      // exports: policy per origin protocol, referenced from the group
      var protoName = { direct: 'EXPORT-CONNECTED', static: 'EXPORT-STATIC' };
      var DIRECT = ['direct', 'static'];
      DIRECT.forEach(function (po) {
        var sel = f.exportProtos && f.exportProtos.indexOf(po) >= 0;
        var had = cur.exportProtos && cur.exportProtos[po];
        var pname = (cur.exportProtos && cur.exportProtos[po]) || protoName[po];
        if (sel && !had) {
          L.push('set policy-options policy-statement ' + pname + ' term T1 from protocol ' + po);
          L.push('set protocols bgp group ' + grp + ' export ' + pname);
        }
        if (!sel && had) {
          L.push('delete protocols bgp group ' + grp + ' export ' + pname);
          L.push('delete policy-options policy-statement ' + pname);
        }
      });
    }
    // security intent (srx)
    for (var zn in f.zones) {
      var zf = f.zones[zn], zc = cur.zones[zn];
      if (!zc) L.push('set security zones security-zone ' + zn);
      zf.ints.forEach(function (inm) {
        if (!zc || zc.ints.indexOf(inm) < 0) L.push('set security zones security-zone ' + zn + ' interfaces ' + inm);
      });
    }
    var curPols = {};
    cur.policies.forEach(function (p) { curPols[p.name] = p; });
    f.policies.forEach(function (p) {
      if (curPols[p.name]) return;
      L.push('set security policies from-zone ' + p.from + ' to-zone ' + p.to + ' policy ' + p.name + ' match source-address ' + (p.src || 'any'));
      L.push('set security policies from-zone ' + p.from + ' to-zone ' + p.to + ' policy ' + p.name + ' match destination-address ' + (p.dst || 'any'));
      L.push('set security policies from-zone ' + p.from + ' to-zone ' + p.to + ' policy ' + p.name + ' match application ' + (p.app || 'any'));
      L.push('set security policies from-zone ' + p.from + ' to-zone ' + p.to + ' policy ' + p.name + ' then ' + (p.action || 'permit'));
    });
    return L;
  }

  function openDeviceConfigurator(id) {
    var node = APP.nodeById(id);
    if (!node) return;
    if (!node.junos) {
      // host devices: IP plan is the whole story
      openModal({
        title: 'Device Configurator', icon: 'cpu', sub: node.name + ' - host intent', size: 'narrow',
        body: '<div class="cfg-row"><label>Interface IP</label><input class="input" id="hostIp" value="' + esc(node.ip || '10.0.3.20') + '" placeholder="192.168.1.10/24"></div>' +
          '<div class="cfg-row"><label>Default gateway</label><input class="input" id="hostGw" value="' + esc(node.gateway || '') + '" placeholder="192.168.1.1"></div>' +
          '<p class="modal-note">Hosts apply their address instantly (ip/gateway commands).</p>',
        footer: '<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="cfgHostApply">Apply</button>',
        onMount: function (m) {
          $('#cfgHostApply', m).addEventListener('click', function () {
            var ip = $('#hostIp', m).value.trim();
            var gw = $('#hostGw', m).value.trim();
            if (ip) node.ip = ip.split('/')[0];
            if (gw) node.gateway = gw;
            APP.renderAll(); APP.scheduleSave();
            var tab2 = APP.openConsoleById(node.id);
            if (tab2 && tab2.term) { if (gw) tab2.term.runCommand('ip ' + ip + ' ' + gw, true); }
            closeModal(true);
            APP.toast('Host intent applied', 'success', 'check');
          });
        }
      });
      return;
    }
    var rt = APP.ensureRuntime(node);
    if (!rt) { APP.toast('Runtime unavailable', 'error', 'warning'); return; }
    var cur = intentFromSetLines(rt);
    var rows = APP.getInterfaceRows(node);
    var phys = rows.filter(function (r) { return r.kind === 'phys'; });
    var f = {
      node: node, hostname: cur.hostname || node.name, routerId: cur.routerId, localAs: cur.localAs,
      interfaces: {}, statics: cur.statics.map(function (r) { return { dest: r.dest, nh: r.nh }; }),
      ospfOn: cur.ospfOn, ospfArea: cur.ospfArea || '0.0.0.0', ospfInts: cur.ospfInts.slice(),
      bgpOn: cur.bgpOn, bgpType: cur.bgpType || 'external', bgpGroup: cur.bgpGroup || 'EBGP', bgpBfd: !!cur.bgpBfd,
      exportProtos: Object.keys(cur.exportProtos || {}), neighbors: cur.neighbors.map(function (n) { return { ip: n.ip, peerAs: n.peerAs }; }),
      zones: {}, policies: cur.policies.map(function (p) { return { name: p.name, from: p.from, to: p.to, src: p.src, dst: p.dst, app: p.app, action: p.action }; })
    };
    for (var k in cur.interfaces) f.interfaces[k] = { desc: cur.interfaces[k].desc, disabled: cur.interfaces[k].disabled, addr: cur.interfaces[k].addr };
    for (var z in cur.zones) f.zones[z] = { name: z, ints: cur.zones[z].ints.slice() };
    if (cur.isSrx && !Object.keys(f.zones).length && phys.length) f.zones['TRUST'] = { name: 'TRUST', ints: [] };

    function chipHtml(on, name) { return '<button type="button" class="cfg-chip' + (on ? ' sel' : '') + '" data-chip="' + esc(name) + '">' + esc(name) + '</button>'; }

    var intsHtml = '';
    if (!phys.length) intsHtml = '<p class="modal-note">No physical interfaces on this device.</p>';
    else phys.forEach(function (r) {
      var fi = f.interfaces[r.name] || { desc: '', disabled: false, addr: '' };
      intsHtml += '<div class="cfg-grid" data-introw="' + esc(r.name) + '">' +
        '<span class="cfg-name mono">' + esc(r.name) + '</span>' +
        '<input class="input cfg-mini" data-if="desc" placeholder="Description" value="' + esc(fi.desc) + '">' +
        '<input class="input cfg-mini mono" data-if="addr" placeholder="10.0.3.1/24" value="' + esc(fi.addr) + '">' +
        '<span class="cfg-up"><input type="checkbox" data-if="disabled"' + (fi.disabled ? ' checked' : '') + '> <span>shutdown</span></span>' +
        '</div>';
    });
    var statHtml = f.statics.map(function (r, idx) {
      return '<div class="cfg-grid cfg-3col" data-srow="' + idx + '"><input class="input cfg-mini mono" data-st="dest" placeholder="10.99.0.0/24" value="' + esc(r.dest) + '"><input class="input cfg-mini" data-st="nh" placeholder="next-hop / discard" value="' + esc(r.nh) + '"><button class="icon-btn cfg-del" data-row-del="static" title="Remove route">' + icon('trash') + '</button></div>';
    }).join('');
    var ospfChips = phys.map(function (r) { return chipHtml(f.ospfInts.indexOf(r.name) >= 0, r.name); }).join(' ');
    var nbrHtml = f.neighbors.map(function (n, idx) {
      return '<div class="cfg-grid cfg-3col" data-nrow="' + idx + '"><input class="input cfg-mini mono" data-nb="ip" placeholder="10.0.12.2" value="' + esc(n.ip) + '"><input class="input cfg-mini mono" data-nb="peerAs" placeholder="65002" value="' + esc(n.peerAs) + '"><button class="icon-btn cfg-del" data-row-del="nbr" title="Remove neighbor">' + icon('trash') + '</button></div>';
    }).join('');
    var zoneHtml = '', polHtml = '';
    if (cur.isSrx) {
      zoneHtml = Object.keys(f.zones).map(function (zn) {
        var chips = phys.map(function (r) { return chipHtml(f.zones[zn].ints.indexOf(r.name) >= 0, r.name); }).join(' ');
        return '<div class="cfg-sec-sub"><b>' + esc(zn) + '</b><div class="cfg-chips" data-zone-chips="' + esc(zn) + '">' + chips + '</div></div>';
      }).join('');
      polHtml = f.policies.map(function (p, idx) {
        return '<div class="cfg-grid cfg-pol" data-prow="' + idx + '">' +
          '<input class="input cfg-mini" data-po="name" placeholder="POLICY-NAME" value="' + esc(p.name) + '">' +
          '<input class="input cfg-mini" data-po="src" placeholder="source, any" value="' + esc(p.src) + '">' +
          '<input class="input cfg-mini" data-po="dst" placeholder="dest, any" value="' + esc(p.dst) + '">' +
          '<select class="input cfg-mini" data-po="action"><option value="permit"' + (p.action !== 'deny' ? ' selected' : '') + '>permit</option><option value="deny"' + (p.action === 'deny' ? ' selected' : '') + '>deny</option></select>' +
          '<button class="icon-btn cfg-del" data-row-del="pol" title="Remove policy">' + icon('trash') + '</button></div>';
      }).join('');
    }
    var body =
      '<div class="cfg-sec">System</div>' +
      '<div class="cfg-row"><label>host-name</label><input class="input cfg-mini" data-cfg="hostname" value="' + esc(f.hostname) + '"></div>' +
      '<div class="cfg-row"><label>router-id</label><input class="input cfg-mini mono" data-cfg="routerId" placeholder="1.1.1.1" value="' + esc(f.routerId) + '"></div>' +
      '<div class="cfg-sec">Interfaces</div>' + intsHtml +
      '<div class="cfg-sec">Static routes <button class="btn tiny" data-add="static" style="margin-left:auto">' + icon('plus') + ' Route</button></div><div data-list="static">' + statHtml + '</div>' +
      '<div class="cfg-sec">OSPF</div>' +
      '<div class="cfg-row"><label>Enabled, area</label><span><input type="checkbox" data-cfg="ospfOn"' + (f.ospfOn ? ' checked' : '') + '> <input class="input cfg-mini mono" data-cfg="ospfArea" style="width:90px" value="' + esc(f.ospfArea) + '"></span></div>' +
      '<div class="cfg-row"><label>Interfaces</label><span class="cfg-chips" data-chipset="ospf">' + ospfChips + '</span></div>' +
      '<div class="cfg-sec">BGP <span class="cfg-inline-check"><input type="checkbox" data-cfg="bgpOn"' + (f.bgpOn ? ' checked' : '') + '> enabled</span><label>local AS</label><input class="input cfg-mini mono" data-cfg="localAs" placeholder="65001" style="width:90px" value="' + esc(f.localAs) + '"></div>' +
      '<div class="cfg-row"><label>Group type</label><span><select class="input cfg-mini" data-cfg="bgpType" style="width:120px"><option value="external"' + (f.bgpType !== 'internal' ? ' selected' : '') + '>external</option><option value="internal"' + (f.bgpType === 'internal' ? ' selected' : '') + '>internal</option></select><span class="cfg-inline-check"><input type="checkbox" data-cfg="bgpBfd"' + (f.bgpBfd ? ' checked' : '') + '> BFD</span></span></div>' +
      '<div data-list="nbr">' + nbrHtml + '</div><button class="btn tiny" data-add="nbr" style="margin:4px 0 10px">' + icon('plus') + ' Neighbor</button>' +
      '<div class="cfg-row"><label>Export policies</label><span class="cfg-chips" data-chipset="exports">' + chipHtml(f.exportProtos.indexOf('direct') >= 0, 'direct') + ' ' + chipHtml(f.exportProtos.indexOf('static') >= 0, 'static') + '</span></div>' +
      (cur.isSrx ?
        '<div class="cfg-sec">Security zones</div>' + zoneHtml +
        '<div class="cfg-sec">Security policies <button class="btn tiny" data-add="pol" style="margin-left:auto">' + icon('plus') + ' Policy</button></div><div data-list="pol">' + polHtml + '</div>' : '') +
      '<div class="cfg-sec">Intent preview</div>' +
      '<pre class="set-preview" id="cfgPreview">(no changes yet)</pre>';
    openModal({
      title: 'Device Configurator', icon: 'cpu', sub: esc(node.name) + ' - GUI intent, pushed as a Junos transaction',
      body: body,
      footer: '<button class="btn" data-modal-close>Cancel</button><button class="btn" id="cfgRollback">Rollback</button><button class="btn primary" id="cfgApply">Apply Intent</button>',
      onMount: function (m) {
        function syncPreview() {
          var L = collectForm();
          var sets = buildIntentSets(L, cur);
          $('#cfgPreview', m).textContent = sets.length ? sets.join('\n') : '(no changes yet)';
        }
        function collectForm() {
          // start from the working tree of inputs
          var L = {
            hostname: $('[data-cfg=hostname]', m) ? $('[data-cfg=hostname]', m).value.trim() : '',
            routerId: $('[data-cfg=routerId]', m) ? $('[data-cfg=routerId]', m).value.trim() : '',
            localAs: $('[data-cfg=localAs]', m) ? $('[data-cfg=localAs]', m).value.trim() : '',
            ospfOn: !!($('[data-cfg=ospfOn]', m) && $('[data-cfg=ospfOn]', m).checked),
            ospfArea: $('[data-cfg=ospfArea]', m) ? $('[data-cfg=ospfArea]', m).value.trim() : '',
            ospfInts: [],
            bgpOn: !!($('[data-cfg=bgpOn]', m) && $('[data-cfg=bgpOn]', m).checked),
            bgpType: $('[data-cfg=bgpType]', m) ? $('[data-cfg=bgpType]', m).value : f.bgpType,
            bgpGroup: f.bgpGroup,
            bgpBfd: !!($('[data-cfg=bgpBfd]', m) && $('[data-cfg=bgpBfd]', m).checked),
            exportProtos: [],
            interfaces: {}, statics: [], neighbors: [], zones: {}, policies: []
          };
          $$('.cfg-chips[data-chipset=ospf] .cfg-chip.sel', m).forEach(function (c) { L.ospfInts.push(c.dataset.chip); });
          $$('.cfg-chips[data-chipset=exports] .cfg-chip.sel', m).forEach(function (c) { L.exportProtos.push(c.dataset.chip); });
          $$('[data-introw]', m).forEach(function (row) {
            var name = row.dataset.introw;
            L.interfaces[name] = {
              desc: $('[data-if=desc]', row).value.trim(),
              addr: $('[data-if=addr]', row).value.trim(),
              disabled: $('[data-if=disabled]', row).checked
            };
          });
          $$('[data-srow]', m).forEach(function (row) {
            var d = $('[data-st=dest]', row).value.trim(), n = $('[data-st=nh]', row).value.trim();
            if (d) L.statics.push({ dest: d, nh: n });
          });
          $$('[data-nrow]', m).forEach(function (row) {
            var ip = $('[data-nb=ip]', row).value.trim(), pa = $('[data-nb=peerAs]', row).value.trim();
            if (ip) L.neighbors.push({ ip: ip, peerAs: pa });
          });
          $$('[data-zone-chips]', m).forEach(function (z) {
            var zn = z.dataset.zoneChips;
            var ints = [];
            $$('.cfg-chip.sel', z).forEach(function (c) { ints.push(c.dataset.chip); });
            L.zones[zn] = { name: zn, ints: ints };
          });
          $$('[data-prow]', m).forEach(function (row) {
            var nm = $('[data-po=name]', row).value.trim();
            if (!nm) return;
            L.policies.push({ name: nm, from: 'TRUST', to: 'UNTRUST', src: $('[data-po=src]', row).value.trim() || 'any', dst: $('[data-po=dst]', row).value.trim() || 'any', app: 'any', action: $('[data-po=action]', row).value });
          });
          return L;
        }
        // live bindings
        $$('.input, input[type=checkbox], .cfg-chip', m).forEach(function (el) {
          el.addEventListener('input', syncPreview);
          el.addEventListener('change', syncPreview);
        });
        $$('[data-chip]', m).forEach(function (c) {
          c.addEventListener('click', function (e) { e.preventDefault(); c.classList.toggle('sel'); syncPreview(); });
        });
        $$('[data-add=static]', m).forEach(function (b) {
          b.addEventListener('click', function () {
            var wrap = $('[data-list=static]', m);
            wrap.insertAdjacentHTML('beforeend', '<div class="cfg-grid cfg-3col" data-srow="new"><input class="input cfg-mini mono" data-st="dest" placeholder="10.99.0.0/24"><input class="input cfg-mini" data-st="nh" placeholder="next-hop / discard"><button class="icon-btn cfg-del" data-row-del="static">' + icon('trash') + '</button></div>');
            bindDynamic();
          });
        });
        $$('[data-add=nbr]', m).forEach(function (b) {
          b.addEventListener('click', function () {
            var wrap = $('[data-list=nbr]', m);
            wrap.insertAdjacentHTML('beforeend', '<div class="cfg-grid cfg-3col" data-nrow="new"><input class="input cfg-mini mono" data-nb="ip" placeholder="10.0.x.2/30"><input class="input cfg-mini mono" data-nb="peerAs" placeholder="65002"><button class="icon-btn cfg-del" data-row-del="nbr">' + icon('trash') + '</button></div>');
            bindDynamic();
          });
        });
        if ($('[data-add=pol]', m)) $('[data-add=pol]', m).addEventListener('click', function () {
          var wrap = $('[data-list=pol]', m);
          wrap.insertAdjacentHTML('beforeend', '<div class="cfg-grid cfg-pol" data-prow="new"><input class="input cfg-mini" data-po="name" placeholder="POLICY-NAME"><input class="input cfg-mini" data-po="src" placeholder="source, any"><input class="input cfg-mini" data-po="dst" placeholder="dest, any"><select class="input cfg-mini" data-po="action"><option value="permit">permit</option><option value="deny">deny</option></select><button class="icon-btn cfg-del" data-row-del="pol">' + icon('trash') + '</button></div>');
          bindDynamic();
        });
        function bindDynamic() {
          $$('[data-row-del]', m).forEach(function (dl) {
            if (dl.dataset.bound) return;
            dl.dataset.bound = '1';
            dl.addEventListener('click', function () {
              var row = dl.closest('[data-srow],[data-nrow],[data-prow]');
              if (row) { row.remove(); syncPreview(); }
            });
          });
        }
        bindDynamic();
        syncPreview();
        $('#cfgRollback', m).addEventListener('click', function () {
          closeModal(true);
          if (APP.pushConfig) APP.pushConfig(node, ['rollback 1']);
        });
        $('#cfgApply', m).addEventListener('click', function () {
          var L = collectForm();
          var sets = buildIntentSets(L, cur);
          if (!sets.length) { APP.toast('No intent changes to apply', 'info', 'check'); return; }
          closeModal(true);
          if (APP.pushConfig) APP.pushConfig(node, sets);
          APP.rebuildWorld(); APP.renderAll(); APP.scheduleSave();
        });
      }
    });
  }
  APP.openDeviceConfigurator = openDeviceConfigurator;

  // ---------------------------------------------------------- fleet intent (SDN push)
  function openFleetIntent() {
    var nodes = APP.getState().nodes.filter(function (n) { return n.junos; });
    if (!nodes.length) { APP.toast('No Junos devices in the topology', 'warn', 'warning'); return; }
    var checkHtml = nodes.map(function (n, i) {
      return '<span class="cfg-inline-check"><input type="checkbox" data-fleet-node="' + esc(n.name) + '"' + (i === 0 ? ' checked' : '') + '> ' + esc(n.name) + '</span>';
    }).join(' ');
    var body =
      '<div class="cfg-sec">Management baseline</div>' +
      '<div class="cfg-row"><label>NTP server</label><input class="input cfg-mini" id="flNtp" placeholder="10.99.0.99"></div>' +
      '<div class="cfg-row"><label>DNS server</label><input class="input cfg-mini" id="flDns" placeholder="10.99.0.98"></div>' +
      '<div class="cfg-row"><label>Syslog host</label><input class="input cfg-mini" id="flSys" placeholder="10.99.0.97"></div>' +
      '<div class="cfg-row"><label>Time zone</label><input class="input cfg-mini" id="flTz" placeholder="UTC"></div>' +
      '<div class="cfg-row"><label>Include baseline</label><span class="cfg-inline-check"><input type="checkbox" id="flMgmtChk" checked> push these settings with the intent</span></div>' +
      '<div class="cfg-sec">Targets</div>' +
      '<div class="fleet-targets">' + checkHtml + '</div>' +
      '<p class="modal-note">One declarative intent, one push. Each device receives its own transaction: configure, set lines, commit. The audit trail stays visible in its console.</p>';
    openModal({
      title: 'Fleet Intent', icon: 'network', sub: 'Centralized config push across devices',
      body: body,
      footer: '<button class="btn" data-modal-close>Cancel</button><button class="btn primary" id="flApply">Apply to Fleet</button>',
      onMount: function (m) {
        $('#flApply', m).addEventListener('click', function () {
          var targets = $$('[data-fleet-node]', m).filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.fleetNode; });
          if (!targets.length) { APP.toast('Select at least one device', 'warn', 'warning'); return; }
          var mgmt = [];
          if ($('#flMgmtChk', m).checked) {
            var ntp = $('#flNtp', m).value.trim(), dns = $('#flDns', m).value.trim(), sys = $('#flSys', m).value.trim(), tz = $('#flTz', m).value.trim();
            if (ntp) { mgmt.push('set system ntp server ' + ntp); }
            if (dns) { mgmt.push('set system name-server ' + dns); }
            if (sys) { mgmt.push('set system syslog host ' + sys + ' any info'); }
            if (tz) { mgmt.push('set system time-zone ' + tz); }
          }
          if (!mgmt.length) { APP.toast('Nothing to push - fill at least one baseline field', 'info', 'check'); return; }
          closeModal(true);
          var pushed = 0;
          targets.forEach(function (name) {
            var node = APP.nodeByName ? APP.nodeByName(name) : APP.getState().nodes.filter(function (n) { return n.name === name; })[0];
            if (node && node.junos && APP.pushConfig) { APP.pushConfig(node, mgmt); pushed++; }
          });
          APP.rebuildWorld(); APP.renderAll(); APP.scheduleSave();
          APP.setStatus('Fleet intent pushed to ' + pushed + '/' + targets.length + ' devices');
        });
      }
    });
  }
  APP.openFleetIntent = openFleetIntent;

  APP.initModals = function () { bindBackdrop(); };

})(typeof window !== 'undefined' ? window : globalThis);
