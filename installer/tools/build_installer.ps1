#Requires -Version 5.1
<#
.SYNOPSIS
    Charon Installer — End-to-End Build Pipeline
.DESCRIPTION
    Builds the complete Charon Game Launcher installer:
    1. Builds the Electron app (Vite + electron-builder --dir)
    2. Builds the installer UI (Vite → single HTML file)
    3. Packs the payload (win-unpacked → LZMA2 compressed blob)
    4. Builds the C++ installer host (CMake + MSVC)
    5. Appends the payload to the installer executable
.EXAMPLE
    .\build_installer.ps1
    .\build_installer.ps1 -SkipElectronBuild
    .\build_installer.ps1 -NoCompress
#>

param(
    [switch]$SkipElectronBuild,
    [switch]$SkipUIBuild,
    [switch]$NoCompress,
    [switch]$Clean,
    [string]$BuildType = "Release"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# ============================================================
# Paths
# ============================================================
$ProjectRoot     = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LauncherDir     = Join-Path $ProjectRoot "launcher"
$InstallerDir    = Join-Path $ProjectRoot "installer"
$InstallerSrcDir = Join-Path $InstallerDir "src"
$InstallerUIDir  = Join-Path $InstallerDir "ui"
$ToolsDir        = Join-Path $InstallerDir "tools"
$BuildDir        = Join-Path $InstallerDir "build"
$OutDir          = Join-Path $InstallerDir "out"

$WinUnpacked     = Join-Path $LauncherDir "dist-installer" "win-unpacked"
$PayloadBin      = Join-Path $BuildDir "payload.bin"
$UIDistHtml      = Join-Path $InstallerUIDir "dist" "index.html"
$ResourceHtml    = Join-Path $InstallerSrcDir "ui_dist" "index.html"
$FinalExe        = Join-Path $OutDir "CharonSetup.exe"

# ============================================================
# Helpers
# ============================================================
function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkCyan
    Write-Host "  $Message" -ForegroundColor Cyan
    Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor DarkCyan
}

function Assert-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        Write-Host "  ERROR: '$Name' not found in PATH." -ForegroundColor Red
        exit 1
    }
}

function Assert-File {
    param([string]$Path, [string]$Description)
    if (-not (Test-Path $Path)) {
        Write-Host "  ERROR: $Description not found at: $Path" -ForegroundColor Red
        exit 1
    }
}

$Stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

# ============================================================
# Step 0: Prerequisites Check
# ============================================================
Write-Step "Step 0: Checking Prerequisites"

Assert-Command "node"
Assert-Command "npm"

Write-Host "  ✓ node    $(node --version)" -ForegroundColor Green
Write-Host "  ✓ npm     $(npm --version)" -ForegroundColor Green

# Check for MSVC
$VSWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $VSWhere) {
    $VSPath = & $VSWhere -latest -property installationPath 2>$null
    if ($VSPath) {
        Write-Host "  ✓ Visual Studio: $VSPath" -ForegroundColor Green
    }
}

# ============================================================
# Step 1: Clean (optional)
# ============================================================
if ($Clean) {
    Write-Step "Step 1: Cleaning Build Artifacts"
    if (Test-Path $BuildDir) {
        Remove-Item -Recurse -Force $BuildDir
        Write-Host "  Removed: $BuildDir" -ForegroundColor Yellow
    }
    if (Test-Path $OutDir) {
        Remove-Item -Recurse -Force $OutDir
        Write-Host "  Removed: $OutDir" -ForegroundColor Yellow
    }
}

# Create output directories
New-Item -ItemType Directory -Force -Path $BuildDir | Out-Null
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# ============================================================
# Step 2: Build Electron App (Vite + electron-builder --dir)
# ============================================================
if (-not $SkipElectronBuild) {
    Write-Step "Step 2: Building Electron App"

    Push-Location $LauncherDir
    try {
        Write-Host "  Running: npm run build (Vite)" -ForegroundColor Gray
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "Vite build failed" }

        Write-Host "  Running: npx electron-builder --dir (unpacked)" -ForegroundColor Gray
        & npx electron-builder --dir --config.win.target=dir
        if ($LASTEXITCODE -ne 0) { throw "electron-builder --dir failed" }

        Assert-File $WinUnpacked "win-unpacked directory"
        $fileCount = (Get-ChildItem -Recurse -File $WinUnpacked).Count
        Write-Host "  ✓ Electron app built: $fileCount files in win-unpacked/" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }
} else {
    Write-Host ""
    Write-Host "  Skipping Electron build (--SkipElectronBuild)" -ForegroundColor Yellow
    Assert-File $WinUnpacked "win-unpacked directory (required even when skipping build)"
}

# ============================================================
# Step 3: Build Installer UI
# ============================================================
if (-not $SkipUIBuild) {
    Write-Step "Step 3: Building Installer UI"

    Push-Location $InstallerUIDir
    try {
        if (-not (Test-Path (Join-Path $InstallerUIDir "node_modules"))) {
            Write-Host "  Running: npm install" -ForegroundColor Gray
            & npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed for installer UI" }
        }

        Write-Host "  Running: npm run build (Vite → single HTML)" -ForegroundColor Gray
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "Installer UI build failed" }

        Assert-File $UIDistHtml "Built installer UI HTML"
        $htmlSize = (Get-Item $UIDistHtml).Length
        Write-Host "  ✓ Installer UI built: index.html ($([math]::Round($htmlSize / 1024)) KB)" -ForegroundColor Green
    }
    finally {
        Pop-Location
    }

    # Copy built HTML to the C++ resource location
    $uiDistDir = Join-Path $InstallerSrcDir "ui_dist"
    New-Item -ItemType Directory -Force -Path $uiDistDir | Out-Null
    Copy-Item -Force $UIDistHtml $ResourceHtml
    Write-Host "  ✓ Copied UI to: $ResourceHtml" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  Skipping UI build (--SkipUIBuild)" -ForegroundColor Yellow
}

# ============================================================
# Step 4: Pack Payload
# ============================================================
Write-Step "Step 4: Packing Payload"

$PackScript = Join-Path $ToolsDir "pack_payload.js"
Assert-File $PackScript "pack_payload.js"

Write-Host "  Running: node $PackScript $WinUnpacked $PayloadBin" -ForegroundColor Gray
& node $PackScript $WinUnpacked $PayloadBin
if ($LASTEXITCODE -ne 0) { throw "Payload packing failed" }

Assert-File $PayloadBin "Payload blob"
$payloadSize = (Get-Item $PayloadBin).Length
Write-Host "  ✓ Payload packed: $([math]::Round($payloadSize / 1024 / 1024, 1)) MB" -ForegroundColor Green

# ============================================================
# Step 5: Build C++ Installer Host
# ============================================================
Write-Step "Step 5: Building C++ Installer Host"

$CMakeBuildDir = Join-Path $BuildDir "cmake"
New-Item -ItemType Directory -Force -Path $CMakeBuildDir | Out-Null

Push-Location $CMakeBuildDir
try {
    Write-Host "  Running: cmake configure" -ForegroundColor Gray
    & cmake $InstallerDir -G "Visual Studio 17 2022" -A x64 `
        -DCMAKE_BUILD_TYPE=$BuildType `
        -DCMAKE_RUNTIME_OUTPUT_DIRECTORY=$OutDir
    if ($LASTEXITCODE -ne 0) { throw "CMake configure failed" }

    Write-Host "  Running: cmake build ($BuildType)" -ForegroundColor Gray
    & cmake --build . --config $BuildType
    if ($LASTEXITCODE -ne 0) { throw "CMake build failed" }

    # Find the built executable
    $builtExe = Get-ChildItem -Recurse -Path $CMakeBuildDir -Filter "CharonSetup.exe" |
                Select-Object -First 1

    if (-not $builtExe) {
        throw "Built CharonSetup.exe not found in cmake output"
    }

    # Copy to output directory
    Copy-Item -Force $builtExe.FullName $FinalExe
    Write-Host "  ✓ C++ host built: $($builtExe.FullName)" -ForegroundColor Green
}
finally {
    Pop-Location
}

# ============================================================
# Step 6: Append Payload to Executable
# ============================================================
Write-Step "Step 6: Appending Payload to Installer"

Assert-File $FinalExe "CharonSetup.exe"

$exeSizeBefore = (Get-Item $FinalExe).Length

& node $PackScript --append $WinUnpacked $FinalExe
if ($LASTEXITCODE -ne 0) {
    # Fallback: manually append the pre-built payload
    Write-Host "  Falling back to manual append..." -ForegroundColor Yellow
    $payloadData = [System.IO.File]::ReadAllBytes($PayloadBin)
    $stream = [System.IO.File]::Open($FinalExe, [System.IO.FileMode]::Append)
    $stream.Write($payloadData, 0, $payloadData.Length)
    $stream.Close()
}

$exeSizeAfter = (Get-Item $FinalExe).Length
$payloadAppended = $exeSizeAfter - $exeSizeBefore

Write-Host "  ✓ Payload appended: $([math]::Round($payloadAppended / 1024 / 1024, 1)) MB" -ForegroundColor Green

# ============================================================
# Done!
# ============================================================
$Stopwatch.Stop()

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  BUILD COMPLETE ✓" -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
Write-Host "  Output:     $FinalExe" -ForegroundColor White
Write-Host "  Size:       $([math]::Round($exeSizeAfter / 1024 / 1024, 1)) MB" -ForegroundColor White
Write-Host "  Time:       $([math]::Round($Stopwatch.Elapsed.TotalSeconds, 1))s" -ForegroundColor White
Write-Host ""
