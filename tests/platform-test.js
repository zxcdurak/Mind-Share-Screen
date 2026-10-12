const vm = require('vm'), fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/page/inject.js'), 'utf8');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function setup({ displayMedia, ua, nativeGetUserMedia }) {
  const listeners = [], posted = [], timers = [];
  const nav = { userAgent: ua || FIREFOX_UA, mediaDevices: displayMedia === undefined ? {} : { getDisplayMedia: displayMedia } };
  if (nativeGetUserMedia) nav.getUserMedia = nativeGetUserMedia;
  const win = {
    addEventListener: (t, f) => listeners.push(f),
    postMessage: m => posted.push(m)
  };
  win.window = win;
  const ctx = vm.createContext({ window: win, navigator: nav, console, Object, Array, Map, Promise, DOMException,
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].f = null; } });
  vm.runInContext(src, ctx);
  const send = d => listeners.forEach(f => f({ source: win, data: d }));
  const problems = () => posted.filter(m => m.source === 'mind-ff-fix' && m.type === 'problem').map(m => m.code);
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

  // 6. events for the diagnostics log
  t = setup({ displayMedia: () => Promise.resolve({ id: 's' }) });
  t.send({ type: 'getScreen' }); await tick(); await tick();
  t.nav.legacyGetUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } } }, () => {}, () => {}); await tick();
  t.nav.legacyGetUserMedia({ audio: true }, () => {}, () => {});
  const ev = t.posted.filter(m => m.type === 'event').map(m => m.code);
  ok(JSON.stringify(ev) === JSON.stringify(['ua-spoofed','env-display-media-yes','share-requested','share-picked','share-delivered','share-refused-call']), 'events: ' + ev.join(','));
  t = setup({ displayMedia: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) });
  t.send({ type: 'getScreen' }); await tick(); await tick();
  ok(t.posted.some(m => m.type === 'event' && m.code === 'share-cancelled'), 'events: cancel is reported as share-cancelled');

  // 7. Chromium: the browser is left alone and the native getUserMedia is used for everything but the screen
  const calls = [];
  t = setup({ displayMedia: () => Promise.resolve({ id: 's' }), ua: CHROME_UA, nativeGetUserMedia: function (c, ok) { calls.push(['native', this === t.nav, c]); ok('camera'); } });
  ok(t.nav.userAgent === CHROME_UA, 'chromium: userAgent is not replaced');
  ok(t.posted.some(m => m.type === 'event' && m.code === 'ua-kept') && !t.posted.some(m => m.code === 'ua-spoofed'), 'chromium: reported as ua-kept');
  let cam; t.nav.legacyGetUserMedia({ audio: true, video: true }, s => cam = s, () => {});
  ok(cam === 'camera' && calls.length === 1 && calls[0][1] === true, 'chromium: camera/microphone go to the native getUserMedia');
  t.send({ type: 'getScreen' }); await tick(); await tick();
  let scr; t.nav.legacyGetUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } } }, s => scr = s, () => {}); await tick();
  ok(scr && scr.id === 's' && calls.length === 1, 'chromium: the screen still comes from getDisplayMedia');

  // 8. Firefox: the browser is disguised, and a non-screen request still fails as before
  t = setup({ displayMedia: () => Promise.resolve({ id: 's' }) });
  ok(t.nav.userAgent.includes('Chrome/124') && !/Firefox/.test(t.nav.userAgent), 'firefox: userAgent is replaced');
  let err; t.nav.legacyGetUserMedia({ audio: true }, () => {}, e => err = e);
  ok(err && err.name === 'NotSupportedError', 'firefox: non-screen requests are still refused');

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
