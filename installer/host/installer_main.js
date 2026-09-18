const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = process.versions.electron ? require('original-fs') : require('fs');
process.noAsar = true;
const https = require('https');
const { execSync, spawn } = require('child_process');

let mainWindow = null;
let abortFlag = false;

// -------------------------------------------------------------
// Helper: Get System Info & Existing Installation
// -------------------------------------------------------------
function getSystemInfo() {
  const drives = [];
  try {
    const raw = execSync('powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Select-Object Root,Free,Used | ConvertTo-Json -Compress"', { encoding: 'utf8', timeout: 3000 });
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    for (const d of list) {
      if (d.Root) {
        drives.push({
          path: d.Root,
          letter: d.Root.replace('\\', ''),
          freeBytes: d.Free || 0,
          totalBytes: (d.Free || 0) + (d.Used || 0),
          free: d.Free || 0,
          total: (d.Free || 0) + (d.Used || 0)
        });
      }
    }
  } catch (e) {
    // Fallback default
    drives.push({ path: 'C:\\', letter: 'C:', freeBytes: 100 * 1024 * 1024 * 1024, totalBytes: 500 * 1024 * 1024 * 1024, free: 100 * 1024 * 1024 * 1024, total: 500 * 1024 * 1024 * 1024 });
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\', 'AppData', 'Local');
  let defaultPath = path.join(localAppData, 'Programs', 'Charon Game Launcher');

  let existingInstall = null;
  try {
    const regQuery = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CharonGameLauncher" /v InstallLocation', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const locMatch = regQuery.match(/InstallLocation\s+REG_SZ\s+(.+)/);
    if (locMatch && locMatch[1]) {
      const loc = locMatch[1].trim();
      let ver = '1.0.0';
      try {
        const verQuery = execSync('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CharonGameLauncher" /v DisplayVersion', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const verMatch = verQuery.match(/DisplayVersion\s+REG_SZ\s+(.+)/);
        if (verMatch) ver = verMatch[1].trim();
      } catch (e) {}

      existingInstall = {
        installed: true,
        path: loc,
        version: ver
      };
      defaultPath = loc;
    }
  } catch (e) {}

  return {
    drives,
    defaultPath,
    existingInstall,
    windowsVersion: 'Windows 64-bit'
  };
}

// -------------------------------------------------------------
// Helper: Shortcuts & Registry
// -------------------------------------------------------------
function createShortcuts(installPath, desktop = true, startMenu = true) {
  const exePath = path.join(installPath, 'Charon Game Launcher.exe');
  if (!fs.existsSync(exePath)) return;

  if (desktop) {
    try {
      const desktopDir = path.join(process.env.USERPROFILE, 'Desktop');
      const lnkPath = path.join(desktopDir, 'Charon Game Launcher.lnk');
      const psCmd = `$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${lnkPath}'); $s.TargetPath = '${exePath}'; $s.WorkingDirectory = '${installPath}'; $s.IconLocation = '${exePath},0'; $s.Save()`;
      execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('Failed to create desktop shortcut:', e.message);
    }
  }

  if (startMenu) {
    try {
      const startMenuDir = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Charon Game Launcher');
      if (!fs.existsSync(startMenuDir)) fs.mkdirSync(startMenuDir, { recursive: true });
      const lnkPath = path.join(startMenuDir, 'Charon Game Launcher.lnk');
      const psCmd = `$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${lnkPath}'); $s.TargetPath = '${exePath}'; $s.WorkingDirectory = '${installPath}'; $s.IconLocation = '${exePath},0'; $s.Save()`;
      execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'ignore' });
    } catch (e) {
      console.warn('Failed to create start menu shortcut:', e.message);
    }
  }
}

function writeRegistryUninstallKey(installPath, version = '1.0.0') {
  try {
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CharonGameLauncher';
    const exePath = path.join(installPath, 'Charon Game Launcher.exe');
    const uninstallBat = path.join(installPath, 'uninstall.bat');

    execSync(`reg add "${key}" /v "DisplayName" /t REG_SZ /d "Charon Game Launcher" /f`, { stdio: 'ignore' });
    execSync(`reg add "${key}" /v "DisplayVersion" /t REG_SZ /d "${version}" /f`, { stdio: 'ignore' });
    execSync(`reg add "${key}" /v "Publisher" /t REG_SZ /d "Charon Technologies" /f`, { stdio: 'ignore' });
    execSync(`reg add "${key}" /v "InstallLocation" /t REG_SZ /d "${installPath}" /f`, { stdio: 'ignore' });
    execSync(`reg add "${key}" /v "DisplayIcon" /t REG_SZ /d "${exePath}" /f`, { stdio: 'ignore' });
    execSync(`reg add "${key}" /v "UninstallString" /t REG_SZ /d "\\"${uninstallBat}\\"" /f`, { stdio: 'ignore' });
    execSync(`reg add "${key}" /v "NoModify" /t REG_DWORD /d 1 /f`, { stdio: 'ignore' });
    execSync(`reg add "${key}" /v "NoRepair" /t REG_DWORD /d 1 /f`, { stdio: 'ignore' });

    // Generate uninstall.bat
    const batContent = `@echo off
echo Uninstalling Charon Game Launcher...
timeout /t 1 /nobreak >nul
reg delete "${key}" /f >nul 2>&1
del /f /q "%USERPROFILE%\\Desktop\\Charon Game Launcher.lnk" >nul 2>&1
rmdir /s /q "%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Charon Game Launcher" >nul 2>&1
rmdir /s /q "${installPath}" >nul 2>&1
echo Done!
exit
`;
    fs.writeFileSync(uninstallBat, batContent, 'utf8');
  } catch (e) {
    console.warn('Failed to write registry uninstall key:', e.message);
  }
}

// -------------------------------------------------------------
// Helper: Extract Payload Archive
// -------------------------------------------------------------
async function extractPayload(destDir, onProgress) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  // Look for payload.bin or unpacked source directory
  const possiblePayloads = [
    path.join(__dirname, '..', 'build', 'payload.bin'),
    path.join(__dirname, 'payload.bin'),
    path.join(process.resourcesPath || '', 'payload.bin'),
    path.join(__dirname, '..', '..', 'launcher', 'dist-installer', 'win-unpacked')
  ];

  let sourcePayload = null;
  let isDirectory = false;
  for (const p of possiblePayloads) {
    if (fs.existsSync(p)) {
      sourcePayload = p;
      isDirectory = fs.statSync(p).isDirectory();
      break;
    }
  }

  if (!sourcePayload) {
    throw new Error('Installer payload source not found');
  }

  if (isDirectory) {
    // Copy directly from unpacked directory
    function copyDirRecursive(src, dst, allFiles = []) {
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const ent of entries) {
        const srcPath = path.join(src, ent.name);
        const dstPath = path.join(dst, ent.name);
        if (ent.isDirectory()) {
          if (!fs.existsSync(dstPath)) fs.mkdirSync(dstPath, { recursive: true });
          copyDirRecursive(srcPath, dstPath, allFiles);
        } else {
          allFiles.push({ srcPath, dstPath, rel: path.relative(sourcePayload, srcPath) });
        }
      }
      return allFiles;
    }

    const filesToCopy = copyDirRecursive(sourcePayload, destDir);
    const total = filesToCopy.length;
    let done = 0;
    const startTime = Date.now();

    for (const f of filesToCopy) {
      if (abortFlag) break;
      fs.copyFileSync(f.srcPath, f.dstPath);
      done++;
      const elapsed = Math.max((Date.now() - startTime) / 1000, 0.1);
      const speedMB = ((done * 2.5) / elapsed).toFixed(1);
      const pct = (done / total) * 85; // 0 - 85% for extraction

      if (onProgress) {
        onProgress({
          percent: Number(pct.toFixed(1)),
          file: `Installing: ${f.rel}`,
          speed: `${speedMB} MB/s`,
          filesDone: done,
          filesTotal: total,
          eta: `${Math.ceil((total - done) / ((done / elapsed) || 1))}s`
        });
      }
    }
  } else {
    // Parse binary archive: [21B header][entries: 4B nameLen, name, 8B dataLen, data]
    const fd = fs.openSync(sourcePayload, 'r');
    const headerBuf = Buffer.alloc(21);
    fs.readSync(fd, headerBuf, 0, 21, 0);

    const magic = headerBuf.slice(0, 4).toString('ascii');
    if (magic !== 'CHRN') {
      fs.closeSync(fd);
      throw new Error(`Invalid payload magic: ${magic}`);
    }

    const payloadSize = Number(headerBuf.readBigUInt64LE(12));
    const stat = fs.statSync(sourcePayload);
    let offset = 21;
    let filesDone = 0;
    const startTime = Date.now();

    while (offset < stat.size && !abortFlag) {
      const lenBuf = Buffer.alloc(4);
      if (fs.readSync(fd, lenBuf, 0, 4, offset) < 4) break;
      offset += 4;
      const nameLen = lenBuf.readUInt32LE(0);

      const nameBuf = Buffer.alloc(nameLen);
      fs.readSync(fd, nameBuf, 0, nameLen, offset);
      offset += nameLen;
      const relPath = nameBuf.toString('utf8');

      const dataLenBuf = Buffer.alloc(8);
      fs.readSync(fd, dataLenBuf, 0, 8, offset);
      offset += 8;
      const dataLen = Number(dataLenBuf.readBigUInt64LE(0));

      const fileData = Buffer.alloc(dataLen);
      fs.readSync(fd, fileData, 0, dataLen, offset);
      offset += dataLen;

      const targetPath = path.join(destDir, relPath);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetPath, fileData);

      filesDone++;
      const elapsed = Math.max((Date.now() - startTime) / 1000, 0.1);
      const pct = Math.min((offset / stat.size) * 85, 85);
      const speedMB = ((offset / 1024 / 1024) / elapsed).toFixed(1);

      if (onProgress) {
        onProgress({
          percent: Number(pct.toFixed(1)),
          file: `Extracting: ${relPath}`,
          speed: `${speedMB} MB/s`,
          filesDone,
          filesTotal: 80,
          eta: `${Math.ceil((stat.size - offset) / ((offset / elapsed) || 1))}s`
        });
      }
    }
    fs.closeSync(fd);
  }
}

// -------------------------------------------------------------
// Helper: Download Online Patch
// -------------------------------------------------------------
function downloadOnlinePatch(patchUrl, destAsar, onProgress) {
  return new Promise((resolve, reject) => {
    if (!patchUrl) return resolve();
    const tempDownload = `${destAsar}.download`;
    const file = fs.createWriteStream(tempDownload);

    const startTime = Date.now();
    let downloadedBytes = 0;

    function getWithRedirect(url) {
      https.get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return getWithRedirect(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(tempDownload); } catch (e) {}
          return resolve(); // Soft fallback to bundled asar
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);

        res.on('data', (chunk) => {
          if (abortFlag) {
            res.destroy();
            file.close();
            try { fs.unlinkSync(tempDownload); } catch (e) {}
            return reject(new Error('Aborted'));
          }

          downloadedBytes += chunk.length;
          file.write(chunk);

          const elapsed = Math.max((Date.now() - startTime) / 1000, 0.1);
          const bps = downloadedBytes / elapsed;
          const speedMB = (bps / 1024 / 1024).toFixed(1);
          const pct = totalBytes > 0 
            ? 85 + (downloadedBytes / totalBytes) * 13 
            : 90;

          if (onProgress) {
            onProgress({
              percent: Number(pct.toFixed(1)),
              file: `Downloading latest update: ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB / ${(totalBytes / 1024 / 1024).toFixed(1)} MB`,
              speed: `${speedMB} MB/s`,
              filesDone: 1,
              filesTotal: 1,
              eta: totalBytes > 0 ? `${Math.ceil((totalBytes - downloadedBytes) / (bps || 1))}s` : '--'
            });
          }
        });

        res.on('end', () => {
          file.end(() => {
            try {
              if (fs.existsSync(destAsar)) fs.unlinkSync(destAsar);
              fs.renameSync(tempDownload, destAsar);
            } catch (e) {
              console.warn('Failed to swap downloaded asar:', e.message);
            }
            resolve();
          });
        });

        res.on('error', (err) => {
          file.close();
          try { fs.unlinkSync(tempDownload); } catch (e) {}
          resolve(); // Fallback cleanly
        });
      }).on('error', () => {
        file.close();
        try { fs.unlinkSync(tempDownload); } catch (e) {}
        resolve(); // Fallback cleanly
      });
    }

    getWithRedirect(patchUrl);
  });
}

// -------------------------------------------------------------
// Core Installation Procedure
// -------------------------------------------------------------
async function executeInstallation(targetPath, shortcuts, version, patchUrl, onProgress) {
  abortFlag = false;
  if (onProgress) {
    onProgress({ percent: 2, file: 'Preparing installation environment...', speed: '--', filesDone: 0, filesTotal: 80, eta: '--' });
  }

  // Step 1: Extract core files
  await extractPayload(targetPath, onProgress);

  // Step 2: Download newer patch if available
  if (patchUrl && !abortFlag) {
    const destAsar = path.join(targetPath, 'resources', 'app.asar');
    await downloadOnlinePatch(patchUrl, destAsar, onProgress);
  }

  // Step 3: Shortcuts & Registry
  if (!abortFlag) {
    if (onProgress) {
      onProgress({ percent: 99, file: 'Configuring Windows integration and shortcuts...', speed: '--', filesDone: 80, filesTotal: 80, eta: '1s' });
    }
    const desktop = shortcuts?.desktop !== false;
    const startMenu = shortcuts?.startMenu !== false;
    createShortcuts(targetPath, desktop, startMenu);
    writeRegistryUninstallKey(targetPath, version || '1.0.0');
  }

  if (onProgress) {
    onProgress({ percent: 100, file: 'Installation complete!', speed: '--', filesDone: 80, filesTotal: 80, eta: '0s' });
  }
}

// -------------------------------------------------------------
// Window Creation & Event Bridge
// -------------------------------------------------------------
function createInstallerWindow() {
  const candidateIcons = [
    path.join(__dirname, 'icon.ico'),
    path.join(__dirname, '..', '..', 'launcher', 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.ico')
  ];
  let iconPath = undefined;
  for (const p of candidateIcons) {
    if (fs.existsSync(p)) {
      iconPath = p;
      break;
    }
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#0b0d12',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'installer_preload.js'),
      nodeIntegration: false,
      contextIsolation: false
    }
  });

  const candidateUiPaths = [
    path.join(__dirname, 'src', 'ui_dist', 'index.html'),
    path.join(__dirname, 'ui_dist', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(__dirname, '..', 'src', 'ui_dist', 'index.html'),
    path.join(__dirname, '..', 'ui', 'dist', 'index.html')
  ];
  let uiPath = null;
  for (const p of candidateUiPaths) {
    if (fs.existsSync(p)) {
      uiPath = p;
      break;
    }
  }

  if (uiPath) {
    mainWindow.loadFile(uiPath);
  } else {
    console.error('Failed to locate installer UI html bundle');
  }

  ipcMain.on('webview-message', async (event, rawMsg) => {
    try {
      const msg = typeof rawMsg === 'string' ? JSON.parse(rawMsg) : rawMsg;
      const cmd = msg.cmd;

      if (cmd === 'getSystemInfo') {
        const info = getSystemInfo();
        mainWindow.webContents.send('webview-event', { event: 'systemInfo', ...info });
      } else if (cmd === 'browseFolder') {
        const res = dialog.showOpenDialogSync(mainWindow, { properties: ['openDirectory'] });
        if (res && res[0]) {
          mainWindow.webContents.send('webview-event', { event: 'folderSelected', path: res[0] });
        }
      } else if (cmd === 'setInstallPath') {
        mainWindow.webContents.send('webview-event', { event: 'pathValidation', valid: true });
      } else if (cmd === 'startInstall') {
        const targetPath = msg.path || getSystemInfo().defaultPath;
        const shortcuts = msg.shortcuts || { desktop: true, startMenu: true };
        const version = msg.version || '1.0.0';
        const patchUrl = msg.patchUrl || '';

        executeInstallation(targetPath, shortcuts, version, patchUrl, (prog) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('webview-event', { event: 'progress', ...prog });
          }
        }).then(() => {
          if (mainWindow && !mainWindow.isDestroyed() && !abortFlag) {
            mainWindow.webContents.send('webview-event', { event: 'complete', installPath: targetPath });
          }
        }).catch((err) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('webview-event', { event: 'error', message: err.message });
          }
        });
      } else if (cmd === 'launchApp') {
        const targetPath = msg.path || getSystemInfo().defaultPath;
        const exePath = path.join(targetPath, 'Charon Game Launcher.exe');
        if (fs.existsSync(exePath)) {
          const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
          child.unref();
        }
        app.quit();
      } else if (cmd === 'abort') {
        abortFlag = true;
      }
    } catch (e) {
      console.error('Error handling webview message:', e);
    }
  });
}

// -------------------------------------------------------------
// CLI Argument Handling (Silent / Update / Normal)
// -------------------------------------------------------------
const args = process.argv.slice(1);
const isSilent = args.includes('/S') || args.includes('/s') || args.includes('--silent') || args.includes('-silent');
const isUpdate = args.includes('--update');

if (isSilent) {
  const targetIdx = args.indexOf('--target');
  const targetPath = (targetIdx !== -1 && args[targetIdx + 1]) ? args[targetIdx + 1] : getSystemInfo().defaultPath;
  const noShortcuts = args.includes('--no-shortcuts');

  console.log(`[Silent Installer] Installing to: ${targetPath}`);
  executeInstallation(targetPath, { desktop: !noShortcuts, startMenu: !noShortcuts }, '1.0.0', '')
    .then(() => {
      console.log('[Silent Installer] Installation completed successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Silent Installer] Failed:', err);
      process.exit(1);
    });
} else if (isUpdate) {
  const updateIdx = args.indexOf('--update');
  const patchFile = args[updateIdx + 1];
  const targetIdx = args.indexOf('--target');
  const targetDir = args[targetIdx + 1];

  console.log(`[Updater] Applying patch: ${patchFile} -> ${targetDir}`);
  try {
    const destAsar = path.join(targetDir, 'resources', 'app.asar');
    const backupAsar = `${destAsar}.old`;
    if (fs.existsSync(destAsar)) fs.copyFileSync(destAsar, backupAsar);
    fs.copyFileSync(patchFile, destAsar);
    console.log('[Updater] Patch applied successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[Updater] Patch application failed:', err);
    process.exit(1);
  }
} else {
  app.whenReady().then(createInstallerWindow);
}
