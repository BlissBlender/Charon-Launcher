# Charon Installer

A custom, modern Windows installer for the Charon Game Launcher — built to replace NSIS with something beautiful.

## Architecture

```
installer/
├── CMakeLists.txt              # C++ build config (MSVC + WebView2)
├── src/                        # Native C++17 installer host
│   ├── main.cpp                # WinMain, frameless window, WebView2
│   ├── js_bridge.h/cpp         # JSON postMessage bridge (JS ↔ C++)
│   ├── installer_engine.h/cpp  # File extraction, registry, shortcuts
│   ├── payload.h/cpp           # LZMA decompression engine
│   ├── elevation.h/cpp         # UAC elevation helper
│   ├── uninstaller.h/cpp       # Uninstaller generator
│   ├── resource.h              # Resource IDs
│   └── resource.rc             # Icon, manifest, embedded HTML
├── ui/                         # React installer UI
│   ├── src/                    # React + Tailwind + Framer Motion
│   └── dist/                   # Built single-file HTML output
├── tools/
│   ├── pack_payload.py         # Payload packer (LZMA2 compression)
│   └── build_installer.ps1     # End-to-end build pipeline
├── build/                      # CMake build artifacts (gitignored)
└── out/                        # Final CharonSetup.exe output
```

## How It Works

1. **Native C++ host** (~2 MB) creates a frameless dark window
2. **WebView2** (built into Windows 10/11) renders the React installer UI
3. User chooses install path and options through the beautiful animated UI
4. C++ engine **extracts the LZMA-compressed payload** to the install directory
5. Creates **shortcuts**, **registry entries**, and an **uninstaller**
6. Optionally launches the app

## Prerequisites

- **Windows 10 21H2+** or **Windows 11** (for WebView2 runtime)
- **Visual Studio 2022 Build Tools** (C++ desktop workload)
- **Node.js 18+** and **npm**
- **Python 3.10+** (for the payload packer)
- **CMake 3.20+**

## Building

### Quick Build (everything)

```powershell
.\tools\build_installer.ps1
```

### Build with options

```powershell
# Skip rebuilding the Electron app (use existing win-unpacked/)
.\tools\build_installer.ps1 -SkipElectronBuild

# Clean build
.\tools\build_installer.ps1 -Clean

# Uncompressed payload (faster build, larger output)
.\tools\build_installer.ps1 -NoCompress
```

### Manual Steps

```powershell
# 1. Build the Electron app
cd launcher
npm run build
npx electron-builder --dir

# 2. Build the installer UI
cd ../installer/ui
npm install
npm run build

# 3. Pack the payload
cd ../tools
python pack_payload.py ../../launcher/dist-installer/win-unpacked ../build/payload.bin

# 4. Build the C++ host
cd ..
cmake -B build/cmake -G "Visual Studio 17 2022" -A x64
cmake --build build/cmake --config Release

# 5. Append payload to exe
python tools/pack_payload.py --append ../launcher/dist-installer/win-unpacked out/CharonSetup.exe
```

## Testing the Payload Packer

```powershell
python tools/pack_payload.py --test ../launcher/dist-installer/win-unpacked
```

This runs a full roundtrip: pack → compress → decompress → unpack → verify every file matches.

## Output

The final installer is: `out/CharonSetup.exe`

This single executable contains:
- The C++ native host (~2 MB)
- The React installer UI (embedded as a resource, ~200 KB)
- The entire Charon Game Launcher app (LZMA compressed payload)
