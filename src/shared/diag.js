// Small shared event log for troubleshooting, kept in storage.local so that the
// content scripts, the background page and the diagnostics page all see the
// same entries. Only short technical notes are written here (counts, error
// names); message texts, names and conference numbers never are.
const MindDiag = (() => {
    const KEY = 'diagLog';
    const MAX = 60;
    let chain = Promise.resolve();

    function log(source, text) {
        const entry = { t: Date.now(), s: source, m: String(text).slice(0, 300) };
        chain = chain.then(async () => {
            const stored = await browser.storage.local.get(KEY);
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

    return { KEY, log, read, clear };
})();
