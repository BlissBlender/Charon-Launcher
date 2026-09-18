#!/usr/bin/env python3
"""
Charon Installer — Payload Packer
==================================
Takes the Electron win-unpacked/ directory and compresses it into a single
payload blob that gets appended to the installer .exe as a PE overlay.

Archive format (before compression):
  For each file:
    [4 bytes]  name_length (little-endian uint32)
    [N bytes]  relative file path (UTF-8)
    [8 bytes]  data_length (little-endian uint64)
    [M bytes]  file data

Payload wrapper (what gets appended to the .exe):
    [4 bytes]  magic "CHRN"
    [8 bytes]  uncompressed_size (little-endian uint64)
    [8 bytes]  compressed_size (little-endian uint64)
    [1 byte]   compression_flag (0x00 = none, 0x01 = LZMA)
    [C bytes]  compressed (or raw) archive data

Usage:
    python pack_payload.py <source_dir> <output_payload>
    python pack_payload.py --test <source_dir>    # roundtrip verification
    python pack_payload.py --append <source_dir> <installer.exe>  # append to exe
"""

import os
import sys
import struct
import lzma
import tempfile
import hashlib
import time
from pathlib import Path


MAGIC = b"CHRN"
COMPRESS_NONE = 0x00
COMPRESS_LZMA = 0x01


def collect_files(source_dir: str) -> list[tuple[str, str]]:
    """Collect all files in source_dir, returning (relative_path, absolute_path) pairs."""
    source = Path(source_dir).resolve()
    if not source.is_dir():
        raise FileNotFoundError(f"Source directory not found: {source}")

    files = []
    for root, dirs, filenames in os.walk(source):
        # Skip common junk
        dirs[:] = [d for d in dirs if d not in (".git", "__pycache__", "node_modules")]
        for fname in sorted(filenames):
            abs_path = os.path.join(root, fname)
            rel_path = os.path.relpath(abs_path, source)
            # Normalize to forward slashes for cross-platform archive
            rel_path = rel_path.replace("\\", "/")
            files.append((rel_path, abs_path))

    return files


def create_archive(files: list[tuple[str, str]], progress: bool = True) -> bytes:
    """Create the raw (uncompressed) archive from a list of (rel_path, abs_path) pairs."""
    chunks = []
    total_size = sum(os.path.getsize(p) for _, p in files)
    processed = 0

    for i, (rel_path, abs_path) in enumerate(files):
        name_bytes = rel_path.encode("utf-8")
        file_size = os.path.getsize(abs_path)

        # Header: name_length (4 bytes) + name + data_length (8 bytes)
        chunks.append(struct.pack("<I", len(name_bytes)))
        chunks.append(name_bytes)
        chunks.append(struct.pack("<Q", file_size))

        # File data
        with open(abs_path, "rb") as f:
            chunks.append(f.read())

        processed += file_size
        if progress and (i % 50 == 0 or i == len(files) - 1):
            pct = (processed / total_size * 100) if total_size > 0 else 100
            print(f"  Archiving: {pct:5.1f}%  ({i + 1}/{len(files)} files)  {rel_path}")

    return b"".join(chunks)


def compress_archive(raw_data: bytes, progress: bool = True) -> tuple[bytes, int]:
    """Compress the archive with LZMA and return (compressed_data, flag)."""
    if progress:
        print(f"  Raw archive size: {len(raw_data):,} bytes ({len(raw_data) / 1024 / 1024:.1f} MB)")
        print("  Compressing with LZMA...")

    start = time.time()

    # Use LZMA with high compression
    compressed = lzma.compress(
        raw_data,
        format=lzma.FORMAT_ALONE,
        filters=[{
            "id": lzma.FILTER_LZMA1,
            "preset": 6,  # Good balance of speed and ratio
            "dict_size": 64 * 1024 * 1024,  # 64 MB dictionary
        }]
    )

    elapsed = time.time() - start
    ratio = len(compressed) / len(raw_data) * 100 if raw_data else 0

    if progress:
        print(f"  Compressed size:  {len(compressed):,} bytes ({len(compressed) / 1024 / 1024:.1f} MB)")
        print(f"  Compression ratio: {ratio:.1f}%")
        print(f"  Time: {elapsed:.1f}s")

    return compressed, COMPRESS_LZMA


def create_payload(source_dir: str, compress: bool = True, progress: bool = True) -> bytes:
    """Create the full payload blob from a source directory."""
    if progress:
        print(f"Packing payload from: {source_dir}")

    files = collect_files(source_dir)
    if not files:
        raise ValueError(f"No files found in {source_dir}")

    if progress:
        print(f"  Found {len(files)} files")

    raw_archive = create_archive(files, progress=progress)

    if compress:
        data, flag = compress_archive(raw_archive, progress=progress)
    else:
        data = raw_archive
        flag = COMPRESS_NONE

    # Build the payload wrapper
    payload = b"".join([
        MAGIC,                                      # 4 bytes: "CHRN"
        struct.pack("<Q", len(raw_archive)),         # 8 bytes: uncompressed size
        struct.pack("<Q", len(data)),                # 8 bytes: compressed size
        struct.pack("<B", flag),                     # 1 byte:  compression flag
        data,                                        # N bytes: archive data
    ])

    if progress:
        print(f"  Final payload size: {len(payload):,} bytes ({len(payload) / 1024 / 1024:.1f} MB)")

    return payload


def write_payload(payload: bytes, output_path: str):
    """Write payload blob to a file."""
    with open(output_path, "wb") as f:
        f.write(payload)
    print(f"  Written to: {output_path}")


def append_to_exe(payload: bytes, exe_path: str):
    """Append the payload blob to the end of a PE executable."""
    if not os.path.isfile(exe_path):
        raise FileNotFoundError(f"Executable not found: {exe_path}")

    with open(exe_path, "ab") as f:
        f.write(payload)

    print(f"  Appended {len(payload):,} bytes to: {exe_path}")


def find_pe_end(exe_path: str) -> int:
    """Find the end offset of the PE file (where overlay data starts)."""
    with open(exe_path, "rb") as f:
        # Read DOS header
        dos_header = f.read(64)
        if dos_header[:2] != b"MZ":
            raise ValueError("Not a valid PE file")

        # e_lfanew: offset to PE signature
        pe_offset = struct.unpack_from("<I", dos_header, 60)[0]

        # Read PE signature
        f.seek(pe_offset)
        pe_sig = f.read(4)
        if pe_sig != b"PE\x00\x00":
            raise ValueError("Invalid PE signature")

        # COFF header
        coff_header = f.read(20)
        num_sections = struct.unpack_from("<H", coff_header, 2)[0]
        optional_header_size = struct.unpack_from("<H", coff_header, 16)[0]

        # Skip optional header
        f.seek(pe_offset + 4 + 20 + optional_header_size)

        # Read section headers to find the last one
        pe_end = 0
        for _ in range(num_sections):
            section = f.read(40)
            raw_data_size = struct.unpack_from("<I", section, 16)[0]
            raw_data_ptr = struct.unpack_from("<I", section, 20)[0]
            section_end = raw_data_ptr + raw_data_size
            pe_end = max(pe_end, section_end)

    return pe_end


def extract_payload_from_exe(exe_path: str) -> bytes | None:
    """Extract the payload blob from a PE overlay."""
    pe_end = find_pe_end(exe_path)

    with open(exe_path, "rb") as f:
        f.seek(pe_end)
        magic = f.read(4)
        if magic != MAGIC:
            return None

        uncompressed_size = struct.unpack("<Q", f.read(8))[0]
        compressed_size = struct.unpack("<Q", f.read(8))[0]
        flag = struct.unpack("<B", f.read(1))[0]
        data = f.read(compressed_size)

    return data, uncompressed_size, flag


def decompress_archive(data: bytes, flag: int) -> bytes:
    """Decompress archive data based on the compression flag."""
    if flag == COMPRESS_NONE:
        return data
    elif flag == COMPRESS_LZMA:
        return lzma.decompress(data, format=lzma.FORMAT_ALONE)
    else:
        raise ValueError(f"Unknown compression flag: {flag}")


def parse_archive(raw_data: bytes) -> list[tuple[str, bytes]]:
    """Parse the raw archive into a list of (filename, data) pairs."""
    entries = []
    offset = 0

    while offset < len(raw_data):
        # Read name length
        if offset + 4 > len(raw_data):
            break
        name_len = struct.unpack_from("<I", raw_data, offset)[0]
        offset += 4

        # Read name
        if offset + name_len > len(raw_data):
            break
        name = raw_data[offset:offset + name_len].decode("utf-8")
        offset += name_len

        # Read data length
        if offset + 8 > len(raw_data):
            break
        data_len = struct.unpack_from("<Q", raw_data, offset)[0]
        offset += 8

        # Read data
        if offset + data_len > len(raw_data):
            break
        file_data = raw_data[offset:offset + data_len]
        offset += data_len

        entries.append((name, file_data))

    return entries


def verify_roundtrip(source_dir: str):
    """Pack and unpack, verifying all files match exactly."""
    print("=" * 60)
    print("ROUNDTRIP VERIFICATION TEST")
    print("=" * 60)

    # Pack
    files = collect_files(source_dir)
    raw_archive = create_archive(files, progress=False)
    compressed, flag = compress_archive(raw_archive, progress=False)

    print(f"  Source files:      {len(files)}")
    print(f"  Raw archive:       {len(raw_archive):,} bytes")
    print(f"  Compressed:        {len(compressed):,} bytes")

    # Decompress
    decompressed = decompress_archive(compressed, flag)
    assert len(decompressed) == len(raw_archive), "Decompressed size mismatch!"

    # Parse
    entries = parse_archive(decompressed)
    assert len(entries) == len(files), f"Entry count mismatch: {len(entries)} vs {len(files)}"

    # Verify each file
    errors = 0
    for (rel_path, abs_path), (entry_name, entry_data) in zip(files, entries):
        assert rel_path == entry_name, f"Name mismatch: {rel_path} vs {entry_name}"

        with open(abs_path, "rb") as f:
            original_data = f.read()

        if original_data != entry_data:
            print(f"  FAIL: {rel_path} — data mismatch!")
            errors += 1
        else:
            pass  # OK

    if errors == 0:
        print(f"  ✓ All {len(files)} files verified successfully!")
    else:
        print(f"  ✗ {errors} files had data mismatches!")
        sys.exit(1)

    print("=" * 60)


def print_usage():
    print("Charon Installer — Payload Packer")
    print()
    print("Usage:")
    print(f"  python {sys.argv[0]} <source_dir> <output.bin>")
    print(f"  python {sys.argv[0]} --append <source_dir> <installer.exe>")
    print(f"  python {sys.argv[0]} --test <source_dir>")
    print(f"  python {sys.argv[0]} --no-compress <source_dir> <output.bin>")
    print()
    print("Examples:")
    print(f"  python {sys.argv[0]} ../launcher/dist-installer/win-unpacked payload.bin")
    print(f"  python {sys.argv[0]} --append ../launcher/dist-installer/win-unpacked out/CharonSetup.exe")
    print(f"  python {sys.argv[0]} --test ../launcher/dist-installer/win-unpacked")


def main():
    if len(sys.argv) < 2:
        print_usage()
        sys.exit(1)

    if sys.argv[1] == "--test":
        if len(sys.argv) < 3:
            print("Error: --test requires <source_dir>")
            sys.exit(1)
        verify_roundtrip(sys.argv[2])

    elif sys.argv[1] == "--append":
        if len(sys.argv) < 4:
            print("Error: --append requires <source_dir> <installer.exe>")
            sys.exit(1)
        payload = create_payload(sys.argv[2])
        append_to_exe(payload, sys.argv[3])

    elif sys.argv[1] == "--no-compress":
        if len(sys.argv) < 4:
            print("Error: --no-compress requires <source_dir> <output.bin>")
            sys.exit(1)
        payload = create_payload(sys.argv[2], compress=False)
        write_payload(payload, sys.argv[3])

    else:
        if len(sys.argv) < 3:
            print_usage()
            sys.exit(1)
        payload = create_payload(sys.argv[1])
        write_payload(payload, sys.argv[2])


if __name__ == "__main__":
    main()
