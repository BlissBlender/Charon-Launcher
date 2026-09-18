const mockBridge = {
  getSystemInfo: () => ({
    drives: [
      { letter: 'C:', total: 500 * 1024 * 1024 * 1024, free: 120 * 1024 * 1024 * 1024 },
      { letter: 'D:', total: 1000 * 1024 * 1024 * 1024, free: 850 * 1024 * 1024 * 1024 }
    ],
    defaultPath: 'C:\\Program Files\\Charon Launcher'
  }),
  browseFolder: () => 'D:\\Games\\Charon Launcher',
  startInstall: () => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 5;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        window.dispatchEvent(new CustomEvent('bridge-event', {
          detail: { event: 'complete' }
        }));
      } else {
        window.dispatchEvent(new CustomEvent('bridge-event', {
          detail: {
            event: 'progress',
            percent: progress,
            file: `Extracting file_${Math.floor(progress)}.pak...`,
            speed: `${Math.floor(Math.random() * 50 + 50)} MB/s`,
            filesDone: Math.floor((progress / 100) * 500),
            filesTotal: 500,
            eta: `${Math.floor((100 - progress) / 2)}s remaining`
          }
        }));
      }
    }, 200);
  }
};

export const sendCommand = (cmd, params = {}) => {
  if (window.chrome?.webview) {
    window.chrome.webview.postMessage(JSON.stringify({ cmd, ...params }));
  } else {
    console.log('[Mock Bridge] Command sent:', cmd, params);
    if (mockBridge[cmd]) {
      const res = mockBridge[cmd](params);
      if (res !== undefined) {
        // Simulate immediate response event for some commands
        if (cmd === 'getSystemInfo') {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('bridge-event', { detail: { event: 'systemInfo', ...res } }));
          }, 50);
        } else if (cmd === 'browseFolder') {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('bridge-event', { detail: { event: 'folderSelected', path: res } }));
          }, 50);
        }
      }
    }
  }
};

const listeners = new Map();

if (window.chrome?.webview) {
  window.chrome.webview.addEventListener('message', (e) => {
    try {
      const msg = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      const cbs = listeners.get(msg.event) || [];
      cbs.forEach(cb => cb(msg));
    } catch (err) {
      console.error('Failed to parse bridge message:', err);
    }
  });
} else {
  window.addEventListener('bridge-event', (e) => {
    const msg = e.detail;
    const cbs = listeners.get(msg.event) || [];
    cbs.forEach(cb => cb(msg));
  });
}

export const onEvent = (eventName, callback) => {
  if (!listeners.has(eventName)) {
    listeners.set(eventName, []);
  }
  listeners.get(eventName).push(callback);
};

export const offEvent = (eventName, callback) => {
  const cbs = listeners.get(eventName);
  if (cbs) {
    listeners.set(eventName, cbs.filter(cb => cb !== callback));
  }
};
