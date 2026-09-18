const { app, BrowserWindow, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const TARGET_URL = 'https://bzzhr.to/k32b35vnnr1c';
const REFERER = 'https://steamrip.com/dishwashing-simulator-free-download/';

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

function startAria2Download(rawUrl, filename) {
  console.log(`\n🚀 Starting Native C++ Download Engine (Aria2)...`);
  console.log(`📁 Saving to: ${path.join(DOWNLOAD_DIR, filename)}`);
  console.log(`🔗 Dynamically splitting into 16 parallel connections\n`);

  // Spawn the compiled C++ aria2c.exe engine
  const aria2 = spawn(path.join(__dirname, 'aria2c.exe'), [
    '--dir', DOWNLOAD_DIR,
    '--out', filename,
    '--split=16',                    // 16 parallel chunks
    '--max-connection-per-server=16',
    '--min-split-size=1M',           // Chunk size
    '--continue=true',               // Enable FDM-style resuming (.aria2 state files)
    '--summary-interval=1',          // Output progress every 1 second
    '--console-log-level=warn',      // Hide spam, only show progress
    rawUrl
  ]);

  aria2.stdout.on('data', (data) => {
    const output = data.toString().trim();
    
    // Aria2 outputs progress lines like: [#2b82f0 1.2MiB/100MiB(1%) CN:16 SD:16 DL:3.5MiB ETA:28s]
    if (output.startsWith('[#')) {
      // Print nicely on the same line
      process.stdout.write(`\r📥 ${output}      `);
    } else if (output.includes('Download complete')) {
      console.log(`\n\n✅ ${output}`);
    }
  });

  aria2.stderr.on('data', (data) => {
    console.error(`[Aria2 Error] ${data.toString()}`);
  });

  aria2.on('close', (code) => {
    console.log(`\n🏁 Download Engine Exited (Code: ${code})`);
    app.quit();
  });
}

app.whenReady().then(async () => {
  console.log('[Bypass] Opening hidden browser to bypass Cloudflare Turnstile...');

  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    show: true, // We'll leave it visible for now so you can see it work!
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // THE INTERCEPTOR: Catch the file download!
  session.defaultSession.on('will-download', (event, item) => {
    event.preventDefault(); // Stop Electron from downloading it!
    
    const finalUrl = item.getURL();
    const filename = item.getFilename();
    
    console.log('\n======================================================');
    console.log('🎉 SUCCESS! Captured Raw Download Link 🎉');
    console.log('======================================================\n');
    
    win.close(); // Close the browser window, we don't need it anymore!
    
    // Hand off the URL to the Native C++ Engine!
    startAria2Download(finalUrl, filename);
  });

  await win.loadURL(TARGET_URL, {
    httpReferrer: REFERER,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });

  // Inject Auto-Clicker
  await win.webContents.executeJavaScript(`
    new Promise((resolve) => {
      const interval = setInterval(() => {
        if (document.title.includes('Just a moment') || document.title.includes('security')) return;
        const btn = document.querySelector('a[hx-get*="/download"]');
        if (btn) {
          btn.click();
          clearInterval(interval);
          resolve();
        }
      }, 1000);
    });
  `);
});

app.on('window-all-closed', () => {
  // Don't quit if the native engine is still downloading!
});
