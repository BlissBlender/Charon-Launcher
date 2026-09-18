#pragma once
#include <string>
#include <windows.h>

struct UpdateConfig {
    std::wstring patchPath;     // Path to the downloaded patch file (.asar or full payload)
    std::wstring targetDir;     // Directory where Charon Launcher is installed
    DWORD targetPid = 0;        // Process ID of the running launcher to wait for
    std::string newVersion;     // New version string for registry
    bool isMicroPatch = false;   // True if patching app.asar directly
};

// Main entry point for headless atomic updates
bool ExecuteNativeUpdate(const UpdateConfig& config);
