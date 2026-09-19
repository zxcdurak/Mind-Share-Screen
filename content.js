// Loader that runs in the isolated content-script world. Its only job is to
// inject the page scripts as real <script> tags so that they run in the
// page's own JS realm (no Xray wrappers). Trying to patch navigator through
// window.wrappedJSObject from here caused intermittent
// "Permission denied to access object" errors that broke the page load,
// because this app's own bootstrap script touches objects across a frame/
// principal boundary too.
(function () {
    'use strict';
    for (const file of ['inject.js', 'chatfix.js']) {
        const script = document.createElement('script');
        script.src = browser.runtime.getURL(file);
        script.onload = function () {
            script.remove();
        };
        (document.head || document.documentElement).prepend(script);
    }
})();
