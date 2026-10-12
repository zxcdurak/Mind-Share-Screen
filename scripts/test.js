#!/usr/bin/env node
'use strict';

// Runs every file in tests/ in its own Node process and reports a summary.
//   node scripts/test.js

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.resolve(__dirname, '..', 'tests');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort();

let failed = 0;
for (const f of files) {
    const run = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
    const output = (run.stdout || '') + (run.stderr || '');
    const bad = run.status !== 0 || /\bFAIL(ED)?\b/.test(output);
    console.log((bad ? 'FAIL ' : 'ok   ') + f);
    if (bad) {
        failed++;
        console.log(output.split('\n').filter(l => /FAIL/.test(l)).join('\n') || output);
    }
}

console.log(failed ? '\n' + failed + ' of ' + files.length + ' test files failed' : '\nall ' + files.length + ' test files passed');
process.exit(failed ? 1 : 0);
