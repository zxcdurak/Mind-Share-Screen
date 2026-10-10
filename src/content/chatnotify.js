// Optional: notifies about new chat messages while the conference tab is in
// the background. Off unless the user turns it on (storage key "chatNotify").
//
// Messages are the chat "cards" of i.Mind (imarker="cardMarker"), each with
// imarker="userName" and imarker="messageContent" inside. To keep a burst of
// messages (e.g. 40 at the end of a class) from becoming 40 notifications:
//   * the background page always reuses one notification id, so an update only
//     changes the number and the text of the existing notification;
//   * updates are sent at most once per MIN_INTERVAL_MS;
//   * the tab title carries a running counter "(N) ...", which is silent.
// Messages that were already in the chat when the panel appeared are ignored.
(function () {
    'use strict';

    const PANEL = '.external-chatMessagePanel';
    const CARD = '[imarker="cardMarker"]';
    const GRACE_MS = 3000;          // history rendered right after the panel appears
    const MIN_INTERVAL_MS = 1000;
    const MAX_TEXT = 140;
    const MAX_TITLE_COUNT = 99;

    let enabled = false;
    let panel = null;
    let panelSince = 0;
    let observer = null;

    let unread = 0;
    let lastText = '';
    let lastSent = 0;
    let timer = null;
    const counted = new WeakSet();

    browser.storage.local.get('chatNotify').then(s => { enabled = s.chatNotify === true; }, () => {});
    browser.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.chatNotify) return;
        enabled = changes.chatNotify.newValue === true;
        if (!enabled) reset();
    });

    const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

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
        const count = unread;
        browser.runtime.sendMessage({ type: 'chat', count, text: lastText }).then(
            () => MindDiag.log('content', 'chat x' + count + ': passed to the background page', 'notify'),
            e => MindDiag.log('content', 'chat x' + count + ': could not reach the background page: ' + (e && e.message), 'notify'));
    }

    const loggedOnce = new Set();
    function logOnce(key, text) {
        if (loggedOnce.has(key)) return;
        loggedOnce.add(key);
        MindDiag.log('content', text, 'notify');
    }

    function note(text) {
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

    function cardsIn(node) {
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) return [];
        const own = el.closest(CARD);
        return own ? [own] : Array.from(el.querySelectorAll(CARD));
    }

    function considerCard(card) {
        if (counted.has(card)) return;
        const body = card.querySelector('[imarker="messageContent"]');
        const text = clean(body && body.textContent);
        if (!text) return;                       // filled in later: seen again then
        counted.add(card);
        if (performance.now() - panelSince < GRACE_MS) return;

        // Count only what the user can miss: notifications switched on and the tab in the background.
        if (!enabled) {
            logOnce('off', 'сообщение в чате замечено, но уведомления о чате выключены (флажок на странице напоминаний)');
            return;
        }
        if (!document.hidden) {
            logOnce('visible', 'сообщение в чате замечено, вкладка на виду: уведомление не нужно');
            return;
        }

        const nameEl = card.querySelector('[imarker="userName"]');
        // "(10:39) Name: " -> "Name"
        const name = clean(nameEl && nameEl.textContent).replace(/^\(\d{1,2}:\d{2}(:\d{2})?\)\s*/, '').replace(/:$/, '');
        note(name ? name + ': ' + text : text);
    }

    function onMutations(muts) {
        for (const m of muts) {
            if (m.type === 'characterData') {
                cardsIn(m.target).forEach(considerCard);
            } else {
                m.addedNodes.forEach(n => cardsIn(n).forEach(considerCard));
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
        // History present at attach time is marked as counted without notifying.
        panel.querySelectorAll(CARD).forEach(considerCard);
        observer = new MutationObserver(onMutations);
        observer.observe(panel, { childList: true, subtree: true, characterData: true });
    }, 1000);
})();
