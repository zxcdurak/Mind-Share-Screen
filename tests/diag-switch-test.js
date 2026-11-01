// The diagnostics log can be switched off: nothing new is written, what was written stays.
const vm = require('vm'), fs = require('fs'), path = require('path');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

const store = {};
const browser = { storage: { local: {
  get: async keys => { const out = {}; [].concat(keys).forEach(k => { if (k in store) out[k] = store[k]; }); return out; },
  set: async o => { Object.assign(store, o); },
  remove: async k => { delete store[k]; }
} } };
const ctx = vm.createContext({ browser, console, Date, Promise, Array, String });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src/shared/diag.js'), 'utf8') + '\nthis.MindDiag = MindDiag;', ctx);
const diag = ctx.MindDiag;

(async () => {
  ok(await diag.isEnabled() === true, 'on by default, with nothing stored');
  await diag.log('test', 'first', 'page');
  ok((await diag.read()).length === 1, 'an entry is written while the log is on');

  await diag.setEnabled(false);
  ok(await diag.isEnabled() === false, 'the switch can be turned off');
  await diag.log('test', 'second', 'page');
  await diag.log('test', 'third', 'problem');
  const afterOff = await diag.read();
  ok(afterOff.length === 1 && afterOff[0].m === 'first', 'nothing new is written while it is off, the old entry stays');

  await diag.setEnabled(true);
  await diag.log('test', 'fourth', 'page');
  ok((await diag.read()).map(e => e.m).join() === 'first,fourth', 'writing resumes when it is turned back on');

  await diag.clear();
  ok((await diag.read()).length === 0 && await diag.isEnabled() === true, 'clearing the log keeps the switch as it was');
  await diag.setEnabled(false);
  await diag.clear();
  ok(await diag.isEnabled() === false, 'clearing does not turn the switch back on');

  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exitCode = fails ? 1 : 0;
})();
