#include "installer_engine.h"
#include "js_bridge.h"
#include "payload.h"
#include "uninstaller.h"
#include "elevation.h"
#include <windows.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <urlmon.h>
#include <filesystem>
#include <iostream>

#pragma comment(lib, "urlmon.lib")

namespace fs = std::filesystem;

InstallerEngine::~InstallerEngine() {
    if (workerThread_.joinable()) {
        workerThread_.join();
    }
}

std::wstring Utf8ToWide(const std::string& str) {
    if (str.empty()) return std::wstring();
    int size = MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, NULL, 0);
    std::wstring result(size, 0);
    MultiByteToWideChar(CP_UTF8, 0, str.c_str(), -1, &result[0], size);
    result.resize(size - 1);
    return result;
}

std::string WideToUtf8(const std::wstring& wstr) {
    if (wstr.empty()) return std::string();
    int size = WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, NULL, 0, NULL, NULL);
    std::string result(size, 0);
    WideCharToMultiByte(CP_UTF8, 0, wstr.c_str(), -1, &result[0], size, NULL, NULL);
    result.resize(size - 1);
    return result;
}

nlohmann::json InstallerEngine::GetSystemInfo() {
    nlohmann::json info;
    info["drives"] = nlohmann::json::array();
    
    DWORD drives = GetLogicalDrives();
    for (int i = 0; i < 26; i++) {
        if (drives & (1 << i)) {
            char root[] = { (char)('A' + i), ':', '\\', '\0' };
            ULARGE_INTEGER freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes;
            if (GetDiskFreeSpaceExA(root, &freeBytesAvailable, &totalNumberOfBytes, &totalNumberOfFreeBytes)) {
                nlohmann::json drive;
                drive["path"] = std::string(root);
                drive["freeBytes"] = freeBytesAvailable.QuadPart;
                drive["totalBytes"] = totalNumberOfBytes.QuadPart;
                info["drives"].push_back(drive);
            }
        }
    }
    
    char localAppData[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData))) {
        fs::path defaultPath = fs::path(localAppData) / "Programs" / "Charon Game Launcher";
        info["defaultPath"] = defaultPath.string();
    } else {
        info["defaultPath"] = "C:\\Program Files\\Charon Game Launcher";
    }
    
    // Check if Charon is already installed on the system
    info["existingInstall"] = nullptr;
    HKEY hKey;
    if (RegOpenKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CharonGameLauncher", 0, KEY_READ, &hKey) == ERROR_SUCCESS) {
        char loc[MAX_PATH] = {0};
        DWORD locSize = sizeof(loc);
        char ver[64] = {0};
        DWORD verSize = sizeof(ver);
        
        if (RegQueryValueExA(hKey, "InstallLocation", NULL, NULL, (LPBYTE)loc, &locSize) == ERROR_SUCCESS) {
            RegQueryValueExA(hKey, "DisplayVersion", NULL, NULL, (LPBYTE)ver, &verSize);
            
            nlohmann::json exist;
            exist["installed"] = true;
            exist["path"] = std::string(loc);
            exist["version"] = std::string(ver);
            info["existingInstall"] = exist;
            info["defaultPath"] = std::string(loc); // Pre-fill with user's existing directory
        }
        RegCloseKey(hKey);
    }
    
    OSVERSIONINFOEXA osInfo = { sizeof(OSVERSIONINFOEXA) };
    info["windowsVersion"] = "Windows"; 
    
    return info;
}

bool InstallerEngine::ValidatePath(const std::string& path) {
    try {
        fs::path p(path);
        fs::path root = p.root_path();
        
        ULARGE_INTEGER freeBytesAvailable, totalNumberOfBytes, totalNumberOfFreeBytes;
        if (GetDiskFreeSpaceExA(root.string().c_str(), &freeBytesAvailable, &totalNumberOfBytes, &totalNumberOfFreeBytes)) {
            if (freeBytesAvailable.QuadPart < 100 * 1024 * 1024) {
                return false;
            }
        }
        return true;
    } catch (...) {
        return false;
    }
}

void InstallerEngine::BrowseFolder(HWND parent) {
    IFileOpenDialog* pfd = NULL;
    if (SUCCEEDED(CoCreateInstance(CLSID_FileOpenDialog, NULL, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&pfd)))) {
        pfd->SetOptions(FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
        if (SUCCEEDED(pfd->Show(parent))) {
            IShellItem* psi = NULL;
            if (SUCCEEDED(pfd->GetResult(&psi))) {
                PWSTR pszPath = NULL;
                if (SUCCEEDED(psi->GetDisplayName(SIGDN_FILESYSPATH, &pszPath))) {
                    nlohmann::json res;
                    res["event"] = "folderSelected";
                    res["path"] = WideToUtf8(pszPath);
                    bridge_->SendEvent(res);
                    CoTaskMemFree(pszPath);
                }
                psi->Release();
            }
        }
        pfd->Release();
    }
}

class DownloadProgressCallback : public IBindStatusCallback {
public:
    DownloadProgressCallback(JsBridge* bridge, std::atomic<bool>* cancelFlag, const std::string& version)
        : bridge_(bridge), cancelFlag_(cancelFlag), version_(version), refCount_(1), lastBytes_(0) {
        lastTime_ = std::chrono::steady_clock::now();
    }

    STDMETHOD(QueryInterface)(REFIID riid, void** ppvObject) override {
        if (!ppvObject) return E_POINTER;
        if (riid == IID_IUnknown || riid == IID_IBindStatusCallback) {
            *ppvObject = static_cast<IBindStatusCallback*>(this);
            AddRef();
            return S_OK;
        }
        *ppvObject = nullptr;
        return E_NOINTERFACE;
    }

    STDMETHOD_(ULONG, AddRef)() override { return ++refCount_; }
    STDMETHOD_(ULONG, Release)() override {
        ULONG res = --refCount_;
        if (res == 0) delete this;
        return res;
    }

    STDMETHOD(OnStartBinding)(DWORD, IBinding*) override { return S_OK; }
    STDMETHOD(GetPriority)(LONG*) override { return S_OK; }
    STDMETHOD(OnLowResource)(DWORD) override { return S_OK; }
    STDMETHOD(OnProgress)(ULONG ulProgress, ULONG ulProgressMax, ULONG ulStatusCode, LPCWSTR) override {
        if (cancelFlag_ && cancelFlag_->load()) return E_ABORT;

        auto now = std::chrono::steady_clock::now();
        double elapsed = std::chrono::duration<double>(now - lastTime_).count();
        double bps = 0.0;
        if (elapsed > 0.25 && ulProgress >= lastBytes_) {
            bps = (ulProgress - lastBytes_) / elapsed;
            lastBytes_ = ulProgress;
            lastTime_ = now;
        }

        if (ulProgressMax > 0 && bridge_) {
            double downloadRatio = (double)ulProgress / (double)ulProgressMax;
            double overallPct = 85.0 + (downloadRatio * 13.0);

            nlohmann::json prog;
            prog["event"] = "progress";
            prog["percent"] = overallPct;

            char buf[128];
            snprintf(buf, sizeof(buf), "Downloading v%s update (%.1f / %.1f MB)...",
                version_.c_str(),
                ulProgress / (1024.0 * 1024.0),
                ulProgressMax / (1024.0 * 1024.0));
            prog["file"] = std::string(buf);
            prog["bytesPerSec"] = bps;
            bridge_->SendEvent(prog);
        }
        return S_OK;
    }
    STDMETHOD(OnStopBinding)(HRESULT, LPCWSTR) override { return S_OK; }
    STDMETHOD(GetBindInfo)(DWORD*, BINDINFO*) override { return S_OK; }
    STDMETHOD(OnDataAvailable)(DWORD, DWORD, FORMATETC*, STGMEDIUM*) override { return S_OK; }
    STDMETHOD(OnObjectAvailable)(REFIID, IUnknown*) override { return S_OK; }

private:
    JsBridge* bridge_;
    std::atomic<bool>* cancelFlag_;
    std::string version_;
    std::atomic<ULONG> refCount_;
    std::chrono::steady_clock::time_point lastTime_;
    ULONG lastBytes_;
};

void InstallerEngine::StartInstall(const std::string& path, bool desktopShortcut, bool startMenuShortcut, const std::string& version, const std::string& patchUrl) {
    cancelFlag_ = false;
    if (workerThread_.joinable()) workerThread_.join();
    workerThread_ = std::thread(&InstallerEngine::InstallWorker, this, path, desktopShortcut, startMenuShortcut, version, patchUrl);
}

void InstallerEngine::InstallWorker(std::string path, bool desktop, bool startMenu, std::string version, std::string patchUrl) {
    if (NeedsElevation(path) && !IsRunningElevated()) {
        nlohmann::json err;
        err["event"] = "error";
        err["message"] = "Elevation required for this path.";
        bridge_->SendEvent(err);
        return;
    }

    try {
        fs::create_directories(path);
    } catch (const std::exception& e) {
        nlohmann::json err;
        err["event"] = "error";
        err["message"] = std::string("Failed to create directory: ") + e.what();
        bridge_->SendEvent(err);
        return;
    }
    
    WCHAR exePath[MAX_PATH];
    GetModuleFileNameW(NULL, exePath, MAX_PATH);
    
    PayloadExtractor extractor;
    bool hasPayload = extractor.Open(exePath);
    
    if (hasPayload) {
        bool ok = extractor.Extract(path, [this](double percent, const std::string& file, double bps) {
            nlohmann::json prog;
            prog["event"] = "progress";
            prog["percent"] = percent * 0.85; // Reserve 85%..98% for online patch if present
            prog["file"] = file;
            prog["bytesPerSec"] = bps;
            bridge_->SendEvent(prog);
        }, cancelFlag_);
        
        if (!ok && !cancelFlag_) {
            nlohmann::json err;
            err["event"] = "error";
            err["message"] = "Extraction failed.";
            bridge_->SendEvent(err);
            return;
        }
    } else {
        for(int i=0; i<=85; i+=10) {
            if(cancelFlag_) break;
            nlohmann::json prog;
            prog["event"] = "progress";
            prog["percent"] = i;
            prog["file"] = "dummy.bin";
            prog["bytesPerSec"] = 1000000;
            bridge_->SendEvent(prog);
            Sleep(80);
        }
    }
    
    if (cancelFlag_) {
        fs::remove_all(path);
        return;
    }

    // If a newer release patch was detected online, download with real-time progress
    if (!patchUrl.empty() && !cancelFlag_) {
        fs::path resourcesDir = fs::path(path) / "resources";
        fs::path targetAsar = resourcesDir / "app.asar";
        fs::path tempDownload = resourcesDir / "app.asar.download";
        std::wstring wUrl = Utf8ToWide(patchUrl);

        DownloadProgressCallback* cb = new DownloadProgressCallback(bridge_, &cancelFlag_, version);
        HRESULT hr = URLDownloadToFileW(NULL, wUrl.c_str(), tempDownload.c_str(), 0, cb);
        cb->Release();

        if (SUCCEEDED(hr) && fs::exists(tempDownload) && fs::file_size(tempDownload) > 1024) {
            std::error_code ec;
            fs::rename(tempDownload, targetAsar, ec);
            if (ec) {
                MoveFileExW(tempDownload.c_str(), targetAsar.c_str(), MOVEFILE_REPLACE_EXISTING);
            }
            nlohmann::json doneProg;
            doneProg["event"] = "progress";
            doneProg["percent"] = 99.0;
            doneProg["file"] = "Applied latest v" + version + " release patch.";
            doneProg["bytesPerSec"] = 0;
            bridge_->SendEvent(doneProg);
        } else {
            if (fs::exists(tempDownload)) {
                try { fs::remove(tempDownload); } catch (...) {}
            }
        }
    }
    
    if (desktop) CreateDesktopShortcut(path);
    if (startMenu) CreateStartMenuShortcut(path);
    
    // Deploy CharonSetup.exe into install directory to serve as native updater & repair engine
    fs::path targetInstaller = fs::path(path) / "CharonSetup.exe";
    CopyFileW(exePath, targetInstaller.c_str(), FALSE);

    WriteUninstaller(path);
    WriteRegistryUninstallKey(path, version.empty() ? "1.0.0.0" : version);
    
    nlohmann::json comp;
    comp["event"] = "complete";
    comp["installPath"] = path;
    bridge_->SendEvent(comp);
}

void InstallerEngine::CreateDesktopShortcut(const std::string& installPath) {
    char deskPath[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_DESKTOPDIRECTORY, NULL, 0, deskPath))) {
        fs::path linkPath = fs::path(deskPath) / "Charon Game Launcher.lnk";
        fs::path targetPath = fs::path(installPath) / "Charon Game Launcher.exe";
        
        IShellLinkW* psl;
        if (SUCCEEDED(CoCreateInstance(CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&psl)))) {
            psl->SetPath(Utf8ToWide(targetPath.string()).c_str());
            psl->SetWorkingDirectory(Utf8ToWide(installPath).c_str());
            IPersistFile* ppf;
            if (SUCCEEDED(psl->QueryInterface(IID_PPV_ARGS(&ppf)))) {
                ppf->Save(Utf8ToWide(linkPath.string()).c_str(), TRUE);
                ppf->Release();
            }
            psl->Release();
        }
    }
}

void InstallerEngine::CreateStartMenuShortcut(const std::string& installPath) {
    char smPath[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathA(NULL, CSIDL_PROGRAMS, NULL, 0, smPath))) {
        fs::path linkPath = fs::path(smPath) / "Charon Game Launcher.lnk";
        fs::path targetPath = fs::path(installPath) / "Charon Game Launcher.exe";
        
        IShellLinkW* psl;
        if (SUCCEEDED(CoCreateInstance(CLSID_ShellLink, NULL, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&psl)))) {
            psl->SetPath(Utf8ToWide(targetPath.string()).c_str());
            psl->SetWorkingDirectory(Utf8ToWide(installPath).c_str());
            IPersistFile* ppf;
            if (SUCCEEDED(psl->QueryInterface(IID_PPV_ARGS(&ppf)))) {
                ppf->Save(Utf8ToWide(linkPath.string()).c_str(), TRUE);
                ppf->Release();
            }
            psl->Release();
        }
    }
}

void InstallerEngine::WriteRegistryUninstallKey(const std::string& installPath, const std::string& version) {
    HKEY hKey;
    LSTATUS status = RegCreateKeyExA(HKEY_CURRENT_USER, "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\CharonGameLauncher", 0, NULL, REG_OPTION_NON_VOLATILE, KEY_WRITE, NULL, &hKey, NULL);
    if (status == ERROR_SUCCESS) {
        std::string dispName = "Charon Game Launcher";
        RegSetValueExA(hKey, "DisplayName", 0, REG_SZ, (const BYTE*)dispName.c_str(), dispName.length() + 1);
        
        std::string uninstStr = "cmd.exe /c \"" + (fs::path(installPath) / "uninstall.bat").string() + "\"";
        RegSetValueExA(hKey, "UninstallString", 0, REG_SZ, (const BYTE*)uninstStr.c_str(), uninstStr.length() + 1);
        
        RegSetValueExA(hKey, "InstallLocation", 0, REG_SZ, (const BYTE*)installPath.c_str(), installPath.length() + 1);
        
        std::string icon = (fs::path(installPath) / "Charon Game Launcher.exe").string();
        RegSetValueExA(hKey, "DisplayIcon", 0, REG_SZ, (const BYTE*)icon.c_str(), icon.length() + 1);
        
        std::string publisher = "Charon";
        RegSetValueExA(hKey, "Publisher", 0, REG_SZ, (const BYTE*)publisher.c_str(), publisher.length() + 1);
        
        std::string ver = version.empty() ? "1.0.0.0" : version;
        RegSetValueExA(hKey, "DisplayVersion", 0, REG_SZ, (const BYTE*)ver.c_str(), ver.length() + 1);
        
        RegCloseKey(hKey);
    }
}

void InstallerEngine::LaunchApp(const std::string& installPath) {
    fs::path targetPath = fs::path(installPath) / "Charon Game Launcher.exe";
    ShellExecuteW(NULL, L"open", Utf8ToWide(targetPath.string()).c_str(), NULL, Utf8ToWide(installPath).c_str(), SW_SHOW);
}

void InstallerEngine::Abort() {
    cancelFlag_ = true;
}
