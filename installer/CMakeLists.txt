cmake_minimum_required(VERSION 3.15)
project(CharonInstaller LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Static CRT linking
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(CMAKE_MSVC_RUNTIME_LIBRARY_DEFAULT "MultiThreaded$<$<CONFIG:Debug>:Debug>")

include(FetchContent)

# nlohmann json
FetchContent_Declare(
  json
  URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
)
FetchContent_MakeAvailable(json)

# WebView2
FetchContent_Declare(
  webview2
  URL https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.2151.40
)
FetchContent_GetProperties(webview2)
if(NOT webview2_POPULATED)
  FetchContent_Populate(webview2)
endif()

add_library(webview2 INTERFACE)
target_include_directories(webview2 INTERFACE ${webview2_SOURCE_DIR}/build/native/include)
target_link_libraries(webview2 INTERFACE ${webview2_SOURCE_DIR}/build/native/x64/WebView2LoaderStatic.lib)

set(SOURCES
  src/main.cpp
  src/js_bridge.cpp
  src/installer_engine.cpp
  src/payload.cpp
  src/elevation.cpp
  src/uninstaller.cpp
  src/updater.cpp
  src/resource.rc
)

add_executable(${PROJECT_NAME} WIN32 ${SOURCES})

target_link_libraries(${PROJECT_NAME} PRIVATE
  nlohmann_json::nlohmann_json
  webview2
  Shlwapi.lib
  Shell32.lib
  Ole32.lib
  Comctl32.lib
  Advapi32.lib
  Dwmapi.lib
  Urlmon.lib
)

set_target_properties(${PROJECT_NAME} PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/out"
)
