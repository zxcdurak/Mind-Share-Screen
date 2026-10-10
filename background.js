'use strict';

// Reminders. Everything here is opt-in: browser.notifications only exists
// after the user grants the optional "notifications" permission from the
// reminders page, and without it this script creates no alarms and is idle.

const ALARM_PREFIX = 'r|';
const NOTIFICATION_PREFIX = 'conf|';
const CHAT_NOTIFICATION_ID = 'mind-chat';
const LATE_LIMIT_MS = 10 * 60 * 1000;

let alarmListenerAdded = false;
let notificationListenerAdded = false;
let chatTarget = null; // tab that the chat notification belongs to

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

// Chat notifications (opt-in, see chatnotify.js). One fixed notification id, so
// repeated updates replace the previous notification instead of stacking.
async function onChatMessage(message, sender) {
    if (!browser.notifications || !sender || !sender.tab) return;
    const { chatNotify } = await browser.storage.local.get('chatNotify');
    if (chatNotify !== true) return;

    const count = Math.min(9999, Math.max(1, Math.floor(Number(message.count)) || 1));
    const text = String(message.text || '').slice(0, 140);
    addListeners();
    chatTarget = { tabId: sender.tab.id, windowId: sender.tab.windowId };
    await browser.notifications.create(CHAT_NOTIFICATION_ID, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icon96.png'),
        title: count === 1 ? 'i.Mind: новое сообщение' : 'i.Mind: новых сообщений: ' + count,
        message: text || 'Откройте вкладку с конференцией.'
    });
}

async function onChatClicked() {
    await browser.notifications.clear(CHAT_NOTIFICATION_ID);
    if (!chatTarget) return;
    try {
        await browser.tabs.update(chatTarget.tabId, { active: true });
        await browser.windows.update(chatTarget.windowId, { focused: true });
    } catch (e) { /* the tab was closed */ }
}

async function onNotificationClicked(id) {
    if (id === CHAT_NOTIFICATION_ID) return onChatClicked();
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

async function clearOurAlarms() {
    for (const alarm of await browser.alarms.getAll()) {
        if (alarm.name.startsWith(ALARM_PREFIX)) await browser.alarms.clear(alarm.name);
    }
}

async function reschedule() {
    if (!browser.alarms) return;

    // "alarms" is a normal permission, so the user's opt-in is the optional
    // "notifications" permission: without it we never create an alarm.
    if (!browser.notifications) {
        await clearOurAlarms();
        return;
    }
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
browser.permissions.onRemoved.addListener(reschedule);
browser.runtime.onStartup.addListener(reschedule);
browser.runtime.onInstalled.addListener(reschedule);
browser.runtime.onMessage.addListener((message, sender) => {
    if (message && message.type === 'reschedule') return reschedule();
    if (message && message.type === 'chat') return onChatMessage(message, sender);
    if (message && message.type === 'chatClear' && browser.notifications) return browser.notifications.clear(CHAT_NOTIFICATION_ID);
});

reschedule();
