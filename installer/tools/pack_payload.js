#!/usr/bin/env node
/**
 * Charon Installer — Payload Packer (Node.js Native)
 * ===================================================
 * Packages the application directory into a structured archive and
 * appends it as an overlay to the C++ installer executable.
 * 
 * Zero external dependencies: Uses Node.js built-in fs, path, and crypto.
 */

const fs = require('fs');
const path = require('path');

const MAGIC = Buffer.from('CHRN', 'ascii');
const FLAG_UNCOMPRESSED = 0x00;

function collectFiles(dir, base = dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of list) {
    const fullPath = path.join(dir, item.name);
    const relPath = path.relative(base, fullPath).replace(/\\/g, '/');

    if (item.isDirectory()) {
      if (['.git', 'node_modules', '__pycache__'].includes(item.name)) continue;
      results = results.concat(collectFiles(fullPath, base));
    } else if (item.isFile()) {
      results.push({ relPath, fullPath });
    }
  }
  return results;
}

function createArchive(files) {
  const chunks = [];
  let totalSize = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const nameBuf = Buffer.from(file.relPath, 'utf8');
    const stat = fs.statSync(file.fullPath);
    const fileSize = stat.size;

    // Header: 4-byte name length + name + 8-byte file size
    const head = Buffer.alloc(4 + nameBuf.length + 8);
    head.writeUInt32LE(nameBuf.length, 0);
    nameBuf.copy(head, 4);
    head.writeBigUInt64LE(BigInt(fileSize), 4 + nameBuf.length);

    chunks.push(head);
    chunks.push(fs.readFileSync(file.fullPath));
    totalSize += fileSize;

    if (i % 50 === 0 || i === files.length - 1) {
      const pct = ((i + 1) / files.length * 100).toFixed(1);
      process.stdout.write(`\r  Archiving: [${pct}%] ${file.relPath.slice(0, 50).padEnd(50)}`);
    }
  }
  process.stdout.write('\n');
  return Buffer.concat(chunks);
}

function createPayload(sourceDir) {
  console.log(`[Packer] Scanning directory: ${sourceDir}`);
  const files = collectFiles(sourceDir);
  console.log(`[Packer] Found ${files.length} files to package.`);

  const rawArchive = createArchive(files);
  const rawSize = BigInt(rawArchive.length);

  // Payload wrapper: [4B "CHRN"][8B uncompressed_size][8B compressed_size][1B flag][archive]
  const header = Buffer.alloc(4 + 8 + 8 + 1);
  MAGIC.copy(header, 0);
  header.writeBigUInt64LE(rawSize, 4);
  header.writeBigUInt64LE(rawSize, 12);
  header.writeUInt8(FLAG_UNCOMPRESSED, 20);

  const finalPayload = Buffer.concat([header, rawArchive]);
  console.log(`[Packer] Packaged payload: ${(finalPayload.length / (1024 * 1024)).toFixed(2)} MB`);
  return finalPayload;
}

function appendToExe(payload, exePath) {
  if (!fs.existsSync(exePath)) {
    throw new Error(`Executable not found: ${exePath}`);
  }
  const beforeSize = fs.statSync(exePath).size;
  fs.appendFileSync(exePath, payload);
  const afterSize = fs.statSync(exePath).size;
  console.log(`[Packer] Successfully appended payload to: ${exePath}`);
  console.log(`[Packer] Final executable size: ${(afterSize / (1024 * 1024)).toFixed(2)} MB (+${((afterSize - beforeSize) / (1024 * 1024)).toFixed(2)} MB)`);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage:');
    console.log('  node pack_payload.js <source_dir> <output_payload.bin>');
    console.log('  node pack_payload.js --append <source_dir> <installer.exe>');
    process.exit(1);
  }

  if (args[0] === '--append') {
    const sourceDir = args[1];
    const exePath = args[2];
    const payload = createPayload(sourceDir);
    appendToExe(payload, exePath);
  } else {
    const sourceDir = args[0];
    const outputPath = args[1];
    const payload = createPayload(sourceDir);
    const outDir = path.dirname(outputPath);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, payload);
    console.log(`[Packer] Written payload to: ${outputPath}`);
  }
}

main();
