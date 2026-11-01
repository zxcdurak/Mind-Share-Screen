// inject.js remembers the page's EventSource objects and closes them on request.
const vm=require('vm'),fs=require('fs'),path=require('path');
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m)}else console.log('ok  ',m)};
class EventSource{constructor(url){this.url=url;this.readyState=1}close(){this.readyState=2}}
const listeners=[],posted=[];
const window={EventSource,addEventListener:(t,f)=>{if(t==='message')listeners.push(f)},postMessage:m=>posted.push(m)};
window.window=window;
const navigator={userAgent:'Chrome/124',mediaDevices:{getDisplayMedia(){}}};
const ctx=vm.createContext({window,navigator,console,Proxy,Reflect,Set,Map,Object,DOMException:class{},setTimeout,clearTimeout,Array});
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','src/page/inject.js'),'utf8'),ctx);
const send=data=>listeners.forEach(f=>f({source:window,data}));
const a=new window.EventSource('/a'),b=new window.EventSource('/b'),c=new window.EventSource('/c');
ok(a instanceof EventSource&&a.url==='/a','wrapped constructor still builds real EventSource objects');
b.close();
posted.length=0;
send({source:'mind-ff-cmd',type:'close-streams'});
const reply=posted.find(m=>m.code==='streams-closed');
ok(reply&&reply.count===2,'closes the two that were still open ('+(reply&&reply.count)+')');
ok(a.readyState===2&&c.readyState===2,'they are closed now');
posted.length=0;
send({source:'mind-ff-cmd',type:'close-streams'});
ok(posted.find(m=>m.code==='streams-closed').count===0,'second request finds nothing');
posted.length=0;
send({type:'close-streams'});
ok(!posted.some(m=>m.code==='streams-closed'),'a message without our source is ignored');
console.log(fails?fails+' FAILED':'ALL PASSED');
process.exitCode=fails?1:0;
