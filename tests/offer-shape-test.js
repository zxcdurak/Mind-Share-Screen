// The diagnostics log gets the "shape" of the WebRTC offer the page sends: names and counts only.
// No address, fingerprint, ufrag or other value may leave the page, and notice.js drops anything odd.
const vm = require('vm'), fs = require('fs'), path = require('path');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

// Shaped after the offer of Yandex Browser 26, with the values that must never be logged.
const SDP = [
  'v=0', 'o=- 3562564537869402956 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'a=group:BUNDLE 0 1', 'a=extmap-allow-mixed', 'a=msid-semantic: WMS',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 110', 'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:iVTG', 'a=ice-pwd:SECRETPASSWORD1234567890', 'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11',
  'a=setup:actpass', 'a=mid:0', 'a=sendrecv', 'a=rtcp-mux',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=extmap:3 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01',
  'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1', 'a=rtpmap:63 red/48000/2', 'a=rtpmap:110 telephone-event/48000',
  'a=candidate:1458433359 1 udp 2122260223 10.10.90.245 52345 typ host generation 0 ufrag iVTG network-id 1',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 49 50 53', 'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:iVTG', 'a=mid:1', 'a=sendrecv', 'a=rtcp-mux', 'a=rtcp-rsize',
  'a=extmap:14 urn:ietf:params:rtp-hdrext:toffset', 'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid',
  'a=rtpmap:96 VP8/90000', 'a=rtpmap:97 rtx/90000', 'a=fmtp:97 apt=96', 'a=rtpmap:102 H264/90000',
  'a=rtpmap:49 H265/90000', 'a=rtpmap:50 rtx/90000', 'a=rtpmap:53 flexfec-03/90000', 'a=fmtp:53 repair-window=10000000',
  'a=candidate:673320919 1 tcp 1518280447 10.10.90.245 9 typ host tcptype active', ''
].join('\r\n');

class FakePC {
  constructor() { this.handlers = {}; this.iceConnectionState = 'new'; this.localDescription = { type: 'offer', sdp: SDP }; }
  get remoteDescription() { return null; }
  addEventListener(type, f) { (this.handlers[type] = this.handlers[type] || []).push(f); }
  fire(type, event) { (this.handlers[type] || []).forEach(f => f(event || {})); }
}

function pageSetup() {
  const posted = [];
  const window = { RTCPeerConnection: FakePC, addEventListener() {}, postMessage: m => posted.push(m) };
  window.window = window;
  const ctx = vm.createContext({ window, navigator: { userAgent: 'Chrome/152', mediaDevices: {} }, console, Proxy, Reflect, Set, Map, Object, Array, Promise, String,
    DOMException: class {}, setTimeout: () => 1, clearTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/page/inject.js'), 'utf8'), ctx);
  const shapes = () => posted.filter(m => m.code === 'rtc-offer-shape');
  return { window, shapes };
}

const t = pageSetup();
const pc = new t.window.RTCPeerConnection();
pc.fire('icecandidate', { candidate: null });
const pieces = t.shapes();
const text = pieces.map(p => p.part + '|' + p.detail).join('\n');
ok(pieces.length >= 4, 'the page reports the shape in pieces (' + pieces.length + ')');
ok(/sections\|audio sendrecv 3 formats; video sendrecv 6 formats; \d+ bytes/.test(text), 'sections: kind, direction, number of formats, size');
ok(/codecs\|audio: opus, red, telephone-event; video: VP8, rtx, H264, H265, flexfec-03/.test(text), 'codec names, including H265 and flexfec-03');
ok(/extensions\|ssrc-audio-level, draft-holmer-rmcat-transport-wide-cc-extensions-01, toffset, mid/.test(text), 'header extension names without the URI prefix');
ok(/attributes\|.*candidate x2/.test(text) && /fingerprint x1/.test(text), 'attribute names with counts');
ok(!/10\.10\.90|SECRET|AA:BB|iVTG|3562564537869402956|1458433359|52345/.test(text), 'no address, password, fingerprint, ufrag or id in the pieces');
ok(pieces.every(p => p.detail.length <= 250), 'every piece is short');

// the notice.js side
const logged = [];
const handlers = [];
const noticeCtx = vm.createContext({
  window: { addEventListener: (type, f) => handlers.push(f), document: {} }, document: { createElement() { return {}; }, body: null, documentElement: {} },
  browser: { runtime: { getManifest: () => ({ version: '1' }) } }, navigator: { userAgent: 'x' }, location: { origin: 'https://e-class.tsu.ru' }, console, Object, Array,
  MindDiag: { log: (s, m, k) => logged.push({ s, m, k }) }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/content/notice.js'), 'utf8'), noticeCtx);
const deliver = data => handlers.forEach(f => f({ source: noticeCtx.window, data }));
logged.length = 0;
pieces.forEach(p => deliver(p));
ok(logged.length === pieces.length && logged.every(e => e.k === 'net' && e.m.startsWith('предложение WebRTC, ')), 'every good piece is logged as a "net" entry');
ok(logged.every(e => e.m.length <= 300), 'every log line fits the 300 character limit of the log');
logged.length = 0;
deliver({ source: 'mind-ff-fix', type: 'event', code: 'rtc-offer-shape', part: 'sections', detail: 'ice-pwd: <b>SECRET</b>' });
deliver({ source: 'mind-ff-fix', type: 'event', code: 'rtc-offer-shape', part: 'passwords', detail: 'video' });
deliver({ source: 'mind-ff-fix', type: 'event', code: 'rtc-offer-shape', part: 'codecs', detail: 'x'.repeat(400) });
deliver({ source: 'mind-ff-fix', type: 'event', code: 'rtc-offer-shape', part: 'codecs' });
ok(logged.length === 0, 'odd characters, an unknown part, an overlong or a missing detail are dropped');

// only two offers per page
const t2 = pageSetup();
for (let i = 0; i < 5; i++) new t2.window.RTCPeerConnection().fire('icecandidate', { candidate: null });
const perOffer = pieces.length;
ok(t2.shapes().length === perOffer * 2, 'at most two offers are described per page (' + t2.shapes().length + ' pieces)');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
