(function (global) {
  'use strict';
  var J = global.JJ;

  // Junos-like schema for parsing and validation of common JNCIA commands/config
  var SCHEMA = {
    op: {
      show: {
        interfaces: { hasTerse: true, hasBrief: true, hasDetail: true, hasExtensive: true },
        route: { protocols: ['inet', 'inet.0'] },
        ospf: { sub: ['neighbor', 'interface', 'database', 'route', 'overview', 'statistics'] },
        bgp: { sub: ['summary', 'neighbor'] },
        arp: {},
        lldp: { sub: ['neighbors'] },
        vlans: {},
        'ethernet-switching': { sub: ['table'] },
        'spanning-tree': { sub: ['bridge', 'interface'] },
        version: {},
        system: { sub: ['uptime', 'commit', 'storage'] },
        chassis: { sub: ['hardware', 'routing-engine', 'alarms', 'environment', 'fpc'] },
        configuration: { hasCompare: true }
      },
      ping: { takesHost: true },
      traceroute: { takesHost: true },
      ssh: { takesHost: true },
      telnet: { takesHost: true },
      configure: {},
      'request': { sub: ['support', 'system'] },
      'start': { sub: ['shell'] },
      'file': { sub: ['list', 'show'] },
      clear: {}
    },
    config: {
      top: ['system', 'interfaces', 'protocols', 'routing-options', 'policy-options', 'firewall', 'vlans', 'groups'],
      keywords: {
        set: true, delete: true, edit: true, top: true, up: true, exit: true,
        deactivate: true, activate: true, rename: true, copy: true, annotate: true,
        commit: true, rollback: true, run: true, show: true, status: true
      }
    }
  };

  var api = { SCHEMA: SCHEMA };
  global.JJ = global.JJ || {};
  global.JJ.schema = api;
})(typeof window !== 'undefined' ? window : globalThis);
