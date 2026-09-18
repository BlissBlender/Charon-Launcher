#pragma once
#include <string>
#include <atomic>
#include <functional>
#include <thread>
#include <nlohmann/json.hpp>
#include <windows.h>

class JsBridge;

class InstallerEngine {
public:
    InstallerEngine(JsBridge* bridge) : bridge_(bridge), cancelFlag_(false) {}
    ~InstallerEngine();

    nlohmann::json GetSystemInfo();
    bool ValidatePath(const std::string& path);
    void BrowseFolder(HWND parent);
    void StartInstall(const std::string& path, bool desktopShortcut, bool startMenuShortcut, const std::string& version = "1.0.0", const std::string& patchUrl = "");
    void CreateDesktopShortcut(const std::string& installPath);
    void CreateStartMenuShortcut(const std::string& installPath);
    void WriteRegistryUninstallKey(const std::string& installPath, const std::string& version = "1.0.0");
    void LaunchApp(const std::string& installPath);
    void Abort();
    void WaitForCompletion() { if (workerThread_.joinable()) workerThread_.join(); }

private:
    void InstallWorker(std::string path, bool desktop, bool startMenu, std::string version, std::string patchUrl);

    JsBridge* bridge_;
    std::atomic<bool> cancelFlag_;
    std::thread workerThread_;
};
