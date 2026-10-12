// Entry point of the Chromium (MV3) background: a service worker that Chromium
// stops when idle and starts again for events. Firefox does not use this file;
// it loads the same scripts as a persistent background page from its manifest.
importScripts('../shared/compat.js', '../shared/common.js', '../shared/diag.js', 'background.js');
