(function () {
    'use strict';

    // Firefox WebExtension content scripts run in an isolated world, like
    // Tampermonkey's default sandbox. window.wrappedJSObject is Firefox's
    // supported way to reach the page's real, unprivileged globals (the
    // equivalent of Tampermonkey's unsafeWindow).
    const win = window.wrappedJSObject;
    const nav = win.navigator;

    // ---------------------------------------------------------------
    // 1. i.Mind hides the "share screen" button entirely unless
    //    navigator.userAgent looks like Chrome/IE/Yandex. We spoof it
    //    here (scoped to this site only) so the button shows up, and
    //    so getScreenMedia() (webrtc.nocache.js) takes its Chrome
    //    ("34+, needs extension") branch, which we then fulfil below
    //    with real browser APIs instead of a real Chrome extension.
    // ---------------------------------------------------------------
    const FAKE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    try {
        Object.defineProperty(nav, 'userAgent', { get: () => FAKE_UA, configurable: true });
        Object.defineProperty(nav, 'appVersion', { get: () => FAKE_UA.replace('Mozilla/', ''), configurable: true });
        Object.defineProperty(nav, 'vendor', { get: () => 'Google Inc.', configurable: true });
    } catch (e) {
        console.error('[i.Mind FF fix] could not override navigator.userAgent', e);
    }

    // ---------------------------------------------------------------
    // 2. Emulate the "Mind Screen Sharing" Chrome extension's
    //    getScreen / gotScreen postMessage handshake (content.js +
    //    background.js), but back it with Firefox's real native
    //    getDisplayMedia() screen picker instead of
    //    chrome.desktopCapture (which doesn't exist here).
    // ---------------------------------------------------------------
    const pendingStreams = new Map();
    let counter = 1;

    win.addEventListener('message', function (event) {
        if (event.source !== win) return;
        const data = event.data;
        if (!data || typeof data !== 'object') return;

        if (data.type === 'getScreen') {
            const id = counter++;

            const streamPromise = nav.mediaDevices.getDisplayMedia({ video: true, audio: true })
                .catch(function (err) {
                    console.warn('[i.Mind FF fix] getDisplayMedia failed:', err);
                    return null;
                });
            pendingStreams.set(id, streamPromise);

            win.postMessage(Object.assign({}, data, { type: 'getScreenPending', request: id }), '*');

            streamPromise.then(function (stream) {
                win.postMessage(Object.assign({}, data, {
                    type: 'gotScreen',
                    sourceId: stream ? ('firefox-native-' + id) : ''
                }), '*');
            });
        }

        if (data.type === 'cancelGetScreen') {
            win.postMessage(Object.assign({}, data, { type: 'canceledGetScreen' }), '*');
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
    function ourLegacyGetUserMedia(constraints, onSuccess, onFailure) {
        const v = constraints && constraints.video;
        const isDesktopCapture = v && v.mandatory && v.mandatory.chromeMediaSource === 'desktop';

        if (isDesktopCapture) {
            const last = Array.from(pendingStreams.values()).pop();
            if (last) {
                last.then(function (stream) {
                    if (!stream) {
                        onFailure(new win.DOMException('Permission denied', 'NotAllowedError'));
                    } else {
                        onSuccess(stream);
                    }
                });
                return;
            }
        }

        onFailure(new win.DOMException('Not supported', 'NotSupportedError'));
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
})();
