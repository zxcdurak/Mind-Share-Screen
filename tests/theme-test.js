// The look of the extension pages has two independent choices: the mode (dark / light / system) and the style
// (prism / rhythm). theme.js keeps and applies them; theme.css must define every colour variable for every
// combination, otherwise a colour of one look leaks into another.
const vm = require('vm'), fs = require('fs'), path = require('path');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ---------- theme.js ----------
function setup(initial = {}, dark = true) {
  const store = { ...initial };
  const dataset = {};
  let breakStorage = false;
  const localStorage = {
    getItem: k => { if (breakStorage) throw new Error('blocked'); return k in store ? store[k] : null; },
    setItem: (k, v) => { if (breakStorage) throw new Error('blocked'); store[k] = String(v); }
  };
  const window = { matchMedia: () => ({ matches: !dark, addEventListener() {} }), addEventListener() {} };
  const ctx = vm.createContext({ window, localStorage, document: { documentElement: { dataset } }, console });
  vm.runInContext(read('src/shared/theme.js'), ctx);
  return { theme: ctx.MindTheme, dataset, store, breakStorage: () => { breakStorage = true; } };
}

let t = setup();
ok(t.dataset.theme === 'dark' && t.dataset.style === 'prism', 'defaults: dark mode, prism style');

t.theme.setStyle('rhythm');
ok(t.dataset.style === 'rhythm' && t.store['mind-style'] === 'rhythm' && t.dataset.theme === 'dark', 'the style is applied and stored, the mode is left alone');
t.theme.setMode('light');
ok(t.dataset.theme === 'light' && t.dataset.style === 'rhythm', 'changing the mode keeps the style');

t.theme.setStyle('neon');
ok(t.dataset.style === 'rhythm' && t.store['mind-style'] === 'rhythm', 'an unknown style is ignored');
const order = [];
for (let i = 0; i < t.theme.STYLES.length; i++) { t.theme.setStyle(t.theme.nextStyle()); order.push(t.dataset.style); }
ok(order.join() === ['haze', 'raster', 'blueprint', 'prism', 'rhythm'].join() && t.dataset.style === 'rhythm', 'cycling visits every style and wraps around (' + order.join(' > ') + ')');
ok(t.theme.STYLES.join() === 'prism,rhythm,haze,raster,blueprint', 'the styles are prism, rhythm, haze, raster, blueprint');
ok(t.theme.STYLES.every(s => typeof t.theme.STYLE_LABELS[s] === 'string' && t.theme.STYLE_LABELS[s]), 'every style has a label');

t = setup({ 'mind-style': 'rhythm', 'mind-theme': 'light' });
ok(t.dataset.style === 'rhythm' && t.dataset.theme === 'light', 'saved choices are applied before the first paint');
t = setup({ 'mind-style': 'garbage' });
ok(t.dataset.style === 'prism', 'a damaged saved style falls back to prism');
t = setup({ 'mind-theme': 'system' }, false);
ok(t.dataset.theme === 'light', 'the system mode follows the system (light here)');

t = setup();
t.breakStorage();
let threw = false;
try { t.theme.setStyle('rhythm'); } catch (e) { threw = true; }
ok(!threw && t.dataset.style === 'prism', 'blocked storage does not break anything (the style just does not persist)');

// ---------- theme.css ----------
const css = read('src/shared/theme.css');
function block(selector) {
  const start = css.indexOf('\n' + selector + ' {');
  if (start < 0) return null;
  return css.slice(start, css.indexOf('\n}', start));
}
const vars = text => new Set((text.match(/--[\w-]+(?=:)/g) || []));
const base = block(':root');
const baseVars = vars(base);
const missing = (needed, ...have) => [...needed].filter(v => !have.some(h => h.has(v)));
const defined = new Set(baseVars);
for (const style of ['rhythm', 'haze', 'raster', 'blueprint']) {
  const shared = block(':root[data-style="' + style + '"]');
  const dark = block(':root[data-style="' + style + '"][data-theme="dark"]');
  const light = block(':root[data-style="' + style + '"][data-theme="light"]');
  ok(base && shared && dark && light, style + ': theme.css has the three blocks of the style');
  const sharedVars = vars(shared), darkVars = vars(dark), lightVars = vars(light);
  ok(missing(baseVars, sharedVars, darkVars).length === 0, style + ' dark defines every variable of the base look (missing: ' + missing(baseVars, sharedVars, darkVars).join(', ') + ')');
  ok(missing(baseVars, sharedVars, lightVars).length === 0, style + ' light defines every variable of the base look (missing: ' + missing(baseVars, sharedVars, lightVars).join(', ') + ')');
  ok(missing(darkVars, lightVars).length === 0 && missing(lightVars, darkVars).length === 0, style + ' dark and light define the same variables');
  ok(![...sharedVars].some(v => darkVars.has(v) || lightVars.has(v)), style + ': shape and type variables are in the shared block only, not repeated per mode');
  for (const v of [...sharedVars, ...darkVars, ...lightVars]) defined.add(v);
}

// every variable a rule reads must exist
const used = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
for (const f of ['src/popup/popup.css', 'src/notifications/notifications.css', 'src/diagnostics/diagnostics.css', 'src/transfer/transfer.css']) {
  for (const m of read(f).matchAll(/var\((--[\w-]+)/g)) used.add(m[1]);
}
const undefinedVars = [...used].filter(v => !defined.has(v));
ok(undefinedVars.length === 0, 'every variable used by a rule is defined somewhere (undefined: ' + undefinedVars.join(', ') + ')');

// the grain must never get in the way of clicks, and the artwork must stay behind the content
ok(/body::after\s*\{[^}]*pointer-events:\s*none/.test(css), 'the grain layer does not catch clicks');
ok(/body::before\s*\{[^}]*z-index:\s*-1/.test(css), 'the artwork layer sits behind the content');

// the popup must offer the choice
const popup = read('src/popup/popup.js');
ok(/role', 'listbox'/.test(popup) && /MindTheme\.STYLES\.map/.test(popup) && /MindTheme\.setStyle\(style\)/.test(popup) && /append\(styleWrap/.test(popup), 'the popup offers the styles as a drop-down list');
ok(/aria-expanded/.test(popup) && /Escape/.test(popup) && /ArrowDown/.test(popup), 'the list closes with Escape and works with the arrow keys');
ok(/\.menu\b/.test(css.slice(css.indexOf('ul, .card'), css.indexOf('ul, .card') + 80)), 'the list is drawn like a panel of the current style');
ok(/palette:/.test(read('src/shared/icons.js')), 'the palette icon exists');

console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
