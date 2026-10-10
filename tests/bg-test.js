// Runs common.js + background.js in a vm with a fake browser API and a fake clock.
const fs = require('fs'), vm = require('vm');
const read = f => fs.readFileSync(require('path').join(__dirname, '..', 'src', f), 'utf8');

function makeEnv({ withPermissions, now }) {
  const clock = { now };
  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const store = {};
  const alarms = new Map();
  const notifications = [];
  const tabs = [];
  const handlers = { alarm: null, click: null };
  const events = () => ({ addListener() {} });
  const browser = {
    storage: {
      local: {
        async get(keys) { const out = {}; for (const k of [].concat(keys)) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k])); return out; },
        async set(o) { Object.assign(store, JSON.parse(JSON.stringify(o))); },
        async remove(k) { for (const x of [].concat(k)) delete store[x]; }
      },
      onChanged: events()
    },
    permissions: { onAdded: events(), onRemoved: events() },
    runtime: { onStartup: events(), onInstalled: events(), onMessage: events(), getURL: p => 'moz-extension://x/' + p },
    tabs: { async create(o) { tabs.push(o.url); } },
    // "alarms" is a regular permission in Firefox, so the API is always there;
    // only "notifications" is optional and gates the feature.
    alarms: {
      async getAll() { return [...alarms].map(([name, scheduledTime]) => ({ name, scheduledTime })); },
      async clear(name) { return alarms.delete(name); },
      create(name, { when }) { alarms.set(name, when); },
      onAlarm: { addListener(f) { handlers.alarm = f; } }
    }
  };
  if (withPermissions) {
    browser.notifications = {
      async create(id, o) { notifications.push({ id, ...o }); },
      async clear() {},
      onClicked: { addListener(f) { handlers.click = f; } }
    };
  }
  const ctx = vm.createContext({ browser, Date: FakeDate, console, crypto, Math, JSON, Map, Set, Array, Number, String, Object, Promise, setTimeout, Error });
  vm.runInContext(read('shared/common.js'), ctx);
  vm.runInContext(read('background/background.js'), ctx);
  return { ctx, store, alarms, notifications, tabs, handlers, clock, FakeDate, browser };
}
const tick = () => new Promise(r => setTimeout(r, 20));
const fmt = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return `${['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d.getDay()]} ${p(d.getHours())}:${p(d.getMinutes())}`; };
let failed = 0;
const check = (name, cond, extra) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!cond) failed++; };

(async () => {
  // Fixed local "now": a Wednesday 2026-10-07 08:00
  const NOW = new Date(2026, 9, 7, 8, 0, 0).getTime();
  const common = (() => { const e = makeEnv({ withPermissions: false, now: NOW }); return e.ctx.MindCommon; })();

  // ---- sanitizeSlots
  const s = common.sanitizeSlots([
    { days: [3, 1, 1, 9, -1, 'x'], time: '09:00' }, { days: [], time: '09:00' }, { days: [1], time: '25:00' },
    { days: [2], time: '9:00' }, null, 'str', { id: 'ok-1', days: [5], time: '23:59' }, { id: 'ok-1', days: [6], time: '00:00' }]);
  check('sanitizeSlots keeps valid, dedupes days, drops invalid', s.length === 3 && s[0].days.join() === '1,3' && s[1].id === 'ok-1' && s[2].id !== 'ok-1' && new Set(s.map(x => x.id)).size === 3, JSON.stringify(s.map(x => [x.days, x.time])));
  check('sanitizeSlots caps at MAX_SLOTS', common.sanitizeSlots(Array.from({ length: 50 }, () => ({ days: [1], time: '10:00' }))).length === common.MAX_SLOTS);
  check('clampLead', common.clampLead(-5) === 0 && common.clampLead(999) === 60 && common.clampLead('abc') === 5 && common.clampLead(7.6) === 8);

  // ---- nextStart
  const slot = d => ({ days: d, time: '09:00' });
  const L = 5 * 60000;
  check('today, later class', fmt(common.nextStart(slot([3]), L, NOW)) === 'Ср 09:00');
  check('class earlier today -> next week', fmt(common.nextStart({ days: [3], time: '07:00' }, L, NOW)) === 'Ср 07:00' && common.nextStart({ days: [3], time: '07:00' }, L, NOW) - NOW === 7 * 86400000 - 3600000);
  check('reminder moment already passed -> next occurrence', common.nextStart({ days: [3], time: '08:03' }, L, NOW) - NOW > 6 * 86400000);
  check('picks the soonest weekday', fmt(common.nextStart(slot([1, 5]), L, NOW)) === 'Пт 09:00');
  check('wraps over the weekend', fmt(common.nextStart(slot([0]), L, NOW)) === 'Вс 09:00');
  check('exactly at reminder moment is not "future"', common.nextStart({ days: [3], time: '08:05' }, L, NOW) - NOW > 6 * 86400000);

  // ---- background without permissions: must stay idle
  {
    const e = makeEnv({ withPermissions: false, now: NOW });
    e.store.favorites = [{ id: 'f1', title: 'T', number: '123', slots: [{ id: 's1', days: [3], time: '09:00' }] }];
    await tick();
    check('no permissions: nothing scheduled, no crash', e.alarms.size === 0 && e.notifications.length === 0);
  }

  // ---- background with permissions
  {
    const e = makeEnv({ withPermissions: true, now: NOW });
    e.store.favorites = [
      { id: 'f1', title: 'Физика', number: '50627597', slots: [{ id: 's1', days: [3], time: '09:00' }, { id: 's2', days: [1, 5], time: '11:30' }, { days: [], time: '10:00' }] },
      { id: 'f2', title: 'Нет расписания', number: '222' },
      { title: 'без id', number: '333', slots: [{ id: 's9', days: [3], time: '10:00' }] }];
    e.store.reminderLead = 10;
    e.ctx.reschedule && await e.ctx.reschedule();
    await tick();
    const names = [...e.alarms.keys()].sort();
    check('schedules only valid slots of favourites with an id', names.join() === 'r|f1|s1,r|f1|s2', names.join());
    check('alarm = start - lead', e.alarms.get('r|f1|s1') === new Date(2026, 9, 7, 8, 50).getTime(), fmt(e.alarms.get('r|f1|s1')));

    // idempotent
    const before = JSON.stringify([...e.alarms]);
    await e.ctx.reschedule(); check('reschedule is idempotent', JSON.stringify([...e.alarms]) === before);

    // removing a slot / favourite clears its alarm
    e.store.favorites[0].slots = [{ id: 's1', days: [3], time: '09:00' }];
    await e.ctx.reschedule(); check('removed slot -> alarm cleared', [...e.alarms.keys()].join() === 'r|f1|s1');
    // lead change moves the alarm
    e.store.reminderLead = 0; await e.ctx.reschedule(); check('lead 0 -> alarm at class start', e.alarms.get('r|f1|s1') === new Date(2026, 9, 7, 9, 0).getTime());
    e.store.reminderLead = 10; await e.ctx.reschedule();

    // fire on time
    const fireAt = e.alarms.get('r|f1|s1');
    e.clock.now = fireAt + 2000;
    await e.handlers.alarm({ name: 'r|f1|s1', scheduledTime: fireAt });
    check('on-time alarm shows a notification', e.notifications.length === 1 && e.notifications[0].title === 'Физика' && e.notifications[0].message.includes('09:00') && e.notifications[0].message.includes('10 мин'), e.notifications[0] && e.notifications[0].message);
    check('after firing the slot is rescheduled a week ahead', e.alarms.get('r|f1|s1') - fireAt > 6 * 86400000, fmt(e.alarms.get('r|f1|s1')));

    // late fire (computer was asleep) -> no notification, still rescheduled
    const late = e.alarms.get('r|f1|s1');
    e.clock.now = late + 30 * 60000;
    await e.handlers.alarm({ name: 'r|f1|s1', scheduledTime: late });
    check('alarm >10 min late is skipped silently', e.notifications.length === 1);
    check('late alarm is still rescheduled', e.alarms.get('r|f1|s1') > e.clock.now);

    // unrelated alarm names are ignored
    await e.handlers.alarm({ name: 'something-else', scheduledTime: e.clock.now });
    check('foreign alarm ignored', e.notifications.length === 1);
    // deleted favourite -> no notification
    e.store.favorites = []; e.clock.now = e.alarms.size ? [...e.alarms.values()][0] : e.clock.now;
    await e.ctx.reschedule(); check('no favourites -> no alarms', e.alarms.size === 0);

    // notification click opens the conference with the guest name
    e.store.guestName = 'Иван, Иванов';
    await e.handlers.click('conf|50627597|123456');
    check('click opens #login_by_id with number', e.tabs[0] === 'https://e-class.tsu.ru/#login_by_id:50627597', e.tabs[0]);
    check('click passes the (cleaned) guest name', e.store.pendingJoin && e.store.pendingJoin.name === 'Иван Иванов');
    await e.handlers.click('conf|abc|1'); await e.handlers.click('other-id');
    check('bad notification ids are ignored', e.tabs.length === 1);
  }

  // ---- permission appears later (alarms undefined at load, defined afterwards)
  {
    const e = makeEnv({ withPermissions: false, now: NOW });
    e.store.favorites = [{ id: 'f1', title: 'T', number: '1', slots: [{ id: 's1', days: [3], time: '09:00' }] }];
    await e.ctx.reschedule(); check('before grant: idle (no alarm, no listener)', e.alarms.size === 0 && !e.handlers.alarm);
    e.browser.notifications = { async create(id, o) { e.notifications.push({ id, ...o }); }, async clear() {}, onClicked: { addListener(f) { e.handlers.click = f; } } };
    await e.ctx.reschedule();
    check('after grant: listeners added and alarm scheduled', !!e.handlers.alarm && !!e.handlers.click && e.alarms.size === 1);
    // user revokes the permission again
    delete e.browser.notifications;
    await e.ctx.reschedule();
    check('after revoke: our alarms are cleared', e.alarms.size === 0);
  }

  // ---- stale alarms left over without the permission are cleaned up, foreign alarms untouched
  {
    const e = makeEnv({ withPermissions: false, now: NOW });
    e.alarms.set('r|gone|s', NOW + 1000); e.alarms.set('someone-else', NOW + 2000);
    await e.ctx.reschedule();
    check('no notifications permission: stale r| alarms removed, others kept', !e.alarms.has('r|gone|s') && e.alarms.has('someone-else'));
  }

  console.log(failed ? `\n${failed} FAILED` : '\nall passed');
  process.exit(failed ? 1 : 0);
})();
