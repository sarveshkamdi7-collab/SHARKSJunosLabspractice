(function(global){
  'use strict';
  var J = global.JJ || {};
  var db = J.db;
  var lab = J.lab;
  var net = J.net;

  function now(){ return Date.now(); }

  function ensureRt(key){
    if(!J._rts) J._rts = {};
    if(J._rts[key]) return J._rts[key];
    var spec = (lab && lab.deviceSpec) ? lab.deviceSpec(key) : null;
    var bootAt = now() - (180000 + (J.hash ? (J.hash('b:'+key)%900000):Math.floor(Math.random()*900000)));
    var root = db.create(null);
    if(spec && Array.isArray(spec.baseline)){
      for(var i=0;i<spec.baseline.length;i++){ try{ db.set(root, spec.baseline[i]); }catch(e){} }
    }
    var cand = db.clone(root);
    J._rts[key] = {
      key:key,
      spec: spec || {key:key, model: key==='SW1'?'EX4300-24T':'MX240', version:'20.4R2-S2.1', platform:key==='SW1'?'ex':'mx'},
      committed: root,
      config: root,
      candidate: cand,
      revisions: [],
      commitLog: [],
      bootAt: bootAt,
      lastConfigured: bootAt + 60000,
      commitCount: 0,
      running: true,
      confirmed: null
    };
    return J._rts[key];
  }

  function getWorld(){
    if(!J._devsAll){ J._devsAll={}; if(lab && lab.deviceKeys){ for(var k=0;k<lab.deviceKeys.length;k++){ J._devsAll[lab.deviceKeys[k]]=ensureRt(lab.deviceKeys[k]); } } }
    if(net && net.buildWorld) return net.buildWorld(J._devsAll);
    return {devices:{}, deviceKeys:(lab&&lab.deviceKeys)||[]};
  }

  function tokenize(line){
    var t=[]; var cur=''; var q=false;
    for(var i=0;i<line.length;i++){
      var ch=line[i];
      if(q){ if(ch==='"'){ q=false; continue; } cur+=ch; continue; }
      if(ch==='"'){ q=true; continue; }
      if(/\s/.test(ch)){ if(cur.length){ t.push(cur); cur=''; } continue; }
      if(ch==='|'){ if(cur.length){ t.push(cur); cur=''; } t.push('|'); continue; }
      cur+=ch;
    }
    if(cur.length) t.push(cur);
    return t;
  }

  function padR(s,n){ s=s==null?'':String(s); while(s.length<n) s+=' '; return s; }
  function padL(s,n){ s=s==null?'':String(s); while(s.length<n) s=' '+s; return s; }

  function routeAge(ts){
    var diff = Math.max(0, Math.floor((Date.now()-(ts||Date.now()))/1000));
    var h=Math.floor(diff/3600), m=Math.floor((diff%3600)/60), sec=diff%60;
    function z(x){return x<10?'0'+x:''+x;}
    return z(h)+':'+z(m)+':'+z(sec);
  }

  function bootSeq(rt){
    var v=(rt.spec&&rt.spec.version)||'20.4R2-S2.1';
    var h=rt.key||'R1';
    return [
      'Consoles: serial console. Type ^S to interrupt boot...',
      '',
      'FreeBSD/amd64 ('+h.toLowerCase()+') (ttyu0)',
      '',
      "Booting `Junos OS'",
      'JUNOS '+v+' built by builder on 2021-06-14 03:12:34 UTC',
      'Copyright (c) 1996-2021, Juniper Networks, Inc.',
      '',
      h+'  (ttyd0)',
      '',
      'login: '
    ];
  }

  function makeSess(rt, world){
    return {
      rt:rt,
      world: world||getWorld(),
      mode:'login',
      user:null,
      history:[],
      hidx:-1,
      input:'',
      pager:null,
      editPath:[],
      confirmed:null
    };
  }

  function prompt(sess){
    if(!sess) return 'root@R1> ';
    var rt=sess.rt||{}; var h=rt.key||'R1';
    var u=sess.user||'root';
    if(sess.mode==='login') return 'login: ';
    if(sess.mode==='shell') return u+'@'+h+':~ % ';
    if(sess.mode==='cli-cfg'){
      var p=(sess.editPath&&sess.editPath.length)?sess.editPath.join(' '):'';
      if(p) return '[edit '+p+']\n'+u+'@'+h+'# ';
      return '[edit]\n'+u+'@'+h+'# ';
    }
    if(sess.mode==='cli-op') return u+'@'+h+'> ';
    return u+'@'+h+'> ';
  }

  function caretLine(s, col){
    var caret=''; for(var i=0;i<col;i++) caret+=' '; return caret+'^';
  }

  function completeList(cmds){
    var out=['Possible match completions:'];
    for(var i=0;i<cmds.length;i++) out.push('  '+cmds[i]);
    return out;
  }

  function showVersion(rt){
    var out=[];
    out.push('Hostname: '+(rt.key||'R1'));
    out.push('Model: '+((rt.spec&&rt.spec.model)||((rt.key==='SW1')?'ex4300-24t':'mx240')));
    out.push('Junos: '+((rt.spec&&rt.spec.version)||'20.4R2-S2.1'));
    out.push('JUNOS OS Kernel 64-bit ['+((rt.spec&&rt.spec.version)||'20.4R2-S2.1')+']');
    out.push('JUNOS base OS boot ['+((rt.spec&&rt.spec.version)||'20.4R2-S2.1')+']');
    out.push('JUNOS Routing Software ['+((rt.spec&&rt.spec.version)||'20.4R2-S2.1')+']');
    return out;
  }

  function showUptime(rt){
    var out=[];
    var nowd=new Date();
    function z(x){return x<10?'0'+x:''+x;}
    function fmt(d){ return d.getUTCFullYear()+'-'+z(d.getUTCMonth()+1)+'-'+z(d.getUTCDate())+' '+z(d.getUTCHours())+':'+z(d.getUTCMinutes())+':'+z(d.getUTCSeconds())+' UTC'; }
    out.push('Current time:      '+fmt(nowd));
    out.push('System booted:     '+fmt(new Date(rt.bootAt||Date.now()-3180000))+' ('+routeAge(rt.bootAt||Date.now()-3180000)+' ago)');
    out.push('Protocols started: '+fmt(new Date((rt.bootAt||Date.now()-3180000)+50000))+' ('+routeAge((rt.bootAt||Date.now()-3180000)+50000)+' ago)');
    out.push('Last configured:   '+fmt(new Date(rt.lastConfigured||Date.now()))+' ('+routeAge(rt.lastConfigured||Date.now())+' ago) by root');
    out.push(' 5:03am  up 53 mins, 1 user, load averages: 0.07, 0.02, 0.01');
    return out;
  }

  function showIntTerse(rt, world){
    var ds = world.devices && world.devices[rt.key];
    var out=[];
    out.push('Interface               Admin Link Proto    Local                 Remote');
    if(!ds) return out;
    var ifs = ds.iflist ? ds.iflist.slice() : Object.keys(ds.interfaces||{});
    for(var i=0;i<ifs.length;i++){
      var name=ifs[i]; var ifc=ds.interfaces[name]; if(!ifc) continue;
      out.push(padR(name,24)+padR(ifc.adminUp?'up':'down',6)+padR(ifc.linkUp?'up':'down',5));
      if(ifc.unilist){
        for(var u=0;u<ifc.unilist.length;u++){
          var un=ifc.unilist[u];
          if(un.family==='inet'){
            for(var a=0;a<un.addrs.length;a++) out.push(padR(name+'.'+un.num,24)+padR('--',6)+padR('--',5)+padR('inet',9)+un.addrs[a]);
          }
        }
      }
    }
    if(ds.interfaces['fxp0'] && out.filter(function(x){return x.indexOf('fxp0')===0;}).length===0){
      out.push(padR('fxp0',24)+padR('up',6)+padR('up',5));
    }
    if(ds.interfaces['lo0'] && out.filter(function(x){return x.indexOf('lo0')===0;}).length===0){
      out.push(padR('lo0',24)+padR('up',6)+padR('up',5));
    }
    return out;
  }

  function showRoute(rt, world){
    var ds = world.devices && world.devices[rt.key];
    var out=[];
    if(!ds){ out.push('inet.0: 0 destinations, 0 routes'); return out; }
    var routes=ds.routes||[];
    out.push('inet.0: '+routes.length+' destinations, '+routes.length+' routes ('+routes.length+' active, 0 holddown, 0 hidden)');
    out.push('+ = Active Route, - = Last Active, * = Both');
    out.push('');
    for(var i=0;i<routes.length&&i<40;i++){
      var r=routes[i];
      var age = r.created ? routeAge(r.created) : '00:00:00';
      out.push(padR(r.dest,19)+'*['+r.proto+'/'+r.pref+'] '+age);
      if(r.mode==='discard' || r.mode==='reject'){ out.push('                      Discard'); continue; }
      if(r.proto==='Direct'){ out.push('                    > via '+(r.via||'')); continue; }
      if(r.proto==='Local'){ out.push('                      Local via '+((r.local)?r.local : (r.dest.split('/')[0]))); continue; }
      if(r.via){ out.push('                    > to '+(r.to||'')+ (r.to?' via '+r.via : ' via '+r.via)); continue; }
    }
    return out;
  }

  function showOspfNbr(rt, world){
    var ds = world.devices && world.devices[rt.key];
    var out=[];
    out.push('Address          State              Interface     Dead time  ID               Pri Retx');
    if(!ds || !ds.ospfNeighbors) return out;
    for(var i=0;i<ds.ospfNeighbors.length;i++){
      var n=ds.ospfNeighbors[i];
      out.push(padR(n.ip,17)+padR(n.state||'Full',19)+padR(n.iface||'',14)+padR('00:00:35',11)+padR(n.id||'',18)+padL(n.prio||'128',4));
    }
    return out;
  }

  function showBgpSum(rt, world){
    var ds = world.devices && world.devices[rt.key];
    var out=[];
    var peers=(ds&&ds.bgp&&ds.bgp.peers)?ds.bgp.peers.length:0;
    out.push('Groups: 1 Peers: '+peers+' Down peers: 0');
    out.push('Table          Tot Paths  Act Paths Suppressed  History Damp State    Pending');
    out.push('Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped');
    if(ds&&ds.bgp&&ds.bgp.peers){
      for(var i=0;i<ds.bgp.peers.length;i++){
        var p=ds.bgp.peers[i];
        out.push(padR(p.ip,22)+padL(p.peerAs||'65000',8)+padL(p.inPkt||'68',10)+padL(p.outPkt||'68',10)+padL('0',7)+padL('0',7)+padL('53',8)+' '+(p.state||'Establ'));
      }
    }
    return out;
  }

  function pipe(lines, filt){
    if(!Array.isArray(lines)) return lines||[];
    if(!filt || filt.length===0) return lines;
    var mode=filt[0], arg=filt[1]||'';
    if(mode==='match'){
      try{ var re=new RegExp(arg); return lines.filter(function(x){return re.test(x);}); }catch(e){ return lines; }
    }
    if(mode==='except'){
      try{ var re2=new RegExp(arg); return lines.filter(function(x){return !re2.test(x);}); }catch(e){ return lines; }
    }
    if(mode==='count'){
      return [String(lines.length)];
    }
    if(mode==='display' && arg==='set'){
      return ['## display set not fully rendered']; // placeholder minimal
    }
    return lines;
  }

  function opHandler(sess, line){
    var rt=sess.rt; var world=sess.world||getWorld(); sess.world=world;
    var toks=tokenize(line);
    if(toks.length===0) return {lines:[], prompt:prompt(sess)};
    if(toks[0]==='?') return {lines:completeList(['configure','exit','ping','request','show','start','traceroute']), prompt:prompt(sess)};
    if(toks[0]==='show'){
      if(toks.length===1){
        return {lines:[
          'Possible match completions:',
          '  arp                  Show Address Resolution Protocol table',
          '  bgp                  Show Border Gateway Protocol information',
          '  chassis              Show chassis hardware & environment',
          '  configuration        Show candidate/committed configuration',
          '  interfaces           Show interface status and statistics',
          '  lldp                 Show Link Layer Discovery Protocol',
          '  ospf                 Show Open Shortest Path First information',
          '  route                Show routing table (RIB)',
          '  system               Show system information',
          '  version              Show software version'
        ], prompt:prompt(sess)};
      }
      if(toks[1]==='version') return {lines:showVersion(rt), prompt:prompt(sess)};
      if(toks[1]==='system' && toks[2]==='uptime') return {lines:showUptime(rt), prompt:prompt(sess)};
      if(toks[1]==='system' && toks[2]==='commit'){ return {lines:['0  '+new Date(rt.lastConfigured||rt.bootAt).toISOString().replace('T',' ').replace(/\.\d+Z/,' UTC')+' by root via cli'], prompt:prompt(sess)}; }
      if(toks[1]==='interfaces' && toks[2]==='terse'){ var l=showIntTerse(rt,world); if(toks.indexOf('|')>=0){ var pi=toks.indexOf('|'); l=pipe(l,toks.slice(pi+1)); } return {lines:l,prompt:prompt(sess)}; }
      if(toks[1]==='route'){ if(toks[2]==='summary'){ var ds2=world.devices[rt.key]; var rs=[]; rs.push('Autonomous system number: 65000'); rs.push('Router ID: '+((ds2&&ds2.routerId)||'1.1.1.1')); rs.push(''); rs.push('inet.0:'); rs.push('        Total routes       '+((ds2&&ds2.routes)?ds2.routes.length:0)); var lp=rs; if(toks.indexOf('|')>=0){ var pi2=toks.indexOf('|'); lp=pipe(lp,toks.slice(pi2+1)); } return {lines:lp,prompt:prompt(sess)}; } var lr=showRoute(rt,world); if(toks.indexOf('|')>=0){ var pi3=toks.indexOf('|'); lr=pipe(lr,toks.slice(pi3+1)); } return {lines:lr,prompt:prompt(sess)}; }
      if(toks[1]==='ospf' && toks[2]==='neighbor'){ var lo=showOspfNbr(rt,world); if(toks.indexOf('|')>=0){ var pi4=toks.indexOf('|'); lo=pipe(lo,toks.slice(pi4+1)); } return {lines:lo,prompt:prompt(sess)}; }
      if(toks[1]==='bgp' && toks[2]==='summary'){ var lb=showBgpSum(rt,world); if(toks.indexOf('|')>=0){ var pi5=toks.indexOf('|'); lb=pipe(lb,toks.slice(pi5+1)); } return {lines:lb,prompt:prompt(sess)}; }
      if(toks[1]==='arp'){ var ds3=world.devices[rt.key]; var la=[]; la.push('MAC Address       Address         Name                      Interface     Flags'); if(ds3&&ds3.arp){ for(var ai=0;ai<ds3.arp.length;ai++){ var aa=ds3.arp[ai]; la.push(padR(aa.mac||'02:00:00:00:00:01',18)+padR(aa.ip,16)+padR(aa.ip,26)+padR(aa.iface,14)+' none'); } } if(toks.indexOf('|')>=0){ var pi6=toks.indexOf('|'); la=pipe(la,toks.slice(pi6+1)); } return {lines:la,prompt:prompt(sess)}; }
      if(toks[1]==='lldp' && toks[2]==='neighbors'){ var ds4=world.devices[rt.key]; var ll=[]; ll.push('Local Interface    Chassis Id          Port info          System Name'); if(ds4&&ds4.lldp){ for(var li=0;li<ds4.lldp.length;li++){ var nl=ds4.lldp[li]; ll.push(padR(nl.localIf,19)+padR(nl.chassisId||'',21)+padR(nl.peerPort,19)+(nl.peer||'')); } } if(toks.indexOf('|')>=0){ var pi7=toks.indexOf('|'); ll=pipe(ll,toks.slice(pi7+1)); } return {lines:ll,prompt:prompt(sess)}; }
      if(toks[1]==='configuration'){ var c=db.braceRender(rt.committed||rt.config,null,false); if(!c||c.length===0) c=['## Last commit: '+new Date().toISOString().replace('T',' ').replace(/\.\d+Z/,' UTC')+' by root','version '+((rt.spec&&rt.spec.version)||'20.4R2-S2.1')+';']; if(toks.indexOf('|')>=0){ var pi8=toks.indexOf('|'); c=pipe(c,toks.slice(pi8+1)); } return {lines:c,prompt:prompt(sess)}; }
      if(toks[1]==='chassis'){ if(toks[2]==='hardware'){ return {lines:['Inventory:','FPC 0            REV 15               711-051312   JJPOS2012   MPCE Type 3-3D','Routing Engine 0 REV 04               750-051094   CAAL2923    RE-S-1800x4'], prompt:prompt(sess)}; } }
      if(toks[1]==='log' && toks[2]==='messages'){ return {lines:['Oct 28 05:10:02 '+rt.key+' mgd[1457]: UI_DBASE_LOG_EVENT: Interface ge-0/0/0.0 Up'], prompt:prompt(sess)}; }
      if(toks[1]==='vlans'){ return {lines:['Routing instance        VLAN name   VLAN ID     Interfaces','default                 staff       10          ge-0/0/1.0*','                                                     ge-0/0/0.0*','default                 guest       20          ge-0/0/2.0*'], prompt:prompt(sess)}; }
      if(toks[1]==='ethernet-switching' && toks[2]==='table'){ var ds5=world.devices[rt.key]; var letOut=[]; letOut.push('MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Permanent static, R - Remote MAC);'); letOut.push(''); letOut.push('Routing instance : default'); letOut.push('    Vlan                MAC                 MAC         Logical    Active'); letOut.push('    name                address             flags       interface  source'); if(ds5&&ds5.macTable){ for(var mi=0;mi<ds5.macTable.length;mi++){ var mm=ds5.macTable[mi]; letOut.push('    '+padR(mm.vlan,20)+padR(mm.mac,21)+padR('D',12)+padR((mm.iface||'')+'.0',11)+'    '+(mm.type||'Learn')); } } letOut.push('Total MAC addresses learned in this instance: '+((ds5&&ds5.macTable)?ds5.macTable.length:0)); return {lines:letOut,prompt:prompt(sess)}; }
      if(toks[1]==='spanning-tree'){ if(toks[2]==='bridge'){ return {lines:['Root bridge ID              32768.'+(rt.key==='SW1'?'02:00:00:00:00:01':'02:00:00:00:00:02'),'Bridge ID                   32768.'+(rt.key==='SW1'?'02:00:00:00:00:01':'02:00:00:00:00:02'),'Extended system ID          0','Total number of topologies  1','Topology 0','    Name           00 (Default)','    Bridge ID      32768.'+(rt.key==='SW1'?'02:00:00:00:00:01':'02:00:00:00:00:02')], prompt:prompt(sess)}; } }
      return {lines:['% Unknown command.'], prompt:prompt(sess)};
    }
    if(toks[0]==='monitor' && toks[1]==='traffic'){
      var mif='ge-0/0/0';
      for(var mt=2;mt<toks.length;mt++){ if(toks[mt]==='interface' && toks[mt+1]) mif=toks[mt+1]; }
      var dsM=world.devices&&world.devices[rt.key];
      var ifM=dsM&&dsM.interfaces&&dsM.interfaces[mif];
      var mo=[];
      mo.push('verbose output suppressed, use <detail> or <extensive> for full protocol decode');
      mo.push('Address resolution is ON in use by the kernel.');
      mo.push('');
      mo.push('Listening on '+mif+', link-type EN10MB (Ethernet), capture size 262144 bytes');
      if(!ifM || !ifM.linkUp){
        mo.push('monitor traffic: '+mif+': No such device or interface is down');
      } else {
        var nowS=new Date();
        for(var mp=0;mp<6;mp++){
          var sec=nowS.getSeconds()+mp;
          var ts='05:'+nowS.getMinutes()+':'+(sec<10?'0':'')+sec+'.'+(100000+Math.floor(Math.random()*899999));
          if(mp%2===0){
            var peer=(rt.key==='R1')?'10.0.12.2':'10.0.12.1';
            var local=(rt.key==='R1')?'10.0.12.1':'10.0.12.2';
            mo.push(ts+' IP '+local+'.0 > 224.0.0.5: OSPFv2, Hello, length 44');
            mo.push(ts+' IP '+peer+' > '+local+': ICMP echo request, id '+ (2048+mp) +', seq '+mp+', length 64');
          } else {
            mo.push(ts+' STP 802.1w, Rapid STP, Flags [Proposal], bridge-id 8000.02:00:00:00:00:01.8001, length 43');
          }
        }
        mo.push('');
        mo.push('6 packets captured');
        mo.push('6 packets received by filter');
        mo.push('0 packets dropped by kernel');
        mo.push('^C');
      }
      return {lines:mo, prompt:prompt(sess)};
    }
    if(toks[0]==='ping'){
      if(toks[1]==='?') return {lines:completeList(['<destination>']), prompt:prompt(sess)};
      if(!toks[1]) return {lines:['ping: missing host argument'], prompt:prompt(sess)};
      var dst=toks[1], cnt=5; var rapid=false; for(var pc=0;pc<toks.length;pc++){ if(toks[pc]==='count'&&toks[pc+1]) cnt=parseInt(toks[pc+1],10)||5; if(toks[pc]==='rapid') rapid=true; }
      var res = (net&&net.pingDev)? net.pingDev(world, rt.key, dst, null):{ok:true};
      var po=[];
      po.push('PING '+dst+' ('+dst+'): 56 data bytes');
      if(res && res.ok){ for(var pi9=0;pi9<cnt;pi9++) po.push('64 bytes from '+dst+': icmp_seq='+pi9+' ttl='+((res.hops&&res.hops.length)?(64-res.hops.length):64)+' time='+(Math.random()*1.5+0.8).toFixed(3)+' ms'); po.push(''); po.push('--- '+dst+' ping statistics ---'); po.push(cnt+' packets transmitted, '+cnt+' packets received, 0% packet loss'); po.push('round-trip min/avg/max/stddev = 0.987/1.089/1.224/0.098 ms'); return {lines:po,prompt:prompt(sess)}; }
      for(var pi10=0;pi10<cnt;pi10++){ po.push('Request timed out'); } po.push(''); po.push('--- '+dst+' ping statistics ---'); po.push(cnt+' packets transmitted, 0 packets received, 100% packet loss'); return {lines:po,prompt:prompt(sess)};
    }
    if(toks[0]==='traceroute'){ if(!toks[1]) return {lines:['traceroute: unknown host'], prompt:prompt(sess)}; var tr=[]; tr.push('traceroute to '+toks[1]+' ('+toks[1]+'), 30 hops max, 40 byte packets'); tr.push(' 1  '+toks[1]+'  1.234 ms  1.123 ms  1.045 ms'); return {lines:tr,prompt:prompt(sess)}; }
    if(toks[0]==='configure'){ sess.mode='cli-cfg'; sess.editPath=[]; if(!sess.rt.candidate) sess.rt.candidate = db.clone(sess.rt.committed||sess.rt.config); return {lines:['Entering configuration mode','The hierarchy levels are ignored for help, complete and compare commands.'], prompt:prompt(sess)}; }
    if(toks[0]==='edit'){ sess.mode='cli-cfg'; sess.editPath=[]; if(!sess.rt.candidate) sess.rt.candidate = db.clone(sess.rt.committed||sess.rt.config); return {lines:['Entering configuration mode','The hierarchy levels are ignored for help, complete and compare commands.'], prompt:prompt(sess)}; }
    if(toks[0]==='exit'||toks[0]==='quit'){ sess.mode='shell'; return {lines:[], prompt:prompt(sess)}; }
    if(toks[0]==='start' && toks[1]==='shell'){ sess.mode='shell'; return {lines:[], prompt:prompt(sess)}; }
    if(toks[0]==='request' && toks[1]==='support' && toks[2]==='information'){ var ro=[]; ro=ro.concat(showVersion(rt)).concat(showUptime(rt)); return {lines:ro,prompt:prompt(sess)}; }
    // syntax error with caret
    if(toks[0]==='show' && toks[1]==='routez'){ var serr=['error: syntax error, unexpected IDENTIFIER.','show routez','           ^']; return {lines:serr,prompt:prompt(sess)}; }
    return {lines:['% Unknown command.'], prompt:prompt(sess)};
  }

  function cfgHandler(sess, line){
    var rt=sess.rt; var toks=tokenize(line); var ltrim=line.trim();
    if(sess.editPath === undefined) sess.editPath = [];
    if(ltrim==='exit'){ if(sess.editPath && sess.editPath.length){ sess.editPath.pop(); return {lines:[], prompt:prompt(sess)}; } sess.mode='cli-op'; return {lines:[], prompt:prompt(sess)}; }
    if(ltrim==='top'){ sess.editPath=[]; return {lines:[], prompt:prompt(sess)}; }
    if(ltrim==='up'){ if(sess.editPath && sess.editPath.length){ var upc=1; try{ var up=toks.slice(1); if(up[0]) upc=parseInt(up[0],10)||1; }catch(e){} for(var ui=0;ui<upc&&sess.editPath.length;ui++) sess.editPath.pop(); } return {lines:[], prompt:prompt(sess)}; }
    if(ltrim.indexOf('up ')===0){ if(sess.editPath && sess.editPath.length){ var upc2=1; try{ upc2=parseInt(toks[1],10)||1; }catch(e){} for(var ui2=0;ui2<upc2&&sess.editPath.length;ui2++) sess.editPath.pop(); } return {lines:[], prompt:prompt(sess)}; }
    if(ltrim==='commit'){ if(!rt.candidate) rt.candidate=db.clone(rt.committed||rt.config); rt.committed=db.clone(rt.candidate); rt.config=rt.committed; rt.lastConfigured=Date.now(); rt.commitCount=(rt.commitCount||0)+1; if(rt.commitLog) rt.commitLog.unshift({time:Date.now(),by:'root'}); else rt.commitLog=[{time:Date.now(),by:'root'}]; if(rt.confirmed){ rt.confirmed=null; } return {lines:['commit complete'], prompt:prompt(sess)}; }
    if(ltrim==='commit check'){ return {lines:['configuration check succeeds'], prompt:prompt(sess)}; }
    if(ltrim.indexOf('commit confirmed')===0){ var m=5; try{ var parts=ltrim.split(/\s+/); if(parts[2]) m=parseInt(parts[2],10)||5; }catch(e){} rt.confirmed={expires:Date.now()+m*60000}; if(!rt.candidate) rt.candidate=db.clone(rt.committed||rt.config); rt.committed=db.clone(rt.candidate); rt.config=rt.committed; rt.lastConfigured=Date.now(); return {lines:['commit confirmed will be automatically rolled back in '+m+' minutes unless confirmed','commit complete'], prompt:prompt(sess)}; }
    if(ltrim==='rollback'){ if(rt.committed){ rt.candidate=db.clone(rt.committed); return {lines:['load complete'], prompt:prompt(sess)}; } return {lines:['error: cannot rollback to last committed state'], prompt:prompt(sess)}; }
    if(ltrim.indexOf('rollback ')===0){ if(rt.committed){ rt.candidate=db.clone(rt.committed); return {lines:['load complete'], prompt:prompt(sess)}; } return {lines:['load complete'], prompt:prompt(sess)}; }
    if(ltrim.indexOf('show | compare')===0){ if(!rt.candidate) rt.candidate=db.clone(rt.committed||rt.config); var diff=(db.compareTrees)?db.compareTrees(rt.committed||rt.config, rt.candidate):[]; if(!diff||diff.length===0) return {lines:['[edit]'], prompt:prompt(sess)}; return {lines:diff, prompt:prompt(sess)}; }
    if(ltrim==='show'){ if(!rt.candidate) rt.candidate=db.clone(rt.committed||rt.config); var c2=db.braceRender(rt.candidate,null,false); if(!c2||c2.length===0) c2=['version '+((rt.spec&&rt.spec.version)||'20.4R2-S2.1')+';']; return {lines:c2, prompt:prompt(sess)}; }
    if(ltrim.indexOf('run ')===0){ var rop=line.trim().substring(4); return opHandler(sess, rop); }
    if(ltrim.indexOf('set ')===0){ if(!rt.candidate) rt.candidate=db.clone(rt.committed||rt.config); try{ db.set(rt.candidate, toks.slice(1)); }catch(e){} return {lines:[], prompt:prompt(sess)}; }
    if(ltrim.indexOf('delete ')===0){ if(!rt.candidate) rt.candidate=db.clone(rt.committed||rt.config); try{ if(db.del) db.del(rt.candidate, toks.slice(1)); else { } }catch(e){ return {lines:['warning: statement does not exist'], prompt:prompt(sess)}; } return {lines:[], prompt:prompt(sess)}; }
    if(ltrim.indexOf('edit ')===0){ var ep=toks.slice(1); if(ep.length){ if(!sess.editPath) sess.editPath=[]; for(var ei=0;ei<ep.length;ei++) sess.editPath.push(ep[ei]); } else { return {lines:['syntax error, expecting <sub-statement>'], prompt:prompt(sess)}; } return {lines:[], prompt:prompt(sess)}; }
    if(ltrim==='?') return {lines:completeList(['commit','delete','edit','exit','rollback','run','set','show','top','up']), prompt:prompt(sess)};
    return {lines:[], prompt:prompt(sess)};
  }

  function feed(sess, lineStr){
    if(!sess) return {lines:[], prompt:''};
    var line=(lineStr===undefined||lineStr===null)?'':String(lineStr);
    if(sess.mode==='login'){
      var uname=line.trim();
      if(uname==='root' || uname==='user'){ sess.mode='shell'; sess.user=uname; return {lines:[], prompt:prompt(sess)}; }
      return {lines:['Login incorrect'], prompt:prompt(sess)};
    }
    if(sess.mode==='shell'){
      if(line.trim()==='cli'){ sess.mode='cli-op'; return {lines:[], prompt:prompt(sess)}; }
      if(line.trim()==='') return {lines:[], prompt:prompt(sess)};
      return {lines:['sh: '+line.trim()+': not found'], prompt:prompt(sess)};
    }
    if(sess.mode==='cli-cfg'){ return cfgHandler(sess, line); }
    if(sess.mode==='cli-op'){ return opHandler(sess, line); }
    return {lines:[], prompt:prompt(sess)};
  }

  var api = {
    createDeviceRuntime: function(k){ return ensureRt(k); },
    ensureRuntime: ensureRt,
    buildWorldFromDevs: function(devs){ if(devs) J._devsAll=devs; return getWorld(); },
    tokenize: tokenize,
    createSession: makeSess,
    promptFor: prompt,
    getWorld: getWorld,
    feed: feed,
    bootLinesFor: bootSeq
  };

  global.JJ = global.JJ || {};
  global.JJ.machine = api;
})(typeof window!=='undefined'?window:globalThis);
