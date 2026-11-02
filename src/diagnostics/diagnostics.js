'use strict';

const $ = id => document.getElementById(id);
const PERMS = { permissions: ['notifications'] };

// Log entry kinds -> what the user sees.
const KINDS = [
    ['page', 'Страница e-class'],
    ['share', 'Демонстрация экрана'],
    ['net', 'Сеть и WebRTC'],
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
    add('Тема', MindTheme.LABELS[MindTheme.mode] + ', оформление «' + MindTheme.STYLE_LABELS[MindTheme.style] + '»');
    add('Журнал событий', (await MindDiag.isEnabled()) ? 'ведётся' : 'выключен, новые события не записываются');

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
    let canConfirm = true;
    try {
        created = await browser.runtime.sendMessage({ type: 'diagTest' });
        const state = await browser.runtime.sendMessage({ type: 'diagState' });
        canConfirm = !!(state && state.shownEvent);
    } catch (e) { /* reported below */ }
    if (!created) {
        out.textContent = 'Браузер не смог создать уведомление. Подробности в журнале ниже.';
    } else if (!canConfirm) {
        out.textContent = 'Уведомление создано. Этот браузер не сообщает, показал ли он его: если на экране пусто, проверьте настройки уведомлений системы и режим «Не беспокоить».';
    } else {
        // onShown is reported by Firefox a moment after create().
        let shown = false;
        for (let i = 0; i < 10 && !shown; i++) {
            await new Promise(r => setTimeout(r, 300));
            shown = (await MindDiag.read()).some(e => e.t >= since && /shown: mind-test/.test(e.m));
        }
        out.textContent = shown
            ? 'Браузер подтвердил показ уведомления. Если на экране его нет, проверьте настройки уведомлений системы.'
            : 'Уведомление создано, но браузер не подтвердил показ. Проверьте настройки уведомлений системы и режим «Не беспокоить».';
    }
    await renderLog();
});

// Codec names of an SDP offer, grouped by media kind: "video: VP8, VP9, flexfec-03; audio: opus".
// Only names, no addresses or fingerprints, so the line is safe to copy into a bug report.
function summarizeCodecs(sdp) {
    const byKind = {};
    let kind = '';
    for (const line of String(sdp).split(/\r?\n/)) {
        const section = /^m=(\w+)/.exec(line);
        if (section) { kind = section[1]; continue; }
        const codec = /^a=rtpmap:\d+ ([^/\s]+)/.exec(line);
        if (codec && kind) {
            byKind[kind] = byKind[kind] || [];
            if (!byKind[kind].includes(codec[1])) byKind[kind].push(codec[1]);
        }
    }
    return Object.keys(byKind).map(k => k + ': ' + byKind[k].join(', ')).join('; ');
}

// Local WebRTC check: a connection without any servers, so nothing leaves the computer.
// It shows whether this browser can gather connection addresses at all.
$('rtcBtn').addEventListener('click', async () => {
    const out = $('rtcResult');
    out.textContent = 'Проверяю…';
    if (typeof RTCPeerConnection !== 'function') {
        out.textContent = 'В этом браузере нет WebRTC.';
        return;
    }
    const kinds = {};
    let hidden = 0;
    let pc = null;
    let codecs = '';
    try {
        pc = new RTCPeerConnection({ iceServers: [] });
        pc.addTransceiver('audio');
        pc.addTransceiver('video');
        const done = new Promise(resolve => {
            const timer = setTimeout(resolve, 4000);
            pc.onicecandidate = event => {
                if (!event.candidate) { clearTimeout(timer); resolve(); return; }
                const text = event.candidate.candidate || '';
                const match = / typ (host|srflx|prflx|relay)/.exec(text);
                if (match) kinds[match[1]] = (kinds[match[1]] || 0) + 1;
                if (/ [0-9a-f-]+\.local /i.test(text)) hidden++;
            };
        });
        const offer = await pc.createOffer();
        codecs = summarizeCodecs(offer.sdp);
        await pc.setLocalDescription(offer);
        await done;
    } catch (e) {
        out.textContent = 'Не удалось создать WebRTC-соединение: ' + (e && e.name ? e.name : 'ошибка') + '.';
        await MindDiag.log('diagnostics', 'проверка WebRTC: ошибка ' + (e && e.name), 'problem');
        await renderLog();
        return;
    } finally {
        if (pc) pc.close();
    }
    const total = Object.values(kinds).reduce((a, b) => a + b, 0);
    const summary = Object.keys(kinds).map(k => k + ': ' + kinds[k]).join(', ');
    out.textContent = total
        ? 'Браузер нашёл адреса (' + summary + ')' + (hidden ? '; локальные адреса скрыты под именами .local, это нормально' : '') + '. Без внешнего сервера проверить большее нельзя: если конференция всё равно не подключается, а в другом браузере работает, смотрите брандмауэр, антивирус и настройки WebRTC этого браузера.'
        : 'Браузер не нашёл ни одного адреса для WebRTC. Это объясняет, почему конференция не подключается: проверьте настройки приватности и WebRTC браузера, расширения для защиты от утечки IP, брандмауэр.';
    await MindDiag.log('diagnostics', 'проверка WebRTC: ' + (summary || 'адресов нет'), total ? 'net' : 'problem');
    if (codecs) await MindDiag.log('diagnostics', 'кодеки в предложении: ' + codecs, 'net');
    await renderLog();
});

$('resetBtn').addEventListener('click', async () => {
    const out = $('resetResult');
    out.textContent = 'Сбрасываю…';
    let result = null;
    try { result = await browser.runtime.sendMessage({ type: 'resetConnections' }); } catch (e) { /* reported below */ }
    if (!result) out.textContent = 'Не удалось связаться с фоном расширения. Подробности в журнале ниже.';
    else if (!result.tabs) out.textContent = 'Открытых вкладок i.Mind нет, закрывать нечего. Если сайт всё равно жалуется, сервер освободит соединения сам примерно через 45 секунд.';
    else out.textContent = 'Вкладок i.Mind: ' + result.tabs + ', закрыто соединений: ' + result.closed + '.';
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

$('logToggle').addEventListener('change', async () => {
    await MindDiag.setEnabled($('logToggle').checked);
    await renderState();
});

(async function init() {
    $('logToggle').checked = await MindDiag.isEnabled();
    setupFilter();
    await renderState();
    await renderLog();
})();
