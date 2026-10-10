// Optional: notifies about new chat messages while the conference tab is in
// the background. Off unless the user turns it on (storage key "chatNotify").
//
// Flood control, so that a burst of messages (e.g. 40 at the end of a class)
// does not turn into 40 notifications:
//   * the first message is announced at once, further ones are merged and
//     announced at most once per MIN_INTERVAL_MS as "N new messages";
//   * the background page always reuses one notification, so they replace
//     each other instead of stacking;
//   * the tab title carries a running counter "(N) ..." which is silent.
// Messages that were already in the chat when the panel appeared are ignored.
(function () {
    'use strict';

    const PANEL = '.external-chatMessagePanel';
    const GRACE_MS = 3000;          // history rendered right after the panel appears
    const FILL_COALESCE_MS = 300;   // one message filled in piece by piece = one message
    const MIN_INTERVAL_MS = 20000;
    const MAX_TEXT = 140;
    const MAX_TITLE_COUNT = 99;

    let enabled = false;
    let panel = null;
    let panelSince = 0;
    let observer = null;

    let unread = 0;
    let lastText = '';
    let lastSent = 0;
    let lastFill = 0;
    let timer = null;
    const recent = [];              // elements already counted (bounded)

    browser.storage.local.get('chatNotify').then(s => { enabled = s.chatNotify === true; }, () => {});
    browser.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.chatNotify) return;
        enabled = changes.chatNotify.newValue === true;
        if (!enabled) reset();
    });

    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

    function related(el) {
        return recent.some(r => r === el || r.contains(el) || el.contains(r));
    }

    function remember(el) {
        recent.push(el);
        if (recent.length > 60) recent.shift();
    }

    function titleBase() {
        return document.title.replace(/^\(\d+\+?\) /, '');
    }

    function updateTitle() {
        const shown = unread > MAX_TITLE_COUNT ? MAX_TITLE_COUNT + '+' : String(unread);
        document.title = '(' + shown + ') ' + titleBase();
    }

    function flush() {
        timer = null;
        if (!unread || !document.hidden || !enabled) return;
        lastSent = Date.now();
        browser.runtime.sendMessage({ type: 'chat', count: unread, text: lastText }).catch(() => {});
    }

    function note(text) {
        if (!enabled || !document.hidden) return;
        unread++;
        lastText = text.slice(0, MAX_TEXT);
        updateTitle();
        if (!timer) timer = setTimeout(flush, Math.max(0, lastSent + MIN_INTERVAL_MS - Date.now()));
    }

    function reset() {
        const had = unread > 0;
        unread = 0;
        lastSent = 0;
        clearTimeout(timer);
        timer = null;
        if (had) {
            document.title = titleBase();
            browser.runtime.sendMessage({ type: 'chatClear' }).catch(() => {});
        }
    }
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reset(); });

    // `fill` is true when text appeared inside an element that already existed.
    function consider(el, fill) {
        if (!el || el.nodeType !== 1 || !panel || !panel.contains(el) || el === panel) return;
        if (performance.now() - panelSince < GRACE_MS) return;
        if (related(el)) return;
        const own = clean(el.textContent);
        if (!own) return;

        const now = performance.now();
        if (fill && now - lastFill < FILL_COALESCE_MS) { lastFill = now; remember(el); return; }
        if (fill) lastFill = now;

        remember(el);
        const parent = fill && el.parentElement && el.parentElement !== panel ? el.parentElement : el;
        note(clean(parent.textContent) || own);
    }

    function onMutations(muts) {
        if (!enabled || !document.hidden) return;
        for (const m of muts) {
            if (m.type === 'characterData') {
                consider(m.target.parentElement, true);
            } else {
                m.addedNodes.forEach(n => {
                    if (n.nodeType === 1) consider(n, false);
                    else if (n.nodeType === 3) consider(n.parentElement, true);
                });
            }
        }
    }

    setInterval(() => {
        const found = document.querySelector(PANEL);
        if (found === panel) return;
        if (observer) observer.disconnect();
        panel = found;
        if (!panel) return;
        panelSince = performance.now();
        observer = new MutationObserver(onMutations);
        observer.observe(panel, { childList: true, subtree: true, characterData: true });
    }, 1000);
})();
