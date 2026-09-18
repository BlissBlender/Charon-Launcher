cmake_minimum_required(VERSION 3.15)
project(CharonCore CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find libcurl (VCPKG makes this seamless)
find_package(CURL REQUIRED)

add_executable(charon-core src/main.cpp)

# Link curl
target_link_libraries(charon-core PRIVATE CURL::libcurl)

# Enable maximum optimization for release builds
if(CMAKE_BUILD_TYPE MATCHES "Release")
    target_compile_options(charon-core PRIVATE /O2 /MD)
endif()
