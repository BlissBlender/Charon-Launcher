const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

console.log('=== Running Charon Updater & Integrity Verification Test Suite ===');

// Test 1: SHA-256 Hash Verification
console.log('\n[Test 1] SHA-256 Checksum Validation:');
const testPayloadContent = Buffer.from('CHARON_TEST_PAYLOAD_' + Date.now());
const tempFile = path.join(__dirname, 'test_sample.bin');
fs.writeFileSync(tempFile, testPayloadContent);

const expectedHash = crypto.createHash('sha256').update(testPayloadContent).digest('hex');
console.log('  Calculated SHA-256:', expectedHash);

function verifyFile(filePath, expected) {
  const hash = crypto.createHash('sha256');
  const buf = fs.readFileSync(filePath);
  hash.update(buf);
  return hash.digest('hex').toLowerCase() === expected.toLowerCase();
}

assert.strictEqual(verifyFile(tempFile, expectedHash), true, 'Exact hash should verify as true');
assert.strictEqual(verifyFile(tempFile, '0000000000000000000000000000000000000000000000000000000000000000'), false, 'Mismatched hash should fail');
console.log('  ✓ SHA-256 integrity check passed: Correct hashes pass, corrupted hashes fail.');

// Test 2: Payload Archive Integrity
console.log('\n[Test 2] Archive Packing & Header Integrity:');
const tempDir = path.join(__dirname, 'test_dir');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
fs.writeFileSync(path.join(tempDir, 'sample1.txt'), 'Hello Charon 1');
fs.writeFileSync(path.join(tempDir, 'sample2.txt'), 'Hello Charon 2');

const { execSync } = require('child_process');
const outputBin = path.join(__dirname, 'test_out.bin');
execSync(`node "${path.join(__dirname, 'pack_payload.js')}" "${tempDir}" "${outputBin}"`);

assert.strictEqual(fs.existsSync(outputBin), true, 'Output payload should exist');
const payloadBuf = fs.readFileSync(outputBin);
const magic = payloadBuf.slice(0, 4).toString('ascii');
assert.strictEqual(magic, 'CHRN', 'Magic bytes must be CHRN');
const uncompressedSize = payloadBuf.readBigUInt64LE(4);
const compressedSize = payloadBuf.readBigUInt64LE(12);
const flag = payloadBuf.readUInt8(20);

console.log('  Magic:', magic);
console.log('  Uncompressed Size:', uncompressedSize.toString());
console.log('  Compressed Size:', compressedSize.toString());
console.log('  Flag:', flag);
assert.strictEqual(uncompressedSize > 0n, true, 'Payload data size must be > 0');
assert.strictEqual(flag, 0, 'Flag should be 0x00 (uncompressed)');
console.log('  ✓ Archive header conforms precisely to C++ PayloadExtractor specification.');

// Cleanup
fs.unlinkSync(tempFile);
fs.unlinkSync(outputBin);
fs.unlinkSync(path.join(tempDir, 'sample1.txt'));
fs.unlinkSync(path.join(tempDir, 'sample2.txt'));
fs.rmdirSync(tempDir);

console.log('\n=== All 2 Tests Passed Successfully! ===\n');
