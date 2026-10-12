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

const BS = String.fromCharCode(92);   // a backslash, spelled out so the patterns below stay readable
const HTML_REF = new RegExp('(?:src|href)="([^"#?]+)"', 'g');
const REMOTE = new RegExp('^(https?:|' + BS + '/' + BS + '/|data:)');
const GET_URL = new RegExp('getURL' + BS + '(' + "'([^']+)'" + BS + ')', 'g');
const IMPORT_SCRIPTS = new RegExp('importScripts' + BS + '(([^)]*)' + BS + ')', 'g');
const QUOTED = new RegExp("'([^']+)'", 'g');
const IS_HTML_OR_JS = new RegExp(BS + '.(html|js)$');

function relativeTo(fromFile, ref) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), ref));
}

// Files that `name` (an HTML page or a script) points to.
function referencedBy(name, text) {
    const out = [];
    if (name.endsWith('.html')) {
        for (const m of text.matchAll(HTML_REF)) {
            if (!REMOTE.test(m[1])) out.push(relativeTo(name, m[1]));
        }
    } else if (name.endsWith('.js')) {
        for (const m of text.matchAll(GET_URL)) out.push(m[1]);
        for (const m of text.matchAll(IMPORT_SCRIPTS)) {
            for (const s of m[1].matchAll(QUOTED)) out.push(relativeTo(name, s[1]));
        }
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
    // Limits of the Chromium stores (Chrome Web Store, Edge Add-ons, Opera add-ons, which Yandex Browser uses).
    if (target === 'chromium') {
        if (manifest.description.length > 132) fail('chromium: description is ' + manifest.description.length + ' characters, the stores allow 132');
        if (manifest.name.length > 45) fail('chromium: name is ' + manifest.name.length + ' characters, the stores allow 45');
    }

    const packed = collect(target);
    const names = new Set(packed.map(f => f.name));
    const refs = new Map(); // file -> who points to it
    for (const f of manifestFiles(manifest)) refs.set(f, 'manifest');
    for (const { name, file } of packed) {
        if (name.includes(String.fromCharCode(92))) fail(target + ': backslash in archive path ' + name);
        if (!IS_HTML_OR_JS.test(name)) continue;
        for (const ref of referencedBy(name, fs.readFileSync(file, 'utf8'))) if (!refs.has(ref)) refs.set(ref, name);
    }
    for (const [ref, who] of refs) {
        if (!names.has(ref)) fail(target + ': ' + who + ' points to ' + ref + ', which is not in the package');
    }
    console.log(target + ': version ' + manifest.version + ', ' + packed.length + ' files, ' + refs.size + ' references checked');
}

const distinct = new Set(Object.values(versions));
if (distinct.size > 1) fail('manifest versions differ: ' + JSON.stringify(versions));

// Every released version needs a CHANGELOG.md entry.
const changelog = exists('CHANGELOG.md') ? fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8') : '';
for (const v of distinct) if (!changelog.includes('## [' + v + ']')) fail('CHANGELOG.md has no entry for version ' + v);


if (problems.length) {
    console.error('\n' + problems.map(p => 'FAIL ' + p).join('\n'));
    process.exit(1);
}
console.log('check passed');
