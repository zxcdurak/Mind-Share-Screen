#!/usr/bin/env node
'use strict';

// Sanity checks before a release:
//   * every manifest that exists is valid JSON, and all manifests carry the same version;
//   * every file a manifest, an HTML page or a runtime.getURL() call points to exists;
//   * the packed archives use forward slashes in entry names.
//
//   node scripts/check.js

const fs = require('fs');
const path = require('path');
const { TARGETS, collect } = require('./build');

const ROOT = path.resolve(__dirname, '..');
const problems = [];
const fail = msg => problems.push(msg);

function exists(rel) {
    return fs.existsSync(path.join(ROOT, rel));
}

function manifestFiles(m) {
    const out = new Set();
    const add = f => typeof f === 'string' && out.add(f);

    Object.values(m.icons || {}).forEach(add);
    const action = m.browser_action || m.action;
    if (action) {
        add(action.default_popup);
        Object.values(action.default_icon || {}).forEach(add);
    }
    const bg = m.background || {};
    (bg.scripts || []).forEach(add);
    add(bg.service_worker);
    add(bg.page);
    for (const cs of m.content_scripts || []) {
        (cs.js || []).forEach(add);
        (cs.css || []).forEach(add);
    }
    for (const entry of m.web_accessible_resources || []) {
        if (typeof entry === 'string') add(entry);
        else (entry.resources || []).forEach(add);
    }
    return out;
}

function htmlFiles(htmlRel) {
    const text = fs.readFileSync(path.join(ROOT, htmlRel), 'utf8');
    const out = [];
    for (const m of text.matchAll(/(?:src|href)="([^"#?]+)"/g)) {
        if (/^(https?:|\/\/|data:)/.test(m[1])) continue;
        out.push(path.posix.normalize(path.posix.join(path.posix.dirname(htmlRel), m[1])));
    }
    return out;
}

function sourceFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = dir + '/' + e.name;
        if (e.isDirectory()) out.push(...sourceFiles(rel));
        else out.push(rel);
    }
    return out;
}

const versions = {};
for (const [target, info] of Object.entries(TARGETS)) {
    if (!exists(info.manifest)) {
        console.log(target + ': no manifest, skipped');
        continue;
    }
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(path.join(ROOT, info.manifest), 'utf8'));
    } catch (e) {
        fail(target + ': manifest is not valid JSON (' + e.message + ')');
        continue;
    }
    versions[target] = manifest.version;

    const refs = manifestFiles(manifest);
    for (const f of [...refs]) if (f.endsWith('.html')) htmlFiles(f).forEach(x => refs.add(x));
    for (const f of sourceFiles('src').filter(x => x.endsWith('.js'))) {
        const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
        for (const m of text.matchAll(/getURL\('([^']+)'\)/g)) refs.add(m[1]);
    }
    for (const f of refs) if (!exists(f)) fail(target + ': missing file ' + f);

    for (const { name } of collect(target)) {
        if (name.includes(String.fromCharCode(92))) fail(target + ': backslash in archive path ' + name);
    }
    console.log(target + ': version ' + manifest.version + ', ' + refs.size + ' references checked');
}

const distinct = new Set(Object.values(versions));
if (distinct.size > 1) fail('manifest versions differ: ' + JSON.stringify(versions));


if (problems.length) {
    console.error('\n' + problems.map(p => 'FAIL ' + p).join('\n'));
    process.exit(1);
}
console.log('check passed');
