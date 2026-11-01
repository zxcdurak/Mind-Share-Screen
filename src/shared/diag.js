// Small shared event log for troubleshooting, kept in storage.local so that the
// content scripts, the background page and the diagnostics page all see the
// same entries. Only short technical notes are written here (counts, error
// names); message texts, names and conference numbers never are.
const MindDiag = (() => {
    const KEY = 'diagLog';
    // The user can switch the log off on the diagnostics page; anything but an explicit false means on.
    const ENABLED_KEY = 'diagEnabled';
    const MAX = 150;
    let chain = Promise.resolve();

    // kind groups entries by feature: share, chat, notify, remind, data, page, problem.
    function log(source, text, kind) {
        const entry = { t: Date.now(), s: source, k: kind || 'page', m: String(text).slice(0, 300) };
        chain = chain.then(async () => {
            const stored = await browser.storage.local.get([KEY, ENABLED_KEY]);
            if (stored[ENABLED_KEY] === false) return;
            const list = Array.isArray(stored[KEY]) ? stored[KEY] : [];
            list.push(entry);
            await browser.storage.local.set({ [KEY]: list.slice(-MAX) });
        }).catch(() => {});
        return chain;
    }

    async function read() {
        const stored = await browser.storage.local.get(KEY);
        return Array.isArray(stored[KEY]) ? stored[KEY] : [];
    }

    function clear() {
        return browser.storage.local.remove(KEY);
    }

    async function isEnabled() {
        const stored = await browser.storage.local.get(ENABLED_KEY);
        return stored[ENABLED_KEY] !== false;
    }

    function setEnabled(on) {
        return browser.storage.local.set({ [ENABLED_KEY]: !!on });
    }

    return { KEY, ENABLED_KEY, log, read, clear, isEnabled, setEnabled };
})();
