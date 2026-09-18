#include "payload.h"
#include <windows.h>
#include <fstream>
#include <vector>
#include <iostream>
#include <filesystem>
#include <chrono>

namespace fs = std::filesystem;

bool PayloadExtractor::Open(const std::wstring& exePath) {
    exePath_ = exePath;
    
    HANDLE hFile = CreateFileW(exePath.c_str(), GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) return false;
    
    HANDLE hMap = CreateFileMappingW(hFile, NULL, PAGE_READONLY, 0, 0, NULL);
    if (!hMap) { CloseHandle(hFile); return false; }
    
    void* pBase = MapViewOfFile(hMap, FILE_MAP_READ, 0, 0, 0);
    if (!pBase) { CloseHandle(hMap); CloseHandle(hFile); return false; }
    
    PIMAGE_DOS_HEADER pDosHeader = (PIMAGE_DOS_HEADER)pBase;
    if (pDosHeader->e_magic != IMAGE_DOS_SIGNATURE) {
        UnmapViewOfFile(pBase); CloseHandle(hMap); CloseHandle(hFile); return false;
    }
    
    PIMAGE_NT_HEADERS pNtHeaders = (PIMAGE_NT_HEADERS)((BYTE*)pBase + pDosHeader->e_lfanew);
    if (pNtHeaders->Signature != IMAGE_NT_SIGNATURE) {
        UnmapViewOfFile(pBase); CloseHandle(hMap); CloseHandle(hFile); return false;
    }
    
    PIMAGE_SECTION_HEADER pSectionHeader = IMAGE_FIRST_SECTION(pNtHeaders);
    DWORD maxOffset = 0;
    for (int i = 0; i < pNtHeaders->FileHeader.NumberOfSections; i++) {
        DWORD endOffset = pSectionHeader[i].PointerToRawData + pSectionHeader[i].SizeOfRawData;
        if (endOffset > maxOffset) maxOffset = endOffset;
    }
    
    LARGE_INTEGER fileSize;
    GetFileSizeEx(hFile, &fileSize);
    
    if (maxOffset < fileSize.QuadPart) {
        BYTE* payloadPtr = (BYTE*)pBase + maxOffset;
        // Payload format: [4B "CHRN"][8B uncompressed_size][8B compressed_size][1B flag][data]
        // Total header = 4 + 8 + 8 + 1 = 21 bytes
        if (fileSize.QuadPart >= maxOffset + 21 && memcmp(payloadPtr, "CHRN", 4) == 0) {
            memcpy(&uncompressedSize_, payloadPtr + 4, 8);
            memcpy(&compressedSize_, payloadPtr + 12, 8);
            isLzma_ = *(payloadPtr + 20) == 0x01;
            payloadOffset_ = maxOffset + 21; // skip past the full header
            UnmapViewOfFile(pBase); CloseHandle(hMap); CloseHandle(hFile);
            return true;
        }
    }
    
    UnmapViewOfFile(pBase); CloseHandle(hMap); CloseHandle(hFile);
    return false;
}

bool PayloadExtractor::Extract(const std::string& destDir, ProgressCallback cb, std::atomic<bool>& cancelFlag) {
    if (payloadOffset_ == 0) return false;
    
    std::ifstream in(exePath_, std::ios::binary);
    if (!in) return false;
    
    in.seekg(payloadOffset_);
    
    std::vector<BYTE> payloadData(compressedSize_);
    in.read((char*)payloadData.data(), compressedSize_);
    
    std::vector<BYTE> uncompressedData;
    if (isLzma_) {
        // Placeholder for LZMA extraction
        return false;
    } else {
        uncompressedData = payloadData; // Uncompressed for now
    }
    
    size_t offset = 0;
    auto startTime = std::chrono::steady_clock::now();
    size_t bytesProcessed = 0;
    
    while (offset < uncompressedData.size() && !cancelFlag) {
        if (offset + 4 > uncompressedData.size()) break;
        uint32_t nameLen = 0;
        memcpy(&nameLen, uncompressedData.data() + offset, 4);
        offset += 4;
        
        if (offset + nameLen > uncompressedData.size()) break;
        std::string name((char*)uncompressedData.data() + offset, nameLen);
        offset += nameLen;
        
        if (offset + 8 > uncompressedData.size()) break;
        uint64_t dataLen = 0;
        memcpy(&dataLen, uncompressedData.data() + offset, 8);
        offset += 8;
        
        if (offset + dataLen > uncompressedData.size()) break;
        
        fs::path outPath = fs::path(destDir) / name;
        fs::create_directories(outPath.parent_path());
        
        std::ofstream out(outPath, std::ios::binary);
        if (out) {
            out.write((char*)uncompressedData.data() + offset, dataLen);
        }
        offset += dataLen;
        bytesProcessed += dataLen;
        
        auto now = std::chrono::steady_clock::now();
        std::chrono::duration<double> diff = now - startTime;
        double bps = diff.count() > 0 ? (bytesProcessed / diff.count()) : 0;
        double percent = ((double)offset / uncompressedData.size()) * 100.0;
        
        if (cb) {
            cb(percent, name, bps);
        }
    }
    
    return !cancelFlag;
}
