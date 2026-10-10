'use strict';

const { DAYS, MAX_SLOTS, DEFAULT_LEAD, MAX_LEAD, newId, clampLead, sanitizeSlots } = MindCommon;

// Only "notifications" can be optional in Firefox ("alarms" is a regular permission).
const PERMS = { permissions: ['notifications'] };
const $ = id => document.getElementById(id);

let favorites = [];
const drafts = new Map(); // favId -> slots as shown (may include incomplete rows)
let savedTimer = null;

function flashSaved() {
    const el = $('saved');
    el.textContent = '✓ Сохранено';
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.textContent = ''; }, 1500);
}

async function loadFavorites() {
    const stored = await browser.storage.local.get('favorites');
    favorites = (Array.isArray(stored.favorites) ? stored.favorites : [])
        .filter(f => f && typeof f.id === 'string' && typeof f.number === 'string');
    for (const fav of favorites) drafts.set(fav.id, sanitizeSlots(fav.slots));
}

// Re-read storage right before writing so we never overwrite changes made
// elsewhere (e.g. a rename in the popup); only this favourite's slots change.
async function persist(favId) {
    const stored = await browser.storage.local.get('favorites');
    const list = Array.isArray(stored.favorites) ? stored.favorites : [];
    const target = list.find(f => f && f.id === favId);
    if (!target) return;
    target.slots = sanitizeSlots(drafts.get(favId));
    await browser.storage.local.set({ favorites: list });
    flashSaved();
}

// ---------- permissions block ----------

async function hasPermissions() {
    try {
        return await browser.permissions.contains(PERMS);
    } catch (e) {
        return false;
    }
}

async function renderPermissions() {
    const box = $('perm');
    box.textContent = '';
    const granted = await hasPermissions();
    renderChat(granted);

    const status = document.createElement('div');
    status.className = 'status';
    const badge = document.createElement('span');
    badge.className = 'badge ' + (granted ? 'on' : 'off');
    badge.textContent = granted ? 'Уведомления включены' : 'Уведомления выключены';
    status.append(badge);

    const button = document.createElement('button');
    button.type = 'button';

    if (!granted) {
        button.className = 'btn primary';
        button.textContent = 'Включить уведомления';
        // permissions.request() must be called straight from the click handler.
        button.addEventListener('click', () => {
            browser.permissions.request(PERMS).then(async ok => {
                if (ok) await browser.runtime.sendMessage({ type: 'reschedule' }).catch(() => {});
                await renderPermissions();
            });
        });
        status.append(button);
        box.append(status);

        const text = document.createElement('p');
        text.className = 'hint';
        text.textContent = 'Расширение работает и без уведомлений. Если включить их, Firefox спросит разрешение на показ уведомлений. Оно нужно для напоминаний о конференциях и для сообщений чата, пока вкладка в фоне. Выключить можно в любой момент.';
        box.append(text);
        return;
    }

    button.className = 'btn';
    button.textContent = 'Отключить уведомления';
    button.addEventListener('click', async () => {
        try { await browser.alarms.clearAll(); } catch (e) { /* already gone */ }
        await browser.permissions.remove(PERMS);
        await renderPermissions();
    });
    status.append(button);
    box.append(status);

    const stored = await browser.storage.local.get('reminderLead');
    const row = document.createElement('label');
    row.className = 'lead';
    row.append('Напоминать за');
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(MAX_LEAD);
    input.value = String(stored.reminderLead == null ? DEFAULT_LEAD : clampLead(stored.reminderLead));
    input.addEventListener('change', async () => {
        const value = clampLead(input.value);
        input.value = String(value);
        await browser.storage.local.set({ reminderLead: value });
        flashSaved();
    });
    row.append(input, 'мин. до начала');
    box.append(row);
}

// ---------- chat notifications ----------

async function renderChat(granted) {
    const box = $('chat');
    box.textContent = '';
    const stored = await browser.storage.local.get('chatNotify');

    const h = document.createElement('h2');
    h.textContent = 'Чат';
    const label = document.createElement('label');
    label.className = 'check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = stored.chatNotify === true;
    input.addEventListener('change', async () => {
        await browser.storage.local.set({ chatNotify: input.checked });
        flashSaved();
    });
    label.append(input, 'Сообщать о новых сообщениях, пока вкладка в фоне');

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'В заголовке вкладки появится счётчик «(N)». Уведомления не засоряют экран: при потоке сообщений обновляются число и текст одного и того же уведомления, не чаще раза в секунду.'
        + (granted ? '' : ' Чтобы получать и всплывающие уведомления, включите уведомления выше.');
    const diag = document.createElement('a');
    diag.href = '../diagnostics/diagnostics.html';
    diag.textContent = 'Диагностика';
    box.append(h, label, hint, diag);
}

// ---------- schedule builder ----------

function renderSlot(fav, slot, container) {
    const row = document.createElement('div');
    row.className = 'slot';

    const days = document.createElement('div');
    days.className = 'days';
    days.setAttribute('role', 'group');
    days.setAttribute('aria-label', 'Дни недели');
    for (const day of DAYS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'day';
        b.textContent = day.short;
        b.title = day.full;
        b.setAttribute('aria-pressed', String(slot.days.includes(day.n)));
        b.addEventListener('click', () => {
            slot.days = slot.days.includes(day.n) ? slot.days.filter(d => d !== day.n) : [...slot.days, day.n];
            b.setAttribute('aria-pressed', String(slot.days.includes(day.n)));
            refreshWarning();
            persist(fav.id);
        });
        days.append(b);
    }

    const time = document.createElement('input');
    time.type = 'time';
    time.value = slot.time;
    time.setAttribute('aria-label', 'Время начала');
    time.addEventListener('input', () => {
        slot.time = time.value || '';
        refreshWarning();
        persist(fav.id);
    });

    const remove = MindIcons.button('close', 'Удалить время', 'remove');
    remove.addEventListener('click', () => {
        const list = drafts.get(fav.id);
        list.splice(list.indexOf(slot), 1);
        row.remove();
        persist(fav.id);
    });

    const warn = document.createElement('p');
    warn.className = 'warn';
    function refreshWarning() {
        const ok = slot.days.length > 0 && /^([01]\d|2[0-3]):[0-5]\d$/.test(slot.time);
        warn.textContent = ok ? '' : 'Выберите хотя бы один день и время — пока это расписание не действует.';
    }
    refreshWarning();

    row.append(days, time, remove, warn);
    container.append(row);
}

function renderCards() {
    const cards = $('cards');
    cards.textContent = '';
    $('empty').hidden = favorites.length > 0;

    for (const fav of favorites) {
        const card = document.createElement('article');
        card.className = 'card';
        card.id = 'fav-' + fav.id;

        const title = document.createElement('h3');
        title.textContent = fav.title || 'Конференция ' + fav.number;
        const num = document.createElement('p');
        num.className = 'num';
        num.textContent = 'Номер ' + fav.number;

        const slots = document.createElement('div');
        for (const slot of drafts.get(fav.id)) renderSlot(fav, slot, slots);

        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'add';
        add.textContent = '+ Добавить время';
        add.addEventListener('click', () => {
            const list = drafts.get(fav.id);
            if (list.length >= MAX_SLOTS) return;
            const slot = { id: newId(), days: [], time: '09:00' };
            list.push(slot);
            renderSlot(fav, slot, slots);
        });

        card.append(title, num, slots, add);
        cards.append(card);
    }

    const wanted = decodeURIComponent(location.hash.slice(1));
    const target = wanted && document.getElementById('fav-' + wanted);
    if (target) {
        target.classList.add('focus');
        target.scrollIntoView({ block: 'center' });
    }
}

(async function init() {
    await loadFavorites();
    await renderPermissions();
    renderCards();
})();
