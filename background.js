'use strict';

// Reminders. Everything here is optional: browser.alarms and
// browser.notifications only exist after the user grants the optional
// permissions from the reminders page, so without them this script is idle.

const ALARM_PREFIX = 'r|';
const NOTIFICATION_PREFIX = 'conf|';
const LATE_LIMIT_MS = 10 * 60 * 1000;

let alarmListenerAdded = false;
let notificationListenerAdded = false;

async function loadState() {
    const stored = await browser.storage.local.get(['favorites', 'reminderLead']);
    const favorites = (Array.isArray(stored.favorites) ? stored.favorites : [])
        .filter(f => f && typeof f.id === 'string' && typeof f.number === 'string');
    const lead = stored.reminderLead == null ? MindCommon.DEFAULT_LEAD : MindCommon.clampLead(stored.reminderLead);
    return { favorites, lead };
}

function timeLabel(time, lead) {
    return lead > 0 ? 'Начало в ' + time + ' (через ' + lead + ' мин.)' : 'Начало в ' + time;
}

async function onAlarm(alarm) {
    if (!alarm.name.startsWith(ALARM_PREFIX)) return;
    const [, favId, slotId] = alarm.name.split('|');
    const late = Date.now() - alarm.scheduledTime;

    try {
        if (browser.notifications && late <= LATE_LIMIT_MS) {
            const { favorites, lead } = await loadState();
            const fav = favorites.find(f => f.id === favId);
            const slot = fav && MindCommon.sanitizeSlots(fav.slots).find(s => s.id === slotId);
            if (fav && slot) {
                await browser.notifications.create(NOTIFICATION_PREFIX + fav.number + '|' + alarm.scheduledTime, {
                    type: 'basic',
                    iconUrl: browser.runtime.getURL('icon96.png'),
                    title: fav.title || 'Конференция ' + fav.number,
                    message: timeLabel(slot.time, lead) + '. Нажмите, чтобы войти.'
                });
            }
        }
    } finally {
        await reschedule();
    }
}

async function onNotificationClicked(id) {
    if (!id.startsWith(NOTIFICATION_PREFIX)) return;
    const number = id.slice(NOTIFICATION_PREFIX.length).split('|')[0];
    await browser.notifications.clear(id);
    if (/^\d{1,18}$/.test(number)) await MindCommon.openConference(number);
}

function addListeners() {
    if (browser.alarms && !alarmListenerAdded) {
        alarmListenerAdded = true;
        browser.alarms.onAlarm.addListener(onAlarm);
    }
    if (browser.notifications && !notificationListenerAdded) {
        notificationListenerAdded = true;
        browser.notifications.onClicked.addListener(onNotificationClicked);
    }
}

async function reschedule() {
    if (!browser.alarms) return;
    addListeners();

    const { favorites, lead } = await loadState();
    const leadMs = lead * 60 * 1000;
    const now = Date.now();

    const wanted = new Map();
    for (const fav of favorites) {
        for (const slot of MindCommon.sanitizeSlots(fav.slots)) {
            const start = MindCommon.nextStart(slot, leadMs, now);
            if (start != null) wanted.set(ALARM_PREFIX + fav.id + '|' + slot.id, start - leadMs);
        }
    }

    const existing = await browser.alarms.getAll();
    for (const alarm of existing) {
        if (!alarm.name.startsWith(ALARM_PREFIX)) continue;
        if (wanted.get(alarm.name) === alarm.scheduledTime) wanted.delete(alarm.name);
        else await browser.alarms.clear(alarm.name);
    }
    for (const [name, when] of wanted) browser.alarms.create(name, { when });
}

browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.favorites || changes.reminderLead)) reschedule();
});
browser.permissions.onAdded.addListener(reschedule);
browser.runtime.onStartup.addListener(reschedule);
browser.runtime.onInstalled.addListener(reschedule);
browser.runtime.onMessage.addListener(message => {
    if (message && message.type === 'reschedule') return reschedule();
});

reschedule();
