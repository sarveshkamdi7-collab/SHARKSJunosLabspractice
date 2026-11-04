(function (global) {
  'use strict';

  var J = global.JJ || {};
  var CRLF = '\r\n';

  function ipv4ToInt(value) {
    var parts = String(value == null ? '' : value).split('.');
    if (parts.length !== 4) return null;
    var result = 0;
    for (var i = 0; i < parts.length; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) return null;
      var octet = Number(parts[i]);
      if (octet < 0 || octet > 255) return null;
      result = result * 256 + octet;
    }
    return result >>> 0;
  }

  function intToIpv4(value) {
    return [16777216, 65536, 256, 1].map(function (div) {
      return Math.floor(value / div) % 256;
    }).join('.');
  }

  function maskForCidr(cidr) {
    var bits = Math.max(0, Math.min(32, cidr));
    var mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return intToIpv4(mask);
  }

  function cidrForMask(mask) {
    var value = ipv4ToInt(mask);
    if (value === null) return null;
    var count = 0;
    var seenZero = false;
    for (var bit = 31; bit >= 0; bit--) {
      var set = ((value >>> bit) & 1) === 1;
      if (set && seenZero) return null;
      if (set) count++;
      else seenZero = true;
    }
    return count;
  }

  function parseCidr(value) {
    var parts = String(value == null ? '' : value).split('/');
    if (parts.length !== 2) return null;
    if (ipv4ToInt(parts[0]) === null) return null;
    if (!/^\d{1,2}$/.test(parts[1])) return null;
    var cidr = Number(parts[1]);
    if (!Number.isInteger(cidr) || cidr < 0 || cidr > 32) return null;
    return { ip: parts[0], cidr: cidr, mask: maskForCidr(cidr) };
  }

  function networkOf(address, cidr) {
    var value = ipv4ToInt(address);
    if (value === null) return null;
    var mask = cidr === 0 ? 0 : (0xffffffff << (32 - cidr)) >>> 0;
    return intToIpv4((value & mask) >>> 0);
  }

  function normalizeMac(value) {
    var cleaned = String(value == null ? '' : value).replace(/[^0-9a-f]/gi, '').toLowerCase();
    if (cleaned.length !== 12) return String(value || '').toLowerCase();
    return cleaned.match(/.{2}/g).join(':');
  }

  function defaultMac(seed) {
    var hash = 0;
    var text = String(seed || 'pc');
    for (var i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    var last = hash % 256;
    return '00:50:79:66:68:' + ('0' + last.toString(16)).slice(-2);
  }

  function splitLines(text) {
    return String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  }

  function VPCSEngine(options) {
    options = options || {};
    this.id = options.id || options.nodeId || 'host';
    this.name = options.name || 'Host-A';
    this.mac = normalizeMac(options.mac || defaultMac(this.id));
    this.ip = '0.0.0.0';
    this.cidr = 0;
    this.gateway = '0.0.0.0';
    this.arpCache = null;

    var sourceIp = options.ip;
    if (sourceIp) {
      var parsed = parseCidr(String(sourceIp).indexOf('/') >= 0 ? sourceIp : sourceIp + '/24');
      if (parsed) {
        this.ip = parsed.ip;
        this.cidr = parsed.cidr;
      }
    }
    if (options.cidr) this.cidr = Math.max(0, Math.min(32, Number(options.cidr)));
    if (options.mask) {
      var maskCidr = cidrForMask(options.mask);
      if (maskCidr !== null) this.cidr = maskCidr;
    }
    if (options.gateway && ipv4ToInt(options.gateway) !== null) this.gateway = options.gateway;
  }

  VPCSEngine.prototype.prompt = function () { return this.name + '> '; };
  VPCSEngine.prototype.mask = function () { return maskForCidr(this.cidr); };
  VPCSEngine.prototype.addr = function () { return this.ip + '/' + this.cidr; };

  VPCSEngine.prototype.reset = function () {
    this.ip = '0.0.0.0';
    this.cidr = 0;
    this.gateway = '0.0.0.0';
    this.mac = defaultMac(this.id);
    this.arpCache = null;
  };

  VPCSEngine.prototype.showIp = function () {
    return [
      'NAME        : ' + this.name,
      'IP/MASK     : ' + this.addr(),
      'GATEWAY     : ' + this.gateway,
      'DNS         : 0.0.0.0',
      'MAC         : ' + this.mac,
      'DHCP        : OFF'
    ];
  };

  VPCSEngine.prototype.ensureArp = function () {
    if (this.arpCache) return this.arpCache;
    this.arpCache = {};
    if (this.gateway !== '0.0.0.0') {
      this.arpCache[this.gateway] = { mac: this.mac, iface: 'eth0' };
    }
    return this.arpCache;
  };

  VPCSEngine.prototype.arpLines = function () {
    var lines = ['Address                  HWtype  HWaddress           Flags Mask            Iface'];
    var cache = this.ensureArp();
    Object.keys(cache).forEach(function (address) {
      var entry = cache[address];
      lines.push(address + '                ether   ' + entry.mac + '   C     -               ' + entry.iface);
    });
    return lines;
  };

  VPCSEngine.prototype.clearArp = function () {
    this.arpCache = {};
    return { lines: [] };
  };

  VPCSEngine.prototype.tracePlan = function (tokens) {
    if (!tokens.length) return { error: 'trace: missing address' };
    if (ipv4ToInt(tokens[0]) === null) return { error: 'trace: invalid address ' + tokens[0] };
    return { trace: tokens[0] };
  };

  VPCSEngine.prototype.routeLines = function () {
    if (this.ip === '0.0.0.0') return ['No route configured.'];
    var lines = ['C ' + networkOf(this.ip, this.cidr) + '/' + this.cidr + ' is directly connected, eth0'];
    if (this.gateway !== '0.0.0.0') lines.push('S* 0.0.0.0/0 via ' + this.gateway + ', eth0');
    return lines;
  };

  VPCSEngine.prototype.setIp = function (tokens) {
    var parsed = parseCidr(tokens[0]);
    if (parsed) {
      var gw = tokens[1];
      if (gw !== undefined && ipv4ToInt(gw) === null) return { error: 'ip: invalid gateway ' + gw };
      this.ip = parsed.ip;
      this.cidr = parsed.cidr;
      if (gw !== undefined) this.gateway = gw;
      this.arpCache = null;
      return { lines: ['IP address configured: ' + this.addr() + (this.gateway !== '0.0.0.0' ? ' gateway ' + this.gateway : '')] };
    }

    var address = tokens[0];
    var mask = tokens[1];
    var gateway = tokens[2];
    if (ipv4ToInt(address) === null || mask === undefined) {
      return { error: 'ip: usage: ip <address>/<cidr> [gateway]' };
    }
    var cidr = cidrForMask(mask);
    if (cidr === null) return { error: 'ip: invalid mask ' + mask };
    if (gateway !== undefined && ipv4ToInt(gateway) === null) return { error: 'ip: invalid gateway ' + gateway };
    this.ip = address;
    this.cidr = cidr;
    if (gateway !== undefined) this.gateway = gateway;
    this.arpCache = null;
    return { lines: ['IP address configured: ' + this.addr() + (this.gateway !== '0.0.0.0' ? ' gateway ' + this.gateway : '')] };
  };

  VPCSEngine.prototype.pingPlan = function (tokens) {
    if (!tokens.length) return { error: 'ping: missing address' };
    var target = tokens[0];
    if (ipv4ToInt(target) === null) return { error: 'ping: invalid address ' + target };
    var count = 5;
    for (var i = 1; i < tokens.length; i++) {
      var token = String(tokens[i]).toLowerCase();
      if (token === '-c' || token === 'count') {
        var parsed = Number(tokens[i + 1]);
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return { error: 'ping: invalid count' };
        count = parsed;
        i++;
      } else {
        return { error: 'ping: unknown option ' + tokens[i] };
      }
    }
    if (this.ip === '0.0.0.0') return { error: "Can't ping: IP address not configured" };

    var localNetwork = networkOf(this.ip, this.cidr);
    var remoteNetwork = networkOf(target, this.cidr);
    var direct = localNetwork !== null && remoteNetwork !== null && localNetwork === remoteNetwork;
    var viaGateway = this.gateway !== '0.0.0.0';
    var reachable = direct || viaGateway;

    var times = [];
    if (reachable) {
      for (var seq = 1; seq <= count; seq++) times.push(0.412 + seq * 0.037);
    }
    return {
      target: target,
      count: count,
      reachable: reachable,
      direct: direct,
      times: times
    };
  };

  VPCSEngine.prototype.execute = function (rawCmd) {
    var raw = String(rawCmd == null ? '' : rawCmd).replace(/[\r\n]+/g, ' ').trim();
    if (!raw) return { lines: [] };
    var tokens = raw.split(/\s+/);
    var command = tokens[0].toLowerCase();
    var rest = tokens.slice(1);

    if (command === 'help' || command === '?') {
      return {
        lines: [
          'VPCS commands:',
          '  ip <address>/<cidr> [gateway] Configure the IPv4 address',
          '  show ip                        Show host information',
          '  ping <host> [-c count]         Ping a host',
          '  trace <host>                   Trace the route to a host',
          '  clear arp                      Clear the ARP cache',
          '  help, ?                        Show this command list'
        ]
      };
    }

    if (command === 'clear') {
      if (!rest.length) return { clear: true };
      if (String(rest[0]).toLowerCase() === 'arp' && rest.length === 1) return this.clearArp();
      return { error: command + ': command not found' };
    }
    if (command === 'quit' || command === 'exit') return { quit: true, lines: ['Goodbye'] };

    if (command === 'show') {
      var sub = (rest[0] || 'ip').toLowerCase();
      if (sub === 'ip' && rest.length <= 1) return { lines: this.showIp() };
      return { error: command + ': command not found' };
    }

    if (command === 'ip') {
      if (!rest.length) return { lines: this.showIp() };
      return this.setIp(rest);
    }

    if (command === 'ping') return { ping: this.pingPlan(rest) };
    if (command === 'trace' || command === 'traceroute') return this.tracePlan(rest);

    return { error: command + ': command not found' };
  };

  VPCSEngine.COMMANDS = ['ip', 'show ip', 'ping', 'trace', 'clear arp', 'help', '?'];

  VPCSEngine.prototype.pingLines = function (plan, sequence) {
    var line;
    if (plan.reachable) {
      line = '84 bytes from ' + plan.target + ' icmp_seq=' + sequence + ' ttl=64 time=' + plan.times[sequence - 1].toFixed(3) + ' ms';
    } else {
      line = 'Request timeout for icmp_seq ' + sequence;
    }
    return line;
  };

  VPCSEngine.prototype.pingSummary = function (plan) {
    if (!plan.reachable) {
      return [
        '',
        '--- ' + plan.target + ' ping statistics ---',
        plan.count + ' packets transmitted, 0 packets received, 100% packet loss'
      ];
    }
    var min = Math.min.apply(null, plan.times);
    var max = Math.max.apply(null, plan.times);
    var sum = plan.times.reduce(function (a, b) { return a + b; }, 0);
    var avg = sum / plan.times.length;
    var variance = plan.times.reduce(function (a, b) { return a + Math.pow(b - avg, 2); }, 0) / plan.times.length;
    var stddev = Math.sqrt(variance);
    return [
      '',
      '--- ' + plan.target + ' ping statistics ---',
      plan.count + ' packets transmitted, ' + plan.count + ' packets received, 0% packet loss',
      'round-trip min/avg/max/stddev = ' + min.toFixed(3) + '/' + avg.toFixed(3) + '/' + max.toFixed(3) + '/' + stddev.toFixed(3) + ' ms'
    ];
  };

  function createEngine(options) { return new VPCSEngine(options); }

  J.vpcs = {
    VPCSEngine: VPCSEngine,
    createEngine: createEngine,
    splitLines: splitLines,
    ipv4ToInt: ipv4ToInt,
    intToIpv4: intToIpv4,
    maskForCidr: maskForCidr,
    cidrForMask: cidrForMask,
    parseCidr: parseCidr,
    networkOf: networkOf,
    defaultMac: defaultMac,
    COMMANDS: VPCSEngine.COMMANDS,
    CRLF: CRLF
  };
})(typeof window !== 'undefined' ? window : globalThis);
