// Content script (isolated world). When a favourite was opened from the popup
// with a guest name set, the popup leaves a short-lived "pendingJoin" record.
// After the by-number lookup i.Mind navigates to "#join:t<token>", the page
// that asks for a name. Its place tokenizer is "<token>[,<directLogin>[,<guestName>]]"
// and with directLogin=true it logs in as a guest without asking, so we just
// append ",true,<name>" to that hash.
(async function () {
    'use strict';

    const MAX_AGE_MS = 3 * 60 * 1000;
    const JOIN_HASH = /^#join:([^,]+)$/;

    let pending;
    try {
        pending = (await browser.storage.local.get('pendingJoin')).pendingJoin;
    } catch (e) {
        return;
    }
    if (!pending || typeof pending.name !== 'string' || !pending.name) return;

    const name = pending.name.replace(/,/g, ' ').trim();
    if (!name || Date.now() - pending.at > MAX_AGE_MS) {
        browser.storage.local.remove('pendingJoin');
        return;
    }

    let done = false;

    function finish() {
        done = true;
        window.removeEventListener('hashchange', apply);
        browser.storage.local.remove('pendingJoin');
    }

    function apply() {
        if (done) return;
        if (Date.now() - pending.at > MAX_AGE_MS) {
            finish();
            return;
        }
        const match = JOIN_HASH.exec(location.hash);
        if (!match) return;
        finish();
        location.hash = '#join:' + match[1] + ',true,' + encodeURIComponent(name);
    }

    window.addEventListener('hashchange', apply);
    apply();
})();
