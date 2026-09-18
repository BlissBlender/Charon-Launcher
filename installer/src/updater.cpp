#include "updater.h"
#include "payload.h"
#include "elevation.h"
#include <windows.h>
#include <filesystem>
#include <fstream>
#include <chrono>
#include <thread>
#include <iostream>

namespace fs = std::filesystem;

static void LogUpdater(const fs::path& logPath, const std::string& message) {
    try {
        std::ofstream out(logPath, std::ios::app);
        if (out) {
            auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
            out << "[" << now << "] " << message << "\n";
        }
    } catch (...) {}
}

bool ExecuteNativeUpdate(const UpdateConfig& config) {
    fs::path installDir = config.targetDir;
    fs::path logFile = installDir / "updater.log";

    LogUpdater(logFile, "Starting Charon Native Update...");

    // 1. Wait for the caller process (launcher) to terminate and release file locks
    if (config.targetPid > 0) {
        LogUpdater(logFile, "Waiting for process " + std::to_string(config.targetPid) + " to exit...");
        HANDLE hProcess = OpenProcess(SYNCHRONIZE | PROCESS_TERMINATE, FALSE, config.targetPid);
        if (hProcess) {
            DWORD waitResult = WaitForSingleObject(hProcess, 15000); // Wait up to 15 seconds
            if (waitResult == WAIT_TIMEOUT) {
                LogUpdater(logFile, "Process timed out. Terminating gracefully...");
                TerminateProcess(hProcess, 0);
                WaitForSingleObject(hProcess, 3000);
            }
            CloseHandle(hProcess);
        }
    }

    // Give the Windows filesystem a moment to flush file handles
    std::this_thread::sleep_for(std::chrono::milliseconds(600));

    // 2. Determine patch type: Micro-Patch (app.asar) vs Full Payload
    fs::path patchPath = config.patchPath;
    if (!fs::exists(patchPath)) {
        LogUpdater(logFile, "ERROR: Patch file does not exist: " + patchPath.string());
        return false;
    }

    bool isAsar = config.isMicroPatch || (patchPath.extension() == L".asar");

    if (isAsar) {
        LogUpdater(logFile, "Applying Micro-Patch (app.asar replacement)...");
        fs::path resourcesDir = installDir / "resources";
        fs::path targetAsar = resourcesDir / "app.asar";
        fs::path backupAsar = resourcesDir / "app.asar.old";

        if (!fs::exists(resourcesDir)) {
            try {
                fs::create_directories(resourcesDir);
            } catch (...) {}
        }

        // Snapshot current version as backup for instant rollback
        if (fs::exists(targetAsar)) {
            LogUpdater(logFile, "Creating snapshot backup of existing app.asar...");
            if (fs::exists(backupAsar)) {
                try { fs::remove(backupAsar); } catch (...) {}
            }
            std::error_code ec;
            fs::rename(targetAsar, backupAsar, ec);
            if (ec) {
                LogUpdater(logFile, "Rename failed: " + ec.message() + ". Trying MoveFileEx...");
                MoveFileExW(targetAsar.c_str(), backupAsar.c_str(), MOVEFILE_REPLACE_EXISTING);
            }
        }

        // Copy new asar file into place
        BOOL copyOk = CopyFileW(patchPath.c_str(), targetAsar.c_str(), FALSE);
        if (!copyOk) {
            DWORD err = GetLastError();
            LogUpdater(logFile, "ERROR: Failed to copy new app.asar. Error code: " + std::to_string(err));
            
            // Automatic Rollback
            if (fs::exists(backupAsar)) {
                LogUpdater(logFile, "Initiating automatic rollback...");
                CopyFileW(backupAsar.c_str(), targetAsar.c_str(), FALSE);
            }
            return false;
        }

        LogUpdater(logFile, "app.asar successfully updated.");
    } else {
        // Full package payload update
        LogUpdater(logFile, "Applying Full Runtime Update...");
        PayloadExtractor extractor;
        if (extractor.Open(patchPath.wstring())) {
            std::atomic<bool> cancelFlag(false);
            bool ok = extractor.Extract(installDir.string(), [](double, const std::string&, double) {}, cancelFlag);
            if (!ok) {
                LogUpdater(logFile, "ERROR: Extraction failed during update.");
                return false;
            }
        } else {
            LogUpdater(logFile, "ERROR: Unable to open payload archive.");
            return false;
        }
    }

    // 3. Update Registry version string if provided
    if (!config.newVersion.empty()) {
        HKEY hKey;
        if (RegOpenKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CharonGameLauncher", 0, KEY_WRITE, &hKey) == ERROR_SUCCESS) {
            RegSetValueExA(hKey, "DisplayVersion", 0, REG_SZ, (const BYTE*)config.newVersion.c_str(), (DWORD)config.newVersion.length() + 1);
            RegCloseKey(hKey);
            LogUpdater(logFile, "Updated registry DisplayVersion to: " + config.newVersion);
        }
    }

    // 4. Create a pending healthcheck beacon
    try {
        fs::path beaconPath = installDir / "charon_update_pending.beacon";
        std::ofstream beacon(beaconPath);
        if (beacon) {
            beacon << "{\"version\":\"" << config.newVersion << "\",\"timestamp\":" << std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count() << "}";
        }
    } catch (...) {}

    // 5. Relaunch Charon Game Launcher
    fs::path exePath = installDir / "Charon Game Launcher.exe";
    if (fs::exists(exePath)) {
        LogUpdater(logFile, "Relaunching Charon Game Launcher...");
        ShellExecuteW(NULL, L"open", exePath.c_str(), L"--post-update", installDir.c_str(), SW_SHOW);
    } else {
        LogUpdater(logFile, "WARNING: Launcher executable not found at: " + exePath.string());
    }

    LogUpdater(logFile, "Update complete. Exiting native updater.");
    return true;
}
