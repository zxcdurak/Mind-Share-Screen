'use strict';

// Shared by the popup, the extension pages and the background script.
var MindCommon = (function () {
    const BASE_URL = 'https://e-class.tsu.ru/';
    const DAYS = [
        { n: 1, short: 'Пн', full: 'понедельник' },
        { n: 2, short: 'Вт', full: 'вторник' },
        { n: 3, short: 'Ср', full: 'среда' },
        { n: 4, short: 'Чт', full: 'четверг' },
        { n: 5, short: 'Пт', full: 'пятница' },
        { n: 6, short: 'Сб', full: 'суббота' },
        { n: 0, short: 'Вс', full: 'воскресенье' }
    ];
    const MAX_SLOTS = 20;
    const DEFAULT_LEAD = 5;
    const MAX_LEAD = 60;
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
    const ID_RE = /^[A-Za-z0-9-]{1,40}$/;

    function newId() {
        return crypto.randomUUID();
    }

    function cleanName(value) {
        return String(value).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function clampLead(value) {
        const n = Math.round(Number(value));
        if (!Number.isFinite(n)) return DEFAULT_LEAD;
        return Math.min(MAX_LEAD, Math.max(0, n));
    }

    // Keeps only complete, valid slots: { id, days: [0..6], time: "HH:MM" }.
    function sanitizeSlots(raw) {
        if (!Array.isArray(raw)) return [];
        const out = [];
        const seen = new Set();
        for (const s of raw) {
            if (out.length >= MAX_SLOTS) break;
            if (!s || typeof s !== 'object') continue;
            const days = Array.isArray(s.days)
                ? [...new Set(s.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
                : [];
            const time = typeof s.time === 'string' && TIME_RE.test(s.time) ? s.time : null;
            if (!days.length || !time) continue;
            const id = typeof s.id === 'string' && ID_RE.test(s.id) && !seen.has(s.id) ? s.id : newId();
            seen.add(id);
            out.push({ id, days, time });
        }
        return out;
    }

    // Start time (ms) of the next occurrence of the slot whose reminder
    // (start minus lead) is still in the future, or null.
    function nextStart(slot, leadMs, now) {
        const [h, m] = slot.time.split(':').map(Number);
        for (let offset = 0; offset <= 7; offset++) {
            const d = new Date(now);
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() + offset);
            d.setHours(h, m, 0, 0);
            if (!slot.days.includes(d.getDay())) continue;
            if (d.getTime() - leadMs > now) return d.getTime();
        }
        return null;
    }

    // Opens a conference by number, passing the saved guest name (if any) to
    // guestname.js through a short-lived "pendingJoin" record.
    async function openConference(number) {
        const stored = await browser.storage.local.get('guestName');
        const name = cleanName(stored.guestName || '');
        if (name) {
            await browser.storage.local.set({ pendingJoin: { name, at: Date.now() } });
        } else {
            await browser.storage.local.remove('pendingJoin');
        }
        await browser.tabs.create({ url: BASE_URL + '#login_by_id:' + number });
    }

    return { BASE_URL, DAYS, MAX_SLOTS, DEFAULT_LEAD, MAX_LEAD, newId, cleanName, clampLead, sanitizeSlots, nextStart, openConference };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = MindCommon;
