const vm=require('vm'),fs=require('fs');
let fails=0;const ok=(c,m)=>{if(!c){fails++;console.log('FAIL',m)}else console.log('ok  ',m)};
const created=[],cleared=[],tabUpd=[],winUpd=[];let store={chatNotify:true},clickCb,msgCb;
const browser={
 storage:{local:{get:async k=>({...store}),set:async()=>{}},onChanged:{addListener(){}}},
 notifications:{create:async(id,o)=>{created.push({id,o})},clear:async id=>{cleared.push(id)},onClicked:{addListener:f=>clickCb=f}},
 alarms:{getAll:async()=>[],clear:async()=>{},create(){},onAlarm:{addListener(){}}},
 permissions:{onAdded:{addListener(){}},onRemoved:{addListener(){}}},
 runtime:{getURL:p=>p,onStartup:{addListener(){}},onInstalled:{addListener(){}},onMessage:{addListener:f=>msgCb=f}},
 tabs:{update:async(...a)=>{tabUpd.push(a)}},windows:{update:async(...a)=>{winUpd.push(a)}}};
const ctx=vm.createContext({browser,console,Date,Math,Map,Set,Promise,Number,String,Array});
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','src/shared/common.js'),'utf8'),ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname,'..','src/background/background.js'),'utf8'),ctx);
(async()=>{
 const sender={tab:{id:7,windowId:3}};
 await msgCb({type:'chat',count:1,text:'Иванов: привет'},sender);
 ok(created.length===1&&created[0].id==='mind-chat'&&created[0].o.title==='i.Mind: новое сообщение','single message title');
 await msgCb({type:'chat',count:40,text:'x'.repeat(500)},sender);
 ok(created[1].id==='mind-chat'&&created[1].o.title.endsWith('40')&&created[1].o.message.length===140,'burst reuses id, count shown, text capped');
 await msgCb({type:'chat',count:-5,text:1},sender); ok(created[2].o.title==='i.Mind: новое сообщение','bad count clamped');
 await clickCb('mind-chat');
 ok(JSON.stringify(tabUpd)==='[[7,{"active":true}]]'&&JSON.stringify(winUpd)==='[[3,{"focused":true}]]'&&cleared.includes('mind-chat'),'click focuses the tab');
 await msgCb({type:'chatClear'},sender); ok(cleared.length===2,'chatClear clears');
 const n=created.length; store.chatNotify=false; await msgCb({type:'chat',count:1,text:'a'},sender); ok(created.length===n,'disabled: nothing shown');
 store.chatNotify=true; await msgCb({type:'chat',count:1,text:'a'},{}); ok(created.length===n,'no tab: ignored');
 console.log(fails?fails+' FAILED':'ALL PASSED');
})();
