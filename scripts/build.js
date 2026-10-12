#!/usr/bin/env node
'use strict';

// Packs the extension for one or both browsers. No dependencies, no code
// transformation: files are copied as they are, only the manifest differs.
//
//   node scripts/build.js firefox            -> dist/firefox/
//   node scripts/build.js chromium --zip     -> dist/chromium/ and dist/mind-for-chromium-<version>.zip
//   node scripts/build.js all --zip
//
// Firefox:  manifest.json at the repository root (also used for temporary
//           installation from about:debugging); the package is an .xpi.
// Chromium: chromium/manifest.json; the package is a .zip.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const TARGETS = {
    firefox: { manifest: 'manifest.json', ext: 'xpi' },
    chromium: { manifest: path.join('chromium', 'manifest.json'), ext: 'zip' }
};

// Everything the extension needs besides its manifest.
const INCLUDE = ['icons', 'src'];

function listFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...listFiles(full));
        else out.push(full);
    }
    return out;
}

// [{ name: 'src/popup/popup.js', file: '<absolute path>' }], manifest first.
function collect(target) {
    const manifestPath = path.join(ROOT, TARGETS[target].manifest);
    if (!fs.existsSync(manifestPath)) throw new Error('No manifest for ' + target + ': ' + TARGETS[target].manifest);

    const files = [{ name: 'manifest.json', file: manifestPath }];
    for (const dir of INCLUDE) {
        for (const file of listFiles(path.join(ROOT, dir)).sort()) {
            files.push({ name: path.relative(ROOT, file).split(path.sep).join('/'), file });
        }
    }
    return files;
}

function version(target) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, TARGETS[target].manifest), 'utf8')).version;
}

// ---- minimal zip writer (entry names always use forward slashes) ----

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

function zip(entries) {
    const { time, day } = dosDateTime(new Date());
    const locals = [];
    const centrals = [];
    let offset = 0;

    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const packed = zlib.deflateRawSync(data, { level: 9 });
        const crc = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);             // version needed
        local.writeUInt16LE(0x0800, 6);         // UTF-8 names
        local.writeUInt16LE(8, 8);              // deflate
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(day, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(packed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        locals.push(local, nameBuf, packed);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);           // version made by
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(day, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(packed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);

        offset += local.length + nameBuf.length + packed.length;
    }

    const centralSize = centrals.reduce((n, b) => n + b.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...locals, ...centrals, end]);
}

// ---- build ----

function build(target, makeZip) {
    const files = collect(target);
    const outDir = path.join(DIST, target);

    fs.rmSync(outDir, { recursive: true, force: true });
    for (const { name, file } of files) {
        const dest = path.join(outDir, name);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(file, dest);
    }
    console.log(target + ': ' + files.length + ' files -> ' + path.relative(ROOT, outDir));

    if (makeZip) {
        const out = path.join(DIST, 'mind-for-' + target + '-' + version(target) + '.' + TARGETS[target].ext);
        const entries = files.map(f => ({ name: f.name, data: fs.readFileSync(f.file) }));
        fs.writeFileSync(out, zip(entries));
        console.log(target + ': ' + path.relative(ROOT, out));
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const makeZip = args.includes('--zip');
    const which = args.find(a => !a.startsWith('--'));
    const targets = which === 'all' ? Object.keys(TARGETS) : [which];

    if (!targets.length || !targets.every(t => TARGETS[t])) {
        console.error('Usage: node scripts/build.js <firefox|chromium|all> [--zip]');
        process.exit(2);
    }
    try {
        for (const t of targets) build(t, makeZip);
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}

module.exports = { TARGETS, collect, version, zip };
