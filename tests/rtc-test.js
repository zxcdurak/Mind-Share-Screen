// inject.js watches the page's RTCPeerConnection objects without changing them and reports
// fixed codes: connected / failed / stuck, and what kinds of addresses were found.
const vm = require('vm'), fs = require('fs'), path = require('path');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

class FakePC {
  constructor(config) {
    this.config = config; this.iceConnectionState = 'new'; this.handlers = {};
  }
  get remoteDescription() { return this.remote || null; }
  addEventListener(type, f) { (this.handlers[type] = this.handlers[type] || []).push(f); }
  fire(type, event) { (this.handlers[type] || []).forEach(f => f(event || {})); }
  setState(s) { this.iceConnectionState = s; this.fire('iceconnectionstatechange'); }
}
FakePC.generateCertificate = () => 'cert';

function setup() {
  const timers = [], posted = [];
  const window = { RTCPeerConnection: FakePC, addEventListener() {}, postMessage: m => posted.push(m) };
  window.window = window;
  const ctx = vm.createContext({ window, navigator: { userAgent: 'Chrome/124', mediaDevices: {} }, console, Proxy, Reflect, Set, Map, Object, Array, Promise,
    DOMException: class {}, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].f = null; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/page/inject.js'), 'utf8'), ctx);
  const codes = () => posted.filter(m => m.type === 'event').map(m => m.code);
  const fireTimers = ms => timers.filter(t => t.f && t.ms === ms).forEach(t => t.f());
  return { window, codes, fireTimers };
}
const cand = type => ({ candidate: { candidate: 'candidate:1 1 udp 2122260223 10.0.0.5 5000 typ ' + type + ' generation 0' } });

// 1. the wrapper hands out real connections
let t = setup();
const pc = new t.window.RTCPeerConnection({ iceServers: [] });
ok(pc instanceof FakePC && pc.config.iceServers.length === 0, 'wrapped constructor still builds real connections');
ok(t.window.RTCPeerConnection.generateCertificate() === 'cert', 'static members still reachable');

// 2. connected
pc.setState('checking'); pc.setState('connected');
ok(t.codes().includes('rtc-ice-connected'), 'connected is reported');

// 3. failed
t = setup();
const bad = new t.window.RTCPeerConnection();
bad.setState('failed');
ok(t.codes().includes('rtc-ice-failed'), 'failed is reported');

// 4. stuck: nothing happens for 20 s
t = setup();
const slow = new t.window.RTCPeerConnection();
slow.setState('checking');
t.fireTimers(20000);
ok(t.codes().includes('rtc-ice-stuck'), 'a connection still checking after 20 s is reported as stuck');

// 4b. no answer from the server: ICE never started
t = setup();
const silent = new t.window.RTCPeerConnection();
t.fireTimers(20000);
ok(t.codes().includes('rtc-no-answer') && !t.codes().includes('rtc-ice-stuck'), 'no remote description after 20 s is reported as "no answer", not as stuck ICE');
t = setup();
const answered = new t.window.RTCPeerConnection();
answered.remote = { type: 'answer' }; answered.setState('checking');
t.fireTimers(20000);
ok(t.codes().includes('rtc-ice-stuck') && !t.codes().includes('rtc-no-answer'), 'an answered offer that never connects is reported as stuck ICE');

// 5. a connection that got connected is not reported as stuck
t = setup();
const fine = new t.window.RTCPeerConnection();
fine.setState('connected');
t.fireTimers(20000);
ok(!t.codes().includes('rtc-ice-stuck'), 'connected in time: no stuck report');

// 6. address kinds
t = setup();
const local = new t.window.RTCPeerConnection();
local.fire('icecandidate', cand('host')); local.fire('icecandidate', { candidate: null });
ok(t.codes().includes('rtc-candidates-local-only'), 'host-only candidates are reported as local only');
t = setup();
const pub = new t.window.RTCPeerConnection();
pub.fire('icecandidate', cand('host')); pub.fire('icecandidate', cand('srflx')); pub.fire('icecandidate', { candidate: null });
ok(t.codes().includes('rtc-candidates-public'), 'srflx candidates are reported as public');

// 7. retries do not flood the log
t = setup();
for (let i = 0; i < 10; i++) new t.window.RTCPeerConnection().setState('failed');
ok(t.codes().filter(c => c === 'rtc-ice-failed').length === 3, 'each code is reported at most three times');

// 8. a page without WebRTC is left alone
const bare = vm.createContext({ window: { addEventListener() {}, postMessage() {} }, navigator: { userAgent: 'Chrome/124', mediaDevices: {} }, console, Proxy, Reflect, Set, Map, Object, Array, Promise, DOMException: class {}, setTimeout, clearTimeout });
bare.window.window = bare.window;
let threw = false;
try { vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/page/inject.js'), 'utf8'), bare); } catch (e) { threw = true; }
ok(!threw, 'no RTCPeerConnection: the script still loads');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
