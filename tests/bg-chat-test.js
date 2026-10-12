const vm=require('vm'),fs=require('fs');
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m)}else console.log('ok  ',m)};
const created=[],cleared=[],tabUpd=[],winUpd=[];let failCreate=false,shownCb,store={chatNotify:true},clickCb,msgCb;
const browser={
 storage:{local:{get:async k=>({...store}),set:async o=>{Object.assign(store,o)},remove:async k=>{delete store[k]}},onChanged:{addListener(){}}},
 notifications:{create:async(id,o)=>{if(failCreate)throw new Error('boom');created.push({id,o})},clear:async id=>{cleared.push(id)},onClicked:{addListener:f=>clickCb=f},onShown:{addListener:f=>shownCb=f},onClosed:{addListener(){}}},
 alarms:{getAll:async()=>[],clear:async()=>{},create(){},onAlarm:{addListener(){}}},
 permissions:{onAdded:{addListener(){}},onRemoved:{addListener(){}}},
 runtime:{id:'x',getURL:p=>'moz-extension://x/'+p,onStartup:{addListener(){}},onInstalled:{addListener(){}},onMessage:{addListener:f=>msgCb=f}},
 tabs:{update:async(...a)=>{tabUpd.push(a)}},windows:{update:async(...a)=>{winUpd.push(a)}}};
const ctx=vm.createContext({browser,console,Date,Math,Map,Set,Promise,Number,String,Array});
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','src/shared/common.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','src/shared/diag.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','src/background/background.js'),'utf8'),ctx);
(async()=>{
 const sender={id:'x',url:'https://e-class.tsu.ru/#conference:1',tab:{id:7,windowId:3}};
 const page={id:'x',url:'moz-extension://x/src/notifications/notifications.html',tab:{id:9,windowId:3}};
 const popup={id:'x',url:'moz-extension://x/src/popup/popup.html'};
 await msgCb({type:'chat',count:1,text:'Иванов: привет'},sender);
 ok(created.length===1&&created[0].id==='mind-chat'&&created[0].o.title==='i.Mind: новое сообщение','single message title');
 await msgCb({type:'chat',count:40,text:'x'.repeat(500)},sender);
 ok(created[1].id==='mind-chat'&&created[1].o.title.endsWith('40')&&created[1].o.message.length===140,'burst reuses id, count shown, text capped');
 await msgCb({type:'chat',count:-5,text:1},sender); ok(created[2].o.title==='i.Mind: новое сообщение','bad count clamped');
 await clickCb('mind-chat');
 ok(JSON.stringify(tabUpd)==='[[7,{"active":true}]]'&&JSON.stringify(winUpd)==='[[3,{"focused":true}]]'&&cleared.includes('mind-chat'),'click focuses the tab');
 await msgCb({type:'chatClear'},sender); ok(cleared.length===2,'chatClear clears');
 const n=created.length; store.chatNotify=false; await msgCb({type:'chat',count:1,text:'a'},sender); ok(created.length===n,'disabled: nothing shown');
 store.chatNotify=true; await msgCb({type:'chat',count:1,text:'a'},{}); ok(created.length===n,'no sender info: ignored');
 const logs=async()=>{await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));return (store.diagLog||[]).map(e=>e.m).join('|')};
 ok(/create succeeded/.test(await logs()),'diag: success logged');
 failCreate=true; await msgCb({type:'chat',count:3,text:'a'},sender); ok(/create failed: boom/.test(await logs()),'diag: create failure logged'); failCreate=false;
 store.chatNotify=false; await msgCb({type:'chat',count:2,text:'a'},sender); ok(/switched off/.test(await logs()),'diag: disabled logged'); store.chatNotify=true;
 await msgCb({type:'chat',count:2,text:'a'},{}); ok(/not an e-class tab/.test(await logs()),'diag: foreign sender logged');
 shownCb('mind-chat'); ok(/shown: mind-chat/.test(await logs()),'diag: onShown logged');
 ok((await msgCb({type:'diagTest'},page))===true && created[created.length-1].id==='mind-test','diag: test notification created');
 const st=await msgCb({type:'diagState'},popup); ok(st.notificationsApi===true,'diag: state reports API');
 ok(!/Иванов|привет/.test(await logs()),'diag: no message text in the log');
 // sender checks
 const before=created.length;
 const otherExt={id:'other',url:'moz-extension://other/x.html',tab:{id:1,windowId:1}};
 const otherSite={id:'x',url:'https://evil.example/',tab:{id:2,windowId:1}};
 await msgCb({type:'chat',count:1,text:'a'},otherExt); await msgCb({type:'chat',count:1,text:'a'},otherSite);
 ok(created.length===before,'chat messages from another extension or another site are ignored');
 const cl=cleared.length; await msgCb({type:'chatClear'},otherSite); ok(cleared.length===cl,'chatClear from another site is ignored');
 ok((await msgCb({type:'diagTest'},sender))===undefined && created.length===before,'diagTest from a web page is ignored');
 ok((await msgCb({type:'diagState'},otherExt))===undefined,'diagState from another extension is ignored');
 ok((await msgCb({type:'reschedule'},sender))===undefined,'reschedule from a web page is ignored');
 ok(msgCb(null,sender)===undefined && msgCb('x',sender)===undefined,'malformed messages are ignored');
 console.log(fails?fails+' FAILED':'ALL PASSED');
})();
