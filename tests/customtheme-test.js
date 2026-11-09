// The user's own themes: a JSON description from an AI is checked, several themes are kept, the look is built from the
// checked values only, and a picture (SVG) written by the AI is rebuilt from what is allowed or refused.
const vm = require('vm'), fs = require('fs'), path = require('path');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function setup(initial = {}) {
  const store = { ...initial };
  const dataset = {};
  const stub = () => ({ addEventListener() {}, replaceChildren() {}, append() {}, classList: { toggle() {} } });
  const doc = {
    documentElement: { dataset },
    head: { appendChild(el) { doc.appended = el; } },
    getElementById: id => (id === 'mind-custom-theme-css' ? (doc.appended && !doc.appended.gone ? doc.appended : null) : stub()),
    createElement: () => ({ id: '', textContent: '', remove() { this.gone = true; } }),
    body: { append() {} }
  };
  const localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} };
  const ctx = vm.createContext({ window, localStorage, document: doc, console, encodeURIComponent, decodeURIComponent, navigator: {} });
  vm.runInContext(read('src/shared/theme.js') + '\nthis.MindTheme = MindTheme;', ctx);
  return { ctx, theme: ctx.MindTheme, dataset, store, doc, css: () => (doc.appended && !doc.appended.gone ? doc.appended.textContent : '') };
}

const example = {
  name: 'Тёплый закат',
  shape: { radius: 'soft', border: 'thin', font: 'system', glass: true, glow: 0.5, grain: 0.15 },
  dark: { bg: '#140B12', surface: '#24141D', fg: '#F7EDE6', muted: '#B9A19A', accent: '#F2784B', accent2: '#E5B25D' },
  light: { bg: '#FBF3EC', surface: '#FFFFFF', fg: '#2A1A14', muted: '#7A5F55', accent: '#C9501F', accent2: '#B8862B' },
  decor: [
    { type: 'gradient', angle: 160, stops: [['bg', 0], ['accent', 100]], opacity: 0.12 },
    { type: 'glow', x: 85, y: 12, size: 55, color: 'accent2', opacity: 0.25 },
    { type: 'shape', shape: 'ring', x: 78, y: 22, size: 30, color: 'accent', opacity: 0.3, stroke: 0.3 },
    { type: 'shape', shape: 'triangle', x: 20, y: 70, size: 20, rotate: 15, color: '#FF00AA', opacity: 0.2, fill: true },
    { type: 'lines', pattern: 'grid', gap: 3, width: 0.08, color: 'fg', opacity: 0.05 },
    { type: 'dots', gap: 4, size: 0.3, color: 'fg', opacity: 0.1 }
  ]
};
const withDecor = decor => Object.assign({}, example, { decor });

// ---------- the description ----------
let t = setup();
const T = t.theme;
let r = T.custom.sanitize(example);
ok(r.ok && !r.errors.length && r.theme.decor.length === 6, 'a complete description is accepted with all its details');
ok(r.theme.dark.bg === '#140B12' && r.theme.shape.radius === 'soft', 'colours are normalised, the shape is kept');
r = T.custom.sanitize({ name: 'x', dark: example.dark, light: example.light });
ok(r.ok && r.theme.shape.font === 'system' && r.theme.decor.length === 0, 'shape and decor are optional');
ok(!T.custom.sanitize(null).ok && !T.custom.sanitize([]).ok && !T.custom.sanitize('{}').ok, 'anything but an object is refused');
r = T.custom.sanitize({ dark: {}, light: {} });
ok(!r.ok && r.errors.some(e => /dark\.bg/.test(e)), 'missing colours are named');
r = T.custom.sanitize(Object.assign({}, example, { dark: Object.assign({}, example.dark, { bg: 'red' }) }));
ok(!r.ok && r.errors.some(e => /dark\.bg/.test(e)), 'a colour that is not #RRGGBB is refused');
r = T.custom.sanitize(Object.assign({}, example, { shape: { radius: 'huge', glow: 3, glass: 'yes' } }));
ok(!r.ok && r.errors.length >= 3, 'wrong shape values are refused one by one (' + r.errors.length + ' messages)');
r = T.custom.sanitize(Object.assign({}, example, { dark: Object.assign({}, example.dark, { fg: '#150C12' }) }));
ok(!r.ok && r.errors.some(e => /не виден/.test(e)), 'text that cannot be read on the background is refused');
r = T.custom.sanitize(Object.assign({}, example, { dark: Object.assign({}, example.dark, { fg: '#7A6A6A' }) }));
ok(r.ok && r.warnings.length > 0, 'weakly readable text only gets a warning');
r = T.custom.sanitize(withDecor([{ type: 'shape', shape: 'star', x: 5000 }, { type: 'script', raw: '<script>' }]));
ok(!r.ok && r.errors.some(e => /decor\[0\]\.shape/.test(e)) && r.errors.some(e => /decor\[0\]\.x/.test(e)) && r.errors.some(e => /decor\[1\]\.type/.test(e)), 'wrong details are refused with their place');
ok(!T.custom.sanitize(withDecor(new Array(30).fill({ type: 'glow' }))).ok, 'more than 24 details are refused');
ok(!T.custom.sanitize(withDecor([{ type: 'gradient', stops: [['accent', 0]] }])).ok, 'a gradient needs at least two stops');

// ---------- several themes ----------
const id1 = T.custom.add(example), id2 = T.custom.add(example);
ok(id1 && id2 && id1 !== id2, 'a second theme is added next to the first');
ok(T.custom.list().length === 2 && T.custom.list()[1].name === 'Тёплый закат 2', 'a repeated name gets a number (' + T.custom.list().map(x => x.name).join(' / ') + ')');
T.setStyle(T.CUSTOM_PREFIX + id1);
ok(T.style === T.CUSTOM_PREFIX + id1 && t.dataset.style === 'custom' && t.store['mind-style'] === 'custom:' + id1, 'a saved theme is applied and remembered');
ok(T.labelOf(T.CUSTOM_PREFIX + id1) === 'Тёплый закат' && T.labelOf('prism') === T.STYLE_LABELS.prism, 'the label of a saved theme is its name');
T.setStyle(T.CUSTOM_PREFIX + 'nope');
ok(T.style === T.CUSTOM_PREFIX + id1, 'a style of a theme that does not exist is ignored');
ok(T.STYLES.join() === 'prism,rhythm,haze,raster,blueprint', 'the built-in styles are not changed by saved themes');
const css = t.css();
ok((css.match(/:root\[data-style="custom"\]\[data-theme="(dark|light)"\]/g) || []).length === 2, 'the look is written for both modes');
ok(/--bg: #140B12;/.test(css) && /--bg: #FBF3EC;/.test(css), 'colours come from the palette of each mode');
const outside = css.split('url("data:image/svg+xml,').map((p, i) => i === 0 ? p : p.slice(p.indexOf('")') + 2)).join('IMG');
ok(!outside.includes('url(') && !/https?:/.test(outside), 'no address and no foreign url() in the style text');
ok(/--grain-opacity: 0\.03/.test(css), 'the grain strength comes from the theme');
T.custom.remove(id2);
ok(T.custom.list().length === 1 && T.style === T.CUSTOM_PREFIX + id1, 'removing another theme keeps the active one');
T.custom.remove(id1);
ok(T.custom.list().length === 0 && T.style === 'prism' && t.dataset.style === 'prism' && t.css() === '', 'removing the active theme goes back to prism and drops its style');
let many = 0;
for (let i = 0; i < 20; i++) if (T.custom.add(example)) many++;
ok(many === T.MAX_THEMES, 'no more than ' + T.MAX_THEMES + ' themes are kept (' + many + ')');

// the single theme of the first version moves into the list
t = setup({ 'mind-custom-theme': JSON.stringify(T.custom.sanitize(example).theme), 'mind-style': 'custom' });
ok(t.theme.style.startsWith('custom:') && t.theme.custom.list().length === 1 && !('mind-custom-theme' in t.store), 'a theme saved by the first version is moved into the list and stays selected');
t = setup({ 'mind-custom-themes': '{broken', 'mind-style': 'custom:abc' });
ok(t.theme.style === 'prism' && t.theme.custom.list().length === 0, 'a damaged list is an empty list');
t = setup({ 'mind-custom-themes': JSON.stringify([{ id: 'x1', name: 'bad', dark: {}, light: {} }]), 'mind-style': 'custom:x1' });
ok(t.theme.style === 'prism', 'a saved theme that no longer passes the check is not used');

// ---------- pictures ----------
const svgOf = svg => T.custom.sanitize(withDecor([{ type: 'svg', svg }]));
const hostile = {
  script: "<svg viewBox='0 0 10 10'><script>alert(1)</script></svg>",
  onload: "<svg viewBox='0 0 10 10' onload='x()'><rect width='5' height='5'/></svg>",
  styleAttr: "<svg viewBox='0 0 10 10'><rect width='5' height='5' style='fill:red'/></svg>",
  use: "<svg viewBox='0 0 10 10'><use href='#a'/></svg>",
  image: "<svg viewBox='0 0 10 10'><image href='http://evil/x.png'/></svg>",
  foreign: "<svg viewBox='0 0 10 10'><foreignObject><div/></foreignObject></svg>",
  externalUrl: "<svg viewBox='0 0 10 10'><rect width='5' height='5' fill='url(http://evil/x.svg#a)'/></svg>",
  danglingRef: "<svg viewBox='0 0 10 10'><rect width='5' height='5' fill='url(#nowhere)'/></svg>",
  entity: "<svg viewBox='0 0 10 10'><rect width='5' height='5' fill='&#x23;f00'/></svg>",
  cdata: "<svg viewBox='0 0 10 10'><![CDATA[x]]></svg>",
  text: "<svg viewBox='0 0 10 10'><text>hi</text></svg>",
  textInside: "<svg viewBox='0 0 10 10'>hello<rect width='5' height='5'/></svg>",
  noViewBox: "<svg><rect width='5' height='5'/></svg>",
  badPath: "<svg viewBox='0 0 10 10'><path d='M0 0 L alert(1)'/></svg>",
  bigBlur: "<svg viewBox='0 0 10 10'><filter id='f'><feGaussianBlur stdDeviation='500'/></filter></svg>",
  twoRoots: "<svg viewBox='0 0 10 10'/><svg viewBox='0 0 10 10'/>",
  unclosed: "<svg viewBox='0 0 10 10'><g><rect width='5' height='5'/></svg>",
  tooLong: "<svg viewBox='0 0 10 10'>" + "<rect width='1' height='1'/>".repeat(700) + '</svg>',
  tooMany: "<svg viewBox='0 0 10 10'>" + "<g>".repeat(9) + "<rect width='1' height='1'/>" + "</g>".repeat(9) + '</svg>',
  notSvg: '<div>hello</div>'
};
const accepted = Object.keys(hostile).filter(k => svgOf(hostile[k]).ok);
ok(!accepted.length, 'every hostile or broken picture is refused (' + Object.keys(hostile).length + ' tried' + (accepted.length ? ', accepted: ' + accepted.join(', ') : '') + ')');
const good = {
  header: "<?xml version='1.0'?><!-- hi --><svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='0 0 100 100'><title>art</title><g opacity='0.5' transform='rotate(10 50 50)'><circle cx='50' cy='50' r='20' fill='$accent' stroke='#fff' stroke-width='2'/></g></svg>",
  blur: "<svg viewBox='0 0 100 100'><defs><filter id='b' x='-50%' y='-50%' width='200%' height='200%'><feGaussianBlur stdDeviation='6'/></filter></defs><circle cx='30' cy='30' r='15' fill='$accent2' filter='url(#b)'/></svg>",
  tile: "<svg viewBox='0 0 20 20'><pattern id='p' width='4' height='4' patternUnits='userSpaceOnUse'><path d='M0 0 L4 4' stroke='$fg' stroke-width='0.3'/></pattern><rect width='20' height='20' fill='url(#p)'/></svg>",
  doubleQuotes: '<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#336699" fill-opacity="0.4"/></svg>'
};
for (const k of Object.keys(good)) { const x = svgOf(good[k]); ok(x.ok, 'a normal picture is accepted: ' + k + (x.ok ? '' : ' (' + x.errors.join(' | ') + ')')); }
r = svgOf(good.header);
ok(r.theme.decor[0].svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && !/title|width="100"|<\?xml|hi/.test(r.theme.decor[0].svg), 'the picture is written anew: no header, comment, title or own size');
ok(!T.custom.sanitize(withDecor(new Array(4).fill({ type: 'svg', svg: good.doubleQuotes }))).ok, 'more than 3 pictures are refused');

t = setup();
const sid = t.theme.custom.add(withDecor([{ type: 'svg', svg: good.header, opacity: 0.5, fit: 'tile', tile: 80 }]));
t.theme.setStyle('custom:' + sid);
const images = t.css().split('url("data:image/svg+xml,').slice(1).map(p => decodeURIComponent(p.slice(0, p.indexOf('")'))));
const own = images.find(x => x.includes('<circle')) || '';
ok(/fill="#F2784B"/.test(own) && /opacity="0.5"/.test(own) && !/\$accent/.test(own), 'the palette colours replace the $names in the picture of the dark mode');
ok(images.filter(x => x.includes('<circle') && x.includes('#C9501F')).length === 1, 'and the light mode gets its own colours');
ok(/ 0 0 \/ 80px 80px repeat/.test(t.css()), 'a tile picture is repeated at the given size');

// ---------- the prompt ----------
const page = setup();
const nodes = {};
page.doc.getElementById = id => (id === 'mind-custom-theme-css' ? null : (nodes[id] = nodes[id] || { addEventListener() {}, replaceChildren() {}, append() {}, classList: { toggle() {} } }));
const code = read('src/customtheme/customtheme.js').replace("'use strict';", '').replace('const $ =', 'var $ =').replace('const custom =', 'var custom =');
vm.runInContext(code, page.ctx);
const prompt = vm.runInContext('buildPrompt()', page.ctx);
const from = prompt.indexOf('{'), to = prompt.indexOf('\n\nЧто означают поля');
let promptExample = null;
try { promptExample = JSON.parse(prompt.slice(from, to)); } catch (e) { /* reported below */ }
ok(promptExample && page.theme.custom.sanitize(promptExample).ok, 'the example inside the prompt is itself accepted');
ok(/Правила для svg/.test(prompt) && /\$accent/.test(prompt) && prompt.includes('Описание темы'), 'the prompt explains the pictures and leaves a place for the description');
ok(page.theme.custom.DECOR_TYPES.every(type => prompt.includes('"type":"' + type + '"')), 'the prompt describes every kind of detail');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exit(fails ? 1 : 0);
