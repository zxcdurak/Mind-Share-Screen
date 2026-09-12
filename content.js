// Loader that runs in the isolated content-script world. Its only job is to
// inject inject.js as a real <script> tag so that code runs in the page's
// own JS realm (no Xray wrappers). Trying to patch navigator through
// window.wrappedJSObject from here caused intermittent
// "Permission denied to access object" errors that broke the page load,
// because this app's own bootstrap script touches objects across a frame/
// principal boundary too.
(function () {
    'use strict';
    const script = document.createElement('script');
    script.src = browser.runtime.getURL('inject.js');
    script.onload = function () {
        script.remove();
    };
    (document.head || document.documentElement).prepend(script);
})();
