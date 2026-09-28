{
  "targets": [
    {
      "target_name": "mac-bookmark",
      "sources": ["src/bookmark.mm"],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "defines": ["NAPI_VERSION=8"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "xcode_settings": {
              "CLANG_ENABLE_OBJC_ARC": "YES",
              "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
              "CLANG_CXX_LIBRARY": "libc++",
              "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
              "MACOSX_DEPLOYMENT_TARGET": "10.15"
            },
            "link_settings": {
              "libraries": ["-framework Foundation", "-framework CoreFoundation"]
            }
          }
        ]
      ]
    }
  ]
}
