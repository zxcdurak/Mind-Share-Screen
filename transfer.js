'use strict';

const FAVORITES_KEY = 'favorites';
const FORMAT = 'mind-for-firefox-favorites';
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ITEMS = 1000;

const $ = id => document.getElementById(id);

function normalizeNumber(value) {
    const digits = String(value).replace(/[\s\-–—]/g, '');
    return /^\d{1,18}$/.test(digits) ? digits : null;
}

function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

function setInfo(id, text, kind) {
    const el = $(id);
    el.textContent = text;
    el.className = 'info' + (kind ? ' ' + kind : '');
}

async function loadFavorites() {
    const stored = await browser.storage.local.get(FAVORITES_KEY);
    const list = stored[FAVORITES_KEY];
    return Array.isArray(list)
        ? list.filter(f => f && typeof f.number === 'string' && normalizeNumber(f.number))
        : [];
}

async function refreshExportState() {
    const count = (await loadFavorites()).length;
    $('exportBtn').disabled = count === 0;
    setInfo('exportInfo', count === 0 ? 'Список избранного пуст — экспортировать нечего.' : 'В списке: ' + count + '.');
}

function parseImport(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        throw new Error('Файл не похож на экспорт избранного: это не корректный JSON.');
    }
    if (!data || typeof data !== 'object' || data.format !== FORMAT || !Array.isArray(data.favorites)) {
        throw new Error('Файл не похож на экспорт избранного из этого расширения.');
    }
    if (data.favorites.length > MAX_ITEMS) {
        throw new Error('В файле слишком много записей (больше ' + MAX_ITEMS + ').');
    }

    const items = [];
    let skipped = 0;
    for (const raw of data.favorites) {
        const number = raw && typeof raw === 'object' ? normalizeNumber(raw.number ?? '') : null;
        if (!number) { skipped++; continue; }
        const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 80) : '';
        items.push({ number, title, slots: MindCommon.sanitizeSlots(raw.slots) });
    }
    return { items, skipped };
}

$('exportBtn').addEventListener('click', async () => {
    const favorites = await loadFavorites();
    if (!favorites.length) return;

    const payload = {
        format: FORMAT,
        version: 1,
        exported: new Date().toISOString(),
        favorites: favorites.map(f => {
            const entry = { title: f.title, number: f.number };
            const slots = MindCommon.sanitizeSlots(f.slots).map(({ days, time }) => ({ days, time }));
            if (slots.length) entry.slots = slots;
            return entry;
        })
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'mind-favorites-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    setInfo('exportInfo', 'Файл сохранён: ' + favorites.length + ' ' + plural(favorites.length, 'запись', 'записи', 'записей') + '.', 'ok');
});

$('file').addEventListener('change', async e => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;

    try {
        if (file.size > MAX_FILE_BYTES) throw new Error('Файл слишком большой.');

        const { items, skipped } = parseImport(await file.text());
        const current = await loadFavorites();
        const byNumber = new Map(current.map(f => [f.number, f]));

        let added = 0, updated = 0;
        for (const item of items) {
            const existing = byNumber.get(item.number);
            if (existing) {
                let changed = false;
                if (item.title && item.title !== existing.title) {
                    existing.title = item.title;
                    changed = true;
                }
                // A schedule in the file replaces the current one; no schedule in the file leaves it alone.
                if (item.slots.length) {
                    const before = JSON.stringify(MindCommon.sanitizeSlots(existing.slots).map(({ days, time }) => ({ days, time })));
                    const after = JSON.stringify(item.slots.map(({ days, time }) => ({ days, time })));
                    if (before !== after) {
                        existing.slots = item.slots;
                        changed = true;
                    }
                }
                if (changed) updated++;
            } else {
                const fav = {
                    id: crypto.randomUUID(),
                    title: item.title || 'Конференция ' + item.number,
                    number: item.number,
                    slots: item.slots,
                    added: Date.now()
                };
                current.push(fav);
                byNumber.set(item.number, fav);
                added++;
            }
        }

        await browser.storage.local.set({ [FAVORITES_KEY]: current });

        const parts = [
            'Добавлено: ' + added,
            'обновлено: ' + updated
        ];
        if (skipped) parts.push('пропущено некорректных: ' + skipped);
        setInfo('importInfo', parts.join(', ') + '.', 'ok');
        await refreshExportState();
    } catch (err) {
        setInfo('importInfo', err.message, 'error');
    } finally {
        input.value = '';
    }
});

refreshExportState();
