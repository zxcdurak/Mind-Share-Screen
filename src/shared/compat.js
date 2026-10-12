// Gives Chromium the Firefox-style `browser` API that the rest of the code uses:
// promise-returning calls and promise-returning onMessage listeners.
// In Firefox `browser` already exists and this file does nothing.
//
// Only the calls the extension actually makes are wrapped. Properties that can
// appear later (notifications, after the optional permission is granted) are
// looked up on every access, so `if (browser.notifications)` keeps working.
(function (root) {
    'use strict';

    if (typeof root.browser !== 'undefined' && root.browser && root.browser.runtime) return;
    const api = root.chrome;
    if (!api || !api.runtime) return;

    // Callback-style call -> promise. The callback form works for every MV3 method.
    function promisify(target, name) {
        return function (...args) {
            return new Promise((resolve, reject) => {
                target[name](...args, result => {
                    const err = api.runtime.lastError;
                    if (err) reject(new Error(err.message));
                    else resolve(result);
                });
            });
        };
    }

    // A view of `target` where the listed methods return promises. Everything else
    // is passed through (functions bound to the original object), and `overrides`
    // replaces individual properties.
    function wrap(target, names, overrides) {
        if (!target) return undefined;
        return new Proxy(target, {
            get(t, key) {
                if (overrides && key in overrides) return overrides[key];
                if (names.includes(key)) return promisify(t, key);
                const value = t[key];
                return typeof value === 'function' ? value.bind(t) : value;
            }
        });
    }

    // Chromium ignores a promise returned from an onMessage listener: the answer
    // has to go through sendResponse, and the listener has to return true.
    const messageListeners = new Map();
    const onMessage = {
        addListener(fn) {
            const wrapped = (message, sender, sendResponse) => {
                const result = fn(message, sender);
                if (result && typeof result.then === 'function') {
                    result.then(sendResponse, () => sendResponse(undefined));
                    return true;
                }
                return false;
            };
            messageListeners.set(fn, wrapped);
            api.runtime.onMessage.addListener(wrapped);
        },
        removeListener(fn) {
            const wrapped = messageListeners.get(fn);
            if (wrapped) api.runtime.onMessage.removeListener(wrapped);
            messageListeners.delete(fn);
        },
        hasListener(fn) {
            return messageListeners.has(fn);
        }
    };

    const browser = {
        get storage() {
            return { local: wrap(api.storage.local, ['get', 'set', 'remove']), onChanged: api.storage.onChanged };
        },
        get runtime() {
            return wrap(api.runtime, ['sendMessage', 'getPlatformInfo'], { onMessage });
        },
        get tabs() { return wrap(api.tabs, ['create', 'update']); },
        get windows() { return wrap(api.windows, ['update']); },
        get permissions() { return wrap(api.permissions, ['contains', 'request', 'remove']); },
        get alarms() { return wrap(api.alarms, ['getAll', 'clear', 'clearAll']); },
        get notifications() { return api.notifications ? wrap(api.notifications, ['create', 'clear']) : undefined; }
    };

    root.browser = browser;
})(typeof globalThis !== 'undefined' ? globalThis : self);
