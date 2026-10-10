// Workaround for the chat input (GWT RichTextArea iframe) that sometimes never
// initialises in Firefox. The app re-parents the iframe several times within a
// single task; Firefox then never delivers the iframe's "load" event, which is
// what the GWT editor waits for. The chat input panel stays display:none and the
// iframe stays 0x0. If that state persists, we re-deliver the missing event.
(function () {
    'use strict';

    const SEL = 'iframe.external-chat-emptyText';
    const t0 = performance.now();
    const log = (...a) => console.log('[imind-fix +' + Math.round(performance.now() - t0) + 'ms]', ...a);

    const note = code => window.postMessage({ source: 'mind-ff-fix', type: 'event', code: code }, '*');

    let lastAdd = 0;
    let attempts = 0;
    let lastAttempt = 0;

    new MutationObserver(muts => {
        for (const m of muts) {
            m.addedNodes.forEach(n => {
                if (n.nodeType !== 1) return;
                const f = n.matches && n.matches(SEL) ? n : (n.querySelector ? n.querySelector(SEL) : null);
                if (f) lastAdd = performance.now();
            });
        }
    }).observe(document, { childList: true, subtree: true });

    const initialised = f => {
        const panel = f.closest('.external-chat-inputPanel');
        return !panel || panel.style.display !== 'none';
    };

    let ticks = 0;
    const timer = setInterval(() => {
        if (++ticks > 240) { clearInterval(timer); return; }   // ~60 s

        const f = document.querySelector(SEL);
        if (!f || !f.isConnected) return;

        if (initialised(f)) {
            if (attempts) { log('chat editor initialised after', attempts, 'attempt(s)'); note('chat-recovered'); attempts = 0; }
            return;
        }

        const now = performance.now();
        if (now - lastAdd < 800 || now - lastAttempt < 1500) return;
        lastAttempt = now;
        attempts++;

        try {
            if (attempts === 1) {
                log('chat editor not initialised; dispatching the missing load event');
                note('chat-load-event');
                f.dispatchEvent(new Event('load'));
            } else if (attempts === 2) {
                log('still not initialised; reloading the editor iframe');
                note('chat-reload');
                f.src = 'about:blank';
            } else {
                log('giving up');
                window.postMessage({ source: 'mind-ff-fix', type: 'problem', code: 'chat-stuck' }, '*');
                clearInterval(timer);
            }
        } catch (e) {
            log('attempt failed', e);
        }
    }, 250);
})();
