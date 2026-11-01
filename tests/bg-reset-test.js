const vm=require('vm'),fs=require('fs'),path=require('path');
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m)}else console.log('ok  ',m)};
const store={},sent=[];let queried=null,msgCb;
const replies={1:{closed:2},2:{closed:3},4:null};
const browser={
 storage:{local:{get:async()=>({...store}),set:async o=>{Object.assign(store,o)},remove:async()=>{}},onChanged:{addListener(){}}},
 alarms:{getAll:async()=>[],clear:async()=>{},create(){},onAlarm:{addListener(){}}},
 permissions:{onAdded:{addListener(){}},onRemoved:{addListener(){}}},
 runtime:{getURL:p=>'ext://id/'+p,onStartup:{addListener(){}},onInstalled:{addListener(){}},onMessage:{addListener:f=>msgCb=f}},
 tabs:{query:async q=>{queried=q;return [{id:1},{id:2},{id:3},{id:4}]},sendMessage:async(id,m)=>{sent.push([id,m.type]);if(id===3)throw new Error('no receiver');return replies[id]}}};
const ctx=vm.createContext({browser,console,Date,Math,Map,Set,Promise,Number,String,Array});
for(const f of ['src/shared/common.js','src/shared/diag.js','src/background/background.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',f),'utf8'),ctx);
(async()=>{
 const page={url:'https://e-class.tsu.ru/x',tab:{id:4}};
 const r=await msgCb({type:'resetConnections'},page);
 ok(queried.url==='https://e-class.tsu.ru/*','only i.Mind tabs are queried');
 ok(!sent.some(s=>s[0]===4),'the asking tab is skipped');
 ok(r.tabs===2&&r.closed===5,'counts tabs reached and streams closed ('+JSON.stringify(r)+')');
 sent.length=0;
 const r2=await msgCb({type:'resetConnections'},{url:'ext://id/src/diagnostics/diagnostics.html'});
 ok(r2.tabs===3&&r2.closed===5,'extension page may ask (tab 3 has no receiver, so 3 of 4 are reached)');
 ok(sent.length===4,'every tab is tried when the asker has no tab');
 sent.length=0;
 ok(await msgCb({type:'resetConnections'},{url:'https://evil.example/'})===undefined&&sent.length===0,'foreign sender ignored');
 ok(await msgCb({type:'resetConnections'},{})===undefined,'sender without url ignored');
 console.log(fails?fails+' FAILED':'ALL PASSED');
 process.exitCode=fails?1:0;
})();
