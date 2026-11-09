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
        open.title = 'Войти по номеру ' + fav.number
            + (MindCommon.sanitizeSlots(fav.slots).length ? '\n' + scheduleSummary(fav) : '');
        open.addEventListener('click', () => openFavorite(fav));

        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = fav.title;
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = formatNumber(fav.number);
        open.append(name, num);

        const rename = MindIcons.button('pencil', 'Переименовать');
        rename.addEventListener('click', () => startRename(li, fav));

        const del = MindIcons.button('close', 'Удалить');
        del.addEventListener('click', () => remove(fav));

        li.append(open, rename, del);
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

const transferBtn = MindIcons.button('transfer', 'Импорт и экспорт избранного');
transferBtn.id = 'transferBtn';
transferBtn.addEventListener('click', async () => {
    await browser.tabs.create({ url: browser.runtime.getURL('src/transfer/transfer.html') });
    window.close();
});

// Theme switcher: one button that cycles dark -> light -> system.
const THEME_ICONS = { dark: 'moon', light: 'sun', system: 'monitor' };
const themeBtn = document.createElement('button');
themeBtn.type = 'button';
themeBtn.id = 'themeBtn';
themeBtn.className = 'icon-btn';

function renderThemeButton() {
    const mode = MindTheme.mode;
    const label = 'Тема: ' + MindTheme.LABELS[mode] + '. Нажмите, чтобы сменить на «' + MindTheme.LABELS[MindTheme.nextMode()] + '»';
    themeBtn.title = label;
    themeBtn.setAttribute('aria-label', label);
    themeBtn.replaceChildren(MindIcons.create(THEME_ICONS[mode]));
}
themeBtn.addEventListener('click', () => {
    MindTheme.setMode(MindTheme.nextMode());
    renderThemeButton();
});
renderThemeButton();

// Style picker: a button that opens a drop-down list of the looks (Призма, Ритм, Дымка, Растр, Чертёж, and the user's own
// themes, one item for each saved) with "Своя тема…" at the end, which opens the page where such a theme is made. The
// light / dark mode button next to it is independent of it.
const styleWrap = document.createElement('span');
styleWrap.className = 'menu-wrap';

const styleBtn = document.createElement('button');
styleBtn.type = 'button';
styleBtn.id = 'styleBtn';
styleBtn.className = 'icon-btn';
styleBtn.setAttribute('aria-haspopup', 'listbox');
styleBtn.setAttribute('aria-expanded', 'false');
styleBtn.setAttribute('aria-controls', 'styleMenu');
styleBtn.append(MindIcons.create('palette'));

const styleMenu = document.createElement('div');
styleMenu.id = 'styleMenu';
styleMenu.className = 'menu';
styleMenu.setAttribute('role', 'listbox');
styleMenu.setAttribute('aria-label', 'Оформление');
styleMenu.hidden = true;

const styleItems = MindTheme.STYLES.concat(MindTheme.custom.list().map(theme => MindTheme.CUSTOM_PREFIX + theme.id)).map(style => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.dataset.style = style;
    item.setAttribute('role', 'option');
    item.append(MindIcons.create('check'), document.createTextNode(MindTheme.labelOf(style)));
    item.addEventListener('click', () => {
        MindTheme.setStyle(style);
        closeStyleMenu(true);
    });
    return item;
});
// the last item is not a look but a door: the page with the instruction for making your own theme
const customPageItem = document.createElement('button');
customPageItem.type = 'button';
customPageItem.className = 'menu-item';
customPageItem.id = 'customThemeItem';
customPageItem.setAttribute('role', 'option');
customPageItem.append(MindIcons.create('check'), document.createTextNode('Своя тема…'));
customPageItem.addEventListener('click', async () => {
    await browser.tabs.create({ url: browser.runtime.getURL('src/customtheme/customtheme.html') });
    window.close();
});
styleItems.push(customPageItem);
styleMenu.append(...styleItems);
styleWrap.append(styleBtn, styleMenu);

function renderStyleMenu() {
    const current = MindTheme.style;
    const label = 'Оформление: ' + MindTheme.labelOf(current);
    styleBtn.title = label;
    styleBtn.setAttribute('aria-label', label);
    for (const item of styleItems) item.setAttribute('aria-selected', String(item.dataset.style === current));
}
function openStyleMenu() {
    styleMenu.hidden = false;
    styleBtn.setAttribute('aria-expanded', 'true');
    (styleItems.find(item => item.dataset.style === MindTheme.style) || styleItems[0]).focus();
}
function closeStyleMenu(refocus) {
    styleMenu.hidden = true;
    styleBtn.setAttribute('aria-expanded', 'false');
    renderStyleMenu();
    if (refocus) styleBtn.focus();
}
styleBtn.addEventListener('click', () => (styleMenu.hidden ? openStyleMenu() : closeStyleMenu(false)));
styleMenu.addEventListener('keydown', event => {
    const at = styleItems.indexOf(document.activeElement);
    const go = index => { event.preventDefault(); styleItems[(index + styleItems.length) % styleItems.length].focus(); };
    if (event.key === 'ArrowDown') go(at + 1);
    else if (event.key === 'ArrowUp') go(at - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(styleItems.length - 1);
    else if (event.key === 'Escape') { event.preventDefault(); closeStyleMenu(true); }
    else if (event.key === 'Tab') closeStyleMenu(false);
});
document.addEventListener('click', event => {
    if (!styleWrap.contains(event.target)) closeStyleMenu(false);
});
renderStyleMenu();

const bellBtn = MindIcons.button('bell', 'Уведомления и напоминания');
bellBtn.addEventListener('click', async () => {
    await browser.tabs.create({ url: browser.runtime.getURL('src/notifications/notifications.html') });
    window.close();
});

const diagBtn = MindIcons.button('pulse', 'Диагностика');
diagBtn.addEventListener('click', async () => {
    await browser.tabs.create({ url: browser.runtime.getURL('src/diagnostics/diagnostics.html') });
    window.close();
});

$('headerButtons').append(styleWrap, themeBtn, bellBtn, diagBtn, transferBtn);

$('guestName').addEventListener('input', () => {
    browser.storage.local.set({ [GUEST_NAME_KEY]: cleanName($('guestName').value) });
});

(async function init() {
    await load();
    render();
})();
