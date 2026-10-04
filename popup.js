'use strict';

const FAVORITES_KEY = 'favorites';
const GUEST_NAME_KEY = 'guestName';

const $ = id => document.getElementById(id);
const { cleanName } = MindCommon;

let favorites = [];

function normalizeNumber(value) {
    const digits = String(value).replace(/[\s\-–—]/g, '');
    return /^\d{1,18}$/.test(digits) ? digits : null;
}

function formatNumber(number) {
    return number.length > 3 ? number.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : number;
}

async function load() {
    const stored = await browser.storage.local.get([FAVORITES_KEY, GUEST_NAME_KEY]);
    const list = stored[FAVORITES_KEY];
    favorites = Array.isArray(list)
        ? list.filter(f => f && typeof f.number === 'string' && normalizeNumber(f.number))
        : [];
    $('guestName').value = typeof stored[GUEST_NAME_KEY] === 'string' ? stored[GUEST_NAME_KEY] : '';
}

function save() {
    return browser.storage.local.set({ [FAVORITES_KEY]: favorites });
}

function showError(message) {
    const el = $('error');
    el.textContent = message;
    el.hidden = !message;
}

async function openFavorite(fav) {
    await MindCommon.openConference(fav.number);
    window.close();
}

async function openReminders(fav) {
    await browser.tabs.create({ url: browser.runtime.getURL('reminders.html') + '#' + encodeURIComponent(fav.id) });
    window.close();
}

function scheduleSummary(fav) {
    const slots = MindCommon.sanitizeSlots(fav.slots);
    if (!slots.length) return 'Напоминания: расписание не задано';
    const label = slots.map(s => s.days
        .slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
        .map(d => MindCommon.DAYS.find(x => x.n === d).short).join(', ') + ' ' + s.time).join('; ');
    return 'Расписание: ' + label;
}

async function remove(fav) {
    favorites = favorites.filter(f => f.id !== fav.id);
    await save();
    render();
}

function startRename(li, fav) {
    const openButton = li.querySelector('.open');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = fav.title;
    input.maxLength = 80;

    let done = false;
    const finish = async commit => {
        if (done) return;
        done = true;
        const title = input.value.trim();
        if (commit && title && title !== fav.title) {
            fav.title = title;
            await save();
        }
        render();
    };

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));

    openButton.replaceWith(input);
    input.focus();
    input.select();
}

function render() {
    const list = $('list');
    list.textContent = '';
    $('empty').hidden = favorites.length > 0;

    for (const fav of favorites) {
        const li = document.createElement('li');

        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'open';
        open.title = 'Войти по номеру ' + fav.number;
        open.addEventListener('click', () => openFavorite(fav));

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = fav.title;
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = formatNumber(fav.number);
        open.append(name, num);

        const rename = document.createElement('button');
        rename.type = 'button';
        rename.className = 'icon';
        rename.textContent = '✎';
        rename.title = 'Переименовать';
        rename.addEventListener('click', () => startRename(li, fav));

        const bell = document.createElement('button');
        bell.type = 'button';
        bell.className = 'icon' + (MindCommon.sanitizeSlots(fav.slots).length ? ' active' : '');
        bell.textContent = '⏰';
        bell.title = scheduleSummary(fav);
        bell.addEventListener('click', () => openReminders(fav));

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'icon delete';
        del.textContent = '✕';
        del.title = 'Удалить';
        del.addEventListener('click', () => remove(fav));

        li.append(open, bell, rename, del);
        list.append(li);
    }
}

$('addForm').addEventListener('submit', async e => {
    e.preventDefault();

    const number = normalizeNumber($('number').value);
    if (!number) {
        showError('Номер конференции должен состоять только из цифр.');
        return;
    }
    showError('');

    const title = $('title').value.trim() || 'Конференция ' + formatNumber(number);
    const existing = favorites.find(f => f.number === number);
    if (existing) {
        existing.title = title;
    } else {
        favorites.push({ id: crypto.randomUUID(), title, number, added: Date.now() });
    }

    await save();
    $('title').value = '';
    $('number').value = '';
    render();
});

$('transferBtn').addEventListener('click', async () => {
    await browser.tabs.create({ url: browser.runtime.getURL('transfer.html') });
    window.close();
});

$('guestName').addEventListener('input', () => {
    browser.storage.local.set({ [GUEST_NAME_KEY]: cleanName($('guestName').value) });
});

(async function init() {
    await load();
    render();
})();
