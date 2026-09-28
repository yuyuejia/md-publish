#include <napi.h>
#import <Foundation/Foundation.h>

// startAccessingSecurityScopedResource 必须成对调用，这里缓存已开始的 URL
static NSMutableDictionary<NSString*, NSURL*>* gAccessing = nil;

static Napi::Value CreateBookmark(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "path string required").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  @autoreleasepool {
    NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
    NSError* error = nil;
    NSData* data = [url bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope
                 includingResourceValuesForKeys:nil
                                  relativeToURL:nil
                                          error:&error];
    if (!data) {
      Napi::Error::New(env, error ? [[error localizedDescription] UTF8String]
                                  : "bookmark creation failed")
          .ThrowAsJavaScriptException();
      return env.Null();
    }
    return Napi::Buffer<unsigned char>::Copy(env, (const unsigned char*)[data bytes], [data length]);
  }
}

// 解析 bookmark 并开始安全作用域访问；stale 时返回新的 bookmark
Napi::Value StartAccessing(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "bookmark buffer required").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto buffer = info[0].As<Napi::Buffer<unsigned char>>();
  @autoreleasepool {
    NSData* data = [NSData dataWithBytes:buffer.Data() length:buffer.Length()];
    BOOL stale = NO;
    NSError* error = nil;
    NSURL* url = [NSURL URLByResolvingBookmarkData:data
                                           options:NSURLBookmarkResolutionWithSecurityScope
                                     relativeToURL:nil
                               bookmarkDataIsStale:&stale
                                             error:&error];
    if (!url) {
      Napi::Error::New(env, error ? [[error localizedDescription] UTF8String]
                                  : "bookmark resolve failed")
          .ThrowAsJavaScriptException();
      return env.Null();
    }
    NSString* key = [url path];
    if (!gAccessing) {
      gAccessing = [NSMutableDictionary dictionary];
    }
    if (gAccessing[key]) {
      [gAccessing[key] stopAccessingSecurityScopedResource];
    }
    BOOL started = [url startAccessingSecurityScopedResource];
    gAccessing[key] = url;

    Napi::Object obj = Napi::Object::New(env);
    obj.Set("path", Napi::String::New(env, [key UTF8String]));
    obj.Set("stale", Napi::Boolean::New(env, stale));
    obj.Set("started", Napi::Boolean::New(env, started));

    if (stale) {
      NSError* refreshError = nil;
      NSData* fresh = [url bookmarkDataWithOptions:NSURLBookmarkCreationWithSecurityScope
                    includingResourceValuesForKeys:nil
                                     relativeToURL:nil
                                             error:&refreshError];
      if (fresh) {
        obj.Set("bookmark", Napi::Buffer<unsigned char>::Copy(
                                env, (const unsigned char*)[fresh bytes], [fresh length]));
      }
    }
    return obj;
  }
}

static Napi::Value StopAccessing(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "path string required").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::string path = info[0].As<Napi::String>().Utf8Value();
  NSString* key = [NSString stringWithUTF8String:path.c_str()];
  @autoreleasepool {
    if (gAccessing && gAccessing[key]) {
      [gAccessing[key] stopAccessingSecurityScopedResource];
      [gAccessing removeObjectForKey:key];
      return Napi::Boolean::New(env, true);
    }
    return Napi::Boolean::New(env, false);
  }
}

static Napi::Value StopAll(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  @autoreleasepool {
    if (gAccessing) {
      for (NSString* key in gAccessing) {
        [gAccessing[key] stopAccessingSecurityScopedResource];
      }
      [gAccessing removeAllObjects];
    }
    return Napi::Boolean::New(env, true);
  }
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("createBookmark", Napi::Function::New(env, CreateBookmark));
  exports.Set("startAccessing", Napi::Function::New(env, StartAccessing));
  exports.Set("stopAccessing", Napi::Function::New(env, StopAccessing));
  exports.Set("stopAll", Napi::Function::New(env, StopAll));
  return exports;
}

NODE_API_MODULE(mac_bookmark, Init)
