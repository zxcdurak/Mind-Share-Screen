// Shows a small dismissible banner when one of the page scripts (inject.js,
// chatfix.js) reports that something the extension depends on in i.Mind is not
// behaving as expected. The page only sends a problem code; the texts live
// here, so page content never ends up in the banner.
(function () {
    'use strict';

    const MESSAGES = {
        'no-display-media': 'Браузер не поддерживает демонстрацию экрана (getDisplayMedia). Обновите Firefox.',
        'share-failed': 'Не удалось начать демонстрацию экрана: браузер отклонил запрос не из-за отмены выбора.',
        'share-protocol': 'Экран выбран, но сайт не запросил видеопоток. Скорее всего, i.Mind обновился и расширение нужно подправить.',
        'chat-stuck': 'Поле ввода чата не запустилось. Обновите страницу (F5); если повторяется, возможно, i.Mind обновился.'
    };

    // Events reported by the page scripts: fixed vocabulary -> [kind, text].
    const EVENTS = {
        'ua-spoofed': ['page', 'подмена User-Agent выполнена'],
        'ua-failed': ['problem', 'не удалось подменить User-Agent'],
        'env-display-media-yes': ['share', 'браузер поддерживает getDisplayMedia'],
        'env-display-media-no': ['problem', 'браузер не поддерживает getDisplayMedia'],
        'share-requested': ['share', 'сайт запросил демонстрацию экрана'],
        'share-picked': ['share', 'экран выбран'],
        'share-cancelled': ['share', 'выбор экрана отменён'],
        'share-delivered': ['share', 'видеопоток экрана передан сайту'],
        'share-refused-call': ['share', 'сайт запросил что-то кроме экрана через legacyGetUserMedia, отказано'],
        'chat-load-event': ['chat', 'поле ввода чата не запустилось, отправлено событие load'],
        'chat-reload': ['chat', 'поле ввода чата всё ещё не запустилось, iframe перезагружен'],
        'chat-recovered': ['chat', 'поле ввода чата запустилось']
    };

    MindDiag.log('content', 'страница e-class загружена, расширение активно', 'page');

    const codes = [];
    let host = null;
    let list = null;

    function diagnostics() {
        return [
            'Mind for Firefox ' + browser.runtime.getManifest().version,
            navigator.userAgent,
            location.origin,
            'problems: ' + codes.join(', ')
        ].join('\n');
    }

    function build() {
        host = document.createElement('div');
        host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
        const root = host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent =
            '.box{box-sizing:border-box;width:340px;max-width:calc(100vw - 32px);padding:12px 14px;border-radius:8px;' +
            'background:#11212D;color:#CCD0CF;border:1px solid #4A5C6A;border-left:4px solid #CCD0CF;' +
            'font:13px/1.45 system-ui,"Segoe UI",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35)}' +
            'h1{margin:0 0 6px;font-size:13px;font-weight:600}ul{margin:0 0 10px;padding-left:18px}li{margin:3px 0}' +
            '.hint{margin:0 0 10px;color:#9BA8AB;font-size:12px}' +
            '.row{display:flex;gap:8px}button{padding:5px 10px;border:1px solid #4A5C6A;border-radius:6px;background:none;' +
            'color:inherit;font:inherit;cursor:pointer}button:hover{background:#253745}';
        const box = document.createElement('div');
        box.className = 'box';
        box.setAttribute('role', 'alert');

        const title = document.createElement('h1');
        title.textContent = 'Mind for Firefox: что-то пошло не так';
        list = document.createElement('ul');
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'Скопируйте диагностику и приложите к описанию проблемы на странице расширения.';

        const row = document.createElement('div');
        row.className = 'row';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Скопировать диагностику';
        copy.addEventListener('click', () => {
            navigator.clipboard.writeText(diagnostics()).then(
                () => { copy.textContent = 'Скопировано'; },
                () => { copy.textContent = 'Не удалось скопировать'; });
        });
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Закрыть';
        close.addEventListener('click', () => host.remove());
        row.append(copy, close);

        box.append(title, list, hint, row);
        root.append(style, box);
    }

    window.addEventListener('message', event => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'mind-ff-fix') return;
        const code = data.code;
        if (data.type === 'event') {
            if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(EVENTS, code)) {
                MindDiag.log('page', EVENTS[code][1], EVENTS[code][0]);
            }
            return;
        }
        if (data.type !== 'problem') return;
        if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(MESSAGES, code)) return;
        if (codes.includes(code)) return;
        codes.push(code);
        MindDiag.log('page', 'проблема «' + code + '»: ' + MESSAGES[code], 'problem');

        if (!host) build();
        const li = document.createElement('li');
        li.textContent = MESSAGES[code];
        list.append(li);
        if (!host.isConnected) (document.body || document.documentElement).append(host);
    });
})();
