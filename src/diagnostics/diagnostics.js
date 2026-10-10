'use strict';

const $ = id => document.getElementById(id);
const PERMS = { permissions: ['notifications'] };

const pad = n => String(n).padStart(2, '0');
function clock(t) {
    const d = new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

function logLine(e) {
    return clock(e.t) + ' [' + e.s + '] ' + e.m;
}

async function collectState() {
    const rows = [];
    const add = (name, value, bad) => rows.push({ name, value, bad: !!bad });

    add('Расширение', browser.runtime.getManifest().version);
    try {
        const info = await browser.runtime.getBrowserInfo();
        const platform = await browser.runtime.getPlatformInfo();
        add('Браузер', info.name + ' ' + info.version + ', ' + platform.os);
    } catch (e) {
        add('Браузер', navigator.userAgent);
    }

    let granted = false;
    try { granted = await browser.permissions.contains(PERMS); } catch (e) { /* ignore */ }
    add('Разрешение на уведомления', granted ? 'выдано' : 'не выдано', !granted);

    const stored = await browser.storage.local.get('chatNotify');
    add('Флажок «сообщения чата»', stored.chatNotify === true ? 'включён' : 'выключен');

    try {
        const bg = await browser.runtime.sendMessage({ type: 'diagState' });
        add('Фоновая страница видит API уведомлений', bg && bg.notificationsApi ? 'да' : 'нет', !(bg && bg.notificationsApi));
    } catch (e) {
        add('Фоновая страница', 'не отвечает: ' + (e && e.message), true);
    }
    return rows;
}

async function renderState() {
    const dl = $('state');
    dl.textContent = '';
    const rows = await collectState();
    for (const r of rows) {
        const dt = document.createElement('dt');
        dt.textContent = r.name;
        const dd = document.createElement('dd');
        dd.textContent = r.value;
        if (r.bad) dd.className = 'bad';
        dl.append(dt, dd);
    }
}

async function renderLog() {
    const entries = await MindDiag.read();
    const list = $('log');
    list.textContent = '';
    $('empty').hidden = entries.length > 0;
    list.hidden = entries.length === 0;
    for (const e of entries) {
        const li = document.createElement('li');
        const src = document.createElement('span');
        src.className = 'src';
        src.textContent = clock(e.t) + ' [' + e.s + '] ';
        li.append(src, e.m);
        list.append(li);
    }
    list.scrollTop = list.scrollHeight;
}

$('testBtn').addEventListener('click', async () => {
    const out = $('testResult');
    out.textContent = 'Отправляю…';
    const since = Date.now();
    let created = false;
    try { created = await browser.runtime.sendMessage({ type: 'diagTest' }); } catch (e) { /* reported below */ }
    if (!created) {
        out.textContent = 'Firefox не смог создать уведомление. Подробности в журнале ниже.';
    } else {
        // onShown is reported by Firefox a moment after create().
        let shown = false;
        for (let i = 0; i < 10 && !shown; i++) {
            await new Promise(r => setTimeout(r, 300));
            shown = (await MindDiag.read()).some(e => e.t >= since && /shown: mind-test/.test(e.m));
        }
        out.textContent = shown
            ? 'Firefox подтвердил показ уведомления. Если на экране его нет, проверьте настройки уведомлений системы.'
            : 'Уведомление создано, но Firefox не подтвердил показ. Проверьте настройки уведомлений системы и режим «Не беспокоить».';
    }
    await renderLog();
});

$('refreshBtn').addEventListener('click', () => { renderState(); renderLog(); });

$('clearBtn').addEventListener('click', async () => {
    await MindDiag.clear();
    await renderLog();
});

$('copyBtn').addEventListener('click', async () => {
    const rows = await collectState();
    const entries = await MindDiag.read();
    const text = rows.map(r => r.name + ': ' + r.value).join('\n') + '\n\n' + entries.map(logLine).join('\n');
    try {
        await navigator.clipboard.writeText(text);
        $('copyBtn').textContent = 'Скопировано';
    } catch (e) {
        $('copyBtn').textContent = 'Не удалось скопировать';
    }
    setTimeout(() => { $('copyBtn').textContent = 'Скопировать всё'; }, 1500);
});

browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[MindDiag.KEY]) renderLog();
});

(async function init() {
    await renderState();
    await renderLog();
})();
