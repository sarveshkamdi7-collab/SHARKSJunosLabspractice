(function (global) {
  'use strict';

  var J = global.JJ || {};
  var APP = (J.app = J.app || {});

  function createVpcs(host, opts) {
    opts = opts || {};
    var node;
    if (typeof opts === 'string') {
      var name = opts;
      node = {
        id: 'host-' + name, name: name, type: 'host', icon: 'pc', model: 'VPCS',
        vendor: 'Virtual PC', junos: false, platform: '', status: 'running',
        consolePort: 5005, ip: name === 'Host-B' ? '10.1.1.20' : '10.0.3.20',
        gateway: name === 'Host-B' ? '10.1.1.2' : '10.0.3.1'
      };
    } else {
      node = opts.node || (APP.nodeById && APP.nodeById(opts.nodeId)) || { name: 'Host', junos: false };
    }
    node = Object.assign({}, node, { junos: false, type: 'host', icon: 'pc' });
    opts.node = node;
    opts.banner = opts.banner !== false;
    return J.ui.console.createConsole(host, opts);
  }

  J.ui = J.ui || {};
  J.ui.vpcs = { createVpcs: createVpcs };
})(typeof window !== 'undefined' ? window : globalThis);
