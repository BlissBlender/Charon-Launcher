#pragma once
#include <string>
#include <atomic>
#include <functional>

using ProgressCallback = std::function<void(double percent, const std::string& file, double bytesPerSec)>;

class PayloadExtractor {
public:
    bool Open(const std::wstring& exePath);
    bool Extract(const std::string& destDir, ProgressCallback cb, std::atomic<bool>& cancelFlag);

private:
    std::wstring exePath_;
    size_t payloadOffset_ = 0;
    size_t compressedSize_ = 0;
    size_t uncompressedSize_ = 0;
    bool isLzma_ = false;
};
