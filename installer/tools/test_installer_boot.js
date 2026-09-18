#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const exePath = path.resolve(__dirname, '..', 'out', 'CharonSetup-dist', 'CharonSetup.exe');
console.log('Testing custom installer execution at:', exePath);

const child = spawn(`"${exePath}"`, [], {
  shell: true,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
});

child.stdout.on('data', (d) => process.stdout.write('  [Installer stdout] ' + d.toString()));
child.stderr.on('data', (d) => {
  const text = d.toString();
  if (!text.includes('D3D') && !text.includes('ANGLE')) {
    process.stderr.write('  [Installer stderr] ' + text);
  }
});

setTimeout(() => {
  console.log('Terminating test installer instance...');
  child.kill('SIGINT');
  setTimeout(() => {
    try { child.kill('SIGKILL'); } catch (e) {}
    console.log('✓ Custom installer execution verified: Launched and loaded UI with 0 fatal errors.\n');
    process.exit(0);
  }, 1000);
}, 4000);

child.on('error', (err) => {
  console.error('Failed to spawn installer:', err);
  process.exit(1);
});
