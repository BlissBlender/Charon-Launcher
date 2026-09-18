#pragma once
#include <string>
#include <nlohmann/json.hpp>
#include <WebView2.h>
#include <windows.h>

class InstallerEngine;

class JsBridge {
public:
    JsBridge(ICoreWebView2* webview, HWND hwnd);
    ~JsBridge();

    void HandleMessage(const std::wstring& jsonMsg);
    void SendEvent(const nlohmann::json& event);

private:
    ICoreWebView2* webview_;
    HWND hwnd_;
    InstallerEngine* engine_;
};
