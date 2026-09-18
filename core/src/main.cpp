#include <iostream>
#include <vector>
#include <string>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <queue>
#include <atomic>
#include <chrono>
#include <curl/curl.h>

// A job sent from a downloader thread to the single disk-writer thread
struct WriteJob {
    size_t offset;
    std::vector<char> data;
};

// Thread-safe queue to ensure we don't lock up the disk with concurrent writes
class ThreadSafeQueue {
    std::queue<WriteJob> q;
    std::mutex m;
    std::condition_variable cv;
public:
    void push(WriteJob job) {
        std::lock_guard<std::mutex> lock(m);
        q.push(std::move(job));
        cv.notify_one();
    }
    bool try_pop(WriteJob& job) {
        std::lock_guard<std::mutex> lock(m);
        if (q.empty()) return false;
        job = std::move(q.front());
        q.pop();
        return true;
    }
    bool empty() {
        std::lock_guard<std::mutex> lock(m);
        return q.empty();
    }
};

struct ThreadState {
    size_t current_offset;
    ThreadSafeQueue* queue;
    std::atomic<size_t>* downloaded_bytes;
};

// The callback libcurl fires whenever a chunk of data arrives over the network
size_t WriteCallback(void* contents, size_t size, size_t nmemb, void* userp) {
    size_t realsize = size * nmemb;
    ThreadState* state = (ThreadState*)userp;

    // Copy data to a buffer and ship it to the writer queue
    std::vector<char> buffer((char*)contents, (char*)contents + realsize);
    state->queue->push({state->current_offset, std::move(buffer)});
    
    // Advance our byte offset so the next chunk writes in the right place
    state->current_offset += realsize;
    *(state->downloaded_bytes) += realsize;

    return realsize;
}

// Queries the HTTP server for the Content-Length
size_t GetFileSize(const std::string& url) {
    CURL* curl = curl_easy_init();
    if (!curl) return 0;
    
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_NOBODY, 1L); // HEAD request
    curl_easy_setopt(curl, CURLOPT_HEADER, 0L);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    
    CURLcode res = curl_easy_perform(curl);
    curl_off_t cl = 0;
    if (res == CURLE_OK) {
        curl_easy_getinfo(curl, CURLINFO_CONTENT_LENGTH_DOWNLOAD_T, &cl);
    }
    curl_easy_cleanup(curl);
    return (size_t)cl;
}

// The worker function ran by each C++ thread
void DownloadWorker(const std::string& url, size_t start, size_t end, ThreadState* state) {
    CURL* curl = curl_easy_init();
    if (!curl) return;

    std::string range = std::to_string(start) + "-" + std::to_string(end);
    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_RANGE, range.c_str());
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, state);
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curl, CURLOPT_FAILONERROR, 1L);

    curl_easy_perform(curl);
    curl_easy_cleanup(curl);
}

int main(int argc, char** argv) {
    if (argc < 3) {
        std::cerr << "Usage: charon-core.exe <URL> <DESTINATION_FILE> [THREADS]\n";
        return 1;
    }

    std::string url = argv[1];
    std::string dest = argv[2];
    int num_threads = (argc >= 4) ? std::stoi(argv[3]) : 8;

    curl_global_init(CURL_GLOBAL_ALL);

    size_t total_size = GetFileSize(url);
    if (total_size == 0) {
        std::cerr << "{\"error\": \"Could not get file size or file is 0 bytes.\"}\n";
        return 1;
    }

    std::cout << "{\"status\": \"starting\", \"size\": " << total_size << ", \"threads\": " << num_threads << "}\n";

    // Open file safely on Windows
    FILE* fp = nullptr;
#ifdef _WIN32
    fopen_s(&fp, dest.c_str(), "wb");
#else
    fp = fopen(dest.c_str(), "wb");
#endif

    if (!fp) {
        std::cerr << "{\"error\": \"Failed to open destination file\"}\n";
        return 1;
    }

    // Pre-allocate the entire 300GB file instantly
#ifdef _WIN32
    _fseeki64(fp, total_size - 1, SEEK_SET);
#else
    fseeko(fp, total_size - 1, SEEK_SET);
#endif
    fputc('\0', fp);

    ThreadSafeQueue queue;
    std::atomic<size_t> downloaded_bytes{0};
    std::atomic<bool> is_downloading{true};

    // Spawn the dedicated SINGLE Disk Writer Thread
    // This entirely prevents Windows file locking issues across multiple threads!
    std::thread writer_thread([&]() {
        WriteJob job;
        while (is_downloading || !queue.empty()) {
            if (queue.try_pop(job)) {
#ifdef _WIN32
                _fseeki64(fp, job.offset, SEEK_SET);
#else
                fseeko(fp, job.offset, SEEK_SET);
#endif
                fwrite(job.data.data(), 1, job.data.size(), fp);
            } else {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
            }
        }
        fclose(fp);
    });

    // Spawn the Network Worker Threads
    std::vector<std::thread> workers;
    std::vector<ThreadState> states(num_threads);
    size_t chunk_size = total_size / num_threads;

    for (int i = 0; i < num_threads; ++i) {
        size_t start = i * chunk_size;
        size_t end = (i == num_threads - 1) ? total_size - 1 : (start + chunk_size - 1);

        states[i].current_offset = start;
        states[i].queue = &queue;
        states[i].downloaded_bytes = &downloaded_bytes;

        workers.emplace_back(DownloadWorker, url, start, end, &states[i]);
    }

    // Main Thread: Print JSON Progress periodically for Electron to consume
    size_t last_bytes = 0;
    while (downloaded_bytes < total_size) {
        std::this_thread::sleep_for(std::chrono::seconds(1));
        size_t current_bytes = downloaded_bytes.load();
        size_t speed = current_bytes - last_bytes; // bytes per second
        last_bytes = current_bytes;

        double progress = (double)current_bytes / total_size * 100.0;
        
        std::cout << "{\"progress\": " << progress 
                  << ", \"downloaded\": " << current_bytes 
                  << ", \"speed\": " << speed 
                  << ", \"total\": " << total_size << "}\n";
    }

    // Cleanup and Join
    for (auto& t : workers) {
        t.join();
    }

    is_downloading = false;
    writer_thread.join();

    curl_global_cleanup();
    std::cout << "{\"status\": \"complete\"}\n";
    return 0;
}
