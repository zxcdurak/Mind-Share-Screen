// compat.js: the Firefox-style `browser` API on top of Chromium's `chrome`.
const vm = require('vm'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'compat.js'), 'utf8');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// A tiny stand-in for Chromium's callback-style API.
function makeChrome() {
  const store = {};
  const listeners = [];
  const chrome = {
    runtime: {
      lastError: undefined,
      getURL: p => 'chrome-extension://x/' + p,
      sendMessage(msg, cb) { cb({ echoed: msg }); },
      onMessage: {
        addListener: f => listeners.push(f),
        removeListener: f => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }
      }
    },
    storage: {
      local: {
        get(keys, cb) { const out = {}; for (const k of [].concat(keys)) if (k in store) out[k] = store[k]; cb(out); },
        set(o, cb) { Object.assign(store, o); cb(); },
        remove(k, cb) { for (const x of [].concat(k)) delete store[x]; cb(); }
      },
      onChanged: { addListener() {} }
    },
    permissions: { contains(p, cb) { cb(true); }, request(p, cb) { cb(true); }, remove(p, cb) { cb(true); }, onAdded: { addListener() {} } },
    alarms: {
      getAll(cb) { cb([{ name: 'a' }]); }, clear(n, cb) { cb(true); },
      create() {}, onAlarm: { addListener() {} }
    },
    tabs: { create(o, cb) { chrome.runtime.lastError = o.fail ? { message: 'tab failed' } : undefined; cb({ id: 1 }); chrome.runtime.lastError = undefined; } },
    windows: { update(id, o, cb) { cb({}); } }
  };
  return { chrome, listeners };
}

function load(globals) {
  const ctx = vm.createContext({ ...globals });
  ctx.globalThis = ctx;
  vm.runInContext(src, ctx);
  return ctx;
}

(async () => {
  // Firefox: `browser` exists, nothing is touched
  const native = { runtime: {}, marker: true };
  let ctx = load({ browser: native, chrome: makeChrome().chrome });
  ok(ctx.browser === native, 'firefox: the native browser object is left alone');

  // Chromium
  const { chrome, listeners } = makeChrome();
  ctx = load({ chrome });
  const b = ctx.browser;
  ok(b && typeof b.storage.local.get === 'function', 'chromium: browser is created');

  await b.storage.local.set({ a: 1, b: 2 });
  const got = await b.storage.local.get(['a', 'b']);
  ok(got.a === 1 && got.b === 2, 'storage.local.get/set return promises');

  ok((await b.permissions.contains({ permissions: ['notifications'] })) === true, 'permissions.contains resolves');
  ok((await b.alarms.getAll()).length === 1, 'alarms.getAll resolves');
  ok((await b.runtime.sendMessage({ type: 'x' })).echoed.type === 'x', 'runtime.sendMessage resolves with the reply');
  ok(b.runtime.getURL('a.png') === 'chrome-extension://x/a.png', 'plain functions pass through (getURL)');

  let rejected = null;
  await b.tabs.create({ fail: true }).catch(e => { rejected = e; });
  ok(rejected && rejected.message === 'tab failed', 'chrome.runtime.lastError becomes a rejection');
  ok((await b.tabs.create({ url: 'u' })).id === 1, 'no lastError: resolves');

  // onMessage: a listener may return a promise (Firefox style)
  b.runtime.onMessage.addListener(async msg => (msg.type === 'ping' ? { pong: true } : undefined));
  ok(listeners.length === 1, 'onMessage listener is registered with Chromium');
  let reply; const returned = listeners[0]({ type: 'ping' }, {}, r => { reply = r; });
  ok(returned === true, 'a promise-returning listener keeps the channel open (returns true)');
  await new Promise(r => setImmediate(r));
  ok(reply && reply.pong === true, 'the promise result is sent through sendResponse');

  let silent = 'unset';
  const ret2 = listeners[0]({ type: 'other' }, {}, r => { silent = r; });
  await new Promise(r => setImmediate(r));
  ok(ret2 === true && silent === undefined, 'a listener resolving to undefined answers with undefined');

  b.runtime.onMessage.addListener(() => undefined);
  ok(listeners[1]({}, {}, () => {}) === false, 'a listener returning nothing does not keep the channel open');

  // notifications only exist once the optional permission has been granted
  ok(b.notifications === undefined, 'notifications is undefined before the permission is granted');
  chrome.notifications = {
    create(id, o, cb) { cb(id); }, clear(id, cb) { cb(true); },
    onClicked: { addListener() {} }
  };
  ok(b.notifications && (await b.notifications.create('n', {})) === 'n', 'notifications appears (and works) after the grant');

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
