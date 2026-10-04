'use strict';

// Loaded synchronously in <head> of every extension page so the theme is applied
// before the first paint. The choice lives in localStorage (shared by all pages
// of the extension): "dark" (default), "light" or "system".
var MindTheme = (function () {
    const KEY = 'mind-theme';
    const MODES = ['dark', 'light', 'system'];
    const LABELS = { dark: 'тёмная', light: 'светлая', system: 'как в системе' };
    const query = window.matchMedia('(prefers-color-scheme: light)');

    function readMode() {
        try {
            const value = localStorage.getItem(KEY);
            return MODES.includes(value) ? value : 'dark';
        } catch (e) {
            return 'dark';
        }
    }

    function resolve(mode) {
        if (mode === 'system') return query.matches ? 'light' : 'dark';
        return mode;
    }

    function apply() {
        const mode = readMode();
        document.documentElement.dataset.theme = resolve(mode);
        document.documentElement.dataset.themeMode = mode;
    }

    function setMode(mode) {
        if (!MODES.includes(mode)) return;
        try { localStorage.setItem(KEY, mode); } catch (e) { /* theme just won't persist */ }
        apply();
    }

    function nextMode() {
        const mode = readMode();
        return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    }

    query.addEventListener('change', apply);
    window.addEventListener('storage', apply);
    apply();

    return { MODES, LABELS, get mode() { return readMode(); }, setMode, nextMode };
})();
