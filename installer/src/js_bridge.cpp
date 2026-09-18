#include "js_bridge.h"
#include "installer_engine.h"

extern std::string WideToUtf8(const std::wstring& wstr);
extern std::wstring Utf8ToWide(const std::string& str);

JsBridge::JsBridge(ICoreWebView2* webview, HWND hwnd) : webview_(webview), hwnd_(hwnd) {
    engine_ = new InstallerEngine(this);
}

JsBridge::~JsBridge() {
    delete engine_;
}

void JsBridge::HandleMessage(const std::wstring& jsonMsg) {
    std::string utf8Msg = WideToUtf8(jsonMsg);
    try {
        nlohmann::json msg = nlohmann::json::parse(utf8Msg);
        std::string cmd = msg["cmd"];
        
        if (cmd == "getSystemInfo") {
            nlohmann::json info = engine_->GetSystemInfo();
            info["event"] = "systemInfo";
            SendEvent(info);
        } else if (cmd == "browseFolder") {
            engine_->BrowseFolder(hwnd_);
        } else if (cmd == "setInstallPath") {
            std::string path = msg["path"];
            bool valid = engine_->ValidatePath(path);
            nlohmann::json res;
            res["event"] = "pathValidation";
            res["valid"] = valid;
            SendEvent(res);
        } else if (cmd == "startInstall") {
            std::string path = msg.value("path", "");
            bool desktop = true;
            bool startMenu = true;
            if (msg.contains("shortcuts")) {
                desktop = msg["shortcuts"].value("desktop", true);
                startMenu = msg["shortcuts"].value("startMenu", true);
            }
            std::string version = msg.value("version", "1.0.0");
            std::string patchUrl = msg.value("patchUrl", "");
            engine_->StartInstall(path, desktop, startMenu, version, patchUrl);
        } else if (cmd == "launchApp") {
            std::string path = msg["path"];
            engine_->LaunchApp(path);
            PostMessage(hwnd_, WM_CLOSE, 0, 0);
        } else if (cmd == "abort") {
            engine_->Abort();
        }
    } catch (...) {
        // ignore parsing errors
    }
}

void JsBridge::SendEvent(const nlohmann::json& event) {
    std::string utf8Str = event.dump();
    std::wstring wideStr = Utf8ToWide(utf8Str);
    
    std::wstring* pStr = new std::wstring(wideStr);
    PostMessageW(hwnd_, WM_USER + 1, (WPARAM)webview_, (LPARAM)pStr);
}
