(function (global) {
  'use strict';

  function padR(s, n) {
    s = s === undefined || s === null ? '' : String(s);
    while (s.length < n) s += ' ';
    return s;
  }

  function padL(s, n) {
    s = s === undefined || s === null ? '' : String(s);
    while (s.length < n) s = ' ' + s;
    return s;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function ipToInt(ip) {
    var parts = String(ip).split('.');
    var n = 0;
    for (var i = 0; i < 4; i++) {
      n = n * 256 + (parseInt(parts[i], 10) || 0);
    }
    return n;
  }

  function intToIp(n) {
    var ip = [];
    for (var i = 3; i >= 0; i--) {
      ip.push((n >> (i * 8)) & 255);
    }
    return ip.join('.');
  }

  function ipLen(ip) {
    var d = /^[\d.]+(\/\d+)?$/.exec(ip), dots = 0;
    for (var i = 0; i < ip.length; i++) if (ip[i] === '.') dots++;
    return dots + 1;
  }

  function mask2int(bits) {
    bits = Math.max(0, Math.min(32, parseInt(bits, 10) || 0));
    if (bits === 0) return 0;
    return ((0xFFFFFFFF << (32 - bits)) >>> 0);
  }

  function netOf(ipCidr) {
    var m = /^([\d.]+)\/(\d+)$/.exec(ipCidr);
    if (!m) return null;
    var ip = ipToInt(m[1]);
    var bits = parseInt(m[2], 10);
    var mask = mask2int(bits);
    var net = (ip & mask) >>> 0;
    return intToIp(net) + '/' + bits;
  }

  function cidrHost(app, ipCidr) {
    var m = /^([\d.]+)\/(\d+)$/.exec(ipCidr);
    if (!m) return null;
    var ip = ipToInt(m[1]);
    var bits = parseInt(m[2], 10);
    var size = bits >= 31 ? 2 : Math.pow(2, 32 - bits);
    var broadcast = (ip | (~mask2int(bits) >>> 0)) >>> 0;
    var last = size > 2 ? broadcast - 1 : broadcast;
    var host = app > 0 ? (ip + app) : (size > 2 ? last : ip);
    return intToIp(host);
  }

  function cidrBroadcast(ipCidr) {
    var m = /^([\d.]+)\/(\d+)$/.exec(ipCidr);
    if (!m) return null;
    var ip = ipToInt(m[1]);
    var bits = parseInt(m[2], 10);
    var bc = (ip | (~mask2int(bits) >>> 0)) >>> 0;
    return intToIp(bc);
  }

  function parseIp(ip) {
    var m = /^([\d.]+)(?:\/(\d+))?$/.exec(String(ip));
    if (!m) return null;
    var parts = String(m[1]).split('.');
    if (parts.length !== 4) return null;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(parts[i]) || parseInt(parts[i], 10) > 255) return null;
    }
    return { ip: m[1], prefix: m[2] === undefined ? null : parseInt(m[2], 10) };
  }

  function inNet(ip, netCidr) {
    var n = parseIp(netCidr);
    var c = parseIp(ip);
    if (!n || !c || n.prefix === null) return false;
    var mask = mask2int(n.prefix);
    return ((ipToInt(c.ip) & mask) >>> 0) === ((ipToInt(n.ip) & mask) >>> 0);
  }

  function sameNetwork(cidr1, cidr2) {
    var a = netOf(cidr1), b = netOf(cidr2);
    return !!a && !!b && a === b;
  }

  function syncHex(x, digits) {
    var m = '0123456789abcdef';
    var hex = '';
    for (var i = 0; i < digits; i++) {
      x = (x * 1103515245 + 12345) >>> 0;
      hex = m[(x >> 24) & 15] + hex;
    }
    return hex;
  }

  function hash(s) {
    var h = 7;
    for (var i = 0; i < s.length; i++) {
      h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  function macFor(key) {
    var h1 = hash(key + ':mac-a');
    var h2 = hash(key + ':mac-b');
    var h3 = hash(key + ':mac-c');
    return '02:' + padZ(syncHex(h1, 2)) + ':' + padZ(syncHex(h2, 2)) + ':' + padZ(syncHex(h3, 2)) + ':' + padZ(syncHex(h1 + h2, 2)) + ':' + padZ(syncHex(h2 + h3, 2));
  }

  function padZ(s) {
    while (String(s).length < 2) s = '0' + s;
    return String(s);
  }

  function epochStr(ts) {
    function z(x) { return padZ(x); }
    var d = new Date(ts);
    return d.getUTCFullYear() + '-' + z(d.getUTCMonth() + 1) + '-' + z(d.getUTCDate()) + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()) + ':' + z(d.getUTCSeconds()) + ' UTC';
  }

  function shortDate(ts) {
    var d = new Date(ts);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function z(x) { return padZ(x); }
    return months[d.getUTCMonth()] + ' ' + z(d.getUTCDate()) + ' ' + z(d.getUTCHours()) + ':' + z(d.getUTCMinutes()) + ':' + z(d.getUTCSeconds()) + '.' + ('00' + (d.getUTCMilliseconds() % 1000)).slice(-3);
  }

  function uptimeForBoot(bootAt) {
    var s = Math.max(0, Math.floor((Date.now() - bootAt) / 1000));
    var mins = Math.floor(s / 60);
    var hrs = Math.floor(mins / 60);
    var days = Math.floor(hrs / 24);
    var pad = function (x) { return padZ(x); };
    if (days > 0) return days + ' days, ' + pad(hrs % 24) + ':' + pad(mins % 60);
    if (hrs > 0) return hrs + ':' + pad(mins % 60);
    return mins + ' mins, ' + pad(s % 60) + ' secs';
  }

  function agoTime(bootAt) {
    var s = Math.max(0, Math.floor((Date.now() - bootAt) / 1000));
    var mins = Math.floor(s / 60);
    var hrs = Math.floor(mins / 60);
    var days = Math.floor(hrs / 24);
    if (days > 0) return days + ' days, ' + padZ(hrs % 24) + ':' + padZ(mins % 60) + ' ago';
    if (hrs > 0) return padZ(hrs) + ':' + padZ(mins % 60) + ' ago';
    if (mins > 60) return mins + ' mins ago';
    return s + ' secs ago';
  }

  function routeAge(ts) {
    var s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    function pad(x) { return padZ(x); }
    var mins = Math.floor(s / 60), hrs = Math.floor(mins / 60), days = Math.floor(hrs / 24);
    if (days > 0) return days + 'd ' + pad(hrs % 24) + ':' + pad(mins % 60) + ':' + pad(s % 60);
    return pad(hrs) + ':' + pad(mins % 60) + ':' + pad(s % 60);
  }

  function cmpIpCidr(a, b) {
    var x = parseIp(a), y = parseIp(b);
    if (!x || !y) return String(a).localeCompare(String(b));
    var nx = ipToInt(x.ip), ny = ipToInt(y.ip);
    if (nx !== ny) return nx < ny ? -1 : 1;
    var px = x.prefix === null ? 32 : x.prefix, py = y.prefix === null ? 32 : y.prefix;
    return px - py;
  }

  function cmpTokens(a, b) {
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) {
      var x = i < a.length ? a[i] : '';
      var y = i < b.length ? b[i] : '';
      if (x === y) continue;
      var nx = parseInt(x, 10), ny = parseInt(y, 10);
      if (!isNaN(nx) && !isNaN(ny) && String(nx) === x && String(ny) === y) return nx - ny;
      return x < y ? -1 : 1;
    }
    return 0;
  }

  function padCols(rows, widths) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var line = '';
      for (var c = 0; c < rows[i].length; c++) {
        var w = widths[c];
        if (!w) w = '';
        if (w <= 0) line += rows[i][c];
        else if (w < 0) line += padR(rows[i][c], Math.abs(w));
        else line += padL(rows[i][c], w);
      }
      out.push(line.replace(/\s+$/, ''));
    }
    return out;
  }

  var api = {
    padR: padR, padL: padL, esc: esc, ipToInt: ipToInt, intToIp: intToIp,
    netOf: netOf, cidrHost: cidrHost, cidrBroadcast: cidrBroadcast, parseIp: parseIp,
    inNet: inNet, sameNetwork: sameNetwork, macFor: macFor, epochStr: epochStr,
    shortDate: shortDate, uptimeForBoot: uptimeForBoot, agoTime: agoTime,
    routeAge: routeAge, cmpIpCidr: cmpIpCidr, cmpTokens: cmpTokens, padCols: padCols,
    hash: hash
  };

  global.JJ = global.JJ || {};
  for (var k in api) global.JJ[k] = api[k];
})(typeof window !== 'undefined' ? window : globalThis);
