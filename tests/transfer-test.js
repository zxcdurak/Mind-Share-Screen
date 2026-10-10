// Runs transfer.js logic in node against a fake browser/DOM to verify parsing + merge (incl. schedules).
const fs = require('fs'), vm = require('vm');
const read = f => fs.readFileSync(require('path').join(__dirname, '..', 'src', f), 'utf8');

function run(initial) {
  const store = { favorites: initial };
  const els = {};
  ['exportBtn', 'exportInfo', 'importInfo', 'file'].forEach(id => (els[id] = { id, textContent: '', className: '', disabled: false, value: 'x', files: null, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } }));
  const captured = {};
  const ctx = vm.createContext({
    document: { getElementById: id => els[id], body: { append() {} }, createElement: () => ({ click() { captured.downloaded = true; }, remove() {} }) },
    browser: { storage: { local: { async get(k) { return { [k]: JSON.parse(JSON.stringify(store[k])) }; }, async set(o) { Object.assign(store, JSON.parse(JSON.stringify(o))); } } } },
    crypto, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, Blob: class { constructor(parts) { captured.blob = parts.join(''); } },
    Date, JSON, Math, Map, Set, Array, String, Number, Object, Error, Promise, setTimeout, console
  });
  vm.runInContext(read('shared/common.js'), ctx);
  vm.runInContext(read('shared/diag.js'), ctx);
  vm.runInContext(read('transfer/transfer.js').replace(/^'use strict';/, ''), ctx);
  return { els, store, captured };
}
const tick = () => new Promise(r => setTimeout(r, 30));
let failed = 0;
const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };

async function doImport(env, text, size) {
  env.els.file.files = [{ size: size ?? text.length, text: async () => text }];
  await env.els.file.listeners.change({ target: env.els.file });
  await tick();
  return { info: env.els.importInfo.textContent, kind: env.els.importInfo.className };
}

(async () => {
  const S = (days, time) => ({ days, time });
  // ---- export includes schedules, omits ids, omits empty
  {
    const env = run([
      { id: 'a', title: 'Физика', number: '111', slots: [{ id: 'x1', days: [1, 3], time: '09:00' }, { id: 'bad', days: [], time: '10:00' }] },
      { id: 'b', title: 'Без расписания', number: '222' }]);
    await tick();
    env.els.exportBtn.listeners.click(); await tick();
    const data = JSON.parse(env.captured.blob);
    check('export includes valid slots without ids', JSON.stringify(data.favorites[0]) === JSON.stringify({ title: 'Физика', number: '111', slots: [S([1, 3], '09:00')] }), JSON.stringify(data.favorites[0]));
    check('export omits "slots" when empty', !('slots' in data.favorites[1]));
  }

  // ---- import merge with schedules
  const file = JSON.stringify({ format: 'mind-for-firefox-favorites', version: 1, favorites: [
    { title: 'Физика', number: '111', slots: [S([1, 3], '09:00')] },                 // existing, schedule differs -> updated
    { title: 'Без изменений', number: '222', slots: [S([2], '10:00')] },             // existing, identical -> not "updated"
    { title: 'Новая', number: '333', slots: [S([5], '14:15'), { days: [], time: '1:00' }] }, // new, one bad slot dropped
    { title: 'Без расписания', number: '444' },                                       // new, no slots
    { title: 'Не трогать расписание', number: '555' }                                 // existing, file has no slots -> keep schedule
  ] });
  const env = run([
    { id: 'a', title: 'Физика', number: '111', slots: [{ id: 'old', days: [4], time: '08:00' }] },
    { id: 'b', title: 'Без изменений', number: '222', slots: [{ id: 'same', days: [2], time: '10:00' }] },
    { id: 'c', title: 'Не трогать расписание', number: '555', slots: [{ id: 'keep', days: [6], time: '12:00' }] }]);
  await tick();
  const res = await doImport(env, file);
  const byNum = Object.fromEntries(env.store.favorites.map(f => [f.number, f]));
  check('import summary counts', res.info === 'Добавлено: 2, обновлено: 1.', res.info);
  check('existing: schedule replaced by the file', JSON.stringify(byNum['111'].slots.map(s => [s.days, s.time])) === '[[[1,3],"09:00"]]');
  check('existing identical: not counted, kept', byNum['222'].slots[0].id === 'same');
  check('existing without slots in file: schedule kept', byNum['555'].slots[0].id === 'keep' && byNum['555'].slots[0].time === '12:00');
  check('new: valid slot kept, bad slot dropped, ids assigned', byNum['333'].slots.length === 1 && byNum['333'].slots[0].time === '14:15' && /^[A-Za-z0-9-]{1,40}$/.test(byNum['333'].slots[0].id));
  check('new without slots gets empty list', Array.isArray(byNum['444'].slots) && byNum['444'].slots.length === 0);

  // ---- old-format file (no slots at all) still imports
  const old = run([]); await tick();
  const r2 = await doImport(old, JSON.stringify({ format: 'mind-for-firefox-favorites', version: 1, favorites: [{ title: 'Старый формат', number: '777' }] }));
  check('old export format (no slots) still imports', r2.info === 'Добавлено: 1, обновлено: 0.' && old.store.favorites[0].slots.length === 0, r2.info);

  // ---- rejections
  const bad = run([]); await tick();
  check('not json rejected', (await doImport(bad, 'не json')).kind.includes('error'));
  check('wrong format rejected', (await doImport(bad, '{"a":1}')).kind.includes('error'));
  check('too big rejected', (await doImport(bad, file, 2 * 1024 * 1024)).kind.includes('error'));
  check('nothing stored after rejections', bad.store.favorites.length === 0);

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
