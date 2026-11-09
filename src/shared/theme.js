'use strict';

// Loaded synchronously in <head> of every extension page so the theme is applied
// before the first paint. Two choices live in localStorage (shared by all pages
// of the extension): the mode, "dark" (default), "light" or "system", and the style,
// "prism" (default), "rhythm", "haze", "raster" or "blueprint", the look drawn by theme.css, or "custom:<id>", one of
// the user's own themes (kept in localStorage too, see below).
var MindTheme = (function () {
    const KEY = 'mind-theme';
    const STYLE_KEY = 'mind-style';
    const MODES = ['dark', 'light', 'system'];
    const LABELS = { dark: 'тёмная', light: 'светлая', system: 'как в системе' };
    const STYLES = ['prism', 'rhythm', 'haze', 'raster', 'blueprint'];
    const STYLE_LABELS = { prism: 'Призма', rhythm: 'Ритм', haze: 'Дымка', raster: 'Растр', blueprint: 'Чертёж' };
    const query = window.matchMedia('(prefers-color-scheme: light)');

    // ---- the user's own themes ----
    // A theme made by an AI (see src/customtheme/) is pasted as a small JSON description: a few colours per mode, a few
    // shape options and, if the AI wants, a list of background details (glows, shapes, lines, dots, gradients). It is never
    // used as CSS or SVG: it is checked here, and every variable of theme.css and every piece of the background picture is
    // built from the checked numbers, names from fixed lists and #RRGGBB colours, so nothing the AI wrote can reach the
    // page as style text or markup. A description that does not pass the check is refused with a list of what is wrong.
    // Several themes can be kept; the style value of a saved theme is "custom:<id>".
    const CUSTOM = 'custom';
    const CUSTOM_PREFIX = 'custom:';
    const CUSTOM_LIST_KEY = 'mind-custom-themes';
    const CUSTOM_OLD_KEY = 'mind-custom-theme';       // the single theme of the first version, moved into the list
    const CUSTOM_STYLE_ID = 'mind-custom-theme-css';
    const MAX_THEMES = 12;
    const MAX_DECOR = 24;
    const OPTIONS = {
        radius: { sharp: ['2px', '2px', '2px'], soft: ['12px', '10px', '8px'], round: ['22px', '999px', '14px'] },   // panel, button, field
        border: { thin: '1px', normal: '2px', thick: '3px' },
        font: {
            system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            serif: 'Georgia, "Times New Roman", serif',
            mono: 'ui-monospace, Consolas, "Courier New", monospace',
            rounded: 'ui-rounded, "Segoe UI Variable Display", "Trebuchet MS", sans-serif'
        }
    };
    const COLOR_KEYS = ['bg', 'surface', 'fg', 'muted', 'accent', 'accent2'];
    const OPTIONAL_COLOR_KEYS = ['link', 'warn'];
    const DEFAULT_SHAPE = { radius: 'soft', border: 'thin', font: 'system', glass: true, glow: 0.5, grain: 0 };
    const DECOR_TYPES = ['glow', 'shape', 'lines', 'dots', 'gradient', 'svg'];
    const DECOR_SHAPES = ['circle', 'ring', 'square', 'triangle', 'diamond', 'cross', 'arc'];
    const LINE_PATTERNS = ['diagonal', 'horizontal', 'vertical', 'grid'];
    const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

    const toRgb = hex => { let h = hex.slice(1); if (h.length === 3) h = h.replace(/./g, '$&$&'); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
    const toHex = rgb => '#' + rgb.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    const triplet = rgb => rgb.map(v => Math.round(v)).join(', ');
    const round = (n, digits) => { const k = Math.pow(10, digits || 2); return Math.round(n * k) / k; };
    const luminance = rgb => {
        const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const readableOn = rgb => contrast([0, 0, 0], rgb) >= contrast([255, 255, 255], rgb) ? '#000000' : '#FFFFFF';
    const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

    // ---- SVG pictures written by the AI ----
    // The markup is read by a small strict parser of our own and the picture is built anew from what is allowed:
    // known elements, known attributes, values of a known shape. Everything else is refused with a message, so the browser's
    // own parser never sees the text of the AI. The result is used only as a CSS background image, which a browser draws
    // statically: no scripts, no outside files, no clicks. Colours may be written as $bg $surface $fg $muted $accent $accent2;
    // they are replaced with the colours of the palette when the picture is drawn, so one picture serves both modes.
    const SVG_MAX_CHARS = 16000;
    const SVG_MAX_NODES = 300;
    const SVG_MAX_DEPTH = 8;
    const SVG_MAX_PICTURES = 3;
    const SVG_ELEMENTS = ['svg', 'g', 'defs', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
        'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern', 'filter', 'feGaussianBlur'];
    const SVG_HARMLESS = ['title', 'desc', 'metadata'];       // dropped without a word
    const SVG_NAMES = {};
    SVG_ELEMENTS.forEach(n => { SVG_NAMES[n.toLowerCase()] = n; });
    const NUMBER = '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
    const RE = {
        number: new RegExp('^' + NUMBER + '(?:%|px)?$'),
        viewBox: new RegExp('^' + NUMBER + '(?:[ ,]+' + NUMBER + '){3}$'),
        list: /^[\d\s,.eE+-]{1,2000}$/,
        path: /^[MmLlHhVvCcSsQqTtAaZz\d\s,.eE+-]{1,6000}$/,
        transform: /^(?:(?:translate|rotate|scale|skewX|skewY|matrix)\([\d\s,.eE+-]*\)\s*)+$/,
        id: /^[A-Za-z][\w-]{0,30}$/,
        ref: /^url\(#([A-Za-z][\w-]{0,30})\)$/,
        colour: /^(?:none|transparent|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6}|rgba?\([\d\s,.%]{1,40}\)|\$(?:bg|surface|fg|muted|accent2|accent)|white|black)$/,
        aspect: /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?$/
    };
    const SVG_ATTRS = {};                                   // lowercase name -> [canonical name, kind]
    const attrKinds = {
        number: ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy', 'fr', 'width', 'height', 'offset', 'opacity',
            'fill-opacity', 'stroke-opacity', 'stop-opacity', 'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'stdDeviation'],
        list: ['points', 'stroke-dasharray'],
        colour: ['fill', 'stroke', 'stop-color'],
        ref: ['clip-path', 'mask', 'filter'],
        transform: ['transform', 'gradientTransform', 'patternTransform'],
        id: ['id', 'result'],
        path: ['d'],
        viewBox: ['viewBox'],
        aspect: ['preserveAspectRatio'],
        units: ['gradientUnits', 'patternUnits', 'clipPathUnits', 'maskUnits', 'maskContentUnits', 'patternContentUnits', 'filterUnits', 'primitiveUnits'],
        rule: ['fill-rule', 'clip-rule'],
        cap: ['stroke-linecap'], join: ['stroke-linejoin'], spread: ['spreadMethod'], inputs: ['in']
    };
    for (const kind of Object.keys(attrKinds)) attrKinds[kind].forEach(n => { SVG_ATTRS[n.toLowerCase()] = [n, kind]; });
    const SVG_ENUMS = {
        units: ['userSpaceOnUse', 'objectBoundingBox'], rule: ['nonzero', 'evenodd'], cap: ['butt', 'round', 'square'],
        join: ['miter', 'round', 'bevel'], spread: ['pad', 'reflect', 'repeat'], inputs: ['SourceGraphic']
    };
    const SVG_IGNORED = ['xmlns', 'xmlns:xlink', 'version', 'class', 'xml:space'];     // dropped without a word

    function checkSvgValue(kind, value) {
        if (kind === 'number') return RE.number.test(value);
        if (kind === 'list') return RE.list.test(value);
        if (kind === 'colour') return RE.colour.test(value) || RE.ref.test(value);
        if (kind === 'ref') return value === 'none' || RE.ref.test(value);
        if (kind === 'transform') return value.length <= 400 && RE.transform.test(value);
        if (kind === 'id') return RE.id.test(value);
        if (kind === 'path') return RE.path.test(value);
        if (kind === 'viewBox') return RE.viewBox.test(value);
        if (kind === 'aspect') return RE.aspect.test(value);
        return SVG_ENUMS[kind].includes(value);
    }

    // text -> { tree, ids, refs } or null with the reasons in errors
    function parseSvg(source, path, errors) {
        let text = String(source).trim();
        if (text.length > SVG_MAX_CHARS) { errors.push(path + ': SVG слишком длинный (' + text.length + ' знаков, можно ' + SVG_MAX_CHARS + ').'); return null; }
        text = text.replace(/^<\?xml[^>]*\?>/i, '').replace(/<!--[\s\S]*?-->/g, '').trim();
        if (/<!|<\?|<!\[CDATA\[/i.test(text)) { errors.push(path + ': в SVG нельзя использовать DOCTYPE, CDATA и инструкции <? ?>.'); return null; }
        const open = /^<([A-Za-z][\w:-]*)((?:\s+[A-Za-z_:][\w:.-]*\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*)\s*(\/?)>/;
        const attrRe = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/g;
        const stack = [];
        let root = null, nodes = 0, pos = 0;
        const ids = new Set(), refs = [];
        const fail = message => { errors.push(path + ': ' + message); return null; };
        while (pos < text.length) {
            if (text[pos] !== '<') {
                const end = text.indexOf('<', pos);
                const chunk = text.slice(pos, end < 0 ? text.length : end);
                const inside = stack[stack.length - 1];
                if (chunk.trim() && !(inside && inside.skip)) return fail('внутри SVG не должно быть текста.');
                pos = end < 0 ? text.length : end;
                continue;
            }
            const rest = text.slice(pos);
            const close = /^<\/([A-Za-z][\w:-]*)\s*>/.exec(rest);
            if (close) {
                const top = stack.pop();
                if (!top || top.source !== close[1]) return fail('теги закрыты не по порядку (</' + close[1] + '>).');
                pos += close[0].length;
                continue;
            }
            const m = open.exec(rest);
            if (!m) return fail('не удалось разобрать тег рядом с «' + rest.slice(0, 24).replace(/\s+/g, ' ') + '».');
            pos += m[0].length;
            const source = m[1], lower = source.toLowerCase();
            const selfClosing = m[3] === '/';
            const harmless = SVG_HARMLESS.includes(lower);
            const name = SVG_NAMES[lower];
            if (!harmless && !name) return fail('элемент <' + source.slice(0, 20) + '> не разрешён. Можно: ' + SVG_ELEMENTS.join(', ') + '.');
            const parent = stack[stack.length - 1];
            const node = { name, source, attrs: {}, children: [], skip: harmless || (parent && parent.skip) };
            if (!node.skip) {
                if (++nodes > SVG_MAX_NODES) return fail('в SVG больше ' + SVG_MAX_NODES + ' элементов.');
                if (stack.length >= SVG_MAX_DEPTH) return fail('вложенность в SVG глубже ' + SVG_MAX_DEPTH + ' уровней.');
                if (!root) { if (name !== 'svg') return fail('главным элементом должен быть <svg>.'); root = node; }
                else if (!parent) return fail('в тексте больше одного корневого элемента.');
                let attr;
                attrRe.lastIndex = 0;
                const attrText = m[2];
                while ((attr = attrRe.exec(attrText))) {
                    const key = attr[1], value = (attr[2] !== undefined ? attr[2] : attr[3]).trim();
                    const lowerKey = key.toLowerCase();
                    if (SVG_IGNORED.includes(lowerKey)) continue;
                    if (name === 'svg' && (lowerKey === 'width' || lowerKey === 'height')) continue;     // the size comes from the background rules
                    const spec = SVG_ATTRS[lowerKey];
                    if (!spec) return fail('атрибут «' + key.slice(0, 24) + '» не разрешён (style, class, href, on… использовать нельзя: цвета пишите в fill и stroke).');
                    if (value.includes('&')) return fail('в значении «' + key + '» нельзя использовать &.');
                    if (!checkSvgValue(spec[1], value)) return fail('значение «' + value.slice(0, 30) + '» у атрибута ' + key + ' не подходит.');
                    if (spec[0] === 'stdDeviation' && Number(value) > 30) return fail('stdDeviation не больше 30.');
                    if (spec[1] === 'id') { if (spec[0] === 'id') { if (ids.has(value)) return fail('id «' + value + '» повторяется.'); ids.add(value); } }
                    const ref = /url\(#([^)]+)\)/.exec(value);
                    if (ref) refs.push(ref[1]);
                    node.attrs[spec[0]] = value;
                }
                if (parent && !parent.skip) parent.children.push(node);
            }
            if (!selfClosing) stack.push(node);
        }
        if (stack.length) return fail('не закрыт тег <' + stack[stack.length - 1].source + '>.');
        if (!root) return fail('не найден элемент <svg>.');
        if (!root.attrs.viewBox) return fail('у <svg> обязателен viewBox, например viewBox="0 0 100 100".');
        const missing = refs.find(id => !ids.has(id));
        if (missing) return fail('ссылка url(#' + missing + ') ведёт на несуществующий id.');
        return { tree: root };
    }

    // The picture, written anew from the checked tree.
    function writeSvg(node) {
        const attrs = Object.keys(node.attrs).map(k => ' ' + k + '="' + node.attrs[k] + '"').join('');
        const head = node.name === 'svg' ? '<svg xmlns="http://www.w3.org/2000/svg"' : '<' + node.name;
        if (!node.children.length) return head + attrs + '/>';
        return head + attrs + '>' + node.children.map(writeSvg).join('') + '</' + node.name + '>';
    }

    // text -> the normalised markup or null
    function sanitizeSvg(source, path, errors) {
        const parsed = parseSvg(source, path, errors);
        if (!parsed) return null;
        delete parsed.tree.attrs.opacity;       // the strength of the whole picture is the "opacity" of the detail
        return writeSvg(parsed.tree);
    }

    // One detail of the background. Missing fields get defaults, wrong ones are reported with the place where they are.
    function sanitizeDecor(item, path, errors) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push(path + ': нужен объект { ... }.'); return null; }
        if (!DECOR_TYPES.includes(item.type)) { errors.push(path + '.type: можно ' + DECOR_TYPES.join(', ') + '.'); return null; }
        const out = { type: item.type };
        const num = (key, min, max, def) => {
            if (item[key] === undefined) return def;
            const v = Number(item[key]);
            if (typeof item[key] === 'boolean' || item[key] === null || !Number.isFinite(v) || v < min || v > max) {
                errors.push(path + '.' + key + ': нужно число от ' + min + ' до ' + max + '.');
                return def;
            }
            return round(v);
        };
        const colour = (value, key, def) => {
            if (value === undefined) return def;
            if (typeof value === 'string' && COLOR_KEYS.includes(value.trim())) return value.trim();
            if (typeof value === 'string' && HEX.test(value.trim())) return toHex(toRgb(value.trim()));
            errors.push(path + '.' + key + ': «' + String(value).slice(0, 20) + '» не имя цвета палитры (' + COLOR_KEYS.join(', ') + ') и не #RRGGBB.');
            return def;
        };
        const choice = (key, list, def) => {
            if (item[key] === undefined) return def;
            if (typeof item[key] === 'string' && list.includes(item[key])) return item[key];
            errors.push(path + '.' + key + ': можно ' + list.join(', ') + '.');
            return def;
        };
        if (item.type === 'glow') {
            Object.assign(out, { x: num('x', -20, 120, 50), y: num('y', -20, 120, 50), size: num('size', 5, 200, 50), color: colour(item.color, 'color', 'accent'), opacity: num('opacity', 0, 0.8, 0.2) });
        } else if (item.type === 'shape') {
            if (item.fill !== undefined && typeof item.fill !== 'boolean') errors.push(path + '.fill: нужно true или false.');
            Object.assign(out, {
                shape: choice('shape', DECOR_SHAPES, 'circle'), x: num('x', -20, 120, 50), y: num('y', -20, 120, 50), size: num('size', 1, 150, 20),
                rotate: num('rotate', -360, 360, 0), color: colour(item.color, 'color', 'accent'), opacity: num('opacity', 0, 0.8, 0.25),
                fill: item.fill === true, stroke: num('stroke', 0.05, 4, 0.4)
            });
        } else if (item.type === 'lines') {
            Object.assign(out, { pattern: choice('pattern', LINE_PATTERNS, 'diagonal'), gap: num('gap', 1, 60, 6), width: num('width', 0.02, 3, 0.15), color: colour(item.color, 'color', 'fg'), opacity: num('opacity', 0, 0.8, 0.08) });
        } else if (item.type === 'dots') {
            Object.assign(out, { gap: num('gap', 1, 40, 4), size: num('size', 0.05, 5, 0.3), color: colour(item.color, 'color', 'fg'), opacity: num('opacity', 0, 0.8, 0.1) });
        } else if (item.type === 'svg') {
            out.fit = choice('fit', ['cover', 'contain', 'tile'], 'cover');
            out.tile = num('tile', 20, 400, 120);
            out.opacity = num('opacity', 0, 1, 0.6);
            if (typeof item.svg === 'string') out.svg = sanitizeSvg(item.svg, path + '.svg', errors);
            else errors.push(path + '.svg: нужна строка с разметкой <svg ...>...</svg>.');
            if (!out.svg) return null;
        } else {
            out.angle = num('angle', 0, 360, 160);
            out.opacity = num('opacity', 0, 0.8, 0.15);
            out.stops = [];
            if (!Array.isArray(item.stops) || item.stops.length < 2 || item.stops.length > 5) {
                errors.push(path + '.stops: нужен список из 2-5 пар [цвет, положение 0-100].');
            } else {
                item.stops.forEach((stop, i) => {
                    const [c, at] = Array.isArray(stop) ? stop : [stop && stop.color, stop && stop.at];
                    const pos = Number(at);
                    const col = colour(c, 'stops[' + i + ']', null);
                    if (col === null) { if (c === undefined) errors.push(path + '.stops[' + i + ']: нет цвета.'); return; }
                    if (typeof at === 'boolean' || at === null || !Number.isFinite(pos) || pos < 0 || pos > 100) { errors.push(path + '.stops[' + i + ']: положение нужно числом от 0 до 100.'); return; }
                    out.stops.push([col, round(pos)]);
                });
            }
        }
        return out;
    }

    // -> { ok, theme (normalised), errors: [text], warnings: [text] }
    function sanitizeCustom(raw) {
        const errors = [], warnings = [];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { ok: false, errors: ['Ответ должен быть JSON-объектом вида { ... }.'], warnings };
        }
        const theme = { v: 2, name: 'Своя тема', shape: Object.assign({}, DEFAULT_SHAPE), dark: {}, light: {}, decor: [] };
        if (typeof raw.name === 'string') {
            const name = raw.name.replace(/[^\p{L}\p{N} .,!?+\-_()«»]/gu, '').trim().slice(0, 32);
            if (name) theme.name = name;
        }

        const shape = raw.shape && typeof raw.shape === 'object' ? raw.shape : {};
        for (const key of ['radius', 'border', 'font']) {
            if (shape[key] === undefined) continue;
            if (typeof shape[key] === 'string' && has(OPTIONS[key], shape[key])) theme.shape[key] = shape[key];
            else errors.push('shape.' + key + ': «' + String(shape[key]).slice(0, 20) + '» не подходит, можно: ' + Object.keys(OPTIONS[key]).join(', ') + '.');
        }
        if (shape.glass !== undefined) {
            if (typeof shape.glass === 'boolean') theme.shape.glass = shape.glass;
            else errors.push('shape.glass: нужно true или false.');
        }
        for (const key of ['glow', 'grain']) {
            if (shape[key] === undefined) continue;
            const value = Number(shape[key]);
            if (typeof shape[key] !== 'boolean' && shape[key] !== null && Number.isFinite(value) && value >= 0 && value <= 1) theme.shape[key] = value;
            else errors.push('shape.' + key + ': нужно число от 0 до 1.');
        }

        for (const mode of ['dark', 'light']) {
            const source = raw[mode];
            if (!source || typeof source !== 'object') { errors.push('Нет палитры «' + mode + '».'); continue; }
            for (const key of COLOR_KEYS.concat(OPTIONAL_COLOR_KEYS)) {
                const value = source[key];
                if (value === undefined) {
                    if (COLOR_KEYS.includes(key)) errors.push(mode + '.' + key + ': не хватает цвета.');
                    continue;
                }
                if (typeof value !== 'string' || !HEX.test(value.trim())) {
                    errors.push(mode + '.' + key + ': «' + String(value).slice(0, 20) + '» не цвет вида #RRGGBB.');
                    continue;
                }
                theme[mode][key] = toHex(toRgb(value.trim()));
            }
        }

        if (raw.decor !== undefined) {
            if (!Array.isArray(raw.decor)) errors.push('decor: нужен список { ... }.');
            else if (raw.decor.length > MAX_DECOR) errors.push('decor: слишком много деталей (' + raw.decor.length + '), можно не больше ' + MAX_DECOR + '.');
            else raw.decor.forEach((item, i) => { const d = sanitizeDecor(item, 'decor[' + i + ']', errors); if (d) theme.decor.push(d); });
        }
        if (theme.decor.filter(d => d.type === 'svg').length > SVG_MAX_PICTURES) errors.push('decor: рисунков svg не больше ' + SVG_MAX_PICTURES + '.');
        if (errors.length) return { ok: false, errors, warnings };

        for (const mode of ['dark', 'light']) {
            const c = theme[mode], bg = toRgb(c.bg);
            const text = Math.min(contrast(toRgb(c.fg), bg), contrast(toRgb(c.fg), toRgb(c.surface)));
            if (text < 3) errors.push(mode + ': текст почти не виден на фоне (контраст ' + text.toFixed(1) + ', нужно хотя бы 3).');
            else if (text < 4.5) warnings.push(mode + ': текст читается не очень хорошо (контраст ' + text.toFixed(1) + ', лучше от 4.5).');
            if (contrast(toRgb(c.muted), bg) < 3) warnings.push(mode + ': подписи (muted) плохо видны на фоне.');
            if (contrast(toRgb(c.accent), bg) < 1.5) warnings.push(mode + ': главный цвет (accent) почти сливается с фоном.');
        }
        return { ok: !errors.length, theme, errors, warnings };
    }

    // The background picture of one mode: glows and gradients are CSS layers, shapes, lines and dots are drawn into SVG
    // images (one per run of such details). The list of the AI is ordered from the bottom up, CSS wants the top first.
    function decorLayers(theme, mode) {
        const palette = theme[mode];
        const rgb = ref => toRgb(COLOR_KEYS.includes(ref) ? palette[ref] : ref);
        const hex = ref => toHex(rgb(ref));
        const rgba = (ref, a) => 'rgba(' + triplet(rgb(ref)) + ', ' + a + ')';
        const layers = [];
        let parts = [], defs = [], n = 0;
        const flush = () => {
            if (!parts.length) return;
            const doc = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><defs>'
                + defs.join('') + '</defs>' + parts.join('') + '</svg>';
            layers.push('url("data:image/svg+xml,' + encodeURIComponent(doc) + '") center / cover no-repeat');
            parts = []; defs = [];
        };
        for (const d of theme.decor) {
            if (d.type === 'glow') {
                flush();
                layers.push('radial-gradient(' + d.size + '% ' + d.size + '% at ' + d.x + '% ' + d.y + '%, ' + rgba(d.color, d.opacity) + ', transparent 70%)');
            } else if (d.type === 'gradient') {
                flush();
                layers.push('linear-gradient(' + d.angle + 'deg, ' + d.stops.map(s => rgba(s[0], d.opacity) + ' ' + s[1] + '%').join(', ') + ')');
            } else if (d.type === 'svg') {
                flush();
                const doc = d.svg.replace('<svg ', '<svg opacity="' + d.opacity + '" ')
                    .replace(/\$(bg|surface|fg|muted|accent2|accent)/g, (all, key) => toHex(toRgb(palette[key])));
                const place = d.fit === 'tile' ? '0 0 / ' + d.tile + 'px ' + d.tile + 'px repeat' : 'center / ' + d.fit + ' no-repeat';
                layers.push('url("data:image/svg+xml,' + encodeURIComponent(doc) + '") ' + place);
            } else if (d.type === 'shape') {
                const c = hex(d.color), r = d.size / 2;
                const paint = d.fill && d.shape !== 'ring' && d.shape !== 'cross' && d.shape !== 'arc'
                    ? 'fill="' + c + '" fill-opacity="' + d.opacity + '" stroke="none"'
                    : 'fill="none" stroke="' + c + '" stroke-opacity="' + d.opacity + '" stroke-width="' + d.stroke + '" stroke-linecap="round" stroke-linejoin="round"';
                const turn = d.rotate + (d.shape === 'diamond' ? 45 : 0);
                const at = ' transform="rotate(' + turn + ' ' + d.x + ' ' + d.y + ')"';
                let shape;
                if (d.shape === 'circle' || d.shape === 'ring') shape = '<circle cx="' + d.x + '" cy="' + d.y + '" r="' + r + '" ' + paint + '/>';
                else if (d.shape === 'square' || d.shape === 'diamond') shape = '<rect x="' + round(d.x - r * 0.85) + '" y="' + round(d.y - r * 0.85) + '" width="' + round(r * 1.7) + '" height="' + round(r * 1.7) + '" ' + paint + at + '/>';
                else if (d.shape === 'triangle') shape = '<polygon points="' + d.x + ',' + round(d.y - r) + ' ' + round(d.x + r * 0.87) + ',' + round(d.y + r * 0.5) + ' ' + round(d.x - r * 0.87) + ',' + round(d.y + r * 0.5) + '" ' + paint + at + '/>';
                else if (d.shape === 'cross') shape = '<path d="M' + round(d.x - r) + ' ' + d.y + 'H' + round(d.x + r) + 'M' + d.x + ' ' + round(d.y - r) + 'V' + round(d.y + r) + '" ' + paint + at + '/>';
                else shape = '<path d="M' + round(d.x + r) + ' ' + d.y + 'A' + r + ' ' + r + ' 0 1 1 ' + d.x + ' ' + round(d.y - r) + '" ' + paint + at + '/>';
                parts.push(shape);
            } else if (d.type === 'lines') {
                const id = 'p' + (++n), c = hex(d.color);
                const angle = d.pattern === 'diagonal' ? 45 : d.pattern === 'vertical' ? 90 : 0;
                const stroke = 'stroke="' + c + '" stroke-opacity="' + d.opacity + '" stroke-width="' + d.width + '" fill="none"';
                const path = d.pattern === 'grid' ? 'M0 0H' + d.gap + 'M0 0V' + d.gap : 'M0 0H' + d.gap;
                defs.push('<pattern id="' + id + '" width="' + d.gap + '" height="' + d.gap + '" patternUnits="userSpaceOnUse" patternTransform="rotate(' + angle + ')"><path d="' + path + '" ' + stroke + '/></pattern>');
                parts.push('<rect width="100" height="100" fill="url(#' + id + ')"/>');
            } else if (d.type === 'dots') {
                const id = 'p' + (++n);
                defs.push('<pattern id="' + id + '" width="' + d.gap + '" height="' + d.gap + '" patternUnits="userSpaceOnUse"><circle cx="' + round(d.gap / 2) + '" cy="' + round(d.gap / 2) + '" r="' + round(d.size / 2) + '" fill="' + hex(d.color) + '" fill-opacity="' + d.opacity + '"/></pattern>');
                parts.push('<rect width="100" height="100" fill="url(#' + id + ')"/>');
            }
        }
        flush();
        return layers.reverse();
    }

    // The grain over everything: a fixed noise picture, only its strength comes from the theme.
    const GRAIN = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>') + '")';

    // The CSS of one saved theme: for each mode one block that defines every variable theme.css reads.
    function customCss(theme) {
        const s = theme.shape, g = s.glow;
        const radius = OPTIONS.radius[s.radius];
        return ['dark', 'light'].map(mode => {
            const c = theme[mode];
            const B = toRgb(c.bg), S = toRgb(c.surface), F = toRgb(c.fg), M = toRgb(c.muted), A = toRgb(c.accent), A2 = toRgb(c.accent2);
            const L = toRgb(c.link || c.accent), W = toRgb(c.warn || (mode === 'dark' ? '#F0B040' : '#B26A00'));
            const rgba = (rgb, a) => 'rgba(' + triplet(rgb) + ', ' + (Math.round(a * 1000) / 1000) + ')';
            const glow = (rgb, a, size) => g > 0 ? '0 0 ' + size + 'px ' + rgba(rgb, a * g) : 'none';
            const flat = rgb => 'linear-gradient(' + toHex(rgb) + ', ' + toHex(rgb) + ')';
            const rim = (a, b, c2) => s.glass
                ? 'linear-gradient(135deg, ' + rgba(F, a) + ', ' + rgba(A, b) + ' 50%, ' + rgba(F, c2) + ')'
                : 'linear-gradient(' + rgba(F, a * 0.5) + ', ' + rgba(F, a * 0.5) + ')';
            const onAccent = readableOn(mix(A, A2, 0.5));
            const art = decorLayers(theme, mode);
            const decl = {
                'color-scheme': mode,
                '--amber': triplet(A), '--gold': triplet(A), '--teal': triplet(A2), '--blue': triplet(A2), '--ice': triplet(F),
                '--bg': toHex(B), '--surface': toHex(S), '--raised': rgba(F, 0.07),
                '--border': rgba(F, 0.22), '--border-strong': rgba(F, 0.5),
                '--muted': toHex(M), '--fg': toHex(F), '--on-fg': readableOn(F), '--chip': rgba(B, 0.55),
                '--heading': toHex(M), '--heading-glow': 'none', '--title': toHex(F), '--title-shadow': glow(A2, 0.45, 16),
                '--name-glow': 'none', '--link': toHex(L), '--link-glow': 'none', '--warn': toHex(W), '--warn-glow': 'none',
                '--icon-color': toHex(F), '--icon-filter': 'none', '--icon-hover-shadow': glow(A, 0.4, 14),
                '--ambient': g > 0
                    ? 'radial-gradient(55% 40% at 8% 88%, ' + rgba(A2, 0.2 * g) + ', transparent 70%), radial-gradient(50% 35% at 96% 10%, ' + rgba(A, 0.16 * g) + ', transparent 70%)'
                    : 'linear-gradient(transparent, transparent)',
                '--panel-bg': (s.glass ? 'linear-gradient(' + rgba(S, 0.78) + ', ' + rgba(S, 0.88) + ')' : flat(S)) + ' padding-box, ' + rim(0.55, 0.35, 0.3) + ' border-box',
                '--panel-shadow': glow(A, 0.22, 22),
                '--field-bg': s.glass ? rgba(B, 0.55) : toHex(mix(S, F, 0.04)),
                '--field-border': rgba(F, 0.3), '--field-shadow': 'none', '--focus-border': toHex(A),
                '--focus-shadow': '0 0 0 1px ' + rgba(A, 0.5) + (g > 0 ? ', 0 0 18px ' + rgba(A, 0.45 * g) : ''),
                '--btn-bg': flat(mix(S, F, 0.08)) + ' padding-box, ' + rim(0.5, 0.35, 0.4) + ' border-box',
                '--btn-bg-hover': flat(mix(S, F, 0.16)) + ' padding-box, ' + rim(0.75, 0.6, 0.7) + ' border-box',
                '--btn-shadow': 'none', '--btn-shadow-hover': glow(A, 0.4, 18),
                '--primary-bg': 'linear-gradient(105deg, ' + toHex(A) + ', ' + toHex(A2) + ') padding-box, linear-gradient(105deg, ' + toHex(A) + ', ' + toHex(A2) + ') border-box',
                '--primary-text': onAccent, '--primary-text-shadow': 'none', '--primary-shadow': glow(A, 0.45, 22),
                '--lit-bg': 'linear-gradient(135deg, ' + rgba(A, 0.85) + ', ' + rgba(A2, 0.75) + ')', '--lit-border': toHex(A),
                '--lit-text': onAccent, '--lit-text-shadow': 'none', '--lit-shadow': glow(A, 0.5, 14),
                '--dot-bg': toHex(A), '--dot-border': toHex(F), '--dot-shadow': glow(A, 0.9, 10),
                '--border-width': OPTIONS.border[s.border], '--radius-panel': radius[0], '--radius-btn': radius[1], '--radius-field': radius[2],
                '--font': OPTIONS.font[s.font], '--title-font': 'inherit', '--heading-font': 'inherit',
                '--panel-blur': s.glass ? 'blur(14px) saturate(1.2)' : 'none',
                '--title-size': '15px', '--title-weight': '600', '--title-transform': 'none', '--title-spacing': '.01em',
                '--heading-weight': '600', '--btn-weight': '600',
                '--art': art.length ? art.join(', ') : 'linear-gradient(transparent, transparent)', '--art-rendering': 'auto',
                '--grain': s.grain > 0 ? GRAIN : 'none', '--grain-opacity': String(round(s.grain * 0.2, 3)), '--grain-blend': 'overlay'
            };
            return ':root[data-style="' + CUSTOM + '"][data-theme="' + mode + '"] {\n'
                + Object.keys(decl).map(k => '  ' + k + ': ' + decl[k] + ';').join('\n') + '\n}';
        }).join('\n');
    }

    // ---- the saved themes: an array of { id, ...theme } in localStorage ----

    function readCustomList() {
        const out = [];
        try {
            let raw = localStorage.getItem(CUSTOM_LIST_KEY);
            if (raw === null) {
                // the first version kept a single theme: make it the first of the list
                const old = localStorage.getItem(CUSTOM_OLD_KEY);
                if (old) {
                    const checked = sanitizeCustom(JSON.parse(old));
                    if (checked.ok) {
                        const moved = Object.assign({ id: 'first' }, checked.theme);
                        raw = JSON.stringify([moved]);
                        localStorage.setItem(CUSTOM_LIST_KEY, raw);
                        if (localStorage.getItem(STYLE_KEY) === CUSTOM) localStorage.setItem(STYLE_KEY, CUSTOM_PREFIX + 'first');
                    }
                    localStorage.removeItem(CUSTOM_OLD_KEY);
                }
            }
            for (const entry of JSON.parse(raw || '[]')) {
                const checked = sanitizeCustom(entry);
                const id = entry && typeof entry.id === 'string' ? entry.id.replace(/[^a-z0-9]/gi, '').slice(0, 12) : '';
                if (checked.ok && id && !out.some(t => t.id === id)) out.push(Object.assign({ id }, checked.theme));
            }
        } catch (e) { /* an unreadable list is an empty list */ }
        return out.slice(0, MAX_THEMES);
    }

    function writeCustomList(list) {
        try { localStorage.setItem(CUSTOM_LIST_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
    }

    const customId = style => typeof style === 'string' && style.startsWith(CUSTOM_PREFIX) ? style.slice(CUSTOM_PREFIX.length) : '';
    const findCustom = id => readCustomList().find(t => t.id === id) || null;

    // the theme whose look is on the page now, or null
    function activeCustom() {
        try { return findCustom(customId(localStorage.getItem(STYLE_KEY))); } catch (e) { return null; }
    }

    function paintCustom() {
        let el = document.getElementById(CUSTOM_STYLE_ID);
        const theme = activeCustom();
        if (!theme) { if (el) el.remove(); return; }
        if (!el) {
            el = document.createElement('style');
            el.id = CUSTOM_STYLE_ID;
            (document.head || document.documentElement).appendChild(el);
        }
        el.textContent = customCss(theme);
    }

    // Saves a checked theme as a new one (a same name gets a number) and returns its id, or '' when it cannot be saved.
    function addCustom(raw) {
        const checked = sanitizeCustom(raw);
        if (!checked.ok) return '';
        const list = readCustomList();
        if (list.length >= MAX_THEMES) return '';
        const theme = checked.theme;
        const base = theme.name;
        for (let n = 2; list.some(t => t.name === theme.name); n++) theme.name = (base.slice(0, 28) + ' ' + n).trim();
        const id = Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
        list.push(Object.assign({ id }, theme));
        return writeCustomList(list) ? id : '';
    }

    function removeCustom(id) {
        const list = readCustomList();
        if (!list.some(t => t.id === id)) return;
        writeCustomList(list.filter(t => t.id !== id));
        try { if (localStorage.getItem(STYLE_KEY) === CUSTOM_PREFIX + id) localStorage.setItem(STYLE_KEY, 'prism'); } catch (e) { /* nothing stored */ }
        apply();
    }

    function labelOf(style) {
        if (customId(style)) return (findCustom(customId(style)) || {}).name || 'Своя тема';
        return STYLE_LABELS[style];
    }

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
            let value = localStorage.getItem(STYLE_KEY);
            if (value === CUSTOM) { readCustomList(); value = localStorage.getItem(STYLE_KEY); }     // the first version's single theme
            if (customId(value) && findCustom(customId(value))) return value;
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
        paintCustom();
        const mode = readMode();
        document.documentElement.dataset.theme = resolve(mode);
        document.documentElement.dataset.themeMode = mode;
        const style = readStyle();
        document.documentElement.dataset.style = customId(style) ? CUSTOM : style;
    }

    function setMode(mode) {
        if (!MODES.includes(mode)) return;
        try { localStorage.setItem(KEY, mode); } catch (e) { /* theme just won't persist */ }
        apply();
    }

    function setStyle(style) {
        if (!STYLES.includes(style) && !findCustom(customId(style))) return;
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
        MODES, LABELS, STYLES, STYLE_LABELS, CUSTOM, CUSTOM_PREFIX, MAX_THEMES, labelOf,
        custom: {
            sanitize: sanitizeCustom, list: readCustomList, add: addCustom, remove: removeCustom,
            COLOR_KEYS, OPTIONAL_COLOR_KEYS, DECOR_TYPES, DECOR_SHAPES, LINE_PATTERNS, MAX_DECOR,
            SVG_ELEMENTS, SVG_MAX_CHARS, SVG_MAX_PICTURES,
            OPTIONS: { radius: Object.keys(OPTIONS.radius), border: Object.keys(OPTIONS.border), font: Object.keys(OPTIONS.font) }
        },
        get mode() { return readMode(); },
        get style() { return readStyle(); },
        setMode, nextMode, setStyle, nextStyle
    };
})();
