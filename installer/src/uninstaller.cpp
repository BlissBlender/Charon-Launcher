#include "uninstaller.h"
#include <windows.h>
#include <fstream>
#include <filesystem>

namespace fs = std::filesystem;

bool WriteUninstaller(const std::string& installPath) {
    fs::path installDir(installPath);
    fs::path uninstallBat = installDir / "uninstall.bat";
    
    std::ofstream out(uninstallBat);
    if (!out) return false;
    
    out << "@echo off\n"
        << "echo Uninstalling Charon Game Launcher...\n"
        << "timeout /t 2 /nobreak >nul\n"
        << "rmdir /s /q \"%~dp0\"\n"
        << "reg delete \"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CharonGameLauncher\" /f\n"
        << "del \"%USERPROFILE%\\Desktop\\Charon Game Launcher.lnk\" 2>nul\n"
        << "del \"%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Charon Game Launcher.lnk\" 2>nul\n"
        << "del \"%~f0\"\n"
        << "exit\n";
        
    out.close();
    return true;
}
