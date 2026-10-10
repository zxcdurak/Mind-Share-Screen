'use strict';

const $ = id => document.getElementById(id);
const PERMS = { permissions: ['notifications'] };

// Log entry kinds -> what the user sees.
const KINDS = [
    ['page', 'Страница e-class'],
    ['share', 'Демонстрация экрана'],
    ['chat', 'Починка поля ввода чата'],
    ['notify', 'Уведомления о чате'],
    ['remind', 'Напоминания'],
    ['data', 'Избранное, импорт, вход гостем'],
    ['problem', 'Проблемы']
];

const pad = n => String(n).padStart(2, '0');
function clock(t) {
    const d = new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
function dateTime(t) {
    const d = new Date(t);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + ' ' + clock(t);
}

function logLine(e) {
    return dateTime(e.t) + ' [' + e.s + '/' + (e.k || 'page') + '] ' + e.m;
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
    add('Тема', MindTheme.LABELS[MindTheme.mode]);

    const stored = await browser.storage.local.get(['favorites', 'guestName', 'chatNotify', 'reminderLead']);
    const favorites = Array.isArray(stored.favorites) ? stored.favorites : [];
    const scheduled = favorites.filter(f => f && MindCommon.sanitizeSlots(f.slots).length).length;
    add('Избранное', favorites.length + ', с расписанием: ' + scheduled);
    add('Имя для входа гостем', stored.guestName ? 'задано' : 'не задано');

    let granted = false;
    try { granted = await browser.permissions.contains(PERMS); } catch (e) { /* ignore */ }
    add('Разрешение на уведомления', granted ? 'выдано' : 'не выдано (напоминания и уведомления чата выключены)');

    if (granted) {
        try {
            const alarms = (await browser.alarms.getAll()).filter(a => a.name.startsWith('r|'));
            const next = alarms.length ? Math.min(...alarms.map(a => a.scheduledTime)) : 0;
            add('Напоминания', 'запланировано: ' + alarms.length + (next ? ', ближайшее: ' + dateTime(next) : ''));
        } catch (e) {
            add('Напоминания', 'не удалось прочитать будильники: ' + (e && e.message), true);
        }
    }
    add('Уведомления о новых сообщениях чата', stored.chatNotify === true ? 'включены' : 'выключены');

    try {
        const bg = await browser.runtime.sendMessage({ type: 'diagState' });
        add('Фоновая страница', bg ? 'работает' + (bg.notificationsApi ? ', API уведомлений доступен' : ', API уведомлений недоступен') : 'ответила пусто', !bg);
    } catch (e) {
        add('Фоновая страница', 'не отвечает: ' + (e && e.message), true);
    }
    return rows;
}

function featureRows(entries) {
    return KINDS.map(([kind, name]) => {
        const mine = entries.filter(e => (e.k || 'page') === kind);
        const last = mine[mine.length - 1];
        if (kind === 'problem') {
            return { name, value: last ? mine.length + ', последняя: ' + dateTime(last.t) + ' — ' + last.m : 'не обнаружено', bad: !!last };
        }
        return { name, value: last ? dateTime(last.t) + ' — ' + last.m : 'событий не было', bad: false };
    });
}

function fill(dl, rows) {
    dl.textContent = '';
    for (const r of rows) {
        const dt = document.createElement('dt');
        dt.textContent = r.name;
        const dd = document.createElement('dd');
        dd.textContent = r.value;
        if (r.bad) dd.className = 'bad';
        dl.append(dt, dd);
    }
}

function setupFilter() {
    const select = $('filter');
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'Все события';
    select.append(all);
    for (const [kind, name] of KINDS) {
        const o = document.createElement('option');
        o.value = kind;
        o.textContent = name;
        select.append(o);
    }
    select.addEventListener('change', renderLog);
}

async function renderState() {
    fill($('state'), await collectState());
    fill($('features'), featureRows(await MindDiag.read()));
}

async function renderLog() {
    const kind = $('filter').value;
    const entries = (await MindDiag.read()).filter(e => !kind || (e.k || 'page') === kind);
    const list = $('log');
    list.textContent = '';
    $('empty').hidden = entries.length > 0;
    list.hidden = entries.length === 0;
    for (const e of entries) {
        const li = document.createElement('li');
        const src = document.createElement('span');
        src.className = 'src';
        src.textContent = dateTime(e.t) + ' [' + e.s + '] ';
        li.append(src, e.m);
        list.append(li);
    }
    list.scrollTop = list.scrollHeight;
    fill($('features'), featureRows(await MindDiag.read()));
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
    await renderState();
    await renderLog();
});

$('copyBtn').addEventListener('click', async () => {
    const rows = await collectState();
    const entries = await MindDiag.read();
    const text = rows.map(r => r.name + ': ' + r.value).join('\n')
        + '\n\n' + featureRows(entries).map(r => r.name + ': ' + r.value).join('\n')
        + '\n\n' + entries.map(logLine).join('\n');
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
    setupFilter();
    await renderState();
    await renderLog();
})();
