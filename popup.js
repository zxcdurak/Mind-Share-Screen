'use strict';

const HOST = 'e-class.tsu.ru';
const KEY = 'favorites';

const $ = id => document.getElementById(id);

let currentTab = null;
let favorites = [];

function parseSupportedUrl(url) {
    try {
        const u = new URL(url);
        return u.protocol === 'https:' && u.hostname === HOST ? u : null;
    } catch (e) {
        return null;
    }
}

async function load() {
    const stored = await browser.storage.local.get(KEY);
    const list = stored[KEY];
    favorites = Array.isArray(list)
        ? list.filter(f => f && typeof f.url === 'string' && parseSupportedUrl(f.url))
        : [];
}

function save() {
    return browser.storage.local.set({ [KEY]: favorites });
}

function findCurrent() {
    return currentTab ? favorites.find(f => f.url === currentTab.url) : undefined;
}

function refreshAddState() {
    const hint = $('hint');
    const button = $('addBtn');
    const name = $('name');

    const url = currentTab && currentTab.url ? parseSupportedUrl(currentTab.url) : null;
    const looksLikeRoot = url && url.pathname === '/' && !url.search && !url.hash;

    let message = '';
    if (!url) {
        message = 'Чтобы добавить конференцию, откройте её вкладку на ' + HOST + '.';
    } else if (looksLikeRoot) {
        message = 'У этой страницы нет адреса конференции — сначала откройте нужную конференцию.';
    }

    const enabled = !message;
    button.disabled = !enabled;
    name.disabled = !enabled;
    hint.hidden = enabled;
    hint.textContent = message;
    button.textContent = findCurrent() ? 'Сохранить название' : 'Добавить текущую вкладку';
}

async function openFavorite(fav) {
    await browser.tabs.create({ url: fav.url });
    window.close();
}

async function remove(fav) {
    favorites = favorites.filter(f => f.id !== fav.id);
    await save();
    render();
    refreshAddState();
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
        refreshAddState();
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
        open.textContent = fav.title || fav.url;
        open.title = fav.url;
        open.addEventListener('click', () => openFavorite(fav));

        const rename = document.createElement('button');
        rename.type = 'button';
        rename.className = 'icon';
        rename.textContent = '✎';
        rename.title = 'Переименовать';
        rename.addEventListener('click', () => startRename(li, fav));

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'icon delete';
        del.textContent = '✕';
        del.title = 'Удалить';
        del.addEventListener('click', () => remove(fav));

        li.append(open, rename, del);
        list.append(li);
    }
}

$('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!currentTab || !parseSupportedUrl(currentTab.url)) return;

    const title = $('name').value.trim() || currentTab.title || currentTab.url;
    const existing = findCurrent();
    if (existing) {
        existing.title = title;
    } else {
        favorites.push({ id: crypto.randomUUID(), title, url: currentTab.url, added: Date.now() });
    }

    await save();
    render();
    refreshAddState();
});

(async function init() {
    await load();
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    currentTab = tabs[0] || null;

    const existing = findCurrent();
    $('name').value = existing ? existing.title : (currentTab && currentTab.title) || '';

    refreshAddState();
    render();
})();
