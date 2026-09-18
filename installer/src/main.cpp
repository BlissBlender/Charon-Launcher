#include <windows.h>
#include <dwmapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <string>
#include <filesystem>
#include <fstream>
#include "js_bridge.h"
#include "installer_engine.h"
#include "resource.h"
#include "updater.h"
#include "elevation.h"

#pragma comment(lib, "Dwmapi.lib")

using namespace Microsoft::WRL;
namespace fs = std::filesystem;

HWND g_hwnd;
ComPtr<ICoreWebView2Controller> g_webviewController;
ComPtr<ICoreWebView2> g_webview;
JsBridge* g_bridge = nullptr;
std::wstring g_tempHtmlPath;

std::wstring GetTempHtmlFile() {
    WCHAR tempPath[MAX_PATH];
    GetTempPathW(MAX_PATH, tempPath);
    WCHAR tempFile[MAX_PATH];
    GetTempFileNameW(tempPath, L"CHR", 0, tempFile);
    
    // Rename to .html extension
    std::wstring htmlPath = std::wstring(tempFile) + L".html";
    MoveFileW(tempFile, htmlPath.c_str());
    
    HRSRC hRes = FindResourceW(NULL, MAKEINTRESOURCEW(IDR_HTML_UI), (LPCWSTR)RT_RCDATA);
    if (hRes) {
        HGLOBAL hMem = LoadResource(NULL, hRes);
        DWORD size = SizeofResource(NULL, hRes);
        void* data = LockResource(hMem);
        if (data) {
            std::ofstream out(htmlPath, std::ios::binary);
            out.write((char*)data, size);
        }
    }
    return htmlPath;
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
        case WM_NCCALCSIZE: {
            if (wParam == TRUE) {
                return 0; // Remove standard frame
            }
            break;
        }
        case WM_NCHITTEST: {
            POINT pt;
            pt.x = LOWORD(lParam);
            pt.y = HIWORD(lParam);
            ScreenToClient(hwnd, &pt);
            
            RECT rc;
            GetClientRect(hwnd, &rc);
            
            // Close button area (top right)
            if (pt.x > rc.right - 40 && pt.y < 30) {
                return HTCLIENT; // let client handle click to close
            }
            // Title bar area (top 30 pixels)
            if (pt.y < 30) {
                return HTCAPTION;
            }
            return HTCLIENT;
        }
        case WM_PAINT: {
            PAINTSTRUCT ps;
            HDC hdc = BeginPaint(hwnd, &ps);
            
            RECT rc;
            GetClientRect(hwnd, &rc);
            
            // Fill background
            HBRUSH hBrush = CreateSolidBrush(RGB(11, 13, 18));
            FillRect(hdc, &rc, hBrush);
            DeleteObject(hBrush);
            
            // Draw thin border
            HPEN hPen = CreatePen(PS_SOLID, 1, RGB(60, 60, 60));
            HGDIOBJ oldPen = SelectObject(hdc, hPen);
            HBRUSH nullBrush = (HBRUSH)GetStockObject(NULL_BRUSH);
            HGDIOBJ oldBrush = SelectObject(hdc, nullBrush);
            Rectangle(hdc, rc.left, rc.top, rc.right, rc.bottom);
            SelectObject(hdc, oldBrush);
            SelectObject(hdc, oldPen);
            DeleteObject(hPen);
            
            // Draw close button 'X'
            HPEN xPen = CreatePen(PS_SOLID, 2, RGB(200, 200, 200));
            oldPen = SelectObject(hdc, xPen);
            int xCenter = rc.right - 20;
            int yCenter = 15;
            MoveToEx(hdc, xCenter - 5, yCenter - 5, NULL);
            LineTo(hdc, xCenter + 5, yCenter + 5);
            MoveToEx(hdc, xCenter + 5, yCenter - 5, NULL);
            LineTo(hdc, xCenter - 5, yCenter + 5);
            SelectObject(hdc, oldPen);
            DeleteObject(xPen);
            
            EndPaint(hwnd, &ps);
            return 0;
        }
        case WM_LBUTTONUP: {
            POINT pt;
            pt.x = LOWORD(lParam);
            pt.y = HIWORD(lParam);
            RECT rc;
            GetClientRect(hwnd, &rc);
            if (pt.x > rc.right - 40 && pt.y < 30) {
                PostMessage(hwnd, WM_CLOSE, 0, 0);
            }
            break;
        }
        case WM_SIZE: {
            if (g_webviewController) {
                RECT bounds;
                GetClientRect(hwnd, &bounds);
                // offset by 1 for border, and top 30 for title bar
                bounds.top += 30;
                bounds.left += 1;
                bounds.right -= 1;
                bounds.bottom -= 1;
                g_webviewController->put_Bounds(bounds);
            }
            break;
        }
        case WM_USER + 1: { // Custom event message from JsBridge background thread
            ICoreWebView2* wv = (ICoreWebView2*)wParam;
            std::wstring* pStr = (std::wstring*)lParam;
            wv->PostWebMessageAsJson(pStr->c_str());
            delete pStr;
            break;
        }
        case WM_DESTROY: {
            if (g_bridge) {
                delete g_bridge;
                g_bridge = nullptr;
            }
            if (!g_tempHtmlPath.empty()) {
                _wremove(g_tempHtmlPath.c_str());
            }
            PostQuitMessage(0);
            return 0;
        }
    }
    return DefWindowProcW(hwnd, msg, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    // 1. Check for command-line arguments (Headless Updater Mode)
    int argc = 0;
    LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (argv && argc > 1) {
        bool isUpdateMode = false;
        bool isSilent = false;
        bool noShortcuts = false;
        std::wstring silentTarget = L"";
        UpdateConfig uConfig;
        for (int i = 1; i < argc; ++i) {
            std::wstring arg = argv[i];
            if (arg == L"--update" && i + 1 < argc) {
                isUpdateMode = true;
                uConfig.patchPath = argv[++i];
            } else if (arg == L"--target" && i + 1 < argc) {
                uConfig.targetDir = argv[++i];
                silentTarget = uConfig.targetDir;
            } else if (arg == L"--pid" && i + 1 < argc) {
                uConfig.targetPid = (DWORD)_wtoi(argv[++i]);
            } else if (arg == L"--version" && i + 1 < argc) {
                std::wstring vStr = argv[++i];
                uConfig.newVersion = std::string(vStr.begin(), vStr.end());
            } else if (arg == L"--micro") {
                uConfig.isMicroPatch = true;
            } else if (arg == L"/S" || arg == L"/s" || arg == L"--silent" || arg == L"-silent") {
                isSilent = true;
            } else if (arg == L"--no-shortcuts") {
                noShortcuts = true;
            }
        }
        LocalFree(argv);

        if (isUpdateMode) {
            // Check if elevation is required for target directory
            if (!uConfig.targetDir.empty()) {
                std::string targetUtf8(uConfig.targetDir.begin(), uConfig.targetDir.end());
                if (NeedsElevation(targetUtf8) && !IsRunningElevated()) {
                    std::wstring fullCmd = GetCommandLineW();
                    size_t flagPos = fullCmd.find(L" --update");
                    if (flagPos != std::wstring::npos) {
                        RelaunchElevated(fullCmd.substr(flagPos + 1));
                        return 0;
                    }
                }
            }

            bool ok = ExecuteNativeUpdate(uConfig);
            return ok ? 0 : 1;
        } else if (isSilent) {
            InstallerEngine engine(nullptr);
            auto sysInfo = engine.GetSystemInfo();
            std::string targetPath = silentTarget.empty() ? sysInfo["defaultPath"].get<std::string>() : std::string(silentTarget.begin(), silentTarget.end());

            if (NeedsElevation(targetPath) && !IsRunningElevated()) {
                std::wstring fullCmd = GetCommandLineW();
                RelaunchElevated(fullCmd);
                return 0;
            }

            engine.StartInstall(targetPath, !noShortcuts, !noShortcuts, "1.0.0", "");
            engine.WaitForCompletion();
            return 0;
        }
    } else if (argv) {
        LocalFree(argv);
    }

    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    
    WNDCLASSEXW wc = {0};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInstance;
    wc.hIcon = LoadIconW(hInstance, MAKEINTRESOURCEW(IDI_APPICON));
    wc.hbrBackground = CreateSolidBrush(RGB(11, 13, 18));
    wc.lpszClassName = L"CharonInstallerClass";
    
    RegisterClassExW(&wc);
    
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int winW = 900;
    int winH = 600;
    int x = (screenW - winW) / 2;
    int y = (screenH - winH) / 2;
    
    g_hwnd = CreateWindowExW(
        0,
        wc.lpszClassName,
        L"Charon Game Launcher Setup",
        WS_POPUP | WS_SYSMENU | WS_MINIMIZEBOX,
        x, y, winW, winH,
        NULL, NULL, hInstance, NULL
    );
    
    BOOL value = TRUE;
    DwmSetWindowAttribute(g_hwnd, 20 /*DWMWA_USE_IMMERSIVE_DARK_MODE*/, &value, sizeof(value));
    
    ShowWindow(g_hwnd, nCmdShow);
    UpdateWindow(g_hwnd);
    
    g_tempHtmlPath = GetTempHtmlFile();
    
    CreateCoreWebView2EnvironmentWithOptions(nullptr, nullptr, nullptr,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [hwnd = g_hwnd](HRESULT result, ICoreWebView2Environment* env) -> HRESULT {
                env->CreateCoreWebView2Controller(hwnd, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [hwnd](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                        if (controller) {
                            g_webviewController = controller;
                            g_webviewController->get_CoreWebView2(&g_webview);
                            
                            RECT bounds;
                            GetClientRect(hwnd, &bounds);
                            bounds.top += 30; bounds.left += 1; bounds.right -= 1; bounds.bottom -= 1;
                            g_webviewController->put_Bounds(bounds);
                            
                            ICoreWebView2Settings* settings;
                            g_webview->get_Settings(&settings);
                            settings->put_AreDefaultContextMenusEnabled(FALSE);
                            settings->put_AreDevToolsEnabled(FALSE);
                            settings->Release();
                            
                            g_bridge = new JsBridge(g_webview.Get(), hwnd);
                            
                            g_webview->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>(
                                [](ICoreWebView2* webview, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
                                    LPWSTR message;
                                    args->TryGetWebMessageAsString(&message);
                                    if (message && g_bridge) {
                                        g_bridge->HandleMessage(std::wstring(message));
                                        CoTaskMemFree(message);
                                    }
                                    return S_OK;
                                }
                            ).Get(), nullptr);
                            
                            std::wstring url = L"file:///" + g_tempHtmlPath;
                            g_webview->Navigate(url.c_str());
                        }
                        return S_OK;
                    }
                ).Get());
                return S_OK;
            }
        ).Get()
    );
    
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
    
    CoUninitialize();
    return (int)msg.wParam;
}
