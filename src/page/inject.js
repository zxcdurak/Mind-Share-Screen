// This file is injected as a real <script> tag by content.js, so it runs
// directly in the page's own JS realm (no Xray wrappers, no cross-compartment
// access) — the same way Tampermonkey's unsafeWindow effectively behaves,
// and avoids the "Permission denied to access object" errors that happened
// when patching navigator through window.wrappedJSObject from an isolated
// content-script world.
(function () {
    'use strict';

    const nav = navigator;

    // Tells the content script (notice.js) that something the extension relies
    // on is not behaving as expected, so the user sees a message instead of a
    // silent failure. Only a fixed problem code is sent, never page data.
    function note(code) {
        window.postMessage({ source: 'mind-ff-fix', type: 'event', code: code }, '*');
    }
    const reported = {};
    function report(code) {
        if (reported[code]) return;
        reported[code] = true;
        window.postMessage({ source: 'mind-ff-fix', type: 'problem', code: code }, '*');
    }
    // After the user picked a screen, the site must ask for the stream through
    // legacyGetUserMedia within this time, otherwise its protocol has changed.
    const STREAM_REQUEST_TIMEOUT_MS = 15000;
    let streamWatch = null;

    // ---------------------------------------------------------------
    // 1. i.Mind hides the "share screen" button entirely unless
    //    navigator.userAgent looks like Chrome/IE/Yandex. We spoof it
    //    here (scoped to this site only) so the button shows up, and
    //    so getScreenMedia() (webrtc.nocache.js) takes its Chrome
    //    ("34+, needs extension") branch, which we then fulfil below
    //    with real browser APIs instead of a real Chrome extension.
    // ---------------------------------------------------------------
    // No "AppleWebKit" on purpose: GWT's user.agent property provider returns
    // 'safari' as soon as it sees "webkit", which makes Firefox run the Safari
    // build of the app. Without it (but with "Gecko") GWT picks the 'gecko1_8'
    // build, while the app's own parser still detects "Chrome/124".
    const FAKE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Chrome/124.0.0.0 Safari/537.36';
    // Chromium-based browsers are already accepted by i.Mind, so only Firefox needs the disguise.
    const isFirefox = /Firefox\//.test(nav.userAgent);
    if (!isFirefox) {
        note('ua-kept');
    } else try {
        Object.defineProperty(nav, 'userAgent', { get: () => FAKE_UA, configurable: true });
        Object.defineProperty(nav, 'appVersion', { get: () => FAKE_UA.replace('Mozilla/', ''), configurable: true });
        Object.defineProperty(nav, 'vendor', { get: () => 'Google Inc.', configurable: true });
        note('ua-spoofed');
    } catch (e) {
        note('ua-failed');
        console.error('[i.Mind FF fix] could not override navigator.userAgent', e);
    }

    // ---------------------------------------------------------------
    // 2. Emulate the "Mind Screen Sharing" Chrome extension's
    //    getScreen / gotScreen postMessage handshake (content.js +
    //    background.js), but back it with Firefox's real native
    //    getDisplayMedia() screen picker instead of
    //    chrome.desktopCapture (which doesn't exist here).
    // ---------------------------------------------------------------
    note(nav.mediaDevices && typeof nav.mediaDevices.getDisplayMedia === 'function' ? 'env-display-media-yes' : 'env-display-media-no');

    const pendingStreams = new Map();
    let counter = 1;

    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (data.type === 'getScreen') {
            const id = counter++;
            note('share-requested');

            // The site gives the extension 1.5 s to answer with getScreenPending before it
            // shows "install the Chrome extension". Firefox can hold the page up for longer
            // than that inside getDisplayMedia() while it lists windows, so the answer goes
            // out first and the picker is opened on the next tick (the click's user
            // activation lasts for seconds, so that is still allowed).
            const streamPromise = new Promise(function (resolve) {
                setTimeout(function () {
                    if (nav.mediaDevices && typeof nav.mediaDevices.getDisplayMedia === 'function') {
                        resolve(new Promise(function (ask) { ask(nav.mediaDevices.getDisplayMedia({ video: true, audio: isFirefox })); })
                            .catch(function (err) {
                                console.warn('[i.Mind FF fix] getDisplayMedia failed:', err);
                                // Cancelling the picker is a normal outcome, not a problem.
                                const name = err && err.name;
                                if (name !== 'NotAllowedError' && name !== 'AbortError' && name !== 'NotReadableError') report('share-failed');
                                else note('share-cancelled');
                                return null;
                            }));
                    } else {
                        report('no-display-media');
                        resolve(null);
                    }
                }, 0);
            });
            pendingStreams.set(id, streamPromise);

            window.postMessage(Object.assign({}, data, { type: 'getScreenPending', request: id }), '*');

            streamPromise.then(function (stream) {
                if (stream) {
                    note('share-picked');
                    clearTimeout(streamWatch);
                    streamWatch = setTimeout(function () { report('share-protocol'); }, STREAM_REQUEST_TIMEOUT_MS);
                }
                window.postMessage(Object.assign({}, data, {
                    type: 'gotScreen',
                    sourceId: stream ? ('firefox-native-' + id) : ''
                }), '*');
            });
        }

        if (data.type === 'cancelGetScreen') {
            window.postMessage(Object.assign({}, data, { type: 'canceledGetScreen' }), '*');
        }
    });

    // ---------------------------------------------------------------
    // 3. Modern Firefox has no navigator.getUserMedia at all, so
    //    webrtc.nocache.js's own line
    //        navigator.legacyGetUserMedia = navigator.getUserMedia
    //    ends up capturing its own broken IE-plugin fallback instead
    //    (which silently grabs the default camera). That's the
    //    function the site calls last, with { chromeMediaSource:
    //    'desktop', chromeMediaSourceId: <sourceId> }, to actually
    //    obtain the stream. We provide our own version and hand back
    //    the stream we already captured via getDisplayMedia() above.
    // ---------------------------------------------------------------
    // Chromium still has the callback API the site was written for; keep it for
    // everything except the screen. Firefox has none, so it keeps failing as before.
    const nativeGetUserMedia = nav.getUserMedia || nav.webkitGetUserMedia || null;

    // What the user picked and whether frames arrive, for the diagnostics log (a black picture
    // is otherwise invisible from here). Only fixed codes leave the page.
    function describeStream(stream) {
        try {
            const track = stream.getVideoTracks()[0];
            if (!track) return;
            const surface = track.getSettings ? track.getSettings().displaySurface : '';
            if (surface === 'monitor' || surface === 'window' || surface === 'browser') note('share-surface-' + surface);
            setTimeout(function () { if (track.readyState === 'live' && track.muted) note('share-track-muted'); }, 2000);
        } catch (e) { /* diagnostics only, never in the way of the stream */ }
    }

    // The site asks for a size limit and no audio (chromeMediaSource: 'desktop' with
    // maxWidth, maxHeight). The original extension honoured that through desktopCapture;
    // getDisplayMedia() ignores it, so in Chromium the limits are applied to the finished track.
    // Firefox keeps working the way it always has.
    function fitStream(stream, wanted) {
        try {
            const track = !isFirefox && wanted && stream.getVideoTracks && stream.getVideoTracks()[0];
            if (!track || !track.applyConstraints) return Promise.resolve();
            const limits = {};
            if (wanted.maxWidth > 0) limits.width = { max: wanted.maxWidth };
            if (wanted.maxHeight > 0) limits.height = { max: wanted.maxHeight };
            if (!Object.keys(limits).length) return Promise.resolve();
            return track.applyConstraints(limits).then(
                function () { note('share-fitted'); },
                function () { note('share-fit-failed'); });
        } catch (e) {
            return Promise.resolve();
        }
    }

    function ourLegacyGetUserMedia(constraints, onSuccess, onFailure) {
        const v = constraints && constraints.video;
        const isDesktopCapture = v && v.mandatory && v.mandatory.chromeMediaSource === 'desktop';

        if (isDesktopCapture) {
            clearTimeout(streamWatch);
            const last = Array.from(pendingStreams.values()).pop();
            if (last) {
                last.then(function (stream) {
                    if (!stream) {
                        onFailure(new DOMException('Permission denied', 'NotAllowedError'));
                    } else {
                        note('share-delivered');
                        fitStream(stream, v.mandatory).then(function () {
                            describeStream(stream);
                            onSuccess(stream);
                        });
                    }
                });
                return;
            }
        }

        if (nativeGetUserMedia) {
            nativeGetUserMedia.call(nav, constraints, onSuccess, onFailure);
            return;
        }
        note('share-refused-call');
        onFailure(new DOMException('Not supported', 'NotSupportedError'));
    }

    // webrtc.nocache.js itself runs `navigator.legacyGetUserMedia =
    // navigator.getUserMedia` during its own bootstrap (after this
    // script has already run), which would clobber a plain assignment
    // here. A getter/setter makes our version stick regardless of load
    // order: the site's write is simply swallowed.
    try {
        Object.defineProperty(nav, 'legacyGetUserMedia', {
            configurable: true,
            get: () => ourLegacyGetUserMedia,
            set: () => {}
        });
    } catch (e) {
        console.error('[i.Mind FF fix] could not override navigator.legacyGetUserMedia', e);
        nav.legacyGetUserMedia = ourLegacyGetUserMedia;
    }

    // ---------------------------------------------------------------
    // 4. i.Mind's server allows only a few Server-Sent-Events connections
    //    per browser and refuses the page when they pile up. Remember the
    //    EventSource objects this page opens so that the content script can
    //    close them on request (the "reset connections" button).
    // ---------------------------------------------------------------
    const openStreams = new Set();
    if (typeof window.EventSource === 'function') {
        try {
            window.EventSource = new Proxy(window.EventSource, {
                construct: function (target, args, newTarget) {
                    const source = Reflect.construct(target, args, newTarget);
                    for (const old of openStreams) if (old.readyState === 2) openStreams.delete(old);
                    openStreams.add(source);
                    return source;
                }
            });
        } catch (e) {
            console.error('[i.Mind FF fix] could not wrap EventSource', e);
        }
    }

    window.addEventListener('message', function (event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'mind-ff-cmd' || data.type !== 'close-streams') return;
        let closed = 0;
        for (const source of openStreams) {
            if (source.readyState !== 2) { source.close(); closed++; }
        }
        openStreams.clear();
        window.postMessage({ source: 'mind-ff-fix', type: 'event', code: 'streams-closed', count: closed }, '*');
    });

    // ---------------------------------------------------------------
    // 5. Watch the page's WebRTC connections (passively, nothing is changed) so
    //    that "the conference never connects" shows up in the diagnostics log:
    //    whether ICE got connected, failed or hung, and what kinds of addresses
    //    the browser found. Each code is reported a few times at most, because
    //    the site retries and creates a new connection every few seconds.
    // ---------------------------------------------------------------
    const RTC_STUCK_MS = 20000;
    const RTC_REPORTS_PER_CODE = 3;
    const rtcReports = {};
    function rtcNote(code) {
        rtcReports[code] = (rtcReports[code] || 0) + 1;
        if (rtcReports[code] <= RTC_REPORTS_PER_CODE) note(code);
    }

    function watchConnection(pc) {
        const found = {};
        const stuck = setTimeout(function () {
            const state = pc.iceConnectionState;
            if (state === 'connected' || state === 'completed' || state === 'closed') return;
            // Without a remote description ICE has not even started: the server never answered the offer.
            rtcNote(state === 'new' && !pc.remoteDescription ? 'rtc-no-answer' : 'rtc-ice-stuck');
        }, RTC_STUCK_MS);
        pc.addEventListener('iceconnectionstatechange', function () {
            const state = pc.iceConnectionState;
            if (state === 'connected' || state === 'completed') { clearTimeout(stuck); rtcNote('rtc-ice-connected'); }
            else if (state === 'failed') { clearTimeout(stuck); rtcNote('rtc-ice-failed'); }
            else if (state === 'closed') clearTimeout(stuck);
        });
        pc.addEventListener('icecandidate', function (event) {
            if (event.candidate) {
                const match = / typ (host|srflx|prflx|relay)/.exec(event.candidate.candidate || '');
                if (match) found[match[1]] = true;
            } else {
                rtcNote(found.srflx || found.relay ? 'rtc-candidates-public' : 'rtc-candidates-local-only');
                try { reportOfferShape(pc); } catch (e) { /* diagnostics only */ }
            }
        });
    }

    // ---------------------------------------------------------------
    // 6. The shape of the offer the page really sends (what pc.localDescription holds once the
    //    candidates are gathered): sections, codec names, header extension names and the names of
    //    the attributes with their counts. No addresses, fingerprints, ids or other values, so the
    //    lines can be copied into a bug report. At most two offers per page.
    // ---------------------------------------------------------------
    const SHAPE_OFFERS_PER_PAGE = 2;
    const SHAPE_PIECE_LENGTH = 250;
    let shapeOffers = 0;

    function describeOffer(sdp) {
        const sections = [];
        const codecs = {};
        const extensions = [];
        const attributes = {};
        const order = [];
        let kind = '';
        let current = null;
        String(sdp).split(/\r?\n/).forEach(function (line) {
            const media = /^m=(\w+) \d+ [\w\/]+ ?(.*)$/.exec(line);
            if (media) {
                kind = media[1];
                current = { kind: kind, formats: media[2] ? media[2].split(' ').length : 0, direction: '' };
                sections.push(current);
                return;
            }
            const attr = /^a=([\w-]+)(?::(.*))?$/.exec(line);
            if (!attr) return;
            const name = attr[1];
            const value = attr[2] || '';
            if (name === 'rtpmap') {
                const codec = /^\d+ ([^/\s]+)/.exec(value);
                if (codec && kind) {
                    codecs[kind] = codecs[kind] || [];
                    if (codecs[kind].indexOf(codec[1]) < 0) codecs[kind].push(codec[1]);
                }
            } else if (name === 'extmap') {
                const uri = /^\d+(?:\/\w+)? (\S+)/.exec(value);
                const short = uri && uri[1].split(/[\/:]/).filter(Boolean).pop();
                if (short && extensions.indexOf(short) < 0) extensions.push(short);
            } else if (/^(sendrecv|sendonly|recvonly|inactive)$/.test(name) && current) {
                current.direction = name;
            }
            if (!attributes[name]) { attributes[name] = 0; order.push(name); }
            attributes[name]++;
        });
        return {
            sections: sections.map(function (m) { return m.kind + ' ' + (m.direction || 'no-direction') + ' ' + m.formats + ' formats'; }).join('; ') + '; ' + String(sdp).length + ' bytes',
            codecs: Object.keys(codecs).map(function (k) { return k + ': ' + codecs[k].join(', '); }).join('; '),
            extensions: extensions.join(', '),
            attributes: order.map(function (name) { return name + ' x' + attributes[name]; }).join(', ')
        };
    }

    function pieces(text) {
        const out = [];
        let rest = text;
        while (rest.length > SHAPE_PIECE_LENGTH) {
            let cut = Math.max(rest.lastIndexOf(', ', SHAPE_PIECE_LENGTH), rest.lastIndexOf('; ', SHAPE_PIECE_LENGTH));
            if (cut <= 0) cut = SHAPE_PIECE_LENGTH;
            out.push(rest.slice(0, cut).trim());
            rest = rest.slice(cut + 1).trim();
        }
        if (rest) out.push(rest);
        return out;
    }

    function reportOfferShape(pc) {
        if (shapeOffers >= SHAPE_OFFERS_PER_PAGE) return;
        const description = pc.localDescription;
        if (!description || typeof description.sdp !== 'string') return;
        shapeOffers++;
        const shape = describeOffer(description.sdp);
        Object.keys(shape).forEach(function (part) {
            pieces(shape[part]).forEach(function (detail) {
                window.postMessage({ source: 'mind-ff-fix', type: 'event', code: 'rtc-offer-shape', part: part, detail: detail }, '*');
            });
        });
    }

    if (typeof window.RTCPeerConnection === 'function') {
        try {
            window.RTCPeerConnection = new Proxy(window.RTCPeerConnection, {
                construct: function (target, args, newTarget) {
                    const pc = Reflect.construct(target, args, newTarget);
                    try { watchConnection(pc); } catch (e) { /* diagnostics only */ }
                    return pc;
                }
            });
        } catch (e) {
            console.error('[i.Mind FF fix] could not wrap RTCPeerConnection', e);
        }
    }
})();
