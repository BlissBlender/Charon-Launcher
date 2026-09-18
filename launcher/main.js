const { app, BrowserWindow, ipcMain, session, shell, net, Tray, Menu, dialog, nativeImage, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const cheerio = require('cheerio');
const zlib = require('zlib');
const crypto = require('crypto');

let pendingUpdate = null;

function verifyFileSha256(filePath, expectedSha256) {
  return new Promise((resolve) => {
    if (!fs.existsSync(filePath)) return resolve(false);
    if (!expectedSha256) return resolve(true);
    try {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => {
        const digest = hash.digest('hex').toLowerCase();
        resolve(digest === expectedSha256.trim().toLowerCase());
      });
      stream.on('error', () => resolve(false));
    } catch (err) {
      resolve(false);
    }
  });
}

function showNativeNotification(title, body) {
  try {
    if (Notification && Notification.isSupported()) {
      const iconPath = path.join(__dirname, 'build', 'icon.png');
      const notif = new Notification({
        title: title || 'Charon Launcher',
        body: body || '',
        icon: fs.existsSync(iconPath) ? iconPath : undefined
      });
      notif.show();
    }
  } catch (e) {
    console.warn('[Notification] Desktop notification error:', e.message);
  }
}

// Prevent Windows Chromium GPU cache collisions and disk cache lock errors
if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-gpu-program-cache');
}

// Ensure single-instance lock so duplicate processes do not collide on Chromium cache
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Backend] Another instance of Charon Game Launcher is already running. Exiting.');
  process.exit(0);
}

let mainWindow;
let appTray = null;
let isQuitting = false;

// ==========================================================
// PERSISTENT SETTINGS MANAGEMENT (HYDRA-PARITY)
// ==========================================================
const SETTINGS_FILE = path.join(app.getPath('userData'), 'charon_settings.json');
const PLAYTIME_FILE = path.join(app.getPath('userData'), 'charon_playtime.json');
const CUSTOM_SOURCES_FILE = path.join(app.getPath('userData'), 'charon_custom_sources.json');

function getDefaultSettings() {
  const defaultDir = (typeof getSafeDefaultDownloadDir === 'function') 
    ? getSafeDefaultDownloadDir() 
    : path.join(os.homedir(), 'Downloads', 'Charon Games');
  return {
    downloadsPath: defaultDir,
    maxDownloadSpeed: null,
    runAtStartup: false,
    startMinimized: false,
    minimizeToTray: true,
    launchToLibrary: false,
    extractByDefault: true,
    deleteArchiveAfterExtract: false,
    showSpeedInMB: true,
    customSources: [],
    steamGridDbApiKey: ''
  };
}

let cachedSettings = null;
function getAppSettings() {
  if (cachedSettings) return cachedSettings;
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      cachedSettings = { ...getDefaultSettings(), ...data };
      return cachedSettings;
    }
  } catch (e) {
    console.error('[Backend] Error reading settings:', e);
  }
  cachedSettings = getDefaultSettings();
  return cachedSettings;
}

function saveAppSettings(newSettings) {
  try {
    cachedSettings = { ...getAppSettings(), ...newSettings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(cachedSettings, null, 2), 'utf8');
    return cachedSettings;
  } catch (e) {
    console.error('[Backend] Error saving settings:', e);
    return getAppSettings();
  }
}

// ==========================================================
// PER-GAME LAUNCH CONFIGURATION (EXECUTABLE & ARGS)
// ==========================================================
const GAME_CONFIGS_FILE = path.join(app.getPath('userData'), 'charon_game_configs.json');

let cachedGameConfigs = null;
function getGameConfigs() {
  if (cachedGameConfigs) return cachedGameConfigs;
  try {
    if (fs.existsSync(GAME_CONFIGS_FILE)) {
      cachedGameConfigs = JSON.parse(fs.readFileSync(GAME_CONFIGS_FILE, 'utf8'));
      return cachedGameConfigs;
    }
  } catch (e) {
    console.error('[Backend] Error reading game configs:', e);
  }
  cachedGameConfigs = {};
  return cachedGameConfigs;
}

function saveGameConfig(gameId, config) {
  try {
    const all = getGameConfigs();
    if (config && (config.customExePath || config.launchArgs)) {
      all[gameId] = { ...all[gameId], ...config };
    } else {
      delete all[gameId];
    }
    cachedGameConfigs = all;
    fs.writeFileSync(GAME_CONFIGS_FILE, JSON.stringify(all, null, 2), 'utf8');
    return all[gameId] || null;
  } catch (e) {
    console.error('[Backend] Error saving game config:', e);
    return null;
  }
}

function getGameConfig(gameId) {
  const all = getGameConfigs();
  return all[gameId] || null;
}

// ==========================================================
// PLAYTIME TRACKING SYSTEM (HYDRA-PARITY)
// ==========================================================
let cachedPlaytime = null;
function getPlaytimeDatabase() {
  if (cachedPlaytime) return cachedPlaytime;
  try {
    if (fs.existsSync(PLAYTIME_FILE)) {
      cachedPlaytime = JSON.parse(fs.readFileSync(PLAYTIME_FILE, 'utf8'));
      return cachedPlaytime;
    }
  } catch (e) {
    console.error('[Backend] Error reading playtime:', e);
  }
  cachedPlaytime = {};
  return cachedPlaytime;
}

function savePlaytimeDatabase(data) {
  try {
    cachedPlaytime = data;
    fs.writeFileSync(PLAYTIME_FILE, JSON.stringify(cachedPlaytime, null, 2), 'utf8');
  } catch (e) {
    console.error('[Backend] Error saving playtime:', e);
  }
}

const activeGameSessions = new Map();

function trackGameSession(gameId, title, exePath, steamAppId) {
  const gameKey = String(gameId || title || path.basename(exePath, '.exe')).trim();
  if (activeGameSessions.has(gameKey)) return;

  const startTime = Date.now();
  const exeName = path.basename(exePath).toLowerCase();
  console.log(`[Playtime] Started tracking session: "${title}" (Key: ${gameKey}, Exe: ${exeName})`);

  const db = getPlaytimeDatabase();
  if (!db[gameKey]) {
    db[gameKey] = { totalSeconds: 0, lastPlayed: Date.now(), sessionsCount: 0, title: title || gameKey };
  }
  db[gameKey].lastPlayed = Date.now();
  db[gameKey].sessionsCount = (db[gameKey].sessionsCount || 0) + 1;
  savePlaytimeDatabase(db);

  // Initialize Steam Achievements monitoring
  const resolvedAppIdPromise = resolveGameSteamAppId(title, exePath, steamAppId);
  resolvedAppIdPromise.then(resolvedId => {
    if (resolvedId) {
      console.log(`[Achievements] Monitoring achievements for "${title}" (AppID: ${resolvedId})`);
      pollGameAchievements(gameKey, resolvedId, exePath, title, true);
    }
  }).catch(() => {});

  const monitorInterval = setInterval(() => {
    const elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('playtime-update', {
        gameKey,
        isRunning: true,
        sessionSeconds: elapsedSeconds,
        totalSeconds: (db[gameKey]?.totalSeconds || 0) + elapsedSeconds
      });
    }

    // Poll for any achievements unlocked while playing
    resolvedAppIdPromise.then(resolvedId => {
      if (resolvedId) {
        pollGameAchievements(gameKey, resolvedId, exePath, title, false);
      }
    }).catch(() => {});

    checkProcessRunning(exeName, (isRunning) => {
      if (!isRunning) {
        clearInterval(monitorInterval);
        activeGameSessions.delete(gameKey);
        const finalSessionSecs = Math.max(1, Math.floor((Date.now() - startTime) / 1000));
        db[gameKey].totalSeconds = (db[gameKey].totalSeconds || 0) + finalSessionSecs;
        db[gameKey].lastPlayed = Date.now();
        savePlaytimeDatabase(db);
        console.log(`[Playtime] Game exited: "${title}". Added ${finalSessionSecs}s. Total: ${db[gameKey].totalSeconds}s.`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('playtime-update', {
            gameKey,
            isRunning: false,
            sessionSeconds: 0,
            totalSeconds: db[gameKey].totalSeconds
          });
        }
        // Auto Cloud Save Sync upon session completion (Hydra-Parity)
        runAutomaticCloudSaveSync(title, steamAppId, exePath, 'session-end').catch(err => {
          console.warn('[Cloud Save] Auto-sync error on session end:', err.message);
        });

        // Deliver deferred auto-update prompt if gameplay is now finished
        if (activeGameSessions.size === 0 && pendingUpdate && mainWindow && !mainWindow.isDestroyed()) {
          console.log('[Updater] Game session exited. Delivering deferred update:', pendingUpdate.status);
          mainWindow.webContents.send('updater-event', pendingUpdate);
          pendingUpdate = null;
        }
      }
    });
  }, 5000);

  activeGameSessions.set(gameKey, { startTime, monitorInterval, title, exeName });
}

function checkProcessRunning(exeName, callback) {
  if (process.platform !== 'win32') {
    return callback(true);
  }
  try {
    const cmd = `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`;
    const cp = spawn('cmd.exe', ['/c', cmd], { windowsHide: true });
    let out = '';
    cp.stdout.on('data', (d) => { out += d.toString(); });
    cp.on('close', () => {
      callback(out.toLowerCase().includes(exeName.toLowerCase()));
    });
    cp.on('error', () => callback(true));
  } catch (err) {
    callback(true);
  }
}

// ==========================================================
// SYSTEM TRAY MANAGEMENT (HYDRA-PARITY)
// ==========================================================
function setupSystemTray(win) {
  if (appTray) return;
  try {
    const devIcon = path.join(__dirname, 'build', 'icon.ico');
    const distIcon = path.join(__dirname, 'dist', 'logo.png');
    const pubIcon = path.join(__dirname, 'public', 'logo.png');
    const iconPath = fs.existsSync(devIcon) ? devIcon : (fs.existsSync(distIcon) ? distIcon : (fs.existsSync(pubIcon) ? pubIcon : null));
    if (!iconPath) return;

    appTray = new Tray(iconPath);
    appTray.setToolTip('Charon Game Launcher');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Charon Launcher',
        click: () => {
          if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
          }
        }
      },
      {
        label: 'Store',
        click: () => {
          if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
            win.webContents.send('switch-tab', 'store');
          }
        }
      },
      {
        label: 'Library',
        click: () => {
          if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
            win.webContents.send('switch-tab', 'library');
          }
        }
      },
      {
        label: 'Downloads',
        click: () => {
          if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
            win.webContents.send('switch-tab', 'downloads');
          }
        }
      },
      {
        label: 'Settings',
        click: () => {
          if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
            win.webContents.send('switch-tab', 'settings');
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit Charon',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);

    appTray.setContextMenu(contextMenu);
    appTray.on('double-click', () => {
      if (win && !win.isDestroyed()) {
        if (win.isVisible()) {
          win.hide();
        } else {
          win.show();
          win.focus();
        }
      }
    });
  } catch (err) {
    console.error('[Backend] Failed to setup tray:', err);
  }
}

function setupAutoUpdater(win) {
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update...');
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-event', { status: 'checking' });
    }
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info.version);
    if (activeGameSessions && activeGameSessions.size > 0) {
      console.log('[Updater] Active game session in progress. Silently queuing update notification.');
      pendingUpdate = {
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate: info.releaseDate || ''
      };
      return;
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-event', {
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate: info.releaseDate || ''
      });
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[Updater] App is up to date.');
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-event', {
        status: 'up-to-date',
        version: info?.version || app.getVersion()
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const bytesPerSec = progress.bytesPerSecond || 0;
    let speed = '';
    if (bytesPerSec >= 1024 * 1024) {
      speed = (bytesPerSec / (1024 * 1024)).toFixed(1) + ' MB/s';
    } else if (bytesPerSec >= 1024) {
      speed = (bytesPerSec / 1024).toFixed(0) + ' KB/s';
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-event', {
        status: 'downloading',
        percent: Math.round(progress.percent || 0),
        speed,
        transferred: progress.transferred || 0,
        total: progress.total || 0
      });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded successfully:', info.version);
    if (activeGameSessions && activeGameSessions.size > 0) {
      console.log('[Updater] Active game session in progress. Silently queuing ready-to-install notification.');
      pendingUpdate = {
        status: 'downloaded',
        version: info.version,
        releaseNotes: info.releaseNotes || ''
      };
      return;
    }
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-event', {
        status: 'downloaded',
        version: info.version,
        releaseNotes: info.releaseNotes || ''
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[Updater] Error:', err == null ? 'unknown' : (err.stack || err).toString());
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater-event', {
        status: 'error',
        message: err?.message || 'Update check failed'
      });
    }
  });
}

function createWindow() {
  const devIcon = path.join(__dirname, 'build', 'icon.ico');
  const distIcon = path.join(__dirname, 'dist', 'logo.png');
  const winIcon = fs.existsSync(devIcon) ? devIcon : (fs.existsSync(distIcon) ? distIcon : undefined);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b0d12',
    icon: winIcon,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0e1117',
      symbolColor: '#c9d1d9',
      height: 38
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  setupSystemTray(mainWindow);

  mainWindow.on('close', (event) => {
    const settings = getAppSettings();
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  const settingsOnBoot = getAppSettings();
  if (!settingsOnBoot.startMinimized) {
    mainWindow.once('ready-to-show', () => {
      mainWindow.show();
    });

    // Safety fallback to ensure window is shown even if network/dev latency delays ready-to-show
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    }, 2500);
  }

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] [L${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.warn(`[Renderer Fail Load] ${errorCode} - ${errorDescription} on ${validatedURL}`);
  });

  const distHtml = path.join(__dirname, 'dist', 'index.html');
  if (app.isPackaged) {
    mainWindow.loadFile(distHtml);
  } else {
    // Fast check if Vite dev server is running before attempting to navigate
    const http = require('http');
    const devUrl = 'http://localhost:5173';
    let loaded = false;
    const req = http.get(devUrl, (res) => {
      if (!loaded) {
        loaded = true;
        console.log('[Backend] Vite dev server detected at localhost:5173, loading URL...');
        mainWindow.loadURL(devUrl).catch(() => {
          mainWindow.loadFile(distHtml);
        });
      }
    });
    req.on('error', () => {
      if (!loaded) {
        loaded = true;
        console.log('[Backend] Vite dev server not running. Loading built app from dist/index.html...');
        mainWindow.loadFile(distHtml);
      }
    });
    req.setTimeout(350, () => {
      req.destroy();
      if (!loaded) {
        loaded = true;
        console.log('[Backend] Dev server ping timed out. Loading built app from dist/index.html...');
        mainWindow.loadFile(distHtml);
      }
    });
  }

  setupAutoUpdater(mainWindow);
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      const url = details.url.toLowerCase();
      if (url.includes('steamrip.com')) {
        details.requestHeaders['Referer'] = 'https://steamrip.com/';
        details.requestHeaders['Origin'] = 'https://steamrip.com';
        details.requestHeaders['Sec-Fetch-Site'] = 'same-origin';
      } else if (url.includes('steamunlocked.org')) {
        details.requestHeaders['Referer'] = 'https://steamunlocked.org/';
        details.requestHeaders['Origin'] = 'https://steamunlocked.org';
        details.requestHeaders['Sec-Fetch-Site'] = 'same-origin';
      } else if (url.includes('buzzheavier.com') || url.includes('bzzhr.to')) {
        if (!details.requestHeaders['Referer']) {
          details.requestHeaders['Referer'] = 'https://steamrip.com/';
        }
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  createWindow();

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.log('[Updater] Initial background check skipped/failed:', err.message);
      });
    }, 4000);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// IPC handlers for In-App Auto Updates
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) {
    console.log('[Updater] Running in unpackaged/dev mode. Simulating check.');
    return { status: 'dev', version: app.getVersion() };
  }
  try {
    const res = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: res?.updateInfo };
  } catch (err) {
    console.error('[Updater] Check failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('start-download-update', async () => {
  if (!app.isPackaged) {
    return { status: 'dev', message: 'Updates cannot be downloaded in development mode.' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    console.error('[Updater] Download failed:', err.message);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('verify-patch-integrity', async (event, opts) => {
  const { filePath, expectedSha256 } = opts || {};
  if (!filePath) return { valid: false, error: 'No file path provided' };
  try {
    const isValid = await verifyFileSha256(filePath, expectedSha256);
    return { valid: isValid };
  } catch (err) {
    return { valid: false, error: err.message };
  }
});

ipcMain.handle('restart-and-apply-update', async (event, opts) => {
  const { customPatchPath, version } = opts || {};
  const appDir = path.dirname(app.getPath('exe'));

  // Look for native C++ patcher / installer binary
  const candidates = [
    path.join(appDir, 'CharonSetup.exe'),
    path.join(process.resourcesPath, 'CharonSetup.exe'),
    path.join(appDir, 'resources', 'CharonSetup.exe'),
    path.join(__dirname, '..', 'installer', 'out', 'CharonSetup.exe'),
    path.join(__dirname, '..', 'installer', 'build', 'cmake', 'Release', 'CharonSetup.exe')
  ];

  let nativePatcher = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      nativePatcher = c;
      break;
    }
  }

  // If a custom patch file was provided and native patcher exists, use atomic C++ updater
  if (nativePatcher && customPatchPath && fs.existsSync(customPatchPath)) {
    console.log('[Updater] Spawning native C++ patcher:', nativePatcher);
    const args = ['--update', customPatchPath, '--target', appDir, '--pid', String(process.pid)];
    if (version) args.push('--version', version);
    if (customPatchPath.endsWith('.asar')) args.push('--micro');

    const child = spawn(nativePatcher, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();
    app.exit(0);
    return { success: true, mode: 'native' };
  }

  // Fallback to electron-updater's quitAndInstall
  console.log('[Updater] Using standard electron-updater quitAndInstall');
  autoUpdater.quitAndInstall(false, true);
  return { success: true, mode: 'electron-updater' };
});

ipcMain.on('renderer-ready', () => {
  console.log('[Updater Watchdog] Renderer signal received.');
  try {
    const appDir = path.dirname(app.getPath('exe'));
    const beaconPath = path.join(appDir, 'charon_update_pending.beacon');
    if (fs.existsSync(beaconPath)) {
      fs.unlinkSync(beaconPath);
      console.log('[Updater Watchdog] Removed update beacon. Update committed successfully.');
      const oldAsar = path.join(process.resourcesPath, 'app.asar.old');
      if (fs.existsSync(oldAsar)) {
        fs.unlinkSync(oldAsar);
        console.log('[Updater Watchdog] Cleaned up app.asar.old snapshot.');
      }
    }
  } catch (err) {
    console.warn('[Updater Watchdog] Cleanup notice:', err.message);
  }
});

// ==========================================================
// SETTINGS IPC ENDPOINTS (HYDRA-PARITY)
// ==========================================================
ipcMain.handle('get-settings', () => {
  return getAppSettings();
});

ipcMain.handle('update-settings', (event, newSettings) => {
  const updated = saveAppSettings(newSettings);
  if (typeof newSettings?.runAtStartup === 'boolean' || typeof newSettings?.startMinimized === 'boolean') {
    try {
      app.setLoginItemSettings({
        openAtLogin: Boolean(updated.runAtStartup),
        openAsHidden: Boolean(updated.startMinimized)
      });
    } catch (e) {
      console.warn('[Backend] Failed to update login item settings:', e.message);
    }
  }
  return updated;
});

ipcMain.handle('select-download-dir', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const current = getAppSettings();
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Download & Installation Directory',
    defaultPath: current.downloadsPath && fs.existsSync(current.downloadsPath) ? current.downloadsPath : undefined,
    properties: ['openDirectory', 'createDirectory']
  });
  if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
    const chosen = res.filePaths[0];
    saveAppSettings({ downloadsPath: chosen });
    return chosen;
  }
  return null;
});

ipcMain.handle('select-game-exe', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Executable or Shortcut to Add to Library',
    filters: [
      { name: 'Executable or Shortcut (*.exe, *.lnk)', extensions: ['exe', 'lnk'] }
    ],
    properties: ['openFile']
  });
  if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
    const chosen = res.filePaths[0];
    const baseTitle = path.basename(chosen, path.extname(chosen))
      .replace(/[._-]/g, ' ')
      .trim();
    return {
      id: 'custom-' + Date.now(),
      title: baseTitle || 'Custom Game',
      exePath: chosen,
      filePath: chosen,
      installDir: path.dirname(chosen),
      source: 'local',
      status: 'completed',
      progress: 100,
      totalSize: 'Local Game',
      date: new Date().toLocaleDateString()
    };
  }
  return null;
});

// ==========================================================
// PER-GAME EXECUTABLE & LAUNCH SETTINGS IPC
// ==========================================================
ipcMain.handle('get-game-executables', async (event, opts) => {
  const { installDir, title } = opts || {};
  if (!installDir || !fs.existsSync(installDir)) {
    return { primary: null, candidates: [] };
  }
  try {
    return findAllGameExecutables(installDir, title);
  } catch (e) {
    console.error('[Backend] Error scanning executables:', e);
    return { primary: null, candidates: [] };
  }
});

ipcMain.handle('get-game-config', (event, gameId) => {
  if (!gameId) return null;
  return getGameConfig(gameId);
});

ipcMain.handle('set-game-config', (event, opts) => {
  const { gameId, customExePath, launchArgs } = opts || {};
  if (!gameId) return { success: false, error: 'No game ID provided' };
  const saved = saveGameConfig(gameId, { customExePath: customExePath || null, launchArgs: launchArgs || null });
  console.log(`[Backend] Saved game config for ${gameId}:`, saved);
  return { success: true, config: saved };
});

ipcMain.handle('browse-game-exe', async (event, opts) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const { installDir } = opts || {};
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Executable',
    defaultPath: installDir && fs.existsSync(installDir) ? installDir : undefined,
    filters: [
      { name: 'Executable (*.exe)', extensions: ['exe'] }
    ],
    properties: ['openFile']
  });
  if (!res.canceled && res.filePaths && res.filePaths.length > 0) {
    return { path: res.filePaths[0], name: path.basename(res.filePaths[0]) };
  }
  return null;
});

ipcMain.handle('auto-launch', (event, opts) => {
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(opts?.enabled),
      openAsHidden: Boolean(opts?.minimized)
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ==========================================================
// PLAYTIME IPC ENDPOINTS (HYDRA-PARITY)
// ==========================================================
ipcMain.handle('get-playtime', () => {
  return getPlaytimeDatabase();
});

ipcMain.handle('get-running-games', () => {
  const list = [];
  const now = Date.now();
  for (const [key, session] of activeGameSessions.entries()) {
    list.push({
      gameKey: key,
      title: session.title,
      sessionSeconds: Math.floor((now - session.startTime) / 1000)
    });
  }
  return list;
});

// ==========================================================
// HOWLONGTOBEAT INTEGRATION & IPC (HYDRA-PARITY)
// ==========================================================
const hltbMemoryCache = new Map();

async function resolveHowLongToBeat(gameTitle) {
  if (!gameTitle) return null;
  const cleanTitle = cleanGameTitleForSearch(gameTitle);
  if (hltbMemoryCache.has(cleanTitle)) {
    return hltbMemoryCache.get(cleanTitle);
  }

  // Strategy 1: npm howlongtobeat
  try {
    const { HowLongToBeatService } = require('howlongtobeat');
    const hltb = new HowLongToBeatService();
    const results = await hltb.search(cleanTitle);
    if (results && results.length > 0) {
      const top = results[0];
      const data = {
        mainStory: top.gameplayMain || 0,
        mainExtra: top.gameplayMainExtra || 0,
        completionist: top.gameplayCompletionist || 0,
        name: top.name,
        similarity: top.similarity || 1
      };
      hltbMemoryCache.set(cleanTitle, data);
      return data;
    }
  } catch (err) {
    // Silent fallback to strategy 2
  }

  // Strategy 2: Direct API fetch with browser headers
  try {
    const searchUrl = 'https://howlongtobeat.com/api/search';
    const response = await net.fetch(searchUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://howlongtobeat.com/',
        'Origin': 'https://howlongtobeat.com',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        searchType: "games",
        searchTerms: cleanTitle.split(' '),
        searchPage: 1,
        size: 5,
        searchOptions: {
          games: { userId: 0, platform: "", sortCategory: "popular", rangeCategory: "main", rangeTime: { min: 0, max: 0 }, gameplay: { perspective: "", flow: "", genre: "" }, modifier: "" },
          users: { sortCategory: "postcount" },
          lists: { sortCategory: "follows" },
          filter: "",
          sort: 0,
          randomizer: 0
        }
      })
    });

    if (response.ok) {
      const json = await response.json();
      if (json && json.data && json.data.length > 0) {
        const item = json.data[0];
        const toHours = (sec) => sec ? Math.round(sec / 3600) : 0;
        const data = {
          mainStory: toHours(item.comp_main),
          mainExtra: toHours(item.comp_plus),
          completionist: toHours(item.comp_100),
          name: item.game_name,
          similarity: 1
        };
        hltbMemoryCache.set(cleanTitle, data);
        return data;
      }
    }
  } catch (e) {}

  return null;
}

ipcMain.handle('get-hltb-data', async (event, gameTitle) => {
  return await resolveHowLongToBeat(gameTitle);
});

// ==========================================================
// CUSTOM DOWNLOAD SOURCES ENGINE & IPC (HYDRA-PARITY)
// ==========================================================
let cachedCustomSourcesCatalog = null;
function getCustomSourcesCatalog() {
  if (cachedCustomSourcesCatalog) return cachedCustomSourcesCatalog;
  try {
    if (fs.existsSync(CUSTOM_SOURCES_FILE)) {
      cachedCustomSourcesCatalog = JSON.parse(fs.readFileSync(CUSTOM_SOURCES_FILE, 'utf8'));
      return cachedCustomSourcesCatalog;
    }
  } catch (e) {
    console.error('[Backend] Error reading custom sources catalog:', e);
  }
  cachedCustomSourcesCatalog = {};
  return cachedCustomSourcesCatalog;
}

function saveCustomSourcesCatalog(data) {
  try {
    cachedCustomSourcesCatalog = data;
    fs.writeFileSync(CUSTOM_SOURCES_FILE, JSON.stringify(cachedCustomSourcesCatalog), 'utf8');
  } catch (e) {
    console.error('[Backend] Error saving custom sources catalog:', e);
  }
}

async function fetchCustomSourceFromUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchCustomSourceFromUrl(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}: Failed to fetch source`));
      }
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          resolve(parsed);
        } catch (e) {
          reject(new Error('Invalid JSON format received from URL'));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Connection timed out')); });
  });
}

ipcMain.handle('get-custom-sources', () => {
  const settings = getAppSettings();
  return settings.customSources || [];
});

ipcMain.handle('add-custom-source', async (event, sourceUrl) => {
  if (!sourceUrl || !sourceUrl.trim()) {
    return { success: false, error: 'URL cannot be empty' };
  }
  const cleanUrl = sourceUrl.trim();
  const settings = getAppSettings();
  const existingSources = settings.customSources || [];

  if (existingSources.some(s => s.url === cleanUrl)) {
    return { success: false, error: 'Source URL already added' };
  }

  try {
    const sourceData = await fetchCustomSourceFromUrl(cleanUrl);
    const downloads = Array.isArray(sourceData) ? sourceData : (sourceData.downloads || []);
    const sourceName = sourceData.name || (new URL(cleanUrl)).hostname;
    const sourceId = 'custom-' + Date.now();

    const newSourceEntry = {
      id: sourceId,
      name: sourceName,
      url: cleanUrl,
      count: downloads.length,
      status: 'matched',
      lastSynced: Date.now()
    };

    const updatedSources = [...existingSources, newSourceEntry];
    saveAppSettings({ customSources: updatedSources });

    // Save download catalog to disk
    const catalog = getCustomSourcesCatalog();
    catalog[sourceId] = {
      name: sourceName,
      downloads: downloads.map((item, idx) => ({
        id: `cs-${sourceId}-${idx}`,
        title: item.title || item.name || 'Unknown',
        uris: item.uris || [item.url || item.uri].filter(Boolean),
        fileSize: item.fileSize || item.size || 'Unknown',
        uploadDate: item.uploadDate || item.date || 'Recently'
      }))
    };
    saveCustomSourcesCatalog(catalog);

    return { success: true, source: newSourceEntry };
  } catch (err) {
    console.error('[Backend] Failed to add custom source:', err.message);
    return { success: false, error: err.message || 'Failed to download or parse source URL' };
  }
});

ipcMain.handle('remove-custom-source', (event, sourceId) => {
  const settings = getAppSettings();
  const filtered = (settings.customSources || []).filter(s => s.id !== sourceId);
  saveAppSettings({ customSources: filtered });

  const catalog = getCustomSourcesCatalog();
  delete catalog[sourceId];
  saveCustomSourcesCatalog(catalog);

  return { success: true };
});

ipcMain.handle('sync-custom-sources', async () => {
  const settings = getAppSettings();
  const sources = settings.customSources || [];
  const catalog = getCustomSourcesCatalog();
  let updatedCount = 0;

  for (const s of sources) {
    try {
      const sourceData = await fetchCustomSourceFromUrl(s.url);
      const downloads = Array.isArray(sourceData) ? sourceData : (sourceData.downloads || []);
      s.count = downloads.length;
      s.status = 'matched';
      s.lastSynced = Date.now();
      catalog[s.id] = {
        name: s.name,
        downloads: downloads.map((item, idx) => ({
          id: `cs-${s.id}-${idx}`,
          title: item.title || item.name || 'Unknown',
          uris: item.uris || [item.url || item.uri].filter(Boolean),
          fileSize: item.fileSize || item.size || 'Unknown',
          uploadDate: item.uploadDate || item.date || 'Recently'
        }))
      };
      updatedCount++;
    } catch (e) {
      s.status = 'failed';
    }
  }

  saveAppSettings({ customSources: sources });
  saveCustomSourcesCatalog(catalog);
  return { success: true, count: updatedCount };
});

// ==========================================================
// STEAMUNLOCKED SCRAPER
// ==========================================================

const parseSteamUnlockedHtml = (html) => {
  const $ = cheerio.load(html);
  const games = [];
  const seen = new Set();

  $('.su-cat__card, .cover-item').each((i, el) => {
    let href = $(el).attr('href') || $(el).find('a').attr('href');
    
    let title = $(el).find('.su-cat__card-body h2').text().trim()
             || $(el).find('h2').text().trim() 
             || $(el).find('.title').text().trim() 
             || $(el).find('.cover-item-content__title').text().trim();
    if (!title) {
      title = $(el).find('.su-cat__card-body h2').text().trim();
    }
    
    let cover = $(el).find('img').attr('data-wpfc-original-src') 
             || $(el).find('img').attr('data-src') 
             || $(el).find('img').attr('src');
    if (cover && (cover.includes('blank.gif') || cover.startsWith('data:image'))) {
      cover = $(el).find('img').attr('data-wpfc-original-src') || $(el).find('img').attr('data-src') || '';
    }
    if (cover && (cover.includes('blank.gif') || cover.startsWith('data:image'))) {
      cover = '';
    }

    if (href && title) {
      let slug = href.replace(/^https?:\/\/[^\/]+\//, '').replace(/\//g, '');
      if (seen.has(slug)) return;
      seen.add(slug);

      if (cover && !cover.startsWith('http')) {
        cover = cover.startsWith('/') ? 'https://steamunlocked.org' + cover : 'https://steamunlocked.org/' + cover;
      }

      games.push({
        id: 'su-' + slug,
        title: title,
        cleanTitle: cleanGameTitleForSearch(title),
        slug: href,
        cover: cover || '',
        banner: cover || '',
        developer: 'SteamUnlocked',
        description: 'Pre-Installed Game from SteamUnlocked',
        size: 'Unknown',
        progress: 0,
        enriched: false,
        source: 'steamunlocked'
      });
    }
  });

  return games;
};

const fetchSteamUnlockedHtmlFast = (url, depth = 0) => {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://steamunlocked.org/'
      }
    };

    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let nextUrl = res.headers.location;
        if (!nextUrl.startsWith('http')) {
          nextUrl = new URL(nextUrl, url).href;
        }
        return resolve(fetchSteamUnlockedHtmlFast(nextUrl, depth + 1));
      }

      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
};

const scrapeSteamUnlockedBrowserWindow = (url) => {
  return new Promise((resolve) => {
    const scrapeWin = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    scrapeWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let resolved = false;
    let pollInterval = null;

    const cleanup = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
      try {
        if (!scrapeWin.isDestroyed()) scrapeWin.destroy();
      } catch (e) {}
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log('[Backend] SteamUnlocked scrape timed out for:', url);
        cleanup();
        resolve([]);
      }
    }, 25000);

    pollInterval = setInterval(async () => {
      if (resolved || scrapeWin.isDestroyed()) {
        cleanup();
        return;
      }
      try {
        const html = await scrapeWin.webContents.executeJavaScript('document.documentElement.outerHTML');
        if (html.includes('Just a moment') || html.includes('Attention Required') || html.includes('security check')) {
          return;
        }
        const games = parseSteamUnlockedHtml(html);
        if (games.length > 0) {
          console.log('[Backend] Scraped', games.length, 'games from URL via BrowserWindow:', url);
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          resolve(games);
        } else if (html.includes('footer') || html.includes('su-allgames') || html.includes('Page not found') || html.includes('Nothing Found')) {
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          resolve([]);
        }
      } catch (err) {
        // Challenging execution in progress
      }
    }, 1000);

    scrapeWin.loadURL(url, {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
  });
};

const fetchSteamUnlockedUrl = async (url) => {
  try {
    const fastHtml = await fetchSteamUnlockedHtmlFast(url);
    if (fastHtml && !fastHtml.includes('Just a moment') && !fastHtml.includes('Attention Required')) {
      const games = parseSteamUnlockedHtml(fastHtml);
      if (games.length > 0) {
        return games;
      }
    }
  } catch (e) {
    console.log('[Backend] Fast HTTP scrape fell back to BrowserWindow for SteamUnlocked:', e.message);
  }

  return scrapeSteamUnlockedBrowserWindow(url);
};

ipcMain.handle('fetch-steamunlocked-page', async (event, params) => {
  return fetchSteamUnlockedGamesInternal(params);
});

// ==========================================================
// SOURCE 3: FITGIRL REPACKS CATALOG & STEAM COVER RESOLVER
// ==========================================================

let metaCacheLoaded = false;
const metaCache = new Map();
function getMetaDiskCachePath() {
  try {
    return path.join(app.getPath('userData'), 'steam_meta_cache.json');
  } catch (e) {
    return path.join(__dirname, 'steam_meta_cache.json');
  }
}

function loadMetaCache() {
  if (metaCacheLoaded) return;
  metaCacheLoaded = true;
  try {
    const p = getMetaDiskCachePath();
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      for (const [k, v] of Object.entries(data)) {
        metaCache.set(k, v);
      }
      console.log(`[Metadata] Loaded ${metaCache.size} cached game covers from disk`);
    }
  } catch (e) {
    console.warn('[Metadata] Could not read disk cache:', e.message);
  }
}

let saveMetaCacheTimer = null;
function persistMetaCache() {
  if (saveMetaCacheTimer) return;
  saveMetaCacheTimer = setTimeout(() => {
    saveMetaCacheTimer = null;
    try {
      const p = getMetaDiskCachePath();
      const obj = Object.fromEntries(metaCache);
      fs.writeFileSync(p, JSON.stringify(obj), 'utf8');
    } catch (e) {}
  }, 1500);
}

function cleanGameTitleForSearch(t) {
  if (!t) return '';
  let s = t;
  s = s.replace(/\[.*?\]/g, ' ');
  s = s.replace(/\(.*?\)/g, ' ');

  // If title has multiple alternatives separated by " / " (e.g. "GTA 4 / Grand Theft Auto IV"), pick the canonical full title
  if (s.includes(' / ')) {
    const parts = s.split(' / ');
    s = parts.reduce((a, b) => a.length > b.length ? a : b).trim();
  }

  // Remove version/build/dlc dashes and suffixes
  s = s.replace(/\s*[–—\-]\s*(?:v?[\d.]+|build|hotfix|update|offline|deluxe|complete|gold|release|bonus|all dlc|just for fun|supporter|definitive|season).*$/i, '');
  s = s.replace(/:\s*(?:complete|deluxe|definitive|gold|anniversary|enhanced|remastered|special|digital|collector['’]?s?|supporter|ultimate|premium|super digital|game & soundtrack|the set bundle|legendary|platinum|goty|game of the year|standard|bundle|edition|collection|kollection|pack|anthology|trilogy|duology|soundtrack bundle|ski resort edition|year one edition|age of pirates).*$/i, '');
  s = s.replace(/\s+(?:supporter bundle|soundtracks? bundle|collector['’]?s edition|ultimate edition|deluxe edition|complete edition|year one edition).*$/i, '');
  s = s.replace(/\s+&\s+.*$/i, '');
  s = s.replace(/,\s*v?[\d.].*$/i, '');
  s = s.replace(/,\s*build\s*.*$/i, '');
  s = s.replace(/,\s*\d{2}\/\d{2}\/\d{4}.*$/i, '');
  s = s.replace(/\s*\+\s*.*$/, '');
  s = s.replace(/\s*[–—]\s*.*$/i, '');
  s = s.replace(/\s*-\s*v?\d.*$/i, '');
  s = s.replace(/#/, '');

  // Strip standalone version numbers with dots (e.g. " 1.0.12", " 1.7.6", " 1.0.0.14580.216444")
  s = s.replace(/\s+v?\d+\.\d+(?:\.\d+)*.*$/i, '');
  // Strip standalone build numbers (e.g. " Build 10092026", " Build 30062026")
  s = s.replace(/\s+(?:build|patch|hotfix|update|release|v\d+)\s*.*$/i, '');
  // Strip Russian modification/version strings
  s = s.replace(/\s*(?:Версия|модификации).*$/i, '');

  return s.replace(/[–—\-,:]+$/, '').trim();
}

function querySteamCommunityApps(query) {
  return new Promise((resolve) => {
    const url = 'https://steamcommunity.com/actions/SearchApps/' + encodeURIComponent(query);
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      timeout: 4000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const arr = JSON.parse(data);
          if (Array.isArray(arr) && arr.length > 0) {
            return resolve(arr[0]);
          }
        } catch (e) {}
        resolve(null);
      });
    }).on('error', () => resolve(null)).on('timeout', () => resolve(null));
  });
}

function queryStoreSearch(query) {
  return new Promise((resolve) => {
    const url = 'https://store.steampowered.com/api/storesearch/?term=' + encodeURIComponent(query) + '&l=english&cc=US';
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      },
      timeout: 4000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (j && Array.isArray(j.items) && j.items.length > 0) {
            const item = j.items[0];
            return resolve({
              appid: item.id,
              name: item.name,
              tiny_image: item.tiny_image
            });
          }
        } catch (e) {}
        resolve(null);
      });
    }).on('error', () => resolve(null)).on('timeout', () => resolve(null));
  });
}

function checkHeadFast(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    try {
      const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 2000 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch (e) {
      resolve(false);
    }
  });
}

function fetchAppDetails(id) {
  return new Promise((resolve) => {
    https.get(`https://store.steampowered.com/api/appdetails?appids=${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 4000
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          resolve(j[id]?.data || null);
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null)).on('timeout', () => resolve(null));
  });
}

async function resolveSteamMetadata(title) {
  loadMetaCache();
  if (!title) return null;
  const rawClean = cleanGameTitleForSearch(title);
  if (!rawClean) return null;

  if (metaCache.has(rawClean)) return metaCache.get(rawClean);
  if (metaCache.has(title)) return metaCache.get(title);

  const queryCandidates = [rawClean];
  if (rawClean.includes(':')) queryCandidates.push(rawClean.split(':')[0].trim());
  if (rawClean.includes(' - ')) queryCandidates.push(rawClean.split(' - ')[0].trim());
  if (rawClean.includes(' – ')) queryCandidates.push(rawClean.split(' – ')[0].trim());

  const strippedTrailingNum = rawClean.replace(/\s+\d{3,}$/, '').trim();
  if (strippedTrailingNum !== rawClean && strippedTrailingNum.length > 2) {
    queryCandidates.push(strippedTrailingNum);
  }

  let app = null;
  for (const q of queryCandidates) {
    if (!q || q.length < 2) continue;
    app = await querySteamCommunityApps(q);
    if (!app) {
      app = await queryStoreSearch(q);
    }
    if (app && app.appid) break;
  }

  if (!app && rawClean.includes(' ')) {
    const words = rawClean.split(/\s+/).slice(0, 3).join(' ');
    if (words !== rawClean && words.length > 2) {
      app = await querySteamCommunityApps(words);
      if (!app) {
        app = await queryStoreSearch(words);
      }
    }
  }

  if (app && app.appid) {
    const details = await fetchAppDetails(app.appid);
    const officialHeader = details?.header_image 
      || (app.tiny_image ? app.tiny_image.replace(/capsule_\d+x\d+\.jpg/, 'header.jpg') : null)
      || app.logo 
      || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${app.appid}/header.jpg`;
      
    const officialBanner = details?.screenshots?.[0]?.path_full 
      || details?.background 
      || officialHeader;

    const verticalCover = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${app.appid}/library_600x900_2x.jpg`;
    const hasVertical = await checkHeadFast(verticalCover);

    const meta = {
      appId: app.appid,
      title: app.name || rawClean,
      cover: hasVertical ? verticalCover : officialHeader,
      coverFallback: officialHeader,
      header: officialHeader,
      banner: officialBanner,
      logo: app.logo || '',
      icon: app.icon || '',
      description: details?.short_description || 'Pre-installed build with verified launch signatures.',
      developer: (details?.developers && details.developers[0]) || 'Verified Release',
      publishers: details?.publishers || [],
      releaseDate: details?.release_date?.date || '',
      genres: details?.genres?.map(g => g.description) || [],
      metacritic: details?.metacritic || null,
      pc_requirements: details?.pc_requirements || null,
      supportedLanguages: details?.supported_languages || '',
      detailedDescription: details?.detailed_description || details?.about_the_game || '',
      screenshots: details?.screenshots?.map(s => ({
        id: s.id,
        thumbnail: s.path_thumbnail,
        full: s.path_full
      })) || [],
      movies: details?.movies?.map(m => ({
        id: m.id,
        name: m.name,
        thumbnail: m.thumbnail,
        mp4: m.mp4?.max || m.mp4?.['480'] || '',
        webm: m.webm?.max || m.webm?.['480'] || ''
      })) || []
    };

    metaCache.set(rawClean, meta);
    metaCache.set(title, meta);
    persistMetaCache();
    return meta;
  }

  return null;
}

async function mapConcurrent(items, fn, concurrency = 6) {
  let idx = 0;
  const results = new Array(items.length);
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return results;
}

let fitgirlGamesCache = null;

function getFitgirlCatalog() {
  if (fitgirlGamesCache) return fitgirlGamesCache;
  try {
    const candidatePaths = [
      path.join(__dirname, 'sources', 'fitgirl.json'),
      path.join(process.resourcesPath, 'sources', 'fitgirl.json'),
      path.join(process.resourcesPath, 'app', 'sources', 'fitgirl.json'),
      'C:\\Users\\USER\\Documents\\source 3.json'
    ];
    const chosenPath = candidatePaths.find(p => p && fs.existsSync(p));

    if (!chosenPath) {
      console.warn('[Backend] FitGirl catalog json not found in candidate paths!');
      return [];
    }

    console.log('[Backend] Loading FitGirl catalog from:', chosenPath);
    const rawStr = fs.readFileSync(chosenPath, 'utf8');
    const parsed = JSON.parse(rawStr);
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.downloads) ? parsed.downloads : []);

    // Map and reverse so newest releases appear first
    const mapped = items.map((item, index) => {
      const hashMatch = item.uris && item.uris[0] ? item.uris[0].match(/urn:btih:([a-fA-F0-9]+)/i) : null;
      const id = 'fg-' + (hashMatch ? hashMatch[1].toLowerCase() : index);
      const firstUri = (item.uris && item.uris.length > 0) ? item.uris[0] : '';
      return {
        id,
        title: item.title || 'Untitled Game',
        slug: firstUri,
        cover: '',
        banner: '',
        developer: 'FitGirl Repacks',
        description: `FitGirl Repack • Uploaded ${item.uploadDate ? item.uploadDate.substring(0, 10) : ''}`,
        size: item.fileSize || 'Unknown',
        progress: 0,
        enriched: false,
        source: 'fitgirl',
        uploadDate: item.uploadDate || '',
        uris: Array.isArray(item.uris) ? item.uris : (firstUri ? [firstUri] : [])
      };
    });

    mapped.forEach(indexGameFields);
    fitgirlGamesCache = mapped.reverse();
    console.log(`[Backend] ✅ FitGirl catalog loaded successfully: ${fitgirlGamesCache.length} games`);
    return fitgirlGamesCache;
  } catch (err) {
    console.error('[Backend] Error loading FitGirl catalog:', err);
    return [];
  }
}

ipcMain.handle('fetch-source3-page', async (event, params) => {
  let page = 1;
  let search = '';
  if (typeof params === 'string') {
    search = params;
  } else if (params && typeof params === 'object') {
    page = params.page || 1;
    search = params.search || '';
  }

  const catalog = getFitgirlCatalog();
  const rawQuery = (search || '').trim();

  let filtered = catalog;
  if (rawQuery) {
    filtered = rankAndFilterGamesBySearch(catalog, rawQuery);
  }

  const perPage = 24;
  const startIndex = (page - 1) * perPage;
  const pageItems = filtered.slice(startIndex, startIndex + perPage);

  // Automatically enrich the 24 games with Steam 600x900 covers & hero banners in parallel
  await mapConcurrent(pageItems, async (game) => {
    if (!game.cover || game.cover.length === 0) {
      const meta = await resolveSteamMetadata(game.title);
      if (meta) {
        game.cover = meta.cover;
        game.coverFallback = meta.coverFallback;
        game.header = meta.header;
        game.banner = meta.banner;
        game.originalCover = meta.cover;
        game.description = meta.description || game.description;
        game.developer = meta.developer || game.developer;
        game.enriched = true;
      }
    }
  }, 6);

  console.log(`[Backend] FitGirl page ${page} (search: "${rawQuery}"): returning ${pageItems.length} items (total matches: ${filtered.length})`);
  return pageItems;
});

// ==========================================================
// SOURCE 4: ONLINEFIX MULTIPLAYER REPACKS CATALOG
// ==========================================================
let onlinefixGamesCache = null;

function getOnlinefixCatalog() {
  if (onlinefixGamesCache) return onlinefixGamesCache;
  try {
    const candidatePaths = [
      path.join(__dirname, 'sources', 'onlinefix.json'),
      path.join(process.resourcesPath, 'sources', 'onlinefix.json'),
      path.join(process.resourcesPath, 'app', 'sources', 'onlinefix.json'),
      'C:\\Users\\USER\\Documents\\onlinefix.json'
    ];
    const chosenPath = candidatePaths.find(p => p && fs.existsSync(p));

    if (!chosenPath) {
      console.warn('[Backend] OnlineFix catalog json not found in candidate paths!');
      return [];
    }

    console.log('[Backend] Loading OnlineFix catalog from:', chosenPath);
    const rawStr = fs.readFileSync(chosenPath, 'utf8');
    const parsed = JSON.parse(rawStr);
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.downloads) ? parsed.downloads : []);

    const mapped = items.map((item, index) => {
      const hashMatch = item.uris && item.uris[0] ? item.uris[0].match(/urn:btih:([a-fA-F0-9]+)/i) : null;
      const id = 'of-' + (hashMatch ? hashMatch[1].toLowerCase() : index);
      const firstUri = (item.uris && item.uris.length > 0) ? item.uris[0] : '';
      let cleanTitle = '';
      if (firstUri) {
        const dnMatch = firstUri.match(/[?&]dn=([^&]+)/);
        if (dnMatch) {
          try {
            cleanTitle = decodeURIComponent(dnMatch[1].replace(/\+/g, ' ')).trim();
          } catch (e) {}
        }
      }
      if (!cleanTitle) {
        cleanTitle = cleanGameTitleForSearch(item.title || '');
      }
      return {
        id,
        title: item.title || 'Untitled Game',
        cleanTitle: cleanTitle || item.title || 'Untitled Game',
        slug: firstUri,
        cover: '',
        banner: '',
        developer: 'OnlineFix',
        description: `OnlineFix Multiplayer Repack • Uploaded ${item.uploadDate ? item.uploadDate.substring(0, 10) : ''}`,
        size: item.fileSize || 'Unknown',
        progress: 0,
        enriched: false,
        source: 'onlinefix',
        sourceName: 'OnlineFix',
        uploadDate: item.uploadDate || '',
        uris: Array.isArray(item.uris) ? item.uris : (firstUri ? [firstUri] : [])
      };
    });

    mapped.forEach(indexGameFields);
    onlinefixGamesCache = mapped;
    console.log(`[Backend] ✅ OnlineFix catalog loaded successfully: ${onlinefixGamesCache.length} games`);
    return onlinefixGamesCache;
  } catch (err) {
    console.error('[Backend] Error loading OnlineFix catalog:', err);
    return [];
  }
}

ipcMain.handle('fetch-source4-page', async (event, params) => {
  let page = 1;
  let search = '';
  if (typeof params === 'string') {
    search = params;
  } else if (params && typeof params === 'object') {
    page = params.page || 1;
    search = params.search || '';
  }

  const catalog = getOnlinefixCatalog();
  const rawQuery = (search || '').trim();

  let filtered = catalog;
  if (rawQuery) {
    filtered = rankAndFilterGamesBySearch(catalog, rawQuery);
  }

  const perPage = 24;
  const startIndex = (page - 1) * perPage;
  const pageItems = filtered.slice(startIndex, startIndex + perPage);

  await mapConcurrent(pageItems, async (game) => {
    if (!game.cover || game.cover.length === 0) {
      const searchTitle = game.cleanTitle || cleanGameTitleForSearch(game.title);
      const meta = await resolveSteamMetadata(searchTitle);
      if (meta) {
        game.cover = meta.cover;
        game.coverFallback = meta.coverFallback;
        game.header = meta.header;
        game.banner = meta.banner;
        game.originalCover = meta.cover;
        game.description = meta.description || game.description;
        game.developer = meta.developer || game.developer;
        game.enriched = true;
      }
    }
  }, 6);

  console.log(`[Backend] OnlineFix page ${page} (search: "${rawQuery}"): returning ${pageItems.length} items (total matches: ${filtered.length})`);
  return pageItems;
});

// Alias for source 4
ipcMain.handle('fetch-onlinefix-page', async (event, params) => {
  return await ipcMain.handlers.get('fetch-source4-page')(event, params);
});

// ==========================================================
// SOURCE 5: DODI REPACKS CATALOG
// ==========================================================
let dodiGamesCache = null;

function getDodiCatalog() {
  if (dodiGamesCache) return dodiGamesCache;
  try {
    const candidatePaths = [
      path.join(__dirname, 'sources', 'dodi.json'),
      path.join(process.resourcesPath, 'sources', 'dodi.json'),
      path.join(process.resourcesPath, 'app', 'sources', 'dodi.json'),
      'C:\\Users\\USER\\Documents\\dodi.json'
    ];
    const chosenPath = candidatePaths.find(p => p && fs.existsSync(p));

    if (!chosenPath) {
      console.warn('[Backend] DODI catalog json not found in candidate paths!');
      return [];
    }

    console.log('[Backend] Loading DODI catalog from:', chosenPath);
    const rawStr = fs.readFileSync(chosenPath, 'utf8');
    const parsed = JSON.parse(rawStr);
    const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.downloads) ? parsed.downloads : []);

    const mapped = items.map((item, index) => {
      const hashMatch = item.uris && item.uris[0] ? item.uris[0].match(/urn:btih:([a-fA-F0-9]+)/i) : null;
      const id = 'dodi-' + (hashMatch ? hashMatch[1].toLowerCase() : index);
      const firstUri = (item.uris && item.uris.length > 0) ? item.uris[0] : '';
      let cleanTitle = '';
      if (firstUri) {
        const dnMatch = firstUri.match(/[?&]dn=([^&]+)/);
        if (dnMatch) {
          try {
            cleanTitle = decodeURIComponent(dnMatch[1].replace(/\+/g, ' ')).trim();
          } catch (e) {}
        }
      }
      if (!cleanTitle) {
        cleanTitle = cleanGameTitleForSearch(item.title || '');
      }
      return {
        id,
        title: item.title || 'Untitled Game',
        cleanTitle: cleanTitle || item.title || 'Untitled Game',
        slug: firstUri,
        cover: '',
        banner: '',
        developer: 'DODI Repacks',
        description: `DODI Repack • Uploaded ${item.uploadDate ? item.uploadDate.substring(0, 10) : ''}`,
        size: item.fileSize || 'Unknown',
        progress: 0,
        enriched: false,
        source: 'dodi',
        sourceName: 'DODI',
        uploadDate: item.uploadDate || '',
        uris: Array.isArray(item.uris) ? item.uris : (firstUri ? [firstUri] : [])
      };
    });

    mapped.forEach(indexGameFields);
    dodiGamesCache = mapped;
    console.log(`[Backend] ✅ DODI catalog loaded successfully: ${dodiGamesCache.length} games`);
    return dodiGamesCache;
  } catch (err) {
    console.error('[Backend] Error loading DODI catalog:', err);
    return [];
  }
}

ipcMain.handle('fetch-source5-page', async (event, params) => {
  let page = 1;
  let search = '';
  if (typeof params === 'string') {
    search = params;
  } else if (params && typeof params === 'object') {
    page = params.page || 1;
    search = params.search || '';
  }

  const catalog = getDodiCatalog();
  const rawQuery = (search || '').trim();

  let filtered = catalog;
  if (rawQuery) {
    filtered = rankAndFilterGamesBySearch(catalog, rawQuery);
  }

  const perPage = 24;
  const startIndex = (page - 1) * perPage;
  const pageItems = filtered.slice(startIndex, startIndex + perPage);

  await mapConcurrent(pageItems, async (game) => {
    if (!game.cover || game.cover.length === 0) {
      const searchTitle = game.cleanTitle || cleanGameTitleForSearch(game.title);
      const meta = await resolveSteamMetadata(searchTitle);
      if (meta) {
        game.cover = meta.cover;
        game.coverFallback = meta.coverFallback;
        game.header = meta.header;
        game.banner = meta.banner;
        game.originalCover = meta.cover;
        game.description = meta.description || game.description;
        game.developer = meta.developer || game.developer;
        game.enriched = true;
      }
    }
  }, 6);

  console.log(`[Backend] DODI page ${page} (search: "${rawQuery}"): returning ${pageItems.length} items (total matches: ${filtered.length})`);
  return pageItems;
});

// Alias for source 5
ipcMain.handle('fetch-dodi-page', async (event, params) => {
  return await ipcMain.handlers.get('fetch-source5-page')(event, params);
});

// ==========================================================
// SYSTEM DRIVES DETECTION (STEAM-STYLE INSTALL LOCATIONS)
// ==========================================================

ipcMain.handle('get-system-drives', async () => {
  return new Promise((resolve) => {
    const cmd = 'powershell -NoProfile -Command "Get-CimInstance Win32_LogicalDisk -Filter \\"DriveType=3\\" | Select-Object DeviceID, VolumeName, Size, FreeSpace | ConvertTo-Json"';
    const { exec } = require('child_process');
    exec(cmd, (err, stdout) => {
      if (err || !stdout) {
        console.error('[Backend] Error querying system drives:', err);
        return resolve([{
          drive: 'C:',
          name: 'Local Disk (C:)',
          totalBytes: 100 * 1024 * 1024 * 1024,
          freeBytes: 50 * 1024 * 1024 * 1024,
          totalFormatted: '100 GB',
          freeFormatted: '50 GB',
          usedPercent: 50,
          targetPath: 'C:\\Charon Games',
          folderExists: fs.existsSync('C:\\Charon Games')
        }]);
      }
      try {
        const raw = JSON.parse(stdout);
        const list = Array.isArray(raw) ? raw : [raw];
        const drives = list.map(d => {
          const total = Number(d.Size || 0);
          const free = Number(d.FreeSpace || 0);
          const used = Math.max(0, total - free);
          const driveLetter = d.DeviceID; // e.g. "C:"
          const targetDir = path.join(driveLetter, 'Charon Games');
          const exists = fs.existsSync(targetDir);

          return {
            drive: driveLetter,
            name: d.VolumeName ? `${d.VolumeName} (${driveLetter})` : `Local Disk (${driveLetter})`,
            totalBytes: total,
            freeBytes: free,
            totalFormatted: (total / (1024 ** 3)).toFixed(1) + ' GB',
            freeFormatted: (free / (1024 ** 3)).toFixed(1) + ' GB',
            usedPercent: total > 0 ? Math.round((used / total) * 100) : 0,
            targetPath: targetDir,
            folderExists: exists
          };
        });
        resolve(drives);
      } catch (e) {
        console.error('[Backend] Drive JSON parse error:', e);
        resolve([]);
      }
    });
  });
});

// ==========================================================
// DOWNLOAD MANAGER (ARIA2 MULTI-THREADED C++ ENGINE)
// ==========================================================

function getSafeDefaultDownloadDir() {
  const primaryDir = 'C:\\Charon Games';
  try {
    if (!fs.existsSync(primaryDir)) {
      fs.mkdirSync(primaryDir, { recursive: true });
    }
    return primaryDir;
  } catch (e) {
    try {
      const fallbackDir = path.join(app.getPath('userData'), 'downloads');
      if (!fs.existsSync(fallbackDir)) {
        fs.mkdirSync(fallbackDir, { recursive: true });
      }
      return fallbackDir;
    } catch (err) {
      return path.join(os.tmpdir(), 'Charon Games');
    }
  }
}

const DOWNLOAD_DIR = getSafeDefaultDownloadDir();

function getEffectiveDownloadDir() {
  try {
    const custom = getAppSettings().downloadsPath;
    if (custom && typeof custom === 'string') {
      if (!fs.existsSync(custom)) {
        fs.mkdirSync(custom, { recursive: true });
      }
      return custom;
    }
  } catch (e) {}
  return DOWNLOAD_DIR;
}

function parseSizeToBytes(str) {
  if (!str || typeof str !== 'string') return 0;
  const clean = str.trim().replace(/,/g, '');
  const match = clean.match(/^([0-9.]+)\s*([A-Za-z]+)?$/);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  if (isNaN(val)) return 0;
  const unit = (match[2] || '').toUpperCase();
  if (unit.startsWith('T')) return val * 1024 * 1024 * 1024 * 1024;
  if (unit.startsWith('G')) return val * 1024 * 1024 * 1024;
  if (unit.startsWith('M')) return val * 1024 * 1024;
  if (unit.startsWith('K')) return val * 1024;
  return val;
}

function getAria2Path() {
  const packagedAria2 = path.join(process.resourcesPath, 'aria2c.exe');
  if (fs.existsSync(packagedAria2)) return packagedAria2;
  const appAria2 = path.join(process.resourcesPath, 'app', 'aria2c.exe');
  if (fs.existsSync(appAria2)) return appAria2;
  const localAria2 = path.join(__dirname, 'aria2c.exe');
  if (fs.existsSync(localAria2)) return localAria2;
  const clientAria2 = path.join(__dirname, '..', 'client', 'aria2c.exe');
  if (fs.existsSync(clientAria2)) return clientAria2;
  return 'aria2c';
}

function get7zPath() {
  const packaged7z = path.join(process.resourcesPath, '7z.exe');
  if (fs.existsSync(packaged7z)) return packaged7z;
  const app7z = path.join(process.resourcesPath, 'app', '7z.exe');
  if (fs.existsSync(app7z)) return app7z;
  const local7z = path.join(__dirname, '7z.exe');
  if (fs.existsSync(local7z)) return local7z;
  const system7z = 'C:\\Program Files\\7-Zip\\7z.exe';
  if (fs.existsSync(system7z)) return system7z;
  const client7z = path.join(__dirname, '..', 'client', '7z.exe');
  if (fs.existsSync(client7z)) return client7z;
  return '7z';
}

function getDirectorySize(dirPath) {
  let total = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const f of files) {
      const full = path.join(dirPath, f);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          total += getDirectorySize(full);
        } else {
          total += stat.size;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return total;
}

function findAllGameExecutables(dir, title) {
  if (!fs.existsSync(dir)) return { primary: null, candidates: [] };
  const candidates = [];
  let installerCandidate = null;

  // Hydra-grade enhanced blacklists
  const IGNORED_DIRECTORIES = new Set([
    '_commonredist', 'commonredist', 'steamworks shared', 'redist', 'redists',
    '_redist', 'directx', 'dotnet', 'dotnetfx', 'vcredist', 'openal', 'physx',
    'prerequisites', 'prereq', 'support', 'mono', '__installer', '__support',
    'binaries_backup', 'tools'
  ]);

  const IGNORED_WORDS = [
    'crash', 'report', 'unins', 'uninstall', 'dxwebsetup', 'vcredist', 'vc_redist',
    'dotnet', 'oalinst', 'directx', 'installer', 'patcher', 'touchup',
    'easyanticheat', 'battleye', 'eac_launcher', 'benchmark',
    'register', 'updater', 'cleanup', 'repair', 'dedicated', 'credits',
    'autorun', 'filerepair', 'activation', 'keygen', 'redist',
    'unitycrashhandler', 'crashreportclient', 'crashpad_handler', 'crashpad',
    'unrealcefsubprocess', 'epicwebhelper', 'uplayinstaller', 'ubisoftconnect',
    'pbsvc', 'pbsetup', 'setup_battleye', 'beservice', 'social-club-setup',
    'dauservicesetup', 'xnafx', 'start_protected_game',
    'ue3redist', 'ue4prereqsetup', 'ue5prereqsetup', 'dotnetfx'
  ];

  const IGNORED_EXACT = new Set([
    'setup.exe', 'installer.exe', 'unitycrashhandler32.exe', 'unitycrashhandler64.exe',
    'crashreportclient.exe', 'crashpad_handler.exe', 'unrealcefsubprocess.exe',
    'epicwebhelper.exe', 'start_protected_game.exe', 'javaw.exe', 'java.exe',
    'dotnet.exe', 'python.exe', 'pythonw.exe', 'node.exe'
  ]);

  function walk(currentDir, depth) {
    if (depth > 4) return;
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          const lower = entry.name.toLowerCase();
          if (IGNORED_DIRECTORIES.has(lower) || lower.includes('redist') || lower.includes('directx') || lower.includes('$')) continue;
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
          const lowerName = entry.name.toLowerCase();
          if (lowerName === 'setup.exe' || lowerName === 'installer.exe') {
            if (!installerCandidate) installerCandidate = fullPath;
          }
          if (!IGNORED_EXACT.has(lowerName) && !IGNORED_WORDS.some(ign => lowerName.includes(ign))) {
            try {
              const stat = fs.statSync(fullPath);
              candidates.push({
                path: fullPath,
                name: entry.name,
                lowerName,
                dir: currentDir,
                depth,
                size: stat.size
              });
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  }

  walk(dir, 0);
  if (candidates.length === 0) {
    return {
      primary: installerCandidate,
      candidates: installerCandidate ? [{
        path: installerCandidate,
        name: path.basename(installerCandidate),
        score: 0,
        label: 'Installer (Fallback)',
        isRecommended: true,
        sizeFormatted: '—'
      }] : []
    };
  }

  const cleanTitle = (title || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // Heuristic Scoring Algorithm (Playnite/Steam/Hydra hybrid)
  for (const c of candidates) {
    let score = 0;
    let label = '';
    const cleanName = c.lowerName.replace(/[^a-z0-9]/g, '').replace('exe', '');

    // 1. Game Title Match (+120 to +200 pts)
    if (cleanTitle && cleanName) {
      if (cleanName === cleanTitle) {
        score += 200;
        label = 'Title Match (Exact)';
      } else if (cleanName.includes(cleanTitle) || cleanTitle.includes(cleanName)) {
        score += 120;
        label = 'Title Match (Partial)';
      }
    }

    // 2. Directory Proximity (+15 to +50 pts)
    if (c.depth === 0) score += 50;
    else if (c.depth === 1) score += 35;
    else if (c.depth === 2) score += 15;

    // 3. Engine Companion Signatures (+40 to +80 pts)
    try {
      const parentEntries = fs.readdirSync(c.dir).map(e => e.toLowerCase());
      const baseNameWithoutExt = c.name.slice(0, -4).toLowerCase();
      // Unity companion data folder
      if (parentEntries.includes(baseNameWithoutExt + '_data')) {
        score += 80;
        label = label || 'Unity Game Binary';
      }
      // Steam API / Goldberg / Steamworks integration
      if (parentEntries.includes('steam_api.dll') || parentEntries.includes('steam_api64.dll') || parentEntries.includes('steam_appid.txt')) {
        score += 45;
        if (!label) label = 'Steamworks Detected';
      }
      // Unreal Engine shipping binary
      if (parentEntries.includes('engine') || c.lowerName.includes('-win64-shipping') || c.lowerName.includes('shipping')) {
        score += 40;
        label = label || 'Unreal Engine Binary';
      }
    } catch (e) {}

    // 4. Launcher / Play conventions (+30 pts)
    if (['launcher.exe', 'play.exe', 'start.exe', 'gamelauncher.exe'].includes(c.lowerName)) {
      score += 30;
      label = label || 'Game Launcher';
    }

    // 5. Config / Settings executable detection (+5 pts, labelled)
    if (['config.exe', 'settings.exe', 'options.exe'].includes(c.lowerName)) {
      score += 5;
      label = 'Configuration Utility';
    }

    // 6. Binary File Size weighting
    if (c.size > 20 * 1024 * 1024) score += 30;
    else if (c.size > 5 * 1024 * 1024) score += 20;
    else if (c.size > 1 * 1024 * 1024) score += 10;
    else if (c.size < 200 * 1024) score -= 25; // Likely helper/stub

    c.score = score;
    c.label = label || c.name;
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.size - a.size;
  });

  const formatSize = (bytes) => {
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 ** 3)).toFixed(1) + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 ** 2)).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return bytes + ' B';
  };

  const result = candidates.map((c, idx) => ({
    path: c.path,
    name: c.name,
    score: c.score,
    label: c.label,
    isRecommended: idx === 0,
    sizeFormatted: formatSize(c.size)
  }));

  return {
    primary: candidates[0].path,
    candidates: result
  };
}

// Backward-compatible wrapper: returns just the primary path string
function findGameExecutable(dir, title) {
  return findAllGameExecutables(dir, title).primary;
}

function extractArchiveFast(archivePath, targetDir, game, onProgress) {
  return new Promise((resolve) => {
    const sevenZip = get7zPath();
    console.log(`\n======================================================`);
    console.log(`⚡ [7-Zip] Starting High-Speed Extraction for: ${game.title}`);
    console.log(`📦 Archive: ${archivePath}`);
    console.log(`📁 Target Directory: ${targetDir}`);
    console.log(`🔧 Binary: ${sevenZip}`);
    console.log(`======================================================\n`);

    if (!fs.existsSync(targetDir)) {
      try {
        fs.mkdirSync(targetDir, { recursive: true });
      } catch (e) {}
    }

    // High-performance 7z flags:
    // x: extract with full paths
    // -o: destination directory
    // -y: assume Yes on all queries (overwrites if necessary)
    // -spe: eliminate duplication of root folder
    // -aoa: Overwrite All existing files without prompt
    // -bsp1: write progress stream to stdout for real-time tracking
    // -mmt=on: utilize all CPU cores for multi-threaded decompression
    const args = [
      'x',
      archivePath,
      `-o${targetDir}`,
      '-y',
      '-spe',
      '-aoa',
      '-bsp1',
      '-mmt=on'
    ];

    const child = spawn(sevenZip, args, { windowsHide: true });
    let lastPercent = 0;

    const dl = activeDownloads.get(game.id);
    if (dl) {
      dl.extractProcess = child;
    }

    child.stdout.on('data', (data) => {
      const str = data.toString();
      const match = str.match(/(\d+)%/);
      if (match) {
        const pct = parseInt(match[1], 10);
        if (pct !== lastPercent) {
          lastPercent = pct;
          onProgress(pct);
        }
      }
    });

    child.stderr.on('data', (data) => {
      console.warn('[7-Zip Stderr]', data.toString().trim());
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[7-Zip] ✅ Extraction 100% COMPLETE for: ${game.title}`);
        resolve({ success: true });
      } else {
        console.error(`[7-Zip] ❌ Extraction exited with code: ${code}`);
        resolve({ success: false, code });
      }
    });

    child.on('error', (err) => {
      console.error('[7-Zip] ❌ Failed to spawn 7z process:', err);
      resolve({ success: false, error: err.message });
    });
  });
}

const activeDownloads = new Map();

async function startAria2Download(rawUrl, filename, game, referer) {
  const targetDir = game.installDir || DOWNLOAD_DIR;
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
      console.error('[Aria2] Failed to create target dir:', targetDir, e);
    }
  }

  console.log(`\n======================================================`);
  console.log(`🚀 [Aria2] Starting 16-Connection Engine for: ${game.title}`);
  console.log(`📁 Target: ${path.join(targetDir, filename)}`);
  console.log(`🔗 Direct CDN URL: ${rawUrl}`);
  console.log(`======================================================\n`);

  if (activeDownloads.has(game.id)) {
    console.log(`[Aria2] Replacing active download instance for: ${game.title}`);
    const prev = activeDownloads.get(game.id);
    try { if (prev.process) prev.process.kill(); } catch (e) {}
    try { if (prev.extractProcess) prev.extractProcess.kill(); } catch (e) {}
    activeDownloads.delete(game.id);
  }

  const aria2Executable = getAria2Path();
  console.log(`[Aria2] Engine binary path: ${aria2Executable}`);

  const args = [
    '--dir=' + targetDir,
    '--out=' + filename,
    '--split=16',                    // 16 parallel chunks for maximum throughput
    '--max-connection-per-server=16',
    '--min-split-size=1M',
    '--continue=true',               // Resume capability (.aria2 control files)
    '--file-allocation=none',        // Instant start, no pre-allocation freeze
    '--disk-cache=64M',              // High-throughput 64MB RAM write buffer
    '--socket-recv-buffer-size=1M',  // 1MB TCP receive buffer (bypasses Windows 64KB TCP window cap)
    '--enable-mmap=true',            // Direct memory-mapped file I/O
    '--enable-http-keep-alive=true', // Persistent HTTP/1.1 connection reuse
    '--enable-http-pipelining=true', // HTTP pipelining for faster chunk negotiation
    '--async-dns=false',             // High-speed OS-level native DNS resolution
    '--summary-interval=1',          // 1s progress interval
    '--console-log-level=warn',
    '--allow-overwrite=true',
    '--auto-file-renaming=false',
    '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  ];

  if (referer) {
    args.push(`--header=Referer: ${referer}`);
  }

  // Forward session cookies from Electron session so the host CDN validates the request
  try {
    const cookies = await session.defaultSession.cookies.get({ url: rawUrl });
    if (cookies && cookies.length > 0) {
      const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
      args.push(`--header=Cookie: ${cookieStr}`);
    }
  } catch (err) {
    console.warn('[Aria2] Could not fetch session cookies:', err.message);
  }

  const appSet = getAppSettings();
  if (appSet.maxDownloadSpeed && Number(appSet.maxDownloadSpeed) > 0) {
    args.push(`--max-download-limit=${Math.round(Number(appSet.maxDownloadSpeed))}`);
  }

  args.push(rawUrl);

  const aria2Process = spawn(aria2Executable, args, {
    windowsHide: true
  });

  const downloadState = {
    process: aria2Process,
    game,
    filename,
    installDir: targetDir,
    percent: 0,
    speed: '',
    eta: '',
    downloaded: '0 MB',
    totalSize: game.size || 'Unknown',
    status: 'downloading'
  };
  activeDownloads.set(game.id, downloadState);

  // Send initial downloading event
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      gameId: game.id,
      percent: 0,
      speed: 'Connecting...',
      eta: 'Calculating...',
      downloaded: '0 MB',
      totalSize: game.size || 'Unknown',
      status: 'downloading',
      filename,
      installDir: targetDir
    });
  }

  // Regex matching: [#gid 1.2GiB/72.6GiB(1%) CN:16 DL:24.5MiB ETA:48m20s]
  const progressRegex = /\[#\w+\s+([^\s/]+)\/([^\s(]+)(?:\((\d+)%\))?.*?DL:([^\s\]]+)(?:\s+ETA:([^\]]+))?\]/;

  let lastEmission = 0;
  let stdoutBuffer = '';
  aria2Process.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/[\r\n]+/);
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const m = line.match(progressRegex);
      if (m) {
        let pct = parseInt(m[3] || '0', 10);
        const rawSpeed = m[4] || '';
        const speed = rawSpeed.replace('iB', 'B') + '/s';
        const eta = m[5] || '';
        const downloaded = (m[1] || '').replace('iB', 'B');
        const totalSize = (m[2] || '').replace('iB', 'B');

        const downBytes = parseSizeToBytes(downloaded);
        const totBytes = parseSizeToBytes(totalSize);
        if (totBytes > 0 && downBytes > 0) {
          const computedPct = Math.min(99, Math.floor((downBytes / totBytes) * 100));
          if (computedPct > pct) pct = computedPct;
        }

        downloadState.percent = pct;
        downloadState.speed = speed;
        downloadState.eta = eta;
        downloadState.downloaded = downloaded;
        downloadState.totalSize = totalSize;

        const now = Date.now();
        if (now - lastEmission >= 250 || pct === 100) {
          lastEmission = now;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', {
              gameId: game.id,
              percent: pct,
              speed,
              eta,
              downloaded,
              totalSize,
              status: 'downloading',
              filename,
              installDir: targetDir
            });
          }
        }
      }
    }
  });

  aria2Process.stderr.on('data', (chunk) => {
    console.error(`[Aria2 Stderr] ${chunk.toString().trim()}`);
  });

  aria2Process.on('close', async (code) => {
    console.log(`[Aria2] Download process exited with code ${code} for: ${game.title}`);

    if (code === 0) {
      console.log(`[Aria2] ✅ Download 100% COMPLETE for: ${game.title}`);

      let downloadedArchive = path.join(targetDir, filename);
      let isArchive = /\.(zip|rar|7z|tar|gz|bz2|xz|iso)$/i.test(filename);

      if (!fs.existsSync(downloadedArchive)) {
        try {
          const decoded = decodeURIComponent(filename);
          if (fs.existsSync(path.join(targetDir, decoded))) {
            downloadedArchive = path.join(targetDir, decoded);
            isArchive = /\.(zip|rar|7z|tar|gz|bz2|xz|iso)$/i.test(decoded);
          } else {
            // Check if there is an archive file in targetDir
            const files = fs.readdirSync(targetDir);
            const found = files.find(f => /\.(zip|rar|7z|tar|gz|bz2|xz|iso)$/i.test(f) && !f.endsWith('.aria2'));
            if (found) {
              downloadedArchive = path.join(targetDir, found);
              isArchive = true;
            }
          }
        } catch (e) {}
      }

      if (isArchive && fs.existsSync(downloadedArchive)) {
        downloadState.status = 'extracting';
        const cleanTitle = (game.title || path.basename(downloadedArchive, path.extname(downloadedArchive)))
          .replace(/[\\/:*?"<>|]/g, '')
          .replace(/Free Download.*$/i, '')
          .replace(/-SteamRIP.*$/i, '')
          .trim() || 'Game';

        const gameExtractDir = path.join(targetDir, cleanTitle);

        console.log(`[Extraction] Unpacking archive ${path.basename(downloadedArchive)} into ${gameExtractDir}...`);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            gameId: game.id,
            percent: 0,
            speed: 'Extracting files...',
            eta: '7-Zip Multi-Threaded Unpack',
            downloaded: downloadState.totalSize || '',
            totalSize: downloadState.totalSize || '',
            status: 'extracting',
            filename,
            installDir: gameExtractDir
          });
        }

        const extractResult = await extractArchiveFast(
          downloadedArchive,
          gameExtractDir,
          game,
          (pct) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('download-progress', {
                gameId: game.id,
                percent: pct,
                speed: 'Extracting (7-Zip)',
                eta: `${pct}% extracted`,
                downloaded: downloadState.totalSize || '',
                totalSize: downloadState.totalSize || '',
                status: 'extracting',
                filename,
                installDir: gameExtractDir
              });
            }
          }
        );

        if (extractResult.success) {
          // Delete downloaded archive and companion .aria2 file to free disk space immediately
          try {
            console.log(`[Cleaner] 🗑️ Deleting downloaded archive: ${downloadedArchive}`);
            if (fs.existsSync(downloadedArchive)) fs.unlinkSync(downloadedArchive);
            const aria2Control = `${downloadedArchive}.aria2`;
            if (fs.existsSync(aria2Control)) fs.unlinkSync(aria2Control);
          } catch (cleanErr) {
            console.warn('[Cleaner] Could not delete archive:', cleanErr.message);
          }

          // Search for primary game executable
          const exePath = findGameExecutable(gameExtractDir, cleanTitle);
          const finalFilePath = exePath || gameExtractDir;
          const finalSize = getDirectorySize(gameExtractDir);
          const formattedSize = (finalSize / (1024 ** 3) >= 1)
            ? (finalSize / (1024 ** 3)).toFixed(2) + ' GB'
            : (finalSize / (1024 ** 2)).toFixed(1) + ' MB';

          console.log(`[Game Ready] 🎮 Game installed and ready: ${finalFilePath}`);
          activeDownloads.delete(game.id);

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', {
              gameId: game.id,
              percent: 100,
              speed: '',
              eta: 'Ready to Play',
              downloaded: formattedSize,
              totalSize: formattedSize,
              status: 'completed',
              filename: cleanTitle,
              installDir: gameExtractDir,
              filePath: finalFilePath,
              exePath: exePath || null
            });
          }
          showNativeNotification('Game Ready to Play! 🎉', `"${cleanTitle}" has been extracted and is ready to launch!`);
          runPostExtractionPipeline(game, gameExtractDir, exePath).catch(err => {
            console.warn('[Post-Extraction] Pipeline error:', err.message);
          });
          return;
        } else {
          console.error(`[Extraction] ❌ Failed to extract archive for: ${game.title}`);
          activeDownloads.delete(game.id);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', {
              gameId: game.id,
              percent: 100,
              speed: '',
              eta: 'Extraction failed',
              status: 'failed',
              filename,
              installDir: targetDir,
              filePath: downloadedArchive
            });
          }
          return;
        }
      }

      // If not an archive, mark completed normally
      activeDownloads.delete(game.id);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          gameId: game.id,
          percent: 100,
          speed: '',
          eta: '',
          downloaded: downloadState.totalSize || '',
          totalSize: downloadState.totalSize || '',
          status: 'completed',
          filename,
          installDir: targetDir,
          filePath: path.join(targetDir, filename)
        });
      }
      showNativeNotification('Download Complete! 🚀', `Finished downloading "${filename}".`);
    } else {
      activeDownloads.delete(game.id);
      if (downloadState.status !== 'cancelled') {
        console.error(`[Aria2] ❌ Download ended with exit code: ${code}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            gameId: game.id,
            percent: downloadState.percent || 0,
            speed: '',
            eta: '',
            status: 'failed',
            filename,
            installDir: targetDir
          });
        }
      }
    }
  });

  aria2Process.on('error', (err) => {
    console.error('[Aria2] Failed to spawn aria2 process:', err);
    activeDownloads.delete(game.id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        gameId: game.id,
        percent: 0,
        speed: '',
        eta: '',
        status: 'failed',
        filename,
        installDir: targetDir
      });
    }
  });
}

// Active background resolvers map (for in-flight Chromium windows / auto-clickers)
const activeResolvers = new Map();

function cleanupActiveGameOperation(gameId) {
  if (!gameId) return;

  // Clean up any in-flight resolver window or bypass auto-clicker
  if (activeResolvers.has(gameId)) {
    const resolverCleanup = activeResolvers.get(gameId);
    if (typeof resolverCleanup === 'function') {
      try { resolverCleanup(); } catch (e) {}
    }
    activeResolvers.delete(gameId);
  }

  // Clean up any active download / aria2 / extraction process
  if (activeDownloads.has(gameId)) {
    const dl = activeDownloads.get(gameId);
    try {
      if (dl.process) dl.process.kill();
    } catch (e) {}
    try {
      if (dl.extractProcess) dl.extractProcess.kill();
    } catch (e) {}
    activeDownloads.delete(gameId);
  }
}

// Download IPC endpoints
ipcMain.on('start-download', async (event, game) => {
  if (!game || !game.id) {
    console.error('[Backend] start-download called with invalid game object:', game);
    return;
  }

  console.log('[Backend] Requested download for:', game.title, 'Source:', game.source, 'Slug:', game.slug);

  // Clean up any prior stuck or running process for this game before starting
  cleanupActiveGameOperation(game.id);

  if ((game.id && (game.id.startsWith('fg-') || game.id.startsWith('of-') || game.id.startsWith('dodi-'))) || 
      game.source === 'fitgirl' || game.source === 'onlinefix' || game.source === 'dodi' || 
      (game.slug && game.slug.startsWith('magnet:')) || 
      (game.uris && game.uris.length > 0)) {
    if (game.source !== 'onlinefix' && game.source !== 'dodi') {
      if (game.id && game.id.startsWith('of-')) {
        game.source = 'onlinefix';
      } else if (game.id && game.id.startsWith('dodi-')) {
        game.source = 'dodi';
      } else {
        game.source = 'fitgirl';
      }
    }
    await startTorrentDownload(game);
    return;
  }

  if ((game.id && game.id.startsWith('su-')) || game.source === 'steamunlocked') {
    game.source = 'steamunlocked';
    if (!game.slug) {
      game.slug = `https://steamunlocked.org/${game.id.replace(/^su-/, '')}/`;
    }
    await startSteamUnlockedDownload(game);
    return;
  }

  if (!game.slug) {
    game.slug = game.id.replace(/^su-/, '');
  }
  game.source = 'steamrip';
  await startSteamRipDownload(game);
});

ipcMain.on('cancel-download', (event, gameId) => {
  console.log('[Backend] Cancelling download/extraction for game:', gameId);
  cleanupActiveGameOperation(gameId);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      gameId,
      percent: 0,
      speed: '',
      eta: '',
      status: 'cancelled'
    });
  }
});

ipcMain.on('open-magnet-link', (event, uri) => {
  if (uri && typeof uri === 'string' && uri.startsWith('magnet:')) {
    console.log('[Backend] Opening magnet link with external system handler:', uri.substring(0, 60) + '...');
    shell.openExternal(uri);
  }
});

ipcMain.on('open-downloads-folder', (event, folderPath) => {
  const target = folderPath && fs.existsSync(folderPath) ? folderPath : DOWNLOAD_DIR;
  shell.openPath(target);
});

ipcMain.on('open-file-location', (event, opts) => {
  let target = DOWNLOAD_DIR;
  if (typeof opts === 'object' && opts !== null) {
    if (opts.filePath && fs.existsSync(opts.filePath)) {
      target = opts.filePath;
    } else if (opts.installDir && fs.existsSync(opts.installDir)) {
      target = opts.installDir;
    } else {
      const dir = opts.installDir || DOWNLOAD_DIR;
      target = opts.filename ? path.join(dir, opts.filename) : dir;
    }
  } else if (typeof opts === 'string') {
    target = path.join(DOWNLOAD_DIR, opts);
  }

  if (fs.existsSync(target)) {
    shell.showItemInFolder(target);
  } else {
    const parentDir = typeof opts === 'object' && opts?.installDir ? opts.installDir : DOWNLOAD_DIR;
    shell.openPath(fs.existsSync(parentDir) ? parentDir : DOWNLOAD_DIR);
  }
});

// Check disk status of downloaded games (Live integrity tracking)
ipcMain.handle('check-files-exist', async (event, items) => {
  if (!Array.isArray(items)) return {};
  const results = {};
  for (const item of items) {
    if (!item || !item.id) continue;
    let resolved = null;
    let exePath = item.exePath || null;
    const cleanTitle = (item.title || item.filename || '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/Free Download.*$/i, '')
      .replace(/-SteamRIP.*$/i, '')
      .trim();

    if (item.filePath && fs.existsSync(item.filePath)) {
      resolved = item.filePath;
    } else if (item.installDir && cleanTitle && fs.existsSync(path.join(item.installDir, cleanTitle))) {
      resolved = path.join(item.installDir, cleanTitle);
    } else if (item.installDir && fs.existsSync(item.installDir) && !item.installDir.endsWith('Charon Games')) {
      resolved = item.installDir;
    } else if (item.installDir && item.filename) {
      const candidate = path.join(item.installDir, item.filename);
      if (fs.existsSync(candidate)) resolved = candidate;
    } else if (item.filename) {
      const candidate = path.join(DOWNLOAD_DIR, item.filename);
      if (fs.existsSync(candidate)) resolved = candidate;
    }

    if (resolved) {
      try {
        const stat = fs.statSync(resolved);
        const isDir = stat.isDirectory();
        if (isDir && (!exePath || !fs.existsSync(exePath))) {
          exePath = findGameExecutable(resolved, cleanTitle);
        }
        const isArchive = !isDir && /\.(zip|rar|7z|tar|gz|bz2|xz|iso)$/i.test(resolved);
        const sizeBytes = isDir ? getDirectorySize(resolved) : stat.size;
        results[item.id] = {
          exists: true,
          sizeBytes,
          sizeFormatted: (sizeBytes / (1024 ** 3) >= 1) 
            ? (sizeBytes / (1024 ** 3)).toFixed(2) + ' GB' 
            : (sizeBytes / (1024 ** 2)).toFixed(1) + ' MB',
          path: resolved,
          exePath,
          isDirectory: isDir,
          isArchive
        };
      } catch (e) {
        results[item.id] = { exists: false };
      }
    } else {
      results[item.id] = { exists: false };
    }
  }
  return results;
});

// Delete a downloaded game from disk and/or remove from history
ipcMain.handle('delete-downloaded-game', async (event, opts) => {
  const { id, filename, installDir, filePath, deleteFromDisk } = opts || {};
  let freedBytes = 0;
  let deletedPath = null;

  if (deleteFromDisk) {
    let target = null;
    if (installDir && fs.existsSync(installDir) && installDir !== DOWNLOAD_DIR && !installDir.endsWith('Charon Games')) {
      target = installDir;
    } else if (filePath && fs.existsSync(filePath)) {
      target = filePath;
    } else if (installDir && filename) {
      const candidate = path.join(installDir, filename);
      if (fs.existsSync(candidate)) target = candidate;
    } else if (filename) {
      const candidate = path.join(DOWNLOAD_DIR, filename);
      if (fs.existsSync(candidate)) target = candidate;
    }

    if (target && fs.existsSync(target)) {
      try {
        const stat = fs.statSync(target);
        if (stat.isDirectory()) {
          freedBytes = getDirectorySize(target);
          fs.rmSync(target, { recursive: true, force: true });
        } else {
          freedBytes = stat.size;
          fs.unlinkSync(target);
        }
        deletedPath = target;
        console.log(`[Backend] Deleted game target from disk: ${target} (${freedBytes} bytes freed)`);

        // Check if companion aria2 control file exists (.aria2) and clean it up too
        const aria2Control = `${target}.aria2`;
        if (fs.existsSync(aria2Control)) {
          try { fs.unlinkSync(aria2Control); } catch (e) {}
        }
      } catch (err) {
        console.error(`[Backend] Failed to delete target ${target}:`, err);
        return { success: false, error: err.message };
      }
    }
  }

  return {
    success: true,
    id,
    deletedPath,
    freedBytes
  };
});

// Launch or open game executable / archive with default OS handler
ipcMain.handle('open-or-run-game', async (event, opts) => {
  let target = null;
  let gameTitle = '';
  let launchArgs = null;

  if (typeof opts === 'object' && opts !== null) {
    gameTitle = opts.title || opts.filename || '';

    // Check per-game config for custom executable and launch args
    const gameConfig = opts.id ? getGameConfig(opts.id) : null;
    if (gameConfig) {
      if (gameConfig.customExePath && fs.existsSync(gameConfig.customExePath)) {
        target = gameConfig.customExePath;
        console.log(`[Backend] Using custom executable from per-game config: ${target}`);
      }
      if (gameConfig.launchArgs) {
        launchArgs = gameConfig.launchArgs;
      }
    }

    // Standard resolution fallback if no custom config
    if (!target) {
      if (opts.exePath && fs.existsSync(opts.exePath)) {
        target = opts.exePath;
      } else if (opts.filePath && fs.existsSync(opts.filePath)) {
        target = opts.filePath;
      } else if (opts.installDir && fs.existsSync(opts.installDir)) {
        target = opts.installDir;
      } else if (opts.filename) {
        const candidate = path.join(DOWNLOAD_DIR, opts.filename);
        if (fs.existsSync(candidate)) target = candidate;
      }
    }
  } else if (typeof opts === 'string') {
    target = path.join(DOWNLOAD_DIR, opts);
  }

  // Helper: launch exe with optional arguments using spawn (for proper cwd + args)
  const launchExecutable = async (exePath, title, id, steamAppId) => {
    trackGameSession(id || title, title, exePath, steamAppId);
    if (launchArgs && launchArgs.trim()) {
      const args = launchArgs.trim().split(/\s+/);
      console.log(`[Backend] Launching with args: ${exePath} ${args.join(' ')}`);
      try {
        const child = spawn(exePath, args, {
          cwd: path.dirname(exePath),
          detached: true,
          stdio: 'ignore',
          windowsHide: false
        });
        child.unref();
        return { success: true, exePath, launchArgs: launchArgs.trim() };
      } catch (e) {
        console.error('[Backend] spawn failed, falling back to shell.openPath:', e.message);
        const res = await shell.openPath(exePath);
        return { success: !res, error: res, exePath };
      }
    } else {
      const res = await shell.openPath(exePath);
      return { success: !res, error: res, exePath };
    }
  };

  if (target && fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const exe = findGameExecutable(target, gameTitle);
      if (exe && fs.existsSync(exe)) {
        console.log(`[Backend] Launching primary game executable: ${exe}`);
        return await launchExecutable(exe, gameTitle, opts?.id, opts?.steamAppId);
      }
    }

    const isArchive = /\.(zip|rar|7z|tar|gz|bz2|xz|iso)$/i.test(target);
    if (isArchive) {
      console.log(`[Backend] Target is an unextracted archive: ${target}. Automatically extracting with 7-Zip...`);
      const parentDir = path.dirname(target);
      const cleanTitle = (gameTitle || path.basename(target, path.extname(target)))
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/Free Download.*$/i, '')
        .replace(/-SteamRIP.*$/i, '')
        .trim() || 'Game';
      const gameExtractDir = path.join(parentDir, cleanTitle);

      const extractResult = await extractArchiveFast(
        target,
        gameExtractDir,
        { title: cleanTitle, id: (typeof opts === 'object' && opts?.id) || 'game' },
        (pct) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', {
              gameId: (typeof opts === 'object' && opts?.id) || null,
              percent: pct,
              speed: 'Extracting (7-Zip)',
              eta: `${pct}% extracted`,
              status: 'extracting',
              filename: path.basename(target),
              installDir: gameExtractDir
            });
          }
        }
      );

      if (extractResult.success) {
        try {
          if (fs.existsSync(target)) fs.unlinkSync(target);
          const aria2Control = `${target}.aria2`;
          if (fs.existsSync(aria2Control)) fs.unlinkSync(aria2Control);
        } catch (e) {}

        const exe = findGameExecutable(gameExtractDir, cleanTitle);
        const finalPath = exe || gameExtractDir;
        const finalSize = getDirectorySize(gameExtractDir);
        const formattedSize = (finalSize / (1024 ** 3) >= 1)
          ? (finalSize / (1024 ** 3)).toFixed(2) + ' GB'
          : (finalSize / (1024 ** 2)).toFixed(1) + ' MB';

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            gameId: (typeof opts === 'object' && opts?.id) || null,
            percent: 100,
            speed: '',
            eta: 'Ready to Play',
            downloaded: formattedSize,
            totalSize: formattedSize,
            status: 'completed',
            filename: cleanTitle,
            installDir: gameExtractDir,
            filePath: finalPath,
            exePath: exe || null
          });
        }

        runPostExtractionPipeline({ ...(typeof opts === 'object' ? opts : {}), title: cleanTitle }, gameExtractDir, exe).catch(err => {
          console.warn('[Post-Extraction] Pipeline error:', err.message);
        });

        if (exe && fs.existsSync(exe)) {
          console.log(`[Backend] Launching primary game executable: ${exe}`);
          return await launchExecutable(exe, cleanTitle, opts?.id, opts?.steamAppId);
        } else {
          console.log(`[Backend] Opening game directory: ${gameExtractDir}`);
          const res = await shell.openPath(gameExtractDir);
          return { success: !res, error: res };
        }
      }
    }

    if (/\.(exe|lnk)$/i.test(target)) {
      console.log(`[Backend] Launching executable target: ${target}`);
      return await launchExecutable(target, gameTitle, opts?.id, opts?.steamAppId);
    } else {
      console.log(`[Backend] Launching/Opening target: ${target}`);
    }
    const res = await shell.openPath(target);
    return { success: !res, error: res, exePath: /\.(exe|lnk)$/i.test(target) ? target : undefined };
  } else {
    return { success: false, error: 'Target not found on disk' };
  }
});

// Dedicated archive extractor IPC endpoint
ipcMain.handle('extract-game-archive', async (event, opts) => {
  const { id, title, targetPath, installDir } = opts || {};
  let archivePath = targetPath;
  if (!archivePath && installDir && opts.filename) {
    archivePath = path.join(installDir, opts.filename);
  }
  if (!archivePath || !fs.existsSync(archivePath)) {
    return { success: false, error: 'Archive file not found' };
  }

  const parentDir = installDir || path.dirname(archivePath);
  const cleanTitle = (title || path.basename(archivePath, path.extname(archivePath)))
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/Free Download.*$/i, '')
    .replace(/-SteamRIP.*$/i, '')
    .trim() || 'Game';
  const gameExtractDir = path.join(parentDir, cleanTitle);

  const extractResult = await extractArchiveFast(
    archivePath,
    gameExtractDir,
    { title: cleanTitle, id },
    (pct) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          gameId: id,
          percent: pct,
          speed: 'Extracting (7-Zip)',
          eta: `${pct}% extracted`,
          status: 'extracting',
          filename: path.basename(archivePath),
          installDir: gameExtractDir
        });
      }
    }
  );

  if (extractResult.success) {
    try {
      if (fs.existsSync(archivePath)) fs.unlinkSync(archivePath);
      const aria2Control = `${archivePath}.aria2`;
      if (fs.existsSync(aria2Control)) fs.unlinkSync(aria2Control);
    } catch (e) {}

    const exe = findGameExecutable(gameExtractDir, cleanTitle);
    const finalPath = exe || gameExtractDir;
    const finalSize = getDirectorySize(gameExtractDir);
    const formattedSize = (finalSize / (1024 ** 3) >= 1)
      ? (finalSize / (1024 ** 3)).toFixed(2) + ' GB'
      : (finalSize / (1024 ** 2)).toFixed(1) + ' MB';

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        gameId: id,
        percent: 100,
        speed: '',
        eta: 'Ready to Play',
        downloaded: formattedSize,
        totalSize: formattedSize,
        status: 'completed',
        filename: cleanTitle,
        installDir: gameExtractDir,
        filePath: finalPath,
        exePath: exe || null
      });
    }

    runPostExtractionPipeline({ id, title: cleanTitle }, gameExtractDir, exe).catch(err => {
      console.warn('[Post-Extraction] Pipeline error:', err.message);
    });

    return { success: true, exePath: exe, installDir: gameExtractDir, totalSize: formattedSize };
  } else {
    return { success: false, error: 'Extraction failed' };
  }
});

// ==========================================================
// STEAMRIP & BUZZHEAVIER RESOLVER
// ==========================================================
function resolveViaRelay(slug) {
  return new Promise((resolve) => {
    const relayUrl = 'https://relay.vyro.workers.dev/api/resolve/' + encodeURIComponent(slug);
    console.log('[Backend] Querying Relay Cloud backend:', relayUrl);

    const req = https.get(relayUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.success && json.data?.downloadUrl) {
            return resolve(json.data.downloadUrl);
          }
        } catch (e) {}
        resolve(null);
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      try { req.destroy(); } catch (e) {}
      resolve(null);
    });
  });
}

async function startSteamRipDownload(game) {
  const slug = game.slug || (game.id ? game.id.replace(/^su-/, '') : '');
  console.log('[Backend] Requested download for:', game.title, 'Slug:', slug);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      gameId: game.id,
      percent: 0,
      speed: 'Connecting...',
      eta: 'Querying Relay Cloud...',
      status: 'downloading'
    });
  }

  // 1. Primary: Query the relay.vyro Cloudflare backend
  try {
    const cloudMirror = await resolveViaRelay(slug);
    if (cloudMirror) {
      console.log('[Backend] ✅ Relay Cloud returned mirror URL:', cloudMirror);
      startBypass(cloudMirror, game);
      return;
    }
  } catch (err) {
    console.warn('[Backend] Relay query exception:', err.message);
  }

  // 2. Fallback: If Relay misses or times out, resolve directly via Chromium
  console.log('[Backend] Relay returned no link. Using native in-app Chromium resolver fallback for:', game.title);
  startSteamRipDirectResolve(game);
}

async function startSteamRipDirectResolve(game) {
  const slug = game.slug || (game.id ? game.id.replace(/^su-/, '') : '');
  if (!slug) {
    console.error('[Backend] SteamRIP direct resolve: Missing slug for game:', game);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        gameId: game.id,
        percent: 0,
        speed: '',
        eta: 'Invalid game slug',
        status: 'failed'
      });
    }
    return;
  }
  const gamePageUrl = (slug && slug.startsWith('http')) ? slug : `https://steamrip.com/${(slug || '').replace(/^\/+|\/+$/g, '')}/`;
  console.log('[Backend] Resolving SteamRIP download directly for:', game.title, 'URL:', gamePageUrl);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      gameId: game.id,
      percent: 0,
      speed: 'Connecting...',
      eta: 'Resolving mirror...',
      status: 'downloading'
    });
  }

  const resolveWin = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  resolveWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  let resolved = false;
  let pollInterval = null;

  const cleanup = () => {
    activeResolvers.delete(game.id);
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    try {
      if (!resolveWin.isDestroyed()) resolveWin.destroy();
    } catch (e) {}
  };

  activeResolvers.set(game.id, cleanup);

  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      console.error('[Backend] SteamRIP resolution timed out for:', game.title);
      cleanup();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          gameId: game.id,
          percent: 0,
          speed: '',
          eta: 'Mirror lookup timed out',
          status: 'failed'
        });
      }
    }
  }, 35000);

  pollInterval = setInterval(async () => {
    if (resolved || resolveWin.isDestroyed()) {
      cleanup();
      return;
    }

    try {
      const data = await resolveWin.webContents.executeJavaScript(`
        (function() {
          const title = document.title || '';
          if (title.includes('Just a moment') || title.includes('Attention Required') || title.includes('security')) {
            return { cf: true };
          }
          const links = Array.from(document.querySelectorAll('a.shortc-button, a[href*="buzzheavier"], a[href*="bzzhr"], a[href*="megadb"], a[href*="qiwi"], a[href*="1fichier"]'))
            .map(a => a.href)
            .filter(h => h && !h.startsWith('#') && !h.startsWith('javascript:'));
          return { cf: false, links };
        })()
      `);

      if (data && !data.cf && data.links && data.links.length > 0) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();

        const mirrorUrl = data.links.find(u => u.includes('bzzhr.to') || u.includes('buzzheavier.com')) || data.links[0];
        console.log('[Backend] Extracted SteamRIP mirror URL for', game.title, ':', mirrorUrl);
        startBypass(mirrorUrl, game, gamePageUrl);
      }
    } catch (err) {
      // Ignored during page navigation
    }
  }, 1000);

  resolveWin.loadURL(gamePageUrl, {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
}

// ==========================================================
// STEAMUNLOCKED & UPLOADHAVEN BYPASS
// ==========================================================
async function startSteamUnlockedDownload(game) {
  const targetUrl = game.slug || (game.id && game.id.startsWith('su-') ? `https://steamunlocked.org/${game.id.replace(/^su-/, '')}/` : null);
  if (!targetUrl) {
    console.error('[Backend] SteamUnlocked: Could not determine URL for game:', game);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        gameId: game.id,
        percent: 0,
        speed: '',
        eta: 'Invalid game URL',
        status: 'failed'
      });
    }
    return;
  }
  game.slug = targetUrl;
  console.log('[Backend] Fetching SteamUnlocked game page:', targetUrl);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      gameId: game.id,
      percent: 0,
      speed: 'Connecting...',
      eta: 'Resolving mirror...',
      status: 'downloading'
    });
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  let resolved = false;
  let pollInterval = null;

  const cleanup = () => {
    activeResolvers.delete(game.id);
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch (e) {}
  };

  activeResolvers.set(game.id, cleanup);

  const timeout = setTimeout(() => {
    if (!resolved) {
      resolved = true;
      console.error('[Backend] SteamUnlocked resolution timed out for:', game.title);
      cleanup();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          gameId: game.id,
          percent: 0,
          speed: '',
          eta: 'Mirror lookup timed out',
          status: 'failed'
        });
      }
    }
  }, 35000);

  pollInterval = setInterval(async () => {
    if (resolved || win.isDestroyed()) {
      cleanup();
      return;
    }

    try {
      const data = await win.webContents.executeJavaScript(`
        (function() {
          const title = document.title || '';
          if (title.includes('Just a moment') || title.includes('Attention Required') || title.includes('security')) {
            return { cf: true };
          }
          const a = document.querySelector('a[href*="uploadhaven.com/download/"]');
          return { cf: false, href: a ? a.href : null };
        })()
      `);

      if (data && !data.cf && data.href) {
        resolved = true;
        clearTimeout(timeout);
        cleanup();
        console.log('[Backend] Extracted UploadHaven URL for', game.title, ':', data.href);
        startUploadHavenBypass(data.href, game);
      }
    } catch (err) {
      // Navigation
    }
  }, 1000);

  win.loadURL(targetUrl, {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
}

// ==========================================================
// BITTORRENT ENGINE (ARIA2 MULTI-THREADED TORRENT & MAGNET)
// ==========================================================

async function startTorrentDownload(game) {
  if (!game || !game.id) return;
  const rawUri = (game.uris && game.uris[0]) || (game.slug && game.slug.startsWith('magnet:') ? game.slug : '');
  if (!rawUri || !rawUri.startsWith('magnet:')) {
    console.error('[Torrent] Invalid or missing magnet URI for game:', game);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        gameId: game.id,
        percent: 0,
        speed: '',
        eta: 'Invalid magnet link',
        status: 'failed'
      });
    }
    return;
  }

  const cleanTitle = (game.title || 'Game')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim() || 'Game';

  const defaultD = DOWNLOAD_DIR;
  const baseDir = (game.installDir && game.installDir !== DOWNLOAD_DIR) ? game.installDir : defaultD;
  const targetDir = path.join(baseDir, cleanTitle);

  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
  } catch (err) {
    console.warn('[Torrent] Could not create targetDir:', err.message);
  }

  if (activeDownloads.has(game.id)) {
    console.log(`[Aria2 Torrent] Replacing active download instance for: ${game.title}`);
    const prev = activeDownloads.get(game.id);
    try { if (prev.process) prev.process.kill(); } catch (e) {}
    activeDownloads.delete(game.id);
  }

  const aria2Executable = getAria2Path();
  console.log(`[Aria2 Torrent] Engine binary path: ${aria2Executable}`);

  const TURBO_TRACKERS = [
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'udp://opentracker.i2p.rocks:6969/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'http://tracker.openbittorrent.com:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://explodie.org:6969/announce',
    'udp://tracker.cyberia.is:6969/announce',
    'udp://p4p.arenabg.com:1337/announce',
    'udp://tracker.tiny-vps.com:6969/announce',
    'udp://tracker.moeking.me:6969/announce',
    'udp://tracker.bittor.pw:1337/announce',
    'udp://tracker.theoks.net:6969/announce',
    'udp://movies.zsw.ca:6969/announce',
    'udp://tracker.dump.cl:6969/announce',
    'udp://retracker.lanta-net.ru:2710/announce',
    'udp://bt1.archive.org:6969/announce'
  ].join(',');

  const args = [
    '--dir=' + targetDir,
    '--continue=true',               // Resume capability (.aria2 control files)
    '--seed-time=0',                 // Stop seeding immediately once download completes
    '--bt-stop-timeout=300',         // 5 min timeout if inactive
    '--enable-dht=true',             // Distributed Hash Table peer discovery
    '--enable-dht6=true',            // IPv6 DHT
    '--bt-enable-lpd=true',          // Local Peer Discovery
    '--enable-peer-exchange=true',   // PEX peer discovery extension
    '--dht-entry-point=dht.transmissionbt.com:6881',
    '--dht-listen-port=6881-6999',
    '--listen-port=6881-6999',
    '--follow-torrent=mem',          // Process magnet metadata in memory and download files directly
    '--file-allocation=none',        // Instant start without freezing disk
    '--disk-cache=128M',             // High-throughput 128MB RAM write buffer
    '--socket-recv-buffer-size=4M',  // 4MB TCP receive buffer (bypasses Windows 64KB TCP window cap)
    '--enable-mmap=true',            // Direct memory-mapped file I/O
    '--bt-max-peers=300',            // Max 300 active peers/seeders (up from 55)
    '--bt-request-peer-speed-limit=100M', // Aggressively rotate and request peers for max bandwidth
    '--bt-tracker-connect-timeout=10',
    '--bt-tracker-timeout=15',
    '--bt-min-crypto-level=plain',   // Allow all peers (encrypted + non-encrypted)
    '--peer-id-prefix=-qB4650-',     // Identify as qBittorrent 4.6.5 for seedbox priority
    '--user-agent=qBittorrent/4.6.5',
    '--summary-interval=1',
    '--console-log-level=warn',
    '--bt-tracker=' + TURBO_TRACKERS,
    rawUri
  ];

  const aria2Process = spawn(aria2Executable, args, {
    windowsHide: true
  });

  const downloadState = {
    process: aria2Process,
    game,
    filename: cleanTitle,
    installDir: targetDir,
    percent: 0,
    speed: '',
    eta: 'Connecting to BitTorrent peers...',
    downloaded: '0 MB',
    totalSize: game.size || 'Unknown',
    status: 'downloading'
  };
  activeDownloads.set(game.id, downloadState);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      gameId: game.id,
      percent: 0,
      speed: 'Connecting...',
      eta: 'Querying DHT & Trackers...',
      downloaded: '0 MB',
      totalSize: game.size || 'Unknown',
      status: 'downloading',
      filename: cleanTitle,
      installDir: targetDir
    });
  }

  const progressRegex = /\[#\w+\s+([^\s/]+)\/([^\s(]+)(?:\((\d+)%\))?.*?DL:([^\s\]]+)(?:\s+ETA:([^\]]+))?\]/;
  let lastEmission = 0;
  let stdoutBuffer = '';

  aria2Process.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/[\r\n]+/);
    stdoutBuffer = lines.pop() || '';

    for (const line of lines) {
      const m = line.match(progressRegex);
      if (m) {
        let pct = parseInt(m[3] || '0', 10);
        const rawSpeed = m[4] || '';
        const speed = rawSpeed.replace('iB', 'B') + '/s';
        let eta = m[5] || '';
        const downloaded = (m[1] || '').replace('iB', 'B');
        const totalSize = (m[2] || '').replace('iB', 'B');

        const downBytes = parseSizeToBytes(downloaded);
        const totBytes = parseSizeToBytes(totalSize);
        if (totBytes > 0 && downBytes > 0) {
          const computedPct = Math.min(99, Math.floor((downBytes / totBytes) * 100));
          if (computedPct > pct) pct = computedPct;
        }

        if (!eta && (totalSize === '0B' || pct === 0)) {
          eta = 'Fetching torrent metadata...';
        }

        downloadState.percent = pct;
        downloadState.speed = speed;
        downloadState.eta = eta;
        downloadState.downloaded = downloaded;
        if (totalSize && totalSize !== '0B') {
          downloadState.totalSize = totalSize;
        }

        const now = Date.now();
        if (now - lastEmission >= 250 || pct === 100) {
          lastEmission = now;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('download-progress', {
              gameId: game.id,
              percent: pct,
              speed,
              eta,
              downloaded,
              totalSize: downloadState.totalSize,
              status: 'downloading',
              filename: cleanTitle,
              installDir: targetDir
            });
          }
        }
      }
    }
  });

  aria2Process.stderr.on('data', (chunk) => {
    console.error(`[Aria2 Torrent Stderr] ${chunk.toString().trim()}`);
  });

  aria2Process.on('close', async (code) => {
    console.log(`[Aria2 Torrent] Exited with code ${code} for: ${game.title}`);
    activeDownloads.delete(game.id);

    if (code === 0) {
      const exePath = findGameExecutable(targetDir, cleanTitle);
      const finalFilePath = exePath || targetDir;
      const finalSize = getDirectorySize(targetDir);
      const formattedSize = (finalSize / (1024 ** 3) >= 1)
        ? (finalSize / (1024 ** 3)).toFixed(2) + ' GB'
        : (finalSize / (1024 ** 2)).toFixed(1) + ' MB';

      console.log(`[Torrent Ready] 🎮 Torrent download ready: ${finalFilePath}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          gameId: game.id,
          percent: 100,
          speed: '',
          eta: 'Ready to Install / Play',
          downloaded: formattedSize,
          totalSize: formattedSize,
          status: 'completed',
          filename: cleanTitle,
          installDir: targetDir,
          filePath: finalFilePath,
          exePath: exePath || null
        });
      }
    } else {
      if (downloadState.status !== 'cancelled') {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('download-progress', {
            gameId: game.id,
            percent: downloadState.percent || 0,
            speed: '',
            eta: '',
            status: 'failed',
            filename: cleanTitle,
            installDir: targetDir
          });
        }
      }
    }
  });

  aria2Process.on('error', (err) => {
    console.error('[Aria2 Torrent Process Error]:', err);
    activeDownloads.delete(game.id);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('download-progress', {
        gameId: game.id,
        percent: 0,
        speed: '',
        eta: 'Engine error',
        status: 'failed',
        filename: cleanTitle,
        installDir: targetDir
      });
    }
  });
}

function startUploadHavenBypass(url, game) {
  console.log('[Backend] Starting UploadHaven Bypass for:', game.title, 'URL:', url);
  const bypassWin = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  
  bypassWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  
  let downloadCaught = false;
  let clickInterval = null;

  const cleanup = () => {
    activeResolvers.delete(game.id);
    if (clickInterval) {
      clearInterval(clickInterval);
      clickInterval = null;
    }
    session.defaultSession.removeListener('will-download', downloadListener);
    try {
      if (!bypassWin.isDestroyed()) bypassWin.destroy();
    } catch (e) {}
  };

  activeResolvers.set(game.id, cleanup);

  const downloadListener = async (event, item) => {
    if (downloadCaught) return;
    downloadCaught = true;
    event.preventDefault(); // Stop Chromium's single-stream download!

    cleanup();

    const finalUrl = item.getURL();
    const filename = item.getFilename();
    const referer = item.getURLChain()[0] || (bypassWin && !bypassWin.isDestroyed() ? bypassWin.webContents.getURL() : url);

    console.log('[Backend] Intercepted UploadHaven download:', filename, 'URL:', finalUrl);

    await startAria2Download(finalUrl, filename, game, referer);
  };
  
  session.defaultSession.on('will-download', downloadListener);
  bypassWin.on('closed', cleanup);
  
  const ref = game.slug || (game.id && game.id.startsWith('su-') ? `https://steamunlocked.org/${game.id.replace(/^su-/, '')}/` : 'https://steamunlocked.org/');
  bypassWin.loadURL(url, { 
    httpReferrer: ref,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  clickInterval = setInterval(async () => {
    if (bypassWin.isDestroyed() || downloadCaught) {
      cleanup();
      return;
    }

    try {
      const res = await bypassWin.webContents.executeJavaScript(`
        (function() {
          const form = document.querySelector('form[action*="/download/"]');
          const btn = document.querySelector('.btn-download') || document.querySelector('#submitFree');
          
          if (form) {
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn && !submitBtn.disabled) {
              form.submit();
              return 'submitted_form';
            }
          } else if (btn) {
            if (!btn.disabled && !btn.classList.contains('disabled')) {
              btn.click();
              return 'clicked_btn';
            }
          }
          return 'waiting_timer';
        })();
      `);

      if (res && (res === 'submitted_form' || res === 'clicked_btn')) {
        console.log('[Backend] UploadHaven auto-clicker triggered:', res);
      }
    } catch (e) {}
  }, 1000);

  setTimeout(() => {
    if (!downloadCaught && !bypassWin.isDestroyed()) {
      console.error('[Backend] UploadHaven bypass timed out for:', game.title);
      cleanup();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          gameId: game.id,
          percent: 0,
          speed: '',
          eta: 'UploadHaven mirror timed out',
          status: 'failed'
        });
      }
    }
  }, 60000);
}

function startBypass(buzzUrl, game, refererUrl) {
  console.log('[Backend] Starting Cloudflare Bypass for:', game.title, 'Target URL:', buzzUrl);

  const cleanReferer = refererUrl || ((game.slug && game.slug.startsWith('http')) ? game.slug : ('https://steamrip.com/' + (game.slug || game.id || '').replace(/^\/+|\/+$/g, '') + '/'));

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('download-progress', {
      gameId: game.id,
      percent: 0,
      speed: 'Connecting...',
      eta: 'Bypassing CDN gate...',
      status: 'downloading'
    });
  }

  const bypassWin = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  bypassWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  let downloadCaught = false;
  let clickInterval = null;

  const cleanup = () => {
    activeResolvers.delete(game.id);
    if (clickInterval) {
      clearInterval(clickInterval);
      clickInterval = null;
    }
    session.defaultSession.removeListener('will-download', downloadListener);
    try {
      if (!bypassWin.isDestroyed()) bypassWin.destroy();
    } catch (e) {}
  };

  activeResolvers.set(game.id, cleanup);

  const downloadListener = async (event, item) => {
    if (downloadCaught) return;
    downloadCaught = true;
    event.preventDefault(); // Stop Chromium's single-stream download!

    cleanup();

    const finalUrl = item.getURL();
    const filename = item.getFilename();
    const referer = item.getURLChain()[0] || (bypassWin && !bypassWin.isDestroyed() ? bypassWin.webContents.getURL() : buzzUrl);

    console.log('[Backend] Intercepted direct CDN download:', filename, 'URL:', finalUrl);

    await startAria2Download(finalUrl, filename, game, referer);
  };

  session.defaultSession.on('will-download', downloadListener);
  bypassWin.on('closed', cleanup);

  bypassWin.loadURL(buzzUrl, {
    httpReferrer: cleanReferer,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  clickInterval = setInterval(async () => {
    if (bypassWin.isDestroyed() || downloadCaught) {
      cleanup();
      return;
    }

    try {
      const res = await bypassWin.webContents.executeJavaScript(`
        (function() {
          const title = document.title;
          if (title.includes('Just a moment') || title.includes('security') || title.includes('Attention Required')) {
            return 'waiting_cf';
          }

          const dlBtn = document.querySelector('a[hx-get*="/download"]');
          if (dlBtn) {
            dlBtn.click();
            return 'clicked_hx_get';
          }

          const allLinks = Array.from(document.querySelectorAll('a, button'));
          const dlLink = allLinks.find(el => {
            const text = el.textContent.toLowerCase().trim();
            return text.includes('start download') || text.includes('download now') || text.includes('download');
          });

          if (dlLink) {
            dlLink.click();
            return 'clicked_dl_link';
          }

          return 'waiting_button';
        })();
      `);

      if (res && res.startsWith('clicked')) {
        console.log('[Backend] Auto-clicker triggered download:', res);
      }
    } catch (e) {
      // Ignored during page navigation
    }
  }, 1000);

  // Safety timeout: 60s
  setTimeout(() => {
    if (!downloadCaught && !bypassWin.isDestroyed()) {
      console.error('[Backend] Bypass timed out for:', game.title);
      cleanup();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', {
          gameId: game.id,
          percent: 0,
          speed: '',
          eta: 'Mirror bypass timed out',
          status: 'failed'
        });
      }
    }
  }, 60000);
}

// ===========================================================
// STEAM METADATA SCRAPER
// ===========================================================

ipcMain.handle('fetch-metadata', async (event, searchQuery) => {
  if (!searchQuery) return null;
  try {
    const meta = await resolveSteamMetadata(searchQuery);
    return meta;
  } catch (e) {
    return null;
  }
});

// ===========================================================
// STEAMRIP SCRAPER
// ===========================================================

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// ==========================================================
// WORLD-CLASS SEARCH ENGINE & MULTI-SOURCE AGGREGATOR
// ==========================================================

const ROMAN_TO_NUM = {
  'i': '1', 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5',
  'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10',
  'xi': '11', 'xii': '12', 'xiii': '13', 'xiv': '14', 'xv': '15',
  'xvi': '16', 'xvii': '17', 'xviii': '18', 'xix': '19', 'xx': '20'
};
const NUM_TO_ROMAN = Object.fromEntries(Object.entries(ROMAN_TO_NUM).map(([r, n]) => [n, r]));

const GAME_ALIASES = {
  'gta': 'grand theft auto',
  'gta v': 'grand theft auto v',
  'gta 5': 'grand theft auto v',
  'gta iv': 'grand theft auto iv',
  'gta 4': 'grand theft auto iv',
  'gta sa': 'grand theft auto san andreas',
  'gta vc': 'grand theft auto vice city',
  'gta 3': 'grand theft auto iii',
  'gta iii': 'grand theft auto iii',
  'cod': 'call of duty',
  'bo1': 'call of duty black ops',
  'bo2': 'call of duty black ops ii',
  'bo3': 'call of duty black ops iii',
  'bo4': 'call of duty black ops 4',
  'bo6': 'call of duty black ops 6',
  'mw': 'modern warfare',
  'mw2': 'modern warfare 2',
  'mw3': 'modern warfare 3',
  'warzone': 'call of duty warzone',
  'rdr': 'red dead redemption',
  'rdr2': 'red dead redemption 2',
  'rdr 2': 'red dead redemption 2',
  'gow': 'god of war',
  'gow ragnarok': 'god of war ragnarok',
  'ac': "assassin's creed",
  'ac valhalla': "assassin's creed valhalla",
  'ac odyssey': "assassin's creed odyssey",
  'ac origins': "assassin's creed origins",
  'ac mirage': "assassin's creed mirage",
  're': 'resident evil',
  're2': 'resident evil 2',
  're3': 'resident evil 3',
  're4': 'resident evil 4',
  're7': 'resident evil 7',
  're8': 'resident evil village',
  'village': 'resident evil village',
  'ff': 'final fantasy',
  'ff7': 'final fantasy vii',
  'ff 7': 'final fantasy vii',
  'ffx': 'final fantasy x',
  'ffxv': 'final fantasy xv',
  'ffxvi': 'final fantasy xvi',
  'dmc': 'devil may cry',
  'dmc5': 'devil may cry 5',
  'dbz': 'dragon ball z',
  'nfs': 'need for speed',
  'spiderman': "spider-man",
  'spider man': "spider-man",
  'tlou': 'the last of us',
  'tlou2': 'the last of us part ii',
  'cp2077': 'cyberpunk 2077',
  'cyberpunk': 'cyberpunk 2077',
  'bg3': "baldur's gate 3",
  'baldurs gate': "baldur's gate 3",
  'er': 'elden ring',
  'nightreign': 'elden ring nightreign',
  'hk': 'hollow knight',
  'silksong': 'hollow knight silksong',
  'mgs': 'metal gear solid',
  'mgs5': 'metal gear solid v',
  'mgs v': 'metal gear solid v',
  'botw': 'the legend of zelda breath of the wild',
  'totk': 'the legend of zelda tears of the kingdom',
  'zelda': 'the legend of zelda',
  'ds1': 'dark souls',
  'ds2': 'dark souls ii',
  'ds3': 'dark souls iii',
  'fh4': 'forza horizon 4',
  'fh5': 'forza horizon 5',
  'forza': 'forza horizon',
  'bb': 'bloodborne',
  'tes': 'the elder scrolls',
  'skyrim': 'the elder scrolls v skyrim',
  'oblivion': 'the elder scrolls iv oblivion',
  'fo4': 'fallout 4',
  'fnv': 'fallout new vegas',
  'hl2': 'half-life 2',
  'hl': 'half-life'
};

function normalizeRomans(tokens) {
  return tokens.map(t => String(ROMAN_TO_NUM[t] || t));
}

function cleanTitleForSearch(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&#\d+;/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/free download.*$/i, '')
    .replace(/\s+v?\d+\.\d+(?:\.\d+)*.*$/i, '')
    .replace(/\s+(?:build|patch|hotfix|update|release|v\d+)\s*.*$/i, '')
    .replace(/\s*(?:Версия|модификации).*$/i, '')
    .replace(/v\d+(\.\d+)*.*$/i, '')
    .replace(/[–—\-]/g, ' ')
    .replace(/['’"`:;,!?#_]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function expandQueryForRemote(rawQuery) {
  if (!rawQuery) return '';
  const q = rawQuery.toLowerCase().trim();
  if (GAME_ALIASES[q]) return GAME_ALIASES[q];
  if (q.includes('cuberpunk')) return 'cyberpunk';
  if (q.includes('witcer')) return 'witcher';
  if (q.includes('sekiroo')) return 'sekiro';
  if (q === 'spiderman') return 'spider-man';
  return rawQuery.trim();
}

function fastLevenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > 3) return 99;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function indexGameFields(game) {
  if (!game) return;
  const rawTitle = (game.title || '').toLowerCase();
  const c = cleanTitleForSearch(rawTitle);
  game._cleanTitle = c;
  game._alnum = c.replace(/[^a-z0-9]/g, '');
  const rawWords = c.split(/[^a-z0-9]+/).filter(Boolean);
  game._tokensNorm = normalizeRomans(rawWords);
  game._initials = rawWords.map(w => w[0]).join('');
}

function scoreGameFast(game, rawQuery) {
  if (!game || !rawQuery) return 0;
  if (!game._cleanTitle) indexGameFields(game);

  const qClean = cleanTitleForSearch(rawQuery);
  if (!qClean) return 0;

  const expandedQ = GAME_ALIASES[qClean] || qClean;
  const queries = [qClean];
  if (expandedQ !== qClean) queries.push(expandedQ);

  const tClean = game._cleanTitle;
  const tAlnum = game._alnum;
  const tTokensNorm = game._tokensNorm;
  const tJoinedNorm = tTokensNorm.join(' ');
  const initials = game._initials;

  let maxScore = 0;

  for (const q of queries) {
    let score = 0;
    const qWords = q.split(/[^a-z0-9]+/).filter(Boolean);
    const qTokensNorm = normalizeRomans(qWords);
    const qJoinedNorm = qTokensNorm.join(' ');
    const qAlnum = q.replace(/[^a-z0-9]/g, '');

    // 1. Exact match (top tier)
    if (tClean === q || tJoinedNorm === qJoinedNorm || tAlnum === qAlnum) {
      score += 10000;
    }
    // 2. Starts with query
    else if (tClean.startsWith(q) || tJoinedNorm.startsWith(qJoinedNorm)) {
      score += 5000;
    }
    // 3. Contains full query phrase
    else if (tClean.includes(q) || tJoinedNorm.includes(qJoinedNorm)) {
      score += 3000;
    }
    // 4. Substring in alphanumeric
    else if (tAlnum.includes(qAlnum) && qAlnum.length >= 3) {
      score += 2000;
    }

    // 5. Acronym match (e.g. "gta" matching "Grand Theft Auto", "gow" -> "God of War")
    if (qAlnum.length >= 2 && (initials === qAlnum || initials.startsWith(qAlnum))) {
      score += 3500;
    }

    // 6. Token matching & Typo / Levenshtein
    let matchedTokens = 0;
    for (const qw of qTokensNorm) {
      let bestWordScore = 0;
      for (const tw of tTokensNorm) {
        if (tw === qw) {
          bestWordScore = Math.max(bestWordScore, 350);
          break;
        } else if (tw.startsWith(qw)) {
          bestWordScore = Math.max(bestWordScore, 220);
        } else if (tw.includes(qw) && qw.length >= 3) {
          bestWordScore = Math.max(bestWordScore, 150);
        } else if (qw.length >= 4 && tw.length >= 4) {
          const dist = fastLevenshtein(qw, tw);
          if (dist === 1) {
            bestWordScore = Math.max(bestWordScore, 180);
          } else if (dist === 2 && qw.length >= 6) {
            bestWordScore = Math.max(bestWordScore, 100);
          }
        }
      }
      if (bestWordScore > 0) {
        matchedTokens++;
        score += bestWordScore;
      }
    }

    // All query tokens matched bonus
    if (qTokensNorm.length > 1 && matchedTokens >= qTokensNorm.length) {
      score += 1500;
    }

    // Extra title noise penalty
    if (score > 0) {
      const extraWords = Math.max(0, tTokensNorm.length - qTokensNorm.length);
      score -= Math.min(extraWords * 15, 300);
    }

    if (score > maxScore) {
      maxScore = score;
    }
  }

  return maxScore;
}

function rankAndFilterGamesBySearch(games, query) {
  if (!query || !query.trim() || !Array.isArray(games)) return games;
  const rawQ = query.trim();

  const scored = [];
  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    const s = scoreGameFast(game, rawQ);
    if (s > 0) {
      scored.push({ game, score: s });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.game);
}

// Global In-Memory Pool of Scraped Games from all providers
const globalScrapedGames = new Map();
function trackScrapedGame(g) {
  if (g && g.id && !globalScrapedGames.has(g.id)) {
    indexGameFields(g);
    globalScrapedGames.set(g.id, g);
  }
}

function parseSteamRipPost(p) {
  let rawTitle = p.title?.rendered || '';
  let title = decodeHtmlEntities(rawTitle.replace(/Free Download.*$/i, '').trim());
  const slug = p.slug;
  const id = slug;

  // Extract cover
  let cover = '';
  const media = p._embedded?.['wp:featuredmedia']?.[0];
  if (media) {
    cover = media.source_url || media.media_details?.sizes?.medium?.source_url || '';
  }

  // Extract size
  const content = p.content?.rendered || '';
  const sizeMatch = content.match(/Size:\s*<strong>([^<]+)<\/strong>/i)
                 || content.match(/Game Size:\s*<strong>([^<]+)<\/strong>/i)
                 || content.match(/<strong>([\d.]+\s*(?:GB|MB))<\/strong>/i)
                 || content.match(/([\d.]+\s*(?:GB|MB))/i);
  const size = sizeMatch ? sizeMatch[1].trim() : 'Pre-installed';

  // Description
  const excerpt = p.excerpt?.rendered?.replace(/<[^>]+>/g, '').replace(/&hellip;/g, '...').trim() || '';

  const game = {
    id,
    title: title || slug,
    cleanTitle: cleanGameTitleForSearch(title || slug),
    slug,
    cover: cover || '',
    banner: cover || '',
    developer: 'SteamRIP',
    description: decodeHtmlEntities(excerpt) || 'Pre-Installed Game from SteamRIP',
    size,
    progress: 0,
    enriched: false,
    source: 'steamrip'
  };
  indexGameFields(game);
  return game;
}

async function fetchSteamRipGamesInternal(params) {
  const { page = 1, search = '' } = (typeof params === 'object' && params !== null) ? params : { page: 1, search: params || '' };
  const rawQuery = (search || '').trim();
  const isSearch = rawQuery !== '';
  const perPage = isSearch ? 50 : 24;

  const effectiveQuery = isSearch ? expandQueryForRemote(rawQuery) : '';

  let apiUrl = `https://steamrip.com/wp-json/wp/v2/posts?per_page=${perPage}&page=${page}&_embed=true`;
  if (isSearch) {
    apiUrl += `&search=${encodeURIComponent(effectiveQuery)}`;
  }

  console.log(`\n[Backend] Fetching SteamRIP page ${page} (Search: "${rawQuery}") via REST API...`);

  try {
    const res = await net.fetch(apiUrl, {
      headers: {
        'Referer': 'https://steamrip.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (res.ok) {
      const posts = await res.json();
      if (Array.isArray(posts) && posts.length > 0) {
        const parsedGames = posts.map(parseSteamRipPost);
        parsedGames.forEach(trackScrapedGame);
        const games = isSearch ? rankAndFilterGamesBySearch(parsedGames, rawQuery) : parsedGames;
        await mapConcurrent(games, async (game) => {
          if (!game.cover || game.cover.length === 0) {
            const searchTitle = game.cleanTitle || cleanGameTitleForSearch(game.title);
            const meta = await resolveSteamMetadata(searchTitle);
            if (meta) {
              game.cover = meta.cover;
              game.coverFallback = meta.coverFallback;
              game.header = meta.header;
              game.banner = meta.banner;
              game.originalCover = meta.cover;
              game.description = meta.description || game.description;
              game.developer = meta.developer || game.developer;
              game.enriched = true;
            }
          }
        }, 6);
        console.log(`[Backend] net.fetch successfully retrieved, enriched and ranked ${games.length} SteamRIP games for page ${page}`);
        return games;
      } else if (Array.isArray(posts) && posts.length === 0) {
        console.log(`[Backend] SteamRIP reached end of catalog on page ${page}`);
        return [];
      }
    }
  } catch (err) {
    console.warn('[Backend] net.fetch error for SteamRIP API:', err.message);
  }

  return new Promise((resolve) => {
    const scrapeWin = new BrowserWindow({
      width: 1280,
      height: 900,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    scrapeWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let resolved = false;

    const cleanup = () => {
      try {
        if (!scrapeWin.isDestroyed()) scrapeWin.destroy();
      } catch (e) {}
    };

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        console.log('[Backend] SteamRIP API scrape timed out for page:', page);
        cleanup();
        resolve([]);
      }
    }, 20000);

    scrapeWin.webContents.on('did-finish-load', async () => {
      try {
        const text = await scrapeWin.webContents.executeJavaScript('document.body.innerText');
        const posts = JSON.parse(text);
        if (Array.isArray(posts)) {
          const parsedGames = posts.map(parseSteamRipPost);
          parsedGames.forEach(trackScrapedGame);
          const games = isSearch ? rankAndFilterGamesBySearch(parsedGames, rawQuery) : parsedGames;
          await mapConcurrent(games, async (game) => {
            if (!game.cover || game.cover.length === 0) {
              const searchTitle = game.cleanTitle || cleanGameTitleForSearch(game.title);
              const meta = await resolveSteamMetadata(searchTitle);
              if (meta) {
                game.cover = meta.cover;
                game.coverFallback = meta.coverFallback;
                game.header = meta.header;
                game.banner = meta.banner;
                game.originalCover = meta.cover;
                game.description = meta.description || game.description;
                game.developer = meta.developer || game.developer;
                game.enriched = true;
              }
            }
          }, 6);
          console.log(`[Backend] BrowserWindow retrieved, enriched and ranked ${games.length} SteamRIP games for page ${page}`);
          resolved = true;
          clearTimeout(timeout);
          cleanup();
          return resolve(games);
        }
      } catch (e) {}
    });

    scrapeWin.loadURL(apiUrl, {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
  });
}

async function fetchSteamUnlockedGamesInternal(params) {
  let page = 1;
  let search = '';
  let targetUrls = [];

  if (typeof params === 'string') {
    targetUrls = [params];
  } else if (params && typeof params === 'object') {
    page = params.page || 1;
    search = params.search || '';
  }

  const rawQ = (search || '').trim();
  const effectiveQ = expandQueryForRemote(rawQ);

  if (targetUrls.length === 0) {
    if (effectiveQ) {
      const q = encodeURIComponent(effectiveQ);
      targetUrls = [
        page === 1 ? `https://steamunlocked.org/?s=${q}` : `https://steamunlocked.org/page/${page}/?s=${q}`
      ];
    } else {
      const startPage = (page - 1) * 2 + 1;
      targetUrls = [
        startPage === 1 ? 'https://steamunlocked.org/?post_type=post' : `https://steamunlocked.org/page/${startPage}/?post_type=post`,
        `https://steamunlocked.org/page/${startPage + 1}/?post_type=post`
      ];
    }
  }

  console.log('[Backend] Fetching SteamUnlocked pages:', targetUrls);

  const batches = await Promise.all(targetUrls.map(u => fetchSteamUnlockedUrl(u)));
  const games = [];
  const seen = new Set();
  for (const batch of batches) {
    for (const g of batch) {
      if (!seen.has(g.id)) {
        seen.add(g.id);
        games.push(g);
        trackScrapedGame(g);
      }
    }
  }

  const finalGames = rawQ ? rankAndFilterGamesBySearch(games, rawQ) : games;

  // Automatically enrich any SteamUnlocked games missing covers with official Steam 600x900 covers & hero banners in parallel
  await mapConcurrent(finalGames, async (game) => {
    if (!game.cover || game.cover.length === 0 || game.cover.includes('blank.gif')) {
      const searchTitle = game.cleanTitle || cleanGameTitleForSearch(game.title);
      const meta = await resolveSteamMetadata(searchTitle);
      if (meta) {
        game.cover = meta.cover;
        game.coverFallback = meta.coverFallback;
        game.header = meta.header;
        game.banner = meta.banner;
        game.originalCover = meta.cover;
        game.description = meta.description || game.description;
        game.developer = meta.developer || game.developer;
        game.enriched = true;
      }
    }
  }, 6);

  console.log(`[Backend] Total SteamUnlocked games returned (enriched): ${finalGames.length}`);
  return finalGames;
}

ipcMain.handle('fetch-steamrip-page', async (event, params) => {
  return fetchSteamRipGamesInternal(params);
});

// ---------------------------------------------------------
// NEW HYDRA-STYLE SEARCH & REPACK IPC HANDLERS
// ---------------------------------------------------------

ipcMain.handle('quick-search', async (event, query) => {
  if (!query || !query.trim()) return [];
  const rawQ = query.trim();
  const fgCatalog = getFitgirlCatalog();
  const ofCatalog = getOnlinefixCatalog();
  const dodiCatalog = getDodiCatalog();
  const customCatalog = getCustomSourcesCatalog();
  const customGames = [];
  for (const sId in customCatalog) {
    if (customCatalog[sId] && Array.isArray(customCatalog[sId].downloads)) {
      for (const d of customCatalog[sId].downloads) {
        customGames.push({
          id: d.id,
          title: d.title,
          cover: '',
          header: '',
          banner: '',
          source: customCatalog[sId].name || 'Custom',
          size: d.fileSize || '',
          slug: '',
          uploadDate: d.uploadDate || '',
          uris: d.uris || []
        });
      }
    }
  }

  const combinedPool = [...fgCatalog, ...ofCatalog, ...dodiCatalog, ...customGames, ...Array.from(globalScrapedGames.values())];
  const seenIds = new Set();
  const pool = [];
  for (const g of combinedPool) {
    if (!seenIds.has(g.id)) {
      seenIds.add(g.id);
      pool.push(g);
    }
  }

  const scored = [];
  for (let i = 0; i < pool.length; i++) {
    const g = pool[i];
    const s = scoreGameFast(g, rawQ);
    if (s > 0) scored.push({ game: g, score: s });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 8).map(s => {
    const g = s.game;
    const cached = metaCache.get(g.title);
    return {
      id: g.id,
      title: g.title,
      cover: cached?.cover || g.cover || '',
      header: cached?.header || g.header || '',
      banner: cached?.banner || g.banner || '',
      source: g.source || 'fitgirl',
      size: g.size || '',
      slug: g.slug || '',
      uploadDate: g.uploadDate || '',
      uris: g.uris || []
    };
  });

  return top;
});

ipcMain.handle('search-all-sources', async (event, params) => {
  const { query, page = 1, perPage = 24 } = (typeof params === 'object' && params !== null) ? params : { query: params || '', page: 1, perPage: 24 };
  const rawQ = (query || '').trim();

  // 1. FitGirl local search (instant)
  const fgCatalog = getFitgirlCatalog();
  const fgRanked = rawQ ? rankAndFilterGamesBySearch(fgCatalog, rawQ) : fgCatalog;

  // 1b. OnlineFix local search (instant)
  const ofCatalog = getOnlinefixCatalog();
  const ofRanked = rawQ ? rankAndFilterGamesBySearch(ofCatalog, rawQ) : ofCatalog;

  // 1c. DODI local search (instant)
  const dodiCatalog = getDodiCatalog();
  const dodiRanked = rawQ ? rankAndFilterGamesBySearch(dodiCatalog, rawQ) : dodiCatalog;

  // 2. SteamRIP search (concurrent)
  let srRanked = [];
  try {
    srRanked = await fetchSteamRipGamesInternal({ page: 1, search: rawQ });
  } catch (e) {
    console.warn('[Search] SteamRIP search error:', e.message);
  }

  // 3. SteamUnlocked search (concurrent)
  let suRanked = [];
  try {
    suRanked = await fetchSteamUnlockedGamesInternal({ page: 1, search: rawQ });
  } catch (e) {
    console.warn('[Search] SteamUnlocked search error:', e.message);
  }

  // Consolidated pool with source tags
  const consolidated = [];
  const seenMap = new Map();

  const addOrMerge = (game, src) => {
    const norm = cleanTitleForSearch(game.title);
    if (!norm) return;

    if (seenMap.has(norm)) {
      const existing = seenMap.get(norm);
      if (!existing.sources.includes(src)) {
        existing.sources.push(src);
      }
      existing.sourceOptions = existing.sourceOptions || {};
      existing.sourceOptions[src] = {
        id: game.id,
        slug: game.slug,
        size: game.size,
        uris: game.uris || []
      };
    } else {
      const item = {
        ...game,
        sources: [src],
        sourceOptions: {
          [src]: {
            id: game.id,
            slug: game.slug,
            size: game.size,
            uris: game.uris || []
          }
        }
      };
      seenMap.set(norm, item);
      consolidated.push(item);
    }
  };

  // Add FitGirl top results
  fgRanked.slice(0, 60).forEach(g => addOrMerge(g, 'fitgirl'));
  // Add OnlineFix top results
  ofRanked.slice(0, 60).forEach(g => addOrMerge(g, 'onlinefix'));
  // Add DODI top results
  dodiRanked.slice(0, 60).forEach(g => addOrMerge(g, 'dodi'));
  // Add SteamRIP results
  (srRanked || []).forEach(g => addOrMerge(g, 'steamrip'));
  // Add SteamUnlocked results
  (suRanked || []).forEach(g => addOrMerge(g, 'steamunlocked'));

  const finalRanked = rawQ ? rankAndFilterGamesBySearch(consolidated, rawQ) : consolidated;

  const startIndex = (page - 1) * perPage;
  const pageItems = finalRanked.slice(startIndex, startIndex + perPage);

  // Pre-enrich top games with Steam covers/banners
  await mapConcurrent(pageItems, async (game) => {
    if (!game.cover || game.cover.length === 0) {
      const meta = await resolveSteamMetadata(game.title);
      if (meta) {
        game.cover = meta.cover;
        game.coverFallback = meta.coverFallback;
        game.header = meta.header;
        game.banner = meta.banner;
        game.originalCover = meta.cover;
        game.description = meta.description || game.description;
        game.developer = meta.developer || game.developer;
        game.enriched = true;
      }
    }
  }, 6);

  return {
    games: pageItems,
    hasMore: (startIndex + perPage) < finalRanked.length,
    total: finalRanked.length,
    counts: {
      total: finalRanked.length,
      fitgirl: fgRanked.length,
      onlinefix: ofRanked.length,
      dodi: dodiRanked.length,
      steamrip: (srRanked || []).length,
      steamunlocked: (suRanked || []).length
    }
  };
});

ipcMain.handle('get-game-repacks', async (event, gameParams) => {
  if (!gameParams || !gameParams.title) return { repacks: [] };
  const { title, id, source, slug } = gameParams;
  const repacks = [];
  const seenUrls = new Set();

  // 1. FitGirl catalog check
  const fgCatalog = getFitgirlCatalog();
  const fgMatches = rankAndFilterGamesBySearch(fgCatalog, title).slice(0, 4);
  for (const fg of fgMatches) {
    const uri = (fg.uris && fg.uris[0]) ? fg.uris[0] : fg.slug;
    if (uri && !seenUrls.has(uri)) {
      seenUrls.add(uri);
      repacks.push({
        source: 'fitgirl',
        sourceName: 'FitGirl Repacks',
        title: fg.title,
        size: fg.size || 'Compressed',
        uploadDate: fg.uploadDate || '',
        downloadType: 'torrent',
        uri: uri,
        uris: fg.uris || [],
        badge: 'Lossless Repack (Torrent / Magnet)'
      });
    }
  }

  // 1b. OnlineFix catalog check
  const ofCatalog = getOnlinefixCatalog();
  const ofMatches = rankAndFilterGamesBySearch(ofCatalog, title).slice(0, 4);
  for (const of of ofMatches) {
    const uri = (of.uris && of.uris[0]) ? of.uris[0] : of.slug;
    if (uri && !seenUrls.has(uri)) {
      seenUrls.add(uri);
      repacks.push({
        source: 'onlinefix',
        sourceName: 'OnlineFix',
        title: of.title,
        size: of.size || 'Multiplayer',
        uploadDate: of.uploadDate || '',
        downloadType: 'torrent',
        uri: uri,
        uris: of.uris || [],
        badge: 'Online Co-op / Multiplayer (OnlineFix)'
      });
    }
  }

  // 1c. DODI catalog check
  const dodiCatalog = getDodiCatalog();
  const dodiMatches = rankAndFilterGamesBySearch(dodiCatalog, title).slice(0, 4);
  for (const dodi of dodiMatches) {
    const uri = (dodi.uris && dodi.uris[0]) ? dodi.uris[0] : dodi.slug;
    if (uri && !seenUrls.has(uri)) {
      seenUrls.add(uri);
      repacks.push({
        source: 'dodi',
        sourceName: 'DODI Repacks',
        title: dodi.title,
        size: dodi.size || 'Repack',
        uploadDate: dodi.uploadDate || '',
        downloadType: 'torrent',
        uri: uri,
        uris: dodi.uris || [],
        badge: 'DODI Repack (Torrent / Magnet)'
      });
    }
  }

  // 2. SteamRIP check
  try {
    const srMatches = await fetchSteamRipGamesInternal({ page: 1, search: title });
    if (Array.isArray(srMatches) && srMatches.length > 0) {
      const best = srMatches[0];
      if (best.slug && !seenUrls.has(best.slug)) {
        seenUrls.add(best.slug);
        repacks.push({
          source: 'steamrip',
          sourceName: 'SteamRIP',
          title: best.title,
          size: best.size || 'Pre-installed',
          uploadDate: '',
          downloadType: 'direct',
          uri: best.slug,
          badge: 'Pre-Installed (Direct Download)'
        });
      }
    }
  } catch (e) {}

  // 3. SteamUnlocked check
  try {
    const suMatches = await fetchSteamUnlockedGamesInternal({ page: 1, search: title });
    if (Array.isArray(suMatches) && suMatches.length > 0) {
      const best = suMatches[0];
      if (best.slug && !seenUrls.has(best.slug)) {
        seenUrls.add(best.slug);
        repacks.push({
          source: 'steamunlocked',
          sourceName: 'SteamUnlocked',
          title: best.title,
          size: best.size || 'Archive',
          uploadDate: '',
          downloadType: 'direct',
          uri: best.slug,
          badge: 'Pre-Installed Archive'
        });
      }
    }
  } catch (e) {}

  // Ensure original game is represented if not already in list
  const origUri = (gameParams.uris && gameParams.uris[0]) ? gameParams.uris[0] : (slug || id);
  if (origUri && !seenUrls.has(origUri)) {
    repacks.unshift({
      source: source || 'game',
      sourceName: source === 'fitgirl' ? 'FitGirl Repacks' : source === 'steamunlocked' ? 'SteamUnlocked' : 'SteamRIP',
      title: title,
      size: gameParams.size || 'Unknown',
      uploadDate: gameParams.uploadDate || '',
      downloadType: source === 'fitgirl' ? 'torrent' : 'direct',
      uri: origUri,
      uris: gameParams.uris || [],
      badge: 'Current Selection'
    });
  }

  return { repacks };
});

// ==========================================================
// FEATURE 1: STEAM SHORTCUTS & ARTWORK INTEGRATION (HYDRA-PARITY)
// ==========================================================

function detectSteamPath() {
  const commonPaths = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'E:\\Steam'
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(path.join(p, 'userdata')) && fs.existsSync(path.join(p, 'steam.exe'))) {
      return p;
    }
  }
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getSteamUsers(steamPath) {
  if (!steamPath) return [];
  const userdataDir = path.join(steamPath, 'userdata');
  if (!fs.existsSync(userdataDir)) return [];
  try {
    return fs.readdirSync(userdataDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d+$/.test(d.name))
      .map(d => d.name);
  } catch (e) {
    return [];
  }
}

function parseBinaryVdf(buffer) {
  let offset = 0;
  function readByte() { return buffer.readUInt8(offset++); }
  function readString() {
    const start = offset;
    while (offset < buffer.length && buffer.readUInt8(offset) !== 0) { offset++; }
    const str = buffer.toString('utf8', start, offset);
    offset++;
    return str;
  }
  function readInt32() {
    const val = buffer.readUInt32LE(offset);
    offset += 4;
    return val;
  }
  function parseObject() {
    const obj = {};
    while (offset < buffer.length) {
      const type = readByte();
      if (type === 0x08) break;
      const key = readString();
      if (type === 0x00) obj[key] = parseObject();
      else if (type === 0x01) obj[key] = readString();
      else if (type === 0x02) obj[key] = readInt32();
    }
    return obj;
  }
  if (buffer.length < 2) return { shortcuts: {} };
  const type = readByte();
  if (type !== 0x00) return { shortcuts: {} };
  const rootName = readString();
  const res = {};
  res[rootName] = parseObject();
  return res;
}

function writeBinaryVdf(rootObj) {
  const chunks = [];
  function writeByte(b) { chunks.push(Buffer.from([b])); }
  function writeString(str) {
    chunks.push(Buffer.from(str, 'utf8'));
    chunks.push(Buffer.from([0x00]));
  }
  function writeInt32(val) {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE((val >>> 0), 0);
    chunks.push(buf);
  }
  function writeObject(obj) {
    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === 'string') {
        writeByte(0x01);
        writeString(key);
        writeString(val);
      } else if (typeof val === 'number') {
        writeByte(0x02);
        writeString(key);
        writeInt32(val);
      } else if (typeof val === 'boolean') {
        writeByte(0x02);
        writeString(key);
        writeInt32(val ? 1 : 0);
      } else if (typeof val === 'object' && val !== null) {
        writeByte(0x00);
        writeString(key);
        writeObject(val);
        writeByte(0x08);
      }
    }
  }
  for (const [rootKey, rootVal] of Object.entries(rootObj)) {
    writeByte(0x00);
    writeString(rootKey);
    writeObject(rootVal);
    writeByte(0x08);
  }
  writeByte(0x08);
  return Buffer.concat(chunks);
}

function downloadArtworkFile(url, destPath) {
  return new Promise((resolve) => {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return resolve(false);
    }
    try {
      const file = fs.createWriteStream(destPath);
      const req = https.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      }, (res) => {
        if (res.statusCode === 200) {
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(true); });
        } else {
          file.close();
          try { fs.unlinkSync(destPath); } catch (e) {}
          resolve(false);
        }
      });
      req.on('error', () => {
        try { fs.unlinkSync(destPath); } catch (e) {}
        resolve(false);
      });
      req.on('timeout', () => {
        req.destroy();
        try { fs.unlinkSync(destPath); } catch (e) {}
        resolve(false);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

async function addGameToSteam(opts) {
  const { title, exePath, installDir, coverImage, bannerImage, steamAppId } = opts || {};
  if (!title) return { success: false, error: 'Game title is required' };

  let targetExe = exePath;
  if (!targetExe && installDir && fs.existsSync(installDir)) {
    targetExe = findGameExecutable(installDir, title);
  }
  if (!targetExe || !fs.existsSync(targetExe)) {
    return { success: false, error: 'Executable not found on disk' };
  }

  const steamPath = detectSteamPath();
  if (!steamPath) {
    return { success: false, error: 'Steam installation was not detected on this PC' };
  }

  const users = getSteamUsers(steamPath);
  if (users.length === 0) {
    return { success: false, error: 'No Steam user profiles found in userdata folder' };
  }

  const appId = (zlib.crc32(Buffer.from(targetExe + title)) | 0x80000000) >>> 0;
  const startDir = path.dirname(targetExe);
  let updatedUsersCount = 0;

  for (const user of users) {
    const configDir = path.join(steamPath, 'userdata', user, 'config');
    const gridDir = path.join(configDir, 'grid');
    if (!fs.existsSync(configDir)) continue;
    if (!fs.existsSync(gridDir)) {
      try { fs.mkdirSync(gridDir, { recursive: true }); } catch (e) {}
    }

    const shortcutsFile = path.join(configDir, 'shortcuts.vdf');
    let shortcutsData = { shortcuts: {} };
    if (fs.existsSync(shortcutsFile)) {
      try {
        const buf = fs.readFileSync(shortcutsFile);
        shortcutsData = parseBinaryVdf(buf);
        if (!shortcutsData.shortcuts || typeof shortcutsData.shortcuts !== 'object') {
          shortcutsData.shortcuts = {};
        }
      } catch (e) {
        shortcutsData = { shortcuts: {} };
      }
    }

    const cleanTargetExe = `"${targetExe}"`;
    let targetIndex = null;
    let maxIdx = -1;
    for (const [idxKey, item] of Object.entries(shortcutsData.shortcuts)) {
      const numIdx = parseInt(idxKey, 10);
      if (!isNaN(numIdx) && numIdx > maxIdx) maxIdx = numIdx;
      if (item.appname === title || item.Exe === cleanTargetExe || item.Exe === targetExe) {
        targetIndex = idxKey;
        break;
      }
    }

    if (!targetIndex) {
      targetIndex = String(maxIdx + 1);
    }

    shortcutsData.shortcuts[targetIndex] = {
      appid: appId,
      appname: title,
      Exe: `"${targetExe}"`,
      StartDir: `"${startDir}"`,
      icon: targetExe,
      ShortcutPath: "",
      LaunchOptions: "",
      IsHidden: 0,
      AllowDesktopConfig: 1,
      AllowOverlay: 1,
      OpenVR: 0,
      Devkit: 0,
      DevkitGameID: "",
      DevkitOverrideAppID: 0,
      LastPlayTime: 0,
      FlatpakAppID: "",
      tags: {}
    };

    try {
      if (fs.existsSync(shortcutsFile)) {
        try { fs.copyFileSync(shortcutsFile, shortcutsFile + '.bak'); } catch (e) {}
      }
      const encoded = writeBinaryVdf(shortcutsData);
      fs.writeFileSync(shortcutsFile, encoded);
      updatedUsersCount++;
    } catch (e) {
      console.error('[Steam] Failed writing shortcuts.vdf for user ' + user, e);
    }

    // Grid artwork download (Vertical poster, horizontal capsule, hero)
    const posterUrl = steamAppId 
      ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/library_600x900_2x.jpg`
      : coverImage;
    const bannerUrl = steamAppId 
      ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/header.jpg`
      : (bannerImage || coverImage);
    const heroUrl = steamAppId 
      ? `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/library_hero.jpg`
      : bannerImage;

    if (posterUrl) {
      downloadArtworkFile(posterUrl, path.join(gridDir, `${appId}p.jpg`));
    }
    if (bannerUrl) {
      downloadArtworkFile(bannerUrl, path.join(gridDir, `${appId}.jpg`));
    }
    if (heroUrl) {
      downloadArtworkFile(heroUrl, path.join(gridDir, `${appId}_hero.jpg`));
    }
  }

  return {
    success: true,
    appId,
    steamPath,
    usersCount: updatedUsersCount,
    message: `Added "${title}" and HD grid artwork to Steam across ${updatedUsersCount} profile(s). Please restart Steam to see your game!`
  };
}

ipcMain.handle('is-steam-installed', () => {
  return Boolean(detectSteamPath());
});

ipcMain.handle('add-to-steam', async (event, opts) => {
  return await addGameToSteam(opts);
});

// ==========================================================
// FEATURE 2: SAVE GAME BACKUP & RESTORE SYSTEM (HYDRA-PARITY)
// ==========================================================

function findGameSaveDirectory(title, steamAppId, exePath) {
  const cleanTitle = (title || '').replace(/[\\/:*?"<>|]/g, '').trim();
  const candidates = [
    path.join(os.homedir(), 'Saved Games', cleanTitle),
    path.join(os.homedir(), 'Documents', 'My Games', cleanTitle),
    path.join(os.homedir(), 'Documents', cleanTitle),
    path.join(process.env.LOCALAPPDATA || '', cleanTitle, 'Saved', 'SaveGames'),
    path.join(process.env.LOCALAPPDATA || '', cleanTitle),
    path.join(process.env.APPDATA || '', cleanTitle)
  ];

  if (steamAppId) {
    candidates.push(path.join(process.env.APPDATA || '', 'Goldberg SteamEmu Saves', String(steamAppId)));
    candidates.push(path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Documents', 'Steam', 'CODEX', String(steamAppId)));
    candidates.push(path.join(process.env.APPDATA || '', 'Rune', String(steamAppId)));
  }

  if (exePath) {
    const dir = path.dirname(exePath);
    candidates.push(path.join(dir, 'save'));
    candidates.push(path.join(dir, 'Save'));
    candidates.push(path.join(dir, 'saves'));
    candidates.push(path.join(dir, 'Profile'));
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      try {
        const files = fs.readdirSync(c);
        if (files.length > 0) return c;
      } catch (e) {}
    }
  }

  const searchRoots = [
    path.join(os.homedir(), 'Saved Games'),
    path.join(os.homedir(), 'Documents', 'My Games')
  ];
  for (const root of searchRoots) {
    if (fs.existsSync(root)) {
      try {
        const subdirs = fs.readdirSync(root);
        for (const sub of subdirs) {
          if (sub.toLowerCase().includes(cleanTitle.toLowerCase()) || cleanTitle.toLowerCase().includes(sub.toLowerCase())) {
            return path.join(root, sub);
          }
        }
      } catch (e) {}
    }
  }

  return candidates[0];
}

function getCharonSavesRootDir(title) {
  const cleanTitle = (title || 'Game').replace(/[\\/:*?"<>|]/g, '').trim();
  const dir = path.join(os.homedir(), 'Charon Saves', cleanTitle);
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
  return dir;
}

async function backupGameSave(opts) {
  const { title, saveDir: customSaveDir, steamAppId, exePath } = opts || {};
  const saveDir = customSaveDir || findGameSaveDirectory(title, steamAppId, exePath);
  if (!saveDir || !fs.existsSync(saveDir)) {
    return { success: false, error: `Save folder does not exist: ${saveDir}` };
  }

  const backupRootDir = getCharonSavesRootDir(title);
  const now = new Date();
  const timestampStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupZip = path.join(backupRootDir, `backup_${timestampStr}.zip`);
  const sevenZip = get7zPath();

  return new Promise((resolve) => {
    const proc = spawn(sevenZip, ['a', '-tzip', backupZip, path.join(saveDir, '*'), '-y'], { windowsHide: true });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(backupZip)) {
        const stat = fs.statSync(backupZip);
        resolve({
          success: true,
          backupPath: backupZip,
          saveDir,
          sizeFormatted: (stat.size / (1024 * 1024) >= 1) ? (stat.size / (1024 * 1024)).toFixed(2) + ' MB' : (stat.size / 1024).toFixed(1) + ' KB',
          dateFormatted: now.toLocaleString(),
          filename: path.basename(backupZip)
        });
      } else {
        resolve({ success: false, error: `7-Zip backup process exited with code ${code}` });
      }
    });
    proc.on('error', (err) => resolve({ success: false, error: err.message }));
  });
}

function listGameBackups(title) {
  const backupRootDir = getCharonSavesRootDir(title);
  if (!fs.existsSync(backupRootDir)) return [];
  try {
    return fs.readdirSync(backupRootDir)
      .filter(f => f.toLowerCase().endsWith('.zip'))
      .map(f => {
        const full = path.join(backupRootDir, f);
        const stat = fs.statSync(full);
        return {
          filename: f,
          fullPath: full,
          sizeBytes: stat.size,
          sizeFormatted: (stat.size / (1024 * 1024) >= 1) ? (stat.size / (1024 * 1024)).toFixed(2) + ' MB' : (stat.size / 1024).toFixed(1) + ' KB',
          dateFormatted: stat.mtime.toLocaleString(),
          timestamp: stat.mtimeMs
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  } catch (e) {
    return [];
  }
}

async function restoreGameSave(opts) {
  const { title, backupPath, targetDir: customTargetDir, steamAppId, exePath } = opts || {};
  if (!backupPath || !fs.existsSync(backupPath)) {
    return { success: false, error: 'Backup archive does not exist' };
  }
  const targetDir = customTargetDir || findGameSaveDirectory(title, steamAppId, exePath);
  if (!fs.existsSync(targetDir)) {
    try { fs.mkdirSync(targetDir, { recursive: true }); } catch (e) {}
  }
  const sevenZip = get7zPath();
  return new Promise((resolve) => {
    const proc = spawn(sevenZip, ['x', backupPath, `-o${targetDir}`, '-aoa', '-y'], { windowsHide: true });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, targetDir, message: `Save game restored successfully into: ${targetDir}` });
      } else {
        resolve({ success: false, error: `7-Zip restore process failed with code ${code}` });
      }
    });
    proc.on('error', (err) => resolve({ success: false, error: err.message }));
  });
}

ipcMain.handle('backup-game-save', async (event, opts) => {
  return await backupGameSave(opts);
});

ipcMain.handle('list-game-backups', (event, title) => {
  return listGameBackups(title);
});

ipcMain.handle('restore-game-save', async (event, opts) => {
  return await restoreGameSave(opts);
});

ipcMain.handle('open-save-location', (event, opts) => {
  const { title, saveDir: customSaveDir, steamAppId, exePath } = opts || {};
  const saveDir = customSaveDir || findGameSaveDirectory(title, steamAppId, exePath);
  if (saveDir && fs.existsSync(saveDir)) {
    shell.openPath(saveDir);
    return { success: true, path: saveDir };
  }
  const charonSavesDir = getCharonSavesRootDir(title);
  shell.openPath(charonSavesDir);
  return { success: true, path: charonSavesDir };
});

// ==========================================================
// FEATURE 3: STEAM ACHIEVEMENTS & REAL-TIME EMULATOR WATCHER (HYDRA-PARITY)
// ==========================================================

const achievementsSchemaCache = new Map();
const sessionUnlockedAchievements = new Map();

function getLocalUnlocksPath(gameKey) {
  const cleanKey = String(gameKey).replace(/[^a-zA-Z0-9_-]/g, '_');
  const dir = path.join(app.getPath('userData'), 'charon_achievements');
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
  }
  return path.join(dir, `${cleanKey}.json`);
}

function loadLocalUnlockedMap(gameKey) {
  const file = getLocalUnlocksPath(gameKey);
  if (fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {}
  }
  return {};
}

function saveLocalUnlockedMap(gameKey, data) {
  try {
    const file = getLocalUnlocksPath(gameKey);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

async function fetchSteamCommunityAchievements(steamAppId) {
  if (!steamAppId) return [];
  const sId = String(steamAppId);
  if (achievementsSchemaCache.has(sId)) {
    return achievementsSchemaCache.get(sId);
  }

  const cacheDir = path.join(app.getPath('userData'), 'achievements_cache');
  if (!fs.existsSync(cacheDir)) {
    try { fs.mkdirSync(cacheDir, { recursive: true }); } catch (e) {}
  }
  const cacheFile = path.join(cacheDir, `${sId}.json`);
  if (fs.existsSync(cacheFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (Array.isArray(data) && data.length > 0) {
        achievementsSchemaCache.set(sId, data);
        return data;
      }
    } catch (e) {}
  }

  return new Promise((resolve) => {
    https.get(`https://steamcommunity.com/stats/${sId}/achievements/`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const $ = cheerio.load(data);
          const achievements = [];
          $('.achieveRow').each((i, el) => {
            const $row = $(el);
            const title = $row.find('.achieveTxtHolder h3').text().trim();
            const desc = $row.find('.achieveTxtHolder h5').text().trim();
            const icon = $row.find('.achieveImgHolder img').attr('src');
            const idMatch = icon && icon.match(/\/([a-zA-Z0-9_-]+)\.(?:jpg|png)/i);
            const name = (idMatch ? idMatch[1] : title).toUpperCase();
            if (title) {
              achievements.push({
                name,
                displayName: title,
                description: desc,
                icon: icon || ''
              });
            }
          });

          if (achievements.length > 0) {
            achievementsSchemaCache.set(sId, achievements);
            try { fs.writeFileSync(cacheFile, JSON.stringify(achievements, null, 2), 'utf8'); } catch (e) {}
          }
          resolve(achievements);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([])).on('timeout', () => resolve([]));
  });
}

async function resolveGameSteamAppId(title, exePath, providedAppId) {
  if (providedAppId && /^\d+$/.test(String(providedAppId))) {
    return String(providedAppId);
  }

  if (exePath) {
    const dir = path.dirname(exePath);
    const candidates = [
      path.join(dir, 'steam_appid.txt'),
      path.join(dir, 'steam_settings', 'steam_appid.txt'),
      path.join(dir, '..', 'steam_appid.txt'),
      path.join(dir, '..', 'steam_settings', 'steam_appid.txt')
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        try {
          const content = fs.readFileSync(c, 'utf8').trim();
          const match = content.match(/^(\d+)/);
          if (match) return match[1];
        } catch (e) {}
      }
    }

    const iniCandidates = [
      path.join(dir, 'steam_emu.ini'),
      path.join(dir, 'codex.ini'),
      path.join(dir, 'rune.ini'),
      path.join(dir, 'hlm.ini')
    ];
    for (const c of iniCandidates) {
      if (fs.existsSync(c)) {
        try {
          const content = fs.readFileSync(c, 'utf8');
          const m = content.match(/AppId\s*=\s*(\d+)/i);
          if (m) return m[1];
        } catch (e) {}
      }
    }
  }

  if (title) {
    try {
      const clean = cleanGameTitleForSearch(title);
      const res = await queryStoreSearch(clean);
      if (res && res.appid) return String(res.appid);
      const comRes = await querySteamCommunityApps(clean);
      if (comRes && comRes.appid) return String(comRes.appid);
    } catch (e) {}
  }

  return null;
}

function parseEmulatorAchievementFiles(steamAppId, exePath) {
  const unlocked = new Map();

  const checkGoldbergJson = (filePath) => {
    if (!fs.existsSync(filePath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.earned || item.unlocked) {
            unlocked.set(String(item.name || item.id || '').toUpperCase(), item.earned_time || Date.now());
          }
        }
      } else if (typeof data === 'object' && data !== null) {
        for (const [key, val] of Object.entries(data)) {
          if (val && (val.earned || val.unlocked || val === 1 || val === true)) {
            unlocked.set(String(key).toUpperCase(), val.earned_time || Date.now());
          }
        }
      }
    } catch (e) {}
  };

  const checkIniFile = (filePath) => {
    if (!fs.existsSync(filePath)) return;
    try {
      const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
      let inSection = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          inSection = /achieve/i.test(trimmed);
        } else if (inSection && trimmed.includes('=')) {
          const [key, val] = trimmed.split('=').map(s => s.trim());
          if (val === '1' || val.toLowerCase() === 'true') {
            unlocked.set(key.toUpperCase(), Date.now());
          }
        }
      }
    } catch (e) {}
  };

  if (steamAppId) {
    checkGoldbergJson(path.join(process.env.APPDATA || '', 'Goldberg SteamEmu Saves', String(steamAppId), 'achievements.json'));
    checkIniFile(path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Documents', 'Steam', 'CODEX', String(steamAppId), 'achievements.ini'));
    checkIniFile(path.join(process.env.APPDATA || '', 'Rune', String(steamAppId), 'achievements.ini'));
  }

  if (exePath) {
    const dir = path.dirname(exePath);
    checkGoldbergJson(path.join(dir, 'steam_settings', 'achievements.json'));
    checkGoldbergJson(path.join(dir, 'achievements.json'));
    checkIniFile(path.join(dir, 'steam_settings', 'achievements.ini'));
  }

  return unlocked;
}

async function pollGameAchievements(gameKey, steamAppId, exePath, title, isInitial = false) {
  if (!steamAppId) return;

  const schema = await fetchSteamCommunityAchievements(steamAppId);
  if (schema.length === 0) return;

  const emulatorUnlocks = parseEmulatorAchievementFiles(steamAppId, exePath);
  const localMap = loadLocalUnlockedMap(gameKey);

  if (!sessionUnlockedAchievements.has(gameKey)) {
    const initialSet = new Set(Object.keys(localMap).map(k => k.toUpperCase()));
    for (const k of emulatorUnlocks.keys()) {
      initialSet.add(k.toUpperCase());
    }
    sessionUnlockedAchievements.set(gameKey, initialSet);
    return;
  }

  const knownSet = sessionUnlockedAchievements.get(gameKey);

  for (const [achName, unlockTime] of emulatorUnlocks.entries()) {
    const upperName = achName.toUpperCase();
    if (!knownSet.has(upperName)) {
      knownSet.add(upperName);
      localMap[upperName] = { earned: true, earned_time: unlockTime || Date.now() };
      saveLocalUnlockedMap(gameKey, localMap);

      const matched = schema.find(s => 
        s.name.toUpperCase() === upperName || 
        s.displayName.toUpperCase() === upperName ||
        upperName.includes(s.name.toUpperCase())
      );

      const unlockPayload = {
        name: upperName,
        displayName: matched?.displayName || achName,
        description: matched?.description || 'Achievement Unlocked!',
        icon: matched?.icon || '',
        gameTitle: title,
        gameKey,
        appId: steamAppId,
        unlockedAt: unlockTime || Date.now()
      };

      console.log(`[Achievements] 🏆 Unlocked: "${unlockPayload.displayName}" in "${title}"`);
      showNativeNotification(`🏆 Achievement Unlocked: ${unlockPayload.displayName}`, `${unlockPayload.description} (${title})`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('achievement-unlocked', unlockPayload);
      }
    }
  }
}

ipcMain.handle('get-game-achievements', async (event, opts) => {
  const { title, steamAppId: providedAppId, exePath, gameId } = opts || {};
  const gameKey = String(gameId || title || '').trim();
  const steamAppId = await resolveGameSteamAppId(title, exePath, providedAppId);

  if (!steamAppId) {
    return { appId: null, total: 0, unlockedCount: 0, achievements: [] };
  }

  const schema = await fetchSteamCommunityAchievements(steamAppId);
  const emulatorUnlocks = parseEmulatorAchievementFiles(steamAppId, exePath);
  const localMap = loadLocalUnlockedMap(gameKey);

  const merged = schema.map(ach => {
    const upperName = ach.name.toUpperCase();
    const isUnlocked = emulatorUnlocks.has(upperName) || 
                       Boolean(localMap[upperName]?.earned) ||
                       Boolean(localMap[ach.displayName.toUpperCase()]?.earned);
    return {
      ...ach,
      unlocked: isUnlocked,
      unlockedAt: localMap[upperName]?.earned_time || null
    };
  });

  const unlockedCount = merged.filter(a => a.unlocked).length;
  return {
    appId: steamAppId,
    total: merged.length,
    unlockedCount,
    achievements: merged
  };
});

// ==========================================================
// FEATURE 4: STEAMGRIDDB & CUSTOM ARTWORK MANAGER (HYDRA-PARITY)
// ==========================================================

const CUSTOM_ARTWORK_FILE = path.join(app.getPath('userData'), 'charon_custom_artwork.json');
const CUSTOM_ARTWORK_DIR = path.join(app.getPath('userData'), 'custom_artwork');
if (!fs.existsSync(CUSTOM_ARTWORK_DIR)) {
  try { fs.mkdirSync(CUSTOM_ARTWORK_DIR, { recursive: true }); } catch (e) {}
}

let cachedCustomArtwork = null;
function getCustomArtworkDatabase() {
  if (cachedCustomArtwork) return cachedCustomArtwork;
  try {
    if (fs.existsSync(CUSTOM_ARTWORK_FILE)) {
      cachedCustomArtwork = JSON.parse(fs.readFileSync(CUSTOM_ARTWORK_FILE, 'utf8'));
      return cachedCustomArtwork;
    }
  } catch (e) {
    console.error('[Artwork] Error reading custom artwork DB:', e);
  }
  cachedCustomArtwork = {};
  return cachedCustomArtwork;
}

function saveCustomArtworkDatabase(data) {
  try {
    cachedCustomArtwork = data;
    fs.writeFileSync(CUSTOM_ARTWORK_FILE, JSON.stringify(cachedCustomArtwork, null, 2), 'utf8');
  } catch (e) {
    console.error('[Artwork] Error saving custom artwork DB:', e);
  }
}

// Helper: HTTP GET JSON with headers
function fetchJson(url, headers = {}) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = https.get({
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'CharonLauncher/1.0.0',
          'Accept': 'application/json',
          ...headers
        }
      }, (res) => {
        let raw = '';
        res.on('data', chunk => raw += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              return resolve(JSON.parse(raw));
            }
            resolve(null);
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(8000, () => {
        req.destroy();
        resolve(null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

// SteamGridDB Kind parameters matching Hydra
const SGDB_KIND_MAP = {
  grid: 'grids',
  hero: 'heroes',
  logo: 'logos',
  icon: 'icons'
};

async function querySteamGridDb(steamAppId, gameTitle, assetType, apiKey) {
  if (!apiKey || !apiKey.trim()) return [];
  const cleanKey = apiKey.trim();
  const kind = SGDB_KIND_MAP[assetType] || 'grids';
  const headers = { 'Authorization': `Bearer ${cleanKey}` };

  let items = [];

  // 1. Try directly with Steam App ID if available
  if (steamAppId) {
    let endpoint = `https://www.steamgriddb.com/api/v2/${kind}/steam/${steamAppId}`;
    if (kind === 'grids') {
      endpoint += '?dimensions=600x900,342x482,660x930&mimes=image/png,image/jpeg,image/webp&nsfw=false';
    } else if (kind === 'heroes') {
      endpoint += '?mimes=image/png,image/jpeg,image/webp&nsfw=false';
    } else if (kind === 'logos') {
      endpoint += '?mimes=image/png,image/webp&nsfw=false';
    } else if (kind === 'icons') {
      endpoint += '?mimes=image/png,image/vnd.microsoft.icon&nsfw=false';
    }

    const res = await fetchJson(endpoint, headers);
    if (res?.success && Array.isArray(res.data) && res.data.length > 0) {
      items = res.data;
    }
  }

  // 2. Fallback: Search game by title on SteamGridDB
  if (items.length === 0 && gameTitle) {
    const cleanQ = cleanGameTitleForSearch(gameTitle);
    const searchUrl = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(cleanQ)}`;
    const searchRes = await fetchJson(searchUrl, headers);
    if (searchRes?.success && Array.isArray(searchRes.data) && searchRes.data.length > 0) {
      const gameId = searchRes.data[0].id;
      if (gameId) {
        let endpoint = `https://www.steamgriddb.com/api/v2/${kind}/game/${gameId}`;
        if (kind === 'grids') {
          endpoint += '?dimensions=600x900,342x482,660x930&mimes=image/png,image/jpeg,image/webp&nsfw=false';
        } else if (kind === 'heroes') {
          endpoint += '?mimes=image/png,image/jpeg,image/webp&nsfw=false';
        } else if (kind === 'logos') {
          endpoint += '?mimes=image/png,image/webp&nsfw=false';
        } else if (kind === 'icons') {
          endpoint += '?mimes=image/png,image/vnd.microsoft.icon&nsfw=false';
        }
        const gameRes = await fetchJson(endpoint, headers);
        if (gameRes?.success && Array.isArray(gameRes.data)) {
          items = gameRes.data;
        }
      }
    }
  }

  return items.map(item => ({
    id: item.id,
    url: item.url,
    thumb: item.thumb || item.url,
    width: item.width || (assetType === 'grid' ? 600 : (assetType === 'hero' ? 1920 : 256)),
    height: item.height || (assetType === 'grid' ? 900 : (assetType === 'hero' ? 620 : 256)),
    score: item.score || 0,
    style: item.style || 'Community',
    author: item.author?.name || 'SteamGridDB',
    isAnimated: Boolean((item.mime && item.mime.includes('webp') && item.style === 'animated') || (item.url && item.url.includes('.gif'))),
    source: 'steamgriddb'
  }));
}

async function getSteamOfficialArtworkCandidates(steamAppId, assetType) {
  if (!steamAppId) return [];
  const sId = String(steamAppId);
  const candidates = [];
  const details = await fetchAppDetails(sId);

  if (assetType === 'grid') {
    // 1. Official 600x900 Library 2x
    candidates.push({
      id: 90001,
      url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/library_600x900_2x.jpg`,
      thumb: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/library_600x900_2x.jpg`,
      width: 600,
      height: 900,
      score: 100,
      style: 'Official 600x900 (HD)',
      author: 'Valve / Steam Official',
      isAnimated: false,
      source: 'steam_official'
    });
    // 2. Standard 600x900
    candidates.push({
      id: 90002,
      url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/library_600x900.jpg`,
      thumb: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/library_600x900.jpg`,
      width: 600,
      height: 900,
      score: 95,
      style: 'Official 600x900 (1x)',
      author: 'Valve / Steam Official',
      isAnimated: false,
      source: 'steam_official'
    });
    // 3. Official Header
    if (details?.header_image) {
      candidates.push({
        id: 90003,
        url: details.header_image,
        thumb: details.header_image,
        width: 460,
        height: 215,
        score: 90,
        style: 'Store Header',
        author: 'Valve / Steam Official',
        isAnimated: false,
        source: 'steam_official'
      });
    }
    // 4. Capsule 616x353
    candidates.push({
      id: 90004,
      url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/capsule_616x353.jpg`,
      thumb: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/capsule_616x353.jpg`,
      width: 616,
      height: 353,
      score: 85,
      style: 'Store Capsule',
      author: 'Valve / Steam Official',
      isAnimated: false,
      source: 'steam_official'
    });
  } else if (assetType === 'hero') {
    // 1. Official Library Hero
    candidates.push({
      id: 91001,
      url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/library_hero.jpg`,
      thumb: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/library_hero.jpg`,
      width: 1920,
      height: 620,
      score: 100,
      style: 'Official Hero Banner',
      author: 'Valve / Steam Official',
      isAnimated: false,
      source: 'steam_official'
    });
    // 2. Official Background Wallpaper
    if (details?.background) {
      candidates.push({
        id: 91002,
        url: details.background,
        thumb: details.background,
        width: 1920,
        height: 1080,
        score: 95,
        style: 'Official Store Background',
        author: 'Valve / Steam Official',
        isAnimated: false,
        source: 'steam_official'
      });
    }
    // 3. Official High-Resolution Screenshots
    if (Array.isArray(details?.screenshots)) {
      details.screenshots.slice(0, 12).forEach((s, idx) => {
        candidates.push({
          id: 91100 + idx,
          url: s.path_full,
          thumb: s.path_thumbnail || s.path_full,
          width: 1920,
          height: 1080,
          score: 85 - idx,
          style: `Store Screenshot #${idx + 1}`,
          author: 'Official Screenshot',
          isAnimated: false,
          source: 'steam_official'
        });
      });
    }
  } else if (assetType === 'logo') {
    // 1. Official Transparent Logo
    candidates.push({
      id: 92001,
      url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/logo.png`,
      thumb: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/logo.png`,
      width: 640,
      height: 360,
      score: 100,
      style: 'Official Transparent Logo',
      author: 'Valve / Steam Official',
      isAnimated: false,
      source: 'steam_official'
    });
    // 2. Capsule 184x69 Logo
    candidates.push({
      id: 92002,
      url: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/capsule_184x69.jpg`,
      thumb: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${sId}/capsule_184x69.jpg`,
      width: 184,
      height: 69,
      score: 80,
      style: 'Capsule Badge',
      author: 'Valve / Steam Official',
      isAnimated: false,
      source: 'steam_official'
    });
  } else if (assetType === 'icon') {
    candidates.push({
      id: 93001,
      url: `https://shared.akamai.steamstatic.com/community_assets/images/apps/${sId}/icon.jpg`,
      thumb: `https://shared.akamai.steamstatic.com/community_assets/images/apps/${sId}/icon.jpg`,
      width: 256,
      height: 256,
      score: 100,
      style: 'Community Icon',
      author: 'Steam Community',
      isAnimated: false,
      source: 'steam_official'
    });
    if (details?.header_image) {
      candidates.push({
        id: 93002,
        url: details.header_image,
        thumb: details.header_image,
        width: 256,
        height: 256,
        score: 80,
        style: 'Header Icon Crop',
        author: 'Steam Store',
        isAnimated: false,
        source: 'steam_official'
      });
    }
  }

  return candidates;
}

ipcMain.handle('get-game-artwork', async (event, opts) => {
  const { title, steamAppId: providedAppId, exePath, assetType = 'grid' } = opts || {};
  const settings = getAppSettings();
  const apiKey = settings.steamGridDbApiKey || '';
  const steamAppId = await resolveGameSteamAppId(title, exePath, providedAppId);

  let sgdbItems = [];
  try {
    if (apiKey) {
      sgdbItems = await querySteamGridDb(steamAppId, title, assetType, apiKey);
    }
  } catch (e) {
    console.warn('[Artwork] SteamGridDB query failed:', e.message);
  }

  let officialItems = [];
  try {
    if (steamAppId) {
      officialItems = await getSteamOfficialArtworkCandidates(steamAppId, assetType);
    }
  } catch (e) {
    console.warn('[Artwork] Official Steam artwork query failed:', e.message);
  }

  // Deduplicate by URL
  const seenUrls = new Set();
  const combined = [];
  for (const item of [...sgdbItems, ...officialItems]) {
    if (item.url && !seenUrls.has(item.url)) {
      seenUrls.add(item.url);
      combined.push(item);
    }
  }

  return {
    items: combined,
    hasApiKey: Boolean(apiKey && apiKey.trim().length > 5),
    assetType,
    steamAppId
  };
});

ipcMain.handle('save-game-artwork', async (event, opts) => {
  const { gameId, title, assetType, url } = opts || {};
  if (!assetType) return { success: false, error: 'Missing assetType' };

  const gameKey = cleanGameTitleForSearch(title || gameId) || String(gameId).trim();
  const db = getCustomArtworkDatabase();
  if (!db[gameKey]) db[gameKey] = {};
  if (url) {
    db[gameKey][assetType] = url;
  } else {
    delete db[gameKey][assetType];
    if (Object.keys(db[gameKey]).length === 0) {
      delete db[gameKey];
    }
  }
  saveCustomArtworkDatabase(db);
  console.log(`[Artwork] Saved custom "${assetType}" for game "${title || gameKey}": ${url || '(reset)'}`);

  return { success: true, artwork: db[gameKey] || {} };
});

ipcMain.handle('get-custom-artwork', () => {
  return getCustomArtworkDatabase();
});

ipcMain.handle('select-local-image-file', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Custom Game Artwork Image',
      properties: ['openFile'],
      filters: [
        { name: 'Images & Animations', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'ico'] }
      ]
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const sourcePath = result.filePaths[0];
    const ext = path.extname(sourcePath).toLowerCase();
    const destName = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const destPath = path.join(CUSTOM_ARTWORK_DIR, destName);
    fs.copyFileSync(sourcePath, destPath);

    // Convert to file URI
    const fileUrl = 'file:///' + destPath.replace(/\\/g, '/');
    return { canceled: false, filePath: fileUrl, originalName: path.basename(sourcePath) };
  } catch (e) {
    console.error('[Artwork] Error selecting local image file:', e);
    return { canceled: true, error: e.message };
  }
});

ipcMain.handle('save-steamgriddb-key', (event, key) => {
  const updated = saveAppSettings({ steamGridDbApiKey: (key || '').trim() });
  return { success: true, key: updated.steamGridDbApiKey };
});

// ==========================================================
// FEATURE 5: POST-EXTRACTION ACTIONS & INTEGRATIONS (HYDRA-PARITY)
// ==========================================================

// 1. PURE NODE.JS PNG TO ICO CONVERTER & WINDOWS SHORTCUT ENGINE
function convertPngToIco(pngBuffer) {
  if (!pngBuffer || pngBuffer.length < 24) return null;
  const isPng = pngBuffer[0] === 0x89 && pngBuffer[1] === 0x50 && pngBuffer[2] === 0x4e && pngBuffer[3] === 0x47;
  if (!isPng) return null;

  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);

  const icoHeader = Buffer.alloc(22);
  icoHeader.writeUInt16LE(0, 0); // Reserved
  icoHeader.writeUInt16LE(1, 2); // Type 1 = ICO
  icoHeader.writeUInt16LE(1, 4); // Count = 1

  icoHeader.writeUInt8(width >= 256 ? 0 : width, 6);   // 0 = 256px
  icoHeader.writeUInt8(height >= 256 ? 0 : height, 7); // 0 = 256px
  icoHeader.writeUInt8(0, 8);  // Palette = 0
  icoHeader.writeUInt8(0, 9);  // Reserved
  icoHeader.writeUInt16LE(1, 10);  // Planes = 1
  icoHeader.writeUInt16LE(32, 12); // BPP = 32
  icoHeader.writeUInt32LE(pngBuffer.length, 14); // Bytes in resource
  icoHeader.writeUInt32LE(22, 18); // Offset = 22

  return Buffer.concat([icoHeader, pngBuffer]);
}

const GAME_ICONS_DIR = path.join(app.getPath('userData'), 'game_icons');
if (!fs.existsSync(GAME_ICONS_DIR)) {
  try { fs.mkdirSync(GAME_ICONS_DIR, { recursive: true }); } catch (e) {}
}

async function downloadOrGenerateGameIcon(game, exePath) {
  const cleanTitle = (game?.title || (exePath ? path.basename(exePath, '.exe') : 'Game'))
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();
  const iconPath = path.join(GAME_ICONS_DIR, `${cleanTitle}.ico`);
  if (fs.existsSync(iconPath)) return iconPath;

  const candidateUrls = [
    game?.icon,
    game?.cover,
    game?.coverFallback,
    game?.header
  ].filter(u => u && typeof u === 'string' && u.startsWith('http'));

  for (const url of candidateUrls) {
    try {
      const buf = await new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { timeout: 8000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectClient = res.headers.location.startsWith('https') ? https : http;
            return redirectClient.get(res.headers.location, (res2) => {
              const chunks = [];
              res2.on('data', c => chunks.push(c));
              res2.on('end', () => resolve(Buffer.concat(chunks)));
            }).on('error', reject);
          }
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => resolve(Buffer.concat(chunks)));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      });

      if (buf && buf.length > 0) {
        if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
          fs.writeFileSync(iconPath, buf);
          return iconPath;
        }
        const ico = convertPngToIco(buf);
        if (ico) {
          fs.writeFileSync(iconPath, ico);
          return iconPath;
        }
      }
    } catch (e) {}
  }

  if (exePath && fs.existsSync(exePath)) {
    return exePath;
  }
  return null;
}

async function createDesktopShortcutForGame(game, exePath) {
  if (!exePath || !fs.existsSync(exePath)) {
    return { success: false, error: 'Executable does not exist on disk' };
  }

  const cleanTitle = (game?.title || path.basename(exePath, '.exe'))
    .replace(/[\\/:*?"<>|]/g, '')
    .trim() || 'Game';

  const desktopDir = path.join(os.homedir(), 'Desktop');
  const startMenuDir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  const desktopLnk = path.join(desktopDir, `${cleanTitle}.lnk`);
  const startMenuLnk = path.join(startMenuDir, `${cleanTitle}.lnk`);
  const workDir = path.dirname(exePath);

  let iconFile = await downloadOrGenerateGameIcon(game, exePath);
  const iconArg = iconFile ? (iconFile.endsWith('.ico') ? `${iconFile}` : `${iconFile},0`) : `${exePath},0`;

  const psScript = `
$WshShell = New-Object -ComObject WScript.Shell;
$Targets = @('${desktopLnk.replace(/'/g, "''")}', '${startMenuLnk.replace(/'/g, "''")}');
foreach ($Lnk in $Targets) {
  try {
    $Dir = [System.IO.Path]::GetDirectoryName($Lnk);
    if (-not [System.IO.Directory]::Exists($Dir)) { [System.IO.Directory]::CreateDirectory($Dir) | Out-Null };
    $Shortcut = $WshShell.CreateShortcut($Lnk);
    $Shortcut.TargetPath = '${exePath.replace(/'/g, "''")}';
    $Shortcut.WorkingDirectory = '${workDir.replace(/'/g, "''")}';
    $Shortcut.IconLocation = '${iconArg.replace(/'/g, "''")}';
    $Shortcut.Save();
  } catch {}
}
`;

  return new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], { windowsHide: true });
    ps.on('close', () => {
      const created = fs.existsSync(desktopLnk);
      console.log(`[Desktop Shortcut] ${created ? '✅ Created' : '❌ Failed to create'} shortcut for "${cleanTitle}" at ${desktopLnk}`);
      resolve({ success: created, path: desktopLnk });
    });
    ps.on('error', (err) => resolve({ success: false, error: err.message }));
  });
}

// 2. AUTOMATIC CLOUD SAVE SYNC (HYDRA-PARITY)
async function runAutomaticCloudSaveSync(gameTitle, steamAppId, exePath, trigger = 'post-extraction') {
  try {
    const saveDir = findGameSaveDirectory(gameTitle, steamAppId, exePath);
    if (!saveDir || !fs.existsSync(saveDir)) {
      console.log(`[Cloud Save] No existing save directory found on disk for "${gameTitle}" (${trigger})`);
      return { status: 'skipped', reason: 'No save directory found' };
    }

    const files = fs.readdirSync(saveDir);
    if (files.length === 0) {
      console.log(`[Cloud Save] Save directory is empty for "${gameTitle}" (${trigger})`);
      return { status: 'skipped', reason: 'Empty save directory' };
    }

    console.log(`[Cloud Save] 🔄 Triggering automatic save sync (${trigger}) for: "${gameTitle}" from ${saveDir}`);
    const backupResult = await backupGameSave({
      title: gameTitle,
      saveDir,
      steamAppId,
      exePath
    });

    if (backupResult.success) {
      console.log(`[Cloud Save] ✅ Auto save backup synced: ${backupResult.backupPath}`);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('on-cloud-save-sync', {
          gameTitle,
          trigger,
          status: 'synced',
          timestamp: Date.now(),
          backupPath: backupResult.backupPath,
          sizeFormatted: backupResult.sizeFormatted
        });
      }
      return { status: 'synced', result: backupResult };
    } else {
      return { status: 'failed', error: backupResult.error };
    }
  } catch (err) {
    console.error(`[Cloud Save] Error during auto sync for ${gameTitle}:`, err.message);
    return { status: 'error', error: err.message };
  }
}

// 3. ACHIEVEMENT METADATA EXPORT (GOLDBERG / LOCAL STEAM EMULATOR)
async function runAchievementMetadataExport(gameTitle, steamAppId, installDir, exePath) {
  try {
    const resolvedId = await resolveGameSteamAppId(gameTitle, exePath, steamAppId);
    if (!resolvedId) {
      console.log(`[Achievements Export] Skipping: No Steam AppID resolved for "${gameTitle}"`);
      return { status: 'skipped', reason: 'No Steam AppID' };
    }

    const targetDirs = new Set();
    if (installDir && fs.existsSync(installDir)) {
      const walkForSteamApi = (dir, depth = 0) => {
        if (depth > 3) return;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              if (entry.name.toLowerCase() === 'steam_settings') {
                targetDirs.add(dir);
              } else {
                walkForSteamApi(full, depth + 1);
              }
            } else if (entry.isFile()) {
              const lower = entry.name.toLowerCase();
              if (lower === 'steam_api.dll' || lower === 'steam_api64.dll') {
                targetDirs.add(dir);
              }
            }
          }
        } catch (e) {}
      };
      walkForSteamApi(installDir);
    }

    if (exePath && fs.existsSync(exePath)) {
      targetDirs.add(path.dirname(exePath));
    }

    if (targetDirs.size === 0 && installDir) {
      targetDirs.add(installDir);
    }

    console.log(`[Achievements Export] Fetching schema for AppID: ${resolvedId} ("${gameTitle}")...`);
    const achievements = await fetchSteamCommunityAchievements(resolvedId);
    if (!achievements || achievements.length === 0) {
      console.log(`[Achievements Export] No achievements found on Steam for AppID ${resolvedId}`);
      return { status: 'empty', count: 0 };
    }

    console.log(`[Achievements Export] Found ${achievements.length} achievements for "${gameTitle}". Exporting to ${targetDirs.size} locations...`);

    let exportedCount = 0;
    for (const targetDir of targetDirs) {
      const steamSettingsDir = path.join(targetDir, 'steam_settings');
      const imagesDir = path.join(steamSettingsDir, 'achievement_images');
      fs.mkdirSync(imagesDir, { recursive: true });

      const appIdFile = path.join(targetDir, 'steam_appid.txt');
      if (!fs.existsSync(appIdFile)) {
        try { fs.writeFileSync(appIdFile, String(resolvedId).trim(), 'utf8'); } catch (e) {}
      }

      const downloadTasks = achievements.slice(0, 80).map(ach => {
        return new Promise(async (resolve) => {
          if (!ach.icon || !ach.icon.startsWith('http')) return resolve();
          const localImg = path.join(imagesDir, `${ach.name}.jpg`);
          if (fs.existsSync(localImg)) return resolve();
          try {
            const req = https.get(ach.icon, { timeout: 5000 }, (res) => {
              const chunks = [];
              res.on('data', c => chunks.push(c));
              res.on('end', () => {
                const buf = Buffer.concat(chunks);
                if (buf.length > 0) {
                  fs.writeFileSync(localImg, buf);
                }
                resolve();
              });
            });
            req.on('error', () => resolve());
            req.on('timeout', () => { req.destroy(); resolve(); });
          } catch (e) {
            resolve();
          }
        });
      });
      await Promise.all(downloadTasks);

      const goldbergList = achievements.map(ach => ({
        name: ach.name,
        displayName: ach.displayName,
        description: ach.description || '',
        icon: `achievement_images/${ach.name}.jpg`,
        icongray: `achievement_images/${ach.name}.jpg`,
        hidden: 0
      }));

      const jsonFile = path.join(steamSettingsDir, 'achievements.json');
      fs.writeFileSync(jsonFile, JSON.stringify(goldbergList, null, 2), 'utf8');
      exportedCount++;
      console.log(`[Achievements Export] ✅ Generated Goldberg achievements at: ${jsonFile}`);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('achievement-export-complete', {
        gameTitle,
        steamAppId: resolvedId,
        achievementCount: achievements.length,
        locations: Array.from(targetDirs)
      });
    }

    return { status: 'success', achievementCount: achievements.length, exportedCount };
  } catch (err) {
    console.error(`[Achievements Export] Error exporting achievements for ${gameTitle}:`, err.message);
    return { status: 'error', error: err.message };
  }
}

// 4. CLASSICS & ROMS MULTI-DISC AUTO-LINKING
const ROM_EXTENSIONS = new Set([
  '.iso', '.chd', '.cue', '.bin', '.cso', '.m3u', '.rvz', '.wbfs', '.nsp', '.xci', '.gdi', '.cdi', '.rom'
]);

function autoLinkClassicsDiscs(game, installDir) {
  if (!installDir || !fs.existsSync(installDir)) return { discs: [] };
  const discCandidates = [];

  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (ROM_EXTENSIONS.has(ext)) {
            const lower = entry.name.toLowerCase();
            if (lower.includes('track ') && !lower.includes('track 1') && !lower.includes('track 01')) {
              continue;
            }
            try {
              const stat = fs.statSync(full);
              discCandidates.push({
                path: full,
                fileName: entry.name,
                size: stat.size,
                dir
              });
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
  };

  walk(installDir);
  if (discCandidates.length === 0) return { discs: [] };

  discCandidates.sort((a, b) => a.fileName.localeCompare(b.fileName));

  const discs = discCandidates.map((c, idx) => {
    let label = `Disc ${idx + 1}`;
    const discMatch = c.fileName.match(/(?:disc|cd|part)\s*(\d+|[a-d])/i);
    if (discMatch) {
      label = `Disc ${discMatch[1].toUpperCase()}`;
    }

    let sku = null;
    const skuMatch = c.fileName.match(/(SLUS|SLES|SCUS|SCES|SLPM|SLPS|ULUS|ULES|CUSA)[-_ ]?(\d{3,5})/i);
    if (skuMatch) {
      sku = `${skuMatch[1].toUpperCase()}-${skuMatch[2]}`;
    }

    return {
      path: c.path,
      fileName: c.fileName,
      label,
      sku: sku || undefined
    };
  });

  if (game?.id) {
    const existing = getGameConfig(game.id) || {};
    saveGameConfig(game.id, {
      ...existing,
      discs,
      selectedDisc: existing.selectedDisc !== undefined ? existing.selectedDisc : 0
    });
  }

  console.log(`[Classics] 🎮 Auto-linked ${discs.length} ROM disc(s) for "${game?.title || 'Game'}":`, discs.map(d => d.label).join(', '));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('classics-discs-linked', {
      gameId: game?.id,
      title: game?.title,
      discs
    });
  }

  return { discs };
}

// 5. UNIFIED POST-EXTRACTION PIPELINE (HYDRA-PARITY)
async function runPostExtractionPipeline(game, installDir, exePath) {
  const title = game?.title || 'Game';
  console.log(`\n======================================================`);
  console.log(`🚀 [Post-Extraction Pipeline] Starting for: "${title}"`);
  console.log(`   Install Dir: ${installDir}`);
  console.log(`   Executable:  ${exePath || '(None)'}`);
  console.log(`======================================================`);

  const results = {
    shortcut: null,
    cloudSave: null,
    achievements: null,
    classics: null
  };

  // 1. Desktop Shortcut Creation
  try {
    if (exePath && fs.existsSync(exePath)) {
      results.shortcut = await createDesktopShortcutForGame(game, exePath);
    }
  } catch (err) {
    console.warn('[Pipeline] Shortcut error:', err.message);
  }

  // 2. Cloud Save Sync initialization
  try {
    results.cloudSave = await runAutomaticCloudSaveSync(title, game?.steamAppId, exePath, 'post-extraction');
  } catch (err) {
    console.warn('[Pipeline] Save sync error:', err.message);
  }

  // 3. Achievement Metadata Export
  try {
    results.achievements = await runAchievementMetadataExport(title, game?.steamAppId, installDir, exePath);
  } catch (err) {
    console.warn('[Pipeline] Achievements export error:', err.message);
  }

  // 4. Classics / ROMs Auto-Linking
  try {
    results.classics = autoLinkClassicsDiscs(game, installDir);
  } catch (err) {
    console.warn('[Pipeline] Classics disc linking error:', err.message);
  }

  console.log(`✅ [Post-Extraction Pipeline] Completed for: "${title}"\n`);
  return results;
}

// IPC Handlers for manual triggers from UI
ipcMain.handle('create-desktop-shortcut', async (event, opts) => {
  const { game, exePath } = opts || {};
  return await createDesktopShortcutForGame(game, exePath);
});

ipcMain.handle('export-achievement-metadata', async (event, opts) => {
  const { title, steamAppId, installDir, exePath } = opts || {};
  return await runAchievementMetadataExport(title, steamAppId, installDir, exePath);
});

ipcMain.handle('scan-classics-discs', (event, opts) => {
  const { game, installDir } = opts || {};
  return autoLinkClassicsDiscs(game, installDir);
});

ipcMain.handle('set-selected-disc', (event, opts) => {
  const { gameId, discIndex } = opts || {};
  if (!gameId) return { success: false };
  const existing = getGameConfig(gameId) || {};
  saveGameConfig(gameId, { ...existing, selectedDisc: discIndex });
  return { success: true, selectedDisc: discIndex };
});

ipcMain.handle('sync-cloud-save', async (event, opts) => {
  const { title, steamAppId, exePath } = opts || {};
  return await runAutomaticCloudSaveSync(title, steamAppId, exePath, 'manual-ui');
});


