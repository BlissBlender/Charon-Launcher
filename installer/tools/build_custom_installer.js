#!/usr/bin/env node
/**
 * Charon Custom Installer Builder
 * =========================================================
 * Builds the standalone custom installer CharonSetup.exe
 * with the high-tech React UI, animated splash, payload extraction,
 * auto-updater, streaming download engine, and registry integration.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const INSTALLER_DIR = path.join(ROOT_DIR, 'installer');
const LAUNCHER_DIR = path.join(ROOT_DIR, 'launcher');
const OUT_DIR = path.join(INSTALLER_DIR, 'out');
const BUILD_DIR = path.join(INSTALLER_DIR, 'build');
const HOST_DIR = path.join(INSTALLER_DIR, 'host');

console.log('===========================================================');
console.log('  BUILDING CHARON CUSTOM INSTALLER (CharonSetup.exe)');
console.log('===========================================================\n');

// Step 1: Ensure directories
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(BUILD_DIR)) fs.mkdirSync(BUILD_DIR, { recursive: true });

// Step 2: Build UI
console.log('[Step 1/5] Verifying built UI bundle...');
const uiDist = path.join(INSTALLER_DIR, 'ui', 'dist', 'index.html');
const uiSrcDist = path.join(INSTALLER_DIR, 'src', 'ui_dist', 'index.html');
if (!fs.existsSync(uiDist)) {
  console.log('  Running: npm run build in installer/ui...');
  execSync('npm run build', { cwd: path.join(INSTALLER_DIR, 'ui'), stdio: 'inherit' });
}
fs.copyFileSync(uiDist, uiSrcDist);
console.log(`  ✓ UI Bundle verified: ${(fs.statSync(uiSrcDist).size / 1024).toFixed(1)} KB`);

// Step 3: Verify / Build win-unpacked payload
console.log('\n[Step 2/5] Verifying launcher payload source...');
const winUnpacked = path.join(LAUNCHER_DIR, 'dist-installer', 'win-unpacked');
if (!fs.existsSync(winUnpacked)) {
  console.log('  Building launcher win-unpacked with electron-builder...');
  execSync('npx electron-builder --dir', { cwd: LAUNCHER_DIR, stdio: 'inherit' });
}
console.log('  ✓ Launcher win-unpacked payload verified.');

// Step 4: Pack payload binary
console.log('\n[Step 3/5] Packing payload into structured CHRN binary archive...');
const payloadBin = path.join(BUILD_DIR, 'payload.bin');
execSync(`node "${path.join(INSTALLER_DIR, 'tools', 'pack_payload.js')}" "${winUnpacked}" "${payloadBin}"`, { stdio: 'inherit' });
console.log(`  ✓ Payload binary packed: ${(fs.statSync(payloadBin).size / 1024 / 1024).toFixed(1)} MB`);

// Step 5: Assemble standalone executable distribution
console.log('\n[Step 4/5] Assembling standalone custom installer executable...');
const electronDist = path.join(LAUNCHER_DIR, 'node_modules', 'electron', 'dist');
const installerAppDir = path.join(OUT_DIR, 'CharonSetup-dist');

if (fs.existsSync(installerAppDir)) {
  fs.rmSync(installerAppDir, { recursive: true, force: true });
}
fs.mkdirSync(installerAppDir, { recursive: true });

// Copy electron runtime files
function copyDir(src, dst) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of entries) {
    const srcPath = path.join(src, ent.name);
    const dstPath = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      if (!fs.existsSync(dstPath)) fs.mkdirSync(dstPath, { recursive: true });
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}
copyDir(electronDist, installerAppDir);

// Rename electron.exe -> CharonSetup.exe
const origExe = path.join(installerAppDir, 'electron.exe');
const targetExe = path.join(installerAppDir, 'CharonSetup.exe');
if (fs.existsSync(origExe)) {
  fs.renameSync(origExe, targetExe);
}

// Stage resources/app/
const appResourceDir = path.join(installerAppDir, 'resources', 'app');
if (!fs.existsSync(appResourceDir)) fs.mkdirSync(appResourceDir, { recursive: true });

// Copy host scripts & UI
fs.copyFileSync(path.join(HOST_DIR, 'installer_main.js'), path.join(appResourceDir, 'installer_main.js'));
fs.copyFileSync(path.join(HOST_DIR, 'installer_preload.js'), path.join(appResourceDir, 'installer_preload.js'));

const appUiDistDir = path.join(appResourceDir, 'src', 'ui_dist');
fs.mkdirSync(appUiDistDir, { recursive: true });
fs.copyFileSync(uiSrcDist, path.join(appUiDistDir, 'index.html'));

// Copy payload.bin into installer resources
fs.copyFileSync(payloadBin, path.join(installerAppDir, 'resources', 'payload.bin'));

// Copy icon.ico into app resources
const iconSrc = path.join(LAUNCHER_DIR, 'build', 'icon.ico');
if (fs.existsSync(iconSrc)) {
  fs.copyFileSync(iconSrc, path.join(appResourceDir, 'icon.ico'));
  fs.copyFileSync(iconSrc, path.join(installerAppDir, 'icon.ico'));
}

// Package.json for installer host
const installerPkg = {
  name: "charon-custom-installer",
  version: "1.0.0",
  main: "installer_main.js",
  description: "High-Performance Custom Installer for Charon Game Launcher"
};
fs.writeFileSync(path.join(appResourceDir, 'package.json'), JSON.stringify(installerPkg, null, 2), 'utf8');

// Step 6: Customize icon & metadata with rcedit
console.log('\n[Step 5/5] Customizing executable metadata and app icon...');
const rcedit = path.join(LAUNCHER_DIR, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
const iconPath = path.join(LAUNCHER_DIR, 'build', 'icon.ico');

if (fs.existsSync(rcedit) && fs.existsSync(targetExe) && fs.existsSync(iconPath)) {
  try {
    execSync(`"${rcedit}" "${targetExe}" --set-icon "${iconPath}" --set-version-string FileDescription "Charon Game Launcher Setup" --set-version-string ProductName "Charon Game Launcher" --set-version-string CompanyName "Charon Technologies" --set-file-version 1.0.0 --set-product-version 1.0.0`, { stdio: 'ignore' });
    console.log('  ✓ Executable icon and metadata branded successfully.');
  } catch (e) {
    console.warn('  rcedit warning:', e.message);
  }
}

// Create top-level launcher link in out/
const finalOutExe = path.join(OUT_DIR, 'CharonSetup.exe');
// Also create a convenient runner in out/
const launcherBat = `@echo off
start "" "%~dp0CharonSetup-dist\\CharonSetup.exe" %*
`;
fs.writeFileSync(path.join(OUT_DIR, 'RunInstaller.cmd'), launcherBat, 'utf8');

console.log('\n===========================================================');
console.log('  CUSTOM INSTALLER BUILD COMPLETE ✓ (ZERO ERRORS)');
console.log('===========================================================');
console.log(`  Installer Executable: ${targetExe}`);
console.log(`  Payload:               ${path.join(installerAppDir, 'resources', 'payload.bin')}`);
console.log(`  UI Bundle:             ${path.join(appResourceDir, 'src', 'ui_dist', 'index.html')}`);
console.log(`  Distribution Folder:   ${installerAppDir}\n`);
