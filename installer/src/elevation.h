#pragma once
#include <string>

bool IsRunningElevated();
bool RelaunchElevated(const std::wstring& args);
bool NeedsElevation(const std::string& path);
