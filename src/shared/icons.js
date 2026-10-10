'use strict';

// Plain, colourless line icons (they take the text colour via currentColor).
var MindIcons = (function () {
    const NS = 'http://www.w3.org/2000/svg';
    const SHAPES = {
        clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
        pencil: [['path', { d: 'M4 20h4L19 9l-4-4L4 16v4z' }], ['path', { d: 'M13.5 6.5l4 4' }]],
        close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
        transfer: [['path', { d: 'M7 20V5M7 5L4 8M7 5l3 3' }], ['path', { d: 'M17 4v15M17 19l-3-3M17 19l3-3' }]],
        pulse: [['path', { d: 'M3 12h4l3-8 4 16 3-8h4' }]],
        bell: [['path', { d: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4l2-2z' }], ['path', { d: 'M10 21h4' }]],
        moon: [['path', { d: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z' }]],
        sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' }]],
        monitor: [['rect', { x: 3, y: 4, width: 18, height: 12, rx: 2 }], ['path', { d: 'M8 20h8M12 16v4' }]]
    };

    function create(name, size) {
        const svg = document.createElementNS(NS, 'svg');
        const px = String(size || 16);
        for (const [k, v] of Object.entries({
            viewBox: '0 0 24 24', width: px, height: px, fill: 'none', stroke: 'currentColor',
            'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
            'aria-hidden': 'true', focusable: 'false'
        })) svg.setAttribute(k, v);

        for (const [tag, attrs] of SHAPES[name]) {
            const el = document.createElementNS(NS, tag);
            for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
            svg.append(el);
        }
        return svg;
    }

    // Icon-only button with an accessible name.
    function button(name, label, className) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'icon-btn' + (className ? ' ' + className : '');
        b.title = label;
        b.setAttribute('aria-label', label);
        b.append(create(name));
        return b;
    }

    return { create, button };
})();
