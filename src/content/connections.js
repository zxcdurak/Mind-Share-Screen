// i.Mind's server allows only a few Server-Sent-Events connections per browser
// and answers with a plain "limit reached" page when they pile up. This script
//  - closes the page's EventSource connections when the background asks for it
//    (the page script inject.js does the closing, we only pass the request on);
//  - recognises the "limit reached" page and offers a reset button on it.
(function () {
    'use strict';

    const RETRY_AFTER_MS = 45000;
    const REPLY_TIMEOUT_MS = 1000;

    browser.runtime.onMessage.addListener(message => {
        if (!message || message.type !== 'closeStreams') return undefined;
        return new Promise(resolve => {
            const finish = count => {
                window.removeEventListener('message', onReply);
                clearTimeout(timer);
                resolve({ closed: count });
            };
            const onReply = event => {
                const data = event.data;
                if (event.source !== window || !data || data.source !== 'mind-ff-fix' || data.code !== 'streams-closed') return;
                const count = Number.isInteger(data.count) && data.count >= 0 && data.count <= 999 ? data.count : 0;
                MindDiag.log('content', 'по просьбе расширения закрыто потоков SSE: ' + count, 'page');
                finish(count);
            };
            const timer = setTimeout(() => finish(0), REPLY_TIMEOUT_MS);
            window.addEventListener('message', onReply);
            window.postMessage({ source: 'mind-ff-cmd', type: 'close-streams' }, '*');
        });
    });

    function isLimitPage() {
        const text = document.body ? document.body.textContent : '';
        return text.length < 3000 && /Server-Sent-Events/i.test(text);
    }

    function showBanner() {
        const host = document.createElement('div');
        host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
        const root = host.attachShadow({ mode: 'closed' });
        const style = document.createElement('style');
        style.textContent =
            '.box{box-sizing:border-box;width:340px;max-width:calc(100vw - 32px);padding:12px 14px;border-radius:8px;' +
            'background:#11212D;color:#CCD0CF;border:1px solid #4A5C6A;border-left:4px solid #CCD0CF;' +
            'font:13px/1.45 system-ui,"Segoe UI",sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35)}' +
            'h1{margin:0 0 6px;font-size:13px;font-weight:600}p{margin:0 0 10px}' +
            '.row{display:flex;gap:8px}button{padding:5px 10px;border:1px solid #4A5C6A;border-radius:6px;background:none;' +
            'color:inherit;font:inherit;cursor:pointer}button:hover:not(:disabled){background:#253745}button:disabled{opacity:.6;cursor:default}';
        const box = document.createElement('div');
        box.className = 'box';
        box.setAttribute('role', 'alert');

        const title = document.createElement('h1');
        title.textContent = 'Mind: слишком много соединений';
        const status = document.createElement('p');
        status.textContent = 'Сервер считает, что у браузера открыто слишком много соединений. Расширение может закрыть их в других вкладках i.Mind и открыть страницу заново.';

        const row = document.createElement('div');
        row.className = 'row';
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = 'Сбросить и повторить';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Закрыть';
        close.addEventListener('click', () => host.remove());
        row.append(reset, close);

        let waiting = null;
        reset.addEventListener('click', async () => {
            if (waiting) { location.reload(); return; }
            reset.disabled = true;
            let result = null;
            try { result = await browser.runtime.sendMessage({ type: 'resetConnections' }); } catch (e) { /* reported below */ }
            reset.disabled = false;
            if (result && result.closed > 0) {
                status.textContent = 'Закрыто соединений: ' + result.closed + '. Открываю страницу заново…';
                MindDiag.log('content', 'сброс соединений: закрыто ' + result.closed, 'page');
                setTimeout(() => location.reload(), 1500);
                return;
            }
            // Nothing to close here: the server still counts connections it has not noticed are gone.
            MindDiag.log('content', 'сброс соединений: закрывать нечего, ждём освобождения на сервере', 'page');
            reset.textContent = 'Повторить сейчас';
            let left = RETRY_AFTER_MS / 1000;
            const tick = () => {
                status.textContent = 'В других вкладках i.Mind соединений нет, так что сбрасывать нечего. Сервер освободит их сам, страница откроется заново через ' + left + ' с.';
                if (left-- <= 0) { location.reload(); return; }
                waiting = setTimeout(tick, 1000);
            };
            tick();
        });

        box.append(title, status, row);
        root.append(style, box);
        (document.body || document.documentElement).append(host);
    }

    document.addEventListener('DOMContentLoaded', () => {
        if (!isLimitPage()) return;
        MindDiag.log('content', 'сервер показал страницу «слишком много соединений»', 'problem');
        showBanner();
    });
})();
