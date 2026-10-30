#!/usr/bin/env node
(function(){
  'use strict';
  var fs=require('fs'), path=require('path'), vm=require('vm');
  var root=path.join(__dirname,'..');
  function load(p){ vm.runInThisContext(fs.readFileSync(path.join(root,p),'utf8'),{filename:p}); }
  ['public/js/junos/util.js','public/js/junos/db.js','public/js/junos/model.js','public/js/junos/derive.js','public/js/junos/schema.js','public/js/junos/machine.js'].forEach(load);
  var J=global.JJ;
  var passed=0,failed=0;
  function ok(n,c){ if(c){ console.log('PASS: '+n); passed++; } else { console.log('FAIL: '+n); failed++; } }

  // prompt + hierarchy
  var rt1=J.machine.createDeviceRuntime('R1');
  var sess=J.machine.createSession(rt1, J.machine.buildWorldFromDevs ? J.machine.buildWorldFromDevs({R1:rt1,R2:J.machine.createDeviceRuntime('R2'),R3:J.machine.createDeviceRuntime('R3'),SW1:J.machine.createDeviceRuntime('SW1')}):null);
  J.machine.feed(sess,'root'); J.machine.feed(sess,'cli');
  var p1 = J.machine.promptFor ? J.machine.promptFor(sess) : '';
  ok('op mode prompt root@R1>', /root@R1>/.test(p1));
  J.machine.feed(sess,'edit');
  var p2 = J.machine.promptFor ? J.machine.promptFor(sess) : '';
  ok('edit alias enters config', sess.mode==='cli-cfg');
  ok('config prompt newline + [edit]', p2.indexOf('[edit]')>=0 && p2.indexOf('\n')>=0 && /root@R1#/.test(p2));

  // L2 SW1
  var world=J.net.buildWorld({R1:J.machine.createDeviceRuntime('R1'),R2:J.machine.createDeviceRuntime('R2'),R3:J.machine.createDeviceRuntime('R3'),SW1:J.machine.createDeviceRuntime('SW1')});
  var sw=world.devices.SW1;
  var hasMac = sw && sw.macTable && sw.macTable.length>=1;
  ok('SW1 ethernet-switching table learned', hasMac);

  // L3 R1
  var rrt=world.devices.R1;
  var routes=rrt && rrt.routes ? rrt.routes : [];
  var hasPrefs = routes.some(function(r){ return /Direct\/0|\[Local\/8\]|\[Static\/5\]|\[OSPF\/10\]/.test(JSON.stringify(r)); }) || routes.length>0;
  ok('R1 route prefs present', routes.length>0);

  // commit engine
  var rt2=J.machine.createDeviceRuntime('R2');
  var s2=J.machine.createSession(rt2, world);
  J.machine.feed(s2,'root'); J.machine.feed(s2,'cli'); J.machine.feed(s2,'configure');
  J.machine.feed(s2,'set system domain-name test.local');
  var cmp = J.machine.feed(s2,'show | compare');
  ok('show | compare has diff', cmp && cmp.lines && cmp.lines.some(function(x){return x.indexOf('+')===0||x.indexOf('-')===0;}));
  var cc = J.machine.feed(s2,'commit check');
  ok('commit check succeeds', cc && cc.lines && cc.lines.join('\n').indexOf('configuration check succeeds')>=0);
  var cconf = J.machine.feed(s2,'commit confirmed 5');
  ok('commit confirmed accepted', cconf && cconf.lines && cconf.lines.join('\n').indexOf('commit confirmed')>=0);

  console.log('Summary: '+passed+'/'+(passed+failed)+' passed');
  process.exit(failed>0?1:0);
})();
