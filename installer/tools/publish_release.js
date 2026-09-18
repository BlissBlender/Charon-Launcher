#!/usr/bin/env node
/**
 * Charon One-Click Release Publisher
 * ============================================================================
 * Automatically packages and publishes a new release to GitHub with:
 *  1. Versioned custom installer (e.g. Charon-Custom-Installer-v1.0.0.zip)
 *  2. Permanent unversioned custom installer (Charon-Custom-Installer.zip)
 *     -> powers: https://github.com/BlissBlender/Charon-Launcher/releases/latest/download/Charon-Custom-Installer.zip
 *  3. Standard Windows setup (Charon-Game-Launcher-Setup.exe & versioned)
 *  4. Differential update payloads (app.asar & latest.yml)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const LAUNCHER_DIR = path.join(ROOT_DIR, 'launcher');
const INSTALLER_DIR = path.join(ROOT_DIR, 'installer');
const OUT_DIR = path.join(INSTALLER_DIR, 'out');
const pkg = JSON.parse(fs.readFileSync(path.join(LAUNCHER_DIR, 'package.json'), 'utf8'));
const version = pkg.version;
const tag = `v${version}`;

console.log('===========================================================');
console.log(`  CHARON RELEASE PUBLISHER: ${tag}`);
console.log('===========================================================\n');

// 1. Build launcher dist if needed
console.log('[1/4] Ensuring launcher dist & installer are built...');
const setupExe = path.join(LAUNCHER_DIR, 'dist-installer', `Charon Game Launcher Setup ${version}.exe`);
if (!fs.existsSync(setupExe)) {
  console.log('  Running launcher build & packaging...');
  execSync('npm run dist', { cwd: LAUNCHER_DIR, stdio: 'inherit' });
}

// 2. Build custom installer
console.log('\n[2/4] Building custom high-tech installer...');
execSync(`node "${path.join(INSTALLER_DIR, 'tools', 'build_custom_installer.js')}"`, { stdio: 'inherit' });

// 3. Package single-file standalone installer executable
console.log('\n[3/4] Compiling single-file standalone installer (Charon-Custom-Installer.exe)...');
const makensisPath = 'C:\\Users\\USER\\AppData\\Local\\electron-builder\\Cache\\nsis\\nsis-3.0.4.1\\Bin\\makensis.exe';
const nsiScript = path.join(INSTALLER_DIR, 'tools', 'package_single_exe.nsi');
execSync(`"${makensisPath}" "${nsiScript}"`, { stdio: 'inherit' });

const singleExe = path.join(OUT_DIR, 'Charon-Custom-Installer.exe');
const versionedExe = path.join(OUT_DIR, `Charon-Custom-Installer-${tag}.exe`);
const cleanSetupExe = path.join(OUT_DIR, 'CharonSetup.exe');
fs.copyFileSync(singleExe, versionedExe);
fs.copyFileSync(singleExe, cleanSetupExe);

// Standard setup
const versionedSetup = path.join(OUT_DIR, `Charon-Game-Launcher-Setup-${version}.exe`);
const permanentSetup = path.join(OUT_DIR, 'Charon-Game-Launcher-Setup.exe');
fs.copyFileSync(setupExe, versionedSetup);
fs.copyFileSync(setupExe, permanentSetup);

// Copy app.asar and latest.yml
const asarSrc = path.join(LAUNCHER_DIR, 'dist-installer', 'win-unpacked', 'resources', 'app.asar');
const asarDst = path.join(OUT_DIR, 'app.asar');
if (fs.existsSync(asarSrc)) fs.copyFileSync(asarSrc, asarDst);

const ymlSrc = path.join(LAUNCHER_DIR, 'dist-installer', 'latest.yml');
const ymlDst = path.join(OUT_DIR, 'latest.yml');
if (fs.existsSync(ymlSrc)) fs.copyFileSync(ymlSrc, ymlDst);

// 4. Publish to GitHub Release
console.log(`\n[4/4] Publishing single-file assets to GitHub release ${tag}...`);
const notes = `Charon Game Launcher ${tag} Official Release. Includes standalone single-file custom installer, standard setup, and background differential update packages.`;

try {
  execSync(`gh release create ${tag} "${versionedExe}" "${singleExe}" "${cleanSetupExe}" "${versionedSetup}" "${permanentSetup}" "${asarDst}" "${ymlDst}" --title "Charon Game Launcher ${tag}" --notes "${notes}"`, { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log(`  ✓ Release ${tag} created and single-file assets uploaded.`);
} catch {
  console.log(`  Release ${tag} already exists. Uploading/clobbering assets...`);
  execSync(`gh release upload ${tag} "${versionedExe}" "${singleExe}" "${cleanSetupExe}" "${versionedSetup}" "${permanentSetup}" "${asarDst}" "${ymlDst}" --clobber`, { cwd: ROOT_DIR, stdio: 'inherit' });
  console.log(`  ✓ Single-file assets uploaded to existing release ${tag}.`);
}

console.log('\n===========================================================');
console.log('  RELEASE PUBLISHED SUCCESSFULLY ✓');
console.log('===========================================================');
console.log(`  Permanent Custom Installer Link (Single .exe for website):`);
console.log(`  -> https://github.com/BlissBlender/Charon-Launcher/releases/latest/download/Charon-Custom-Installer.exe\n`);
console.log(`  Permanent Standard Setup Link:`);
console.log(`  -> https://github.com/BlissBlender/Charon-Launcher/releases/latest/download/Charon-Game-Launcher-Setup.exe\n`);
console.log(`  Release Page:`);
console.log(`  -> https://github.com/BlissBlender/Charon-Launcher/releases/tag/${tag}\n`);

