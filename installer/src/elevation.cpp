#include "elevation.h"
#include <windows.h>
#include <shellapi.h>

bool IsRunningElevated() {
    bool isElevated = false;
    HANDLE hToken = NULL;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &hToken)) {
        TOKEN_ELEVATION elevation;
        DWORD cbSize = sizeof(TOKEN_ELEVATION);
        if (GetTokenInformation(hToken, TokenElevation, &elevation, sizeof(elevation), &cbSize)) {
            isElevated = elevation.TokenIsElevated;
        }
        CloseHandle(hToken);
    }
    return isElevated;
}

bool RelaunchElevated(const std::wstring& args) {
    WCHAR szPath[MAX_PATH];
    if (GetModuleFileNameW(NULL, szPath, ARRAYSIZE(szPath))) {
        SHELLEXECUTEINFOW sei = { sizeof(sei) };
        sei.lpVerb = L"runas";
        sei.lpFile = szPath;
        sei.lpParameters = args.c_str();
        sei.hwnd = NULL;
        sei.nShow = SW_NORMAL;
        if (ShellExecuteExW(&sei)) {
            return true;
        }
    }
    return false;
}

bool NeedsElevation(const std::string& path) {
    std::string lowerPath = path;
    for (char& c : lowerPath) c = tolower(c);
    return lowerPath.find("program files") != std::string::npos;
}
