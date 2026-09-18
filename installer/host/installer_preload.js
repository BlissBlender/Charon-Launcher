const { contextBridge, ipcRenderer } = require('electron');

// Polyfill window.chrome.webview so installer/ui/dist/index.html connects seamlessly
window.chrome = window.chrome || {};
window.chrome.webview = {
  postMessage: (msg) => {
    ipcRenderer.send('webview-message', msg);
  },
  addEventListener: (type, callback) => {
    if (type === 'message') {
      ipcRenderer.on('webview-event', (event, data) => {
        callback({ data });
      });
    }
  },
  removeEventListener: (type, callback) => {}
};
