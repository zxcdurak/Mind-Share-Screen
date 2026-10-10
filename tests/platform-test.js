const vm = require('vm'), fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/page/inject.js'), 'utf8');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

function setup({ displayMedia }) {
  const listeners = [], posted = [], timers = [];
  const nav = { mediaDevices: displayMedia === undefined ? {} : { getDisplayMedia: displayMedia } };
  const win = {
    addEventListener: (t, f) => listeners.push(f),
    postMessage: m => posted.push(m)
  };
  win.window = win;
  const ctx = vm.createContext({ window: win, navigator: nav, console, Object, Array, Map, Promise, DOMException,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].f = null; } });
  vm.runInContext(src, ctx);
  const send = d => listeners.forEach(f => f({ source: win, data: d }));
  const problems = () => posted.filter(m => m.source === 'mind-ff-fix').map(m => m.code);
  return { nav, send, posted, timers, problems };
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  // 1. healthy flow: stream picked, site requests it in time
  let t = setup({ displayMedia: () => Promise.resolve({ id: 's' }) });
  t.send({ type: 'getScreen' }); await tick(); await tick();
  ok(t.posted.some(m => m.type === 'gotScreen' && m.sourceId), 'healthy: gotScreen sent');
  let got; t.nav.legacyGetUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } } }, s => got = s, () => {});
  await tick();
  ok(got && got.id === 's', 'healthy: stream delivered');
  t.timers.forEach(x => x.f && x.f());
  ok(t.problems().length === 0, 'healthy: no problems reported');

  // 2. site never asks for the stream
  t = setup({ displayMedia: () => Promise.resolve({ id: 's' }) });
  t.send({ type: 'getScreen' }); await tick(); await tick();
  ok(t.timers.length === 1 && t.timers[0].ms === 15000, 'protocol: watchdog armed (15 s)');
  t.timers.forEach(x => x.f && x.f());
  ok(JSON.stringify(t.problems()) === '["share-protocol"]', 'protocol: reported share-protocol');
  t.timers.forEach(x => x.f && x.f());
  ok(t.problems().length === 1, 'protocol: reported only once');

  // 3. user cancels the picker
  t = setup({ displayMedia: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) });
  t.send({ type: 'getScreen' }); await tick(); await tick();
  ok(t.problems().length === 0 && t.timers.length === 0, 'cancel: no problem, no watchdog');
  ok(t.posted.some(m => m.type === 'gotScreen' && m.sourceId === ''), 'cancel: gotScreen with empty source');

  // 4. getDisplayMedia rejects for another reason
  t = setup({ displayMedia: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotSupportedError' })) });
  t.send({ type: 'getScreen' }); await tick(); await tick();
  ok(JSON.stringify(t.problems()) === '["share-failed"]', 'failure: reported share-failed');

  // 5. no getDisplayMedia at all (previously threw a TypeError)
  t = setup({});
  t.send({ type: 'getScreen' }); await tick(); await tick();
  ok(JSON.stringify(t.problems()) === '["no-display-media"]', 'missing API: reported no-display-media');
  ok(t.posted.some(m => m.type === 'gotScreen' && m.sourceId === ''), 'missing API: site still gets an answer');

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
