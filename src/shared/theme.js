'use strict';

// Loaded synchronously in <head> of every extension page so the theme is applied
// before the first paint. Two choices live in localStorage (shared by all pages
// of the extension): the mode, "dark" (default), "light" or "system", and the style,
// "prism" (default), "rhythm", "haze", "raster" or "blueprint", the look drawn by theme.css.
var MindTheme = (function () {
    const KEY = 'mind-theme';
    const STYLE_KEY = 'mind-style';
    const MODES = ['dark', 'light', 'system'];
    const LABELS = { dark: 'тёмная', light: 'светлая', system: 'как в системе' };
    const STYLES = ['prism', 'rhythm', 'haze', 'raster', 'blueprint'];
    const STYLE_LABELS = { prism: 'Призма', rhythm: 'Ритм', haze: 'Дымка', raster: 'Растр', blueprint: 'Чертёж' };
    const query = window.matchMedia('(prefers-color-scheme: light)');

    function readMode() {
        try {
            const value = localStorage.getItem(KEY);
            return MODES.includes(value) ? value : 'dark';
        } catch (e) {
            return 'dark';
        }
    }

    function readStyle() {
        try {
            const value = localStorage.getItem(STYLE_KEY);
            return STYLES.includes(value) ? value : 'prism';
        } catch (e) {
            return 'prism';
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
        document.documentElement.dataset.style = readStyle();
    }

    function setMode(mode) {
        if (!MODES.includes(mode)) return;
        try { localStorage.setItem(KEY, mode); } catch (e) { /* theme just won't persist */ }
        apply();
    }

    function setStyle(style) {
        if (!STYLES.includes(style)) return;
        try { localStorage.setItem(STYLE_KEY, style); } catch (e) { /* the style just won't persist */ }
        apply();
    }

    function nextStyle() {
        return STYLES[(STYLES.indexOf(readStyle()) + 1) % STYLES.length];
    }

    function nextMode() {
        const mode = readMode();
        return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    }

    query.addEventListener('change', apply);
    window.addEventListener('storage', apply);
    apply();

    return {
        MODES, LABELS, STYLES, STYLE_LABELS,
        get mode() { return readMode(); },
        get style() { return readStyle(); },
        setMode, nextMode, setStyle, nextStyle
    };
})();
