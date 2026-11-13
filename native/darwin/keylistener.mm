// Only shortcut state is retained or sent. Other key events are discarded.
#import <Foundation/Foundation.h>
#import <ApplicationServices/ApplicationServices.h>
#import <IOKit/hid/IOHIDLib.h>
#import <IOKit/hidsystem/IOHIDLib.h>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <map>
#include <set>

static CFMachPortRef tap = nullptr;
static CFRunLoopRef loop = nullptr;
static std::mutex outputLock;
static bool active = false, armed = false;
static unsigned epoch = 0;
static IOHIDManagerRef hidManager = nullptr;
static IOHIDDeviceRef activeDevice = nullptr;
static std::map<IOHIDDeviceRef,std::set<uint32_t>> held;
static void send(const std::string& message) { std::lock_guard<std::mutex> lock(outputLock); std::fputs(message.c_str(),stdout); std::fputc('\n',stdout); std::fflush(stdout); }
static void release(const char* reason) {
  if (active) send(std::string("{\"t\":\"combo\",\"pressed\":false,\"reason\":\"")+reason+"\",\"epoch\":"+std::to_string(epoch)+"}");
  active=false; armed=false; activeDevice=nullptr; held.clear();
}
static bool allReleased() {
  auto state=kCGEventSourceStateCombinedSessionState;
  return !CGEventSourceKeyState(state,0x3a) && !CGEventSourceKeyState(state,0x3d) &&
         !CGEventSourceKeyState(state,0x38) && !CGEventSourceKeyState(state,0x3c) && !CGEventSourceKeyState(state,0x04);
}
static bool deviceComplete(const std::set<uint32_t>& keys) {
  return (keys.count(0xe2) || keys.count(0xe6)) && (keys.count(0xe1) || keys.count(0xe5)) && keys.count(0x0b);
}
static void onHidValue(void*, IOReturn result, void*, IOHIDValueRef value) {
  if (result != kIOReturnSuccess || !value) { release("hid-error"); send("{\"t\":\"error\",\"code\":\"hid-error\"}"); return; }
  IOHIDElementRef element=IOHIDValueGetElement(value);
  if (!element || IOHIDElementGetUsagePage(element)!=0x07) return;
  uint32_t usage=IOHIDElementGetUsage(element);
  if (usage != 0xe1 && usage != 0xe5 && usage != 0xe2 && usage != 0xe6 && usage != 0x0b) return;
  IOHIDDeviceRef device=IOHIDElementGetDevice(element);
  if (!device) { release("unknown-device"); return; }
  auto& keys=held[device];
  if (IOHIDValueGetIntegerValue(value)) { if (!keys.insert(usage).second) return; } else keys.erase(usage);
  if (active && device == activeDevice && !deviceComplete(keys)) { release("key-up"); return; }
  if (armed && !active && deviceComplete(keys)) {
    active=true; activeDevice=device;
    send("{\"t\":\"combo\",\"pressed\":true,\"epoch\":"+std::to_string(epoch)+"}");
  }
}
static void onDeviceRemoved(void*, IOReturn, void*, IOHIDDeviceRef device) {
  if (active && activeDevice == device) release("device-removed");
  held.erase(device); armed=false;
}
static CGEventRef onEvent(CGEventTapProxy, CGEventType type, CGEventRef event, void*) {
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    release("tap-disabled"); send("{\"t\":\"tap-disabled\"}");
    CGEventTapEnable(tap,true);
    if (CGEventTapIsEnabled(tap)) send("{\"t\":\"health\",\"state\":\"tap-reenabled\"}");
    else send("{\"t\":\"error\",\"code\":\"tap-disabled\"}");
    return event;
  }
  // Device-specific state comes from IOHID, not the session-wide event tap.
  if (type == kCGEventKeyDown && CGEventGetIntegerValueField(event,kCGKeyboardEventAutorepeat)) return event;
  return event;
}
static unsigned seq(const std::string& s) { auto p=s.find("\"seq\""); if (p==std::string::npos) return 0; p=s.find(':',p); return p==std::string::npos ? 0 : (unsigned)std::strtoul(s.c_str()+p+1,nullptr,10); }
int main(int argc, char** argv) { @autoreleasepool {
  if (argc > 1 && std::strcmp(argv[1],"--check-permission")==0) {
    auto access=IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
    std::printf("%s\n",access == kIOHIDAccessTypeGranted ? "granted" : access == kIOHIDAccessTypeDenied ? "denied" : "unknown"); return 0;
  }
  if (argc > 1 && std::strcmp(argv[1],"--request-permission")==0) { IOHIDRequestAccess(kIOHIDRequestTypeListenEvent); std::puts("requested"); return 0; }
  if (IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) != kIOHIDAccessTypeGranted) { send("{\"t\":\"error\",\"code\":\"perm-denied\"}"); return 1; }
  CGEventMask mask=CGEventMaskBit(kCGEventKeyDown)|CGEventMaskBit(kCGEventKeyUp)|CGEventMaskBit(kCGEventFlagsChanged);
  tap=CGEventTapCreate(kCGSessionEventTap,kCGHeadInsertEventTap,kCGEventTapOptionListenOnly,mask,onEvent,nullptr);
  if (!tap) { send("{\"t\":\"error\",\"code\":\"tap-init-failed\"}"); return 1; }
  loop=CFRunLoopGetCurrent();
  hidManager=IOHIDManagerCreate(kCFAllocatorDefault,kIOHIDOptionsTypeNone);
  if (!hidManager) { send("{\"t\":\"error\",\"code\":\"hid-init-failed\"}"); return 1; }
  int page=1, usage=6;
  CFNumberRef pageNum=CFNumberCreate(kCFAllocatorDefault,kCFNumberIntType,&page);
  CFNumberRef usageNum=CFNumberCreate(kCFAllocatorDefault,kCFNumberIntType,&usage);
  const void* keys[]={CFSTR(kIOHIDDeviceUsagePageKey),CFSTR(kIOHIDDeviceUsageKey)};
  const void* values[]={pageNum,usageNum};
  CFDictionaryRef matching=CFDictionaryCreate(kCFAllocatorDefault,keys,values,2,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
  IOHIDManagerSetDeviceMatching(hidManager,matching); CFRelease(matching); CFRelease(pageNum); CFRelease(usageNum);
  IOHIDManagerRegisterInputValueCallback(hidManager,onHidValue,nullptr);
  IOHIDManagerRegisterDeviceRemovalCallback(hidManager,onDeviceRemoved,nullptr);
  IOHIDManagerScheduleWithRunLoop(hidManager,loop,kCFRunLoopDefaultMode);
  if (IOHIDManagerOpen(hidManager,kIOHIDOptionsTypeNone)!=kIOReturnSuccess) { send("{\"t\":\"error\",\"code\":\"hid-open-failed\"}"); return 1; }
  CFRunLoopSourceRef source=CFMachPortCreateRunLoopSource(kCFAllocatorDefault,tap,0);
  CFRunLoopAddSource(loop,source,kCFRunLoopCommonModes); CGEventTapEnable(tap,true);
  std::thread reader([] {
    char buf[512];
    while (std::fgets(buf,sizeof(buf),stdin)) {
      std::string s(buf); unsigned n=seq(s);
      if (s.find("\"ping\"")!=std::string::npos) send("{\"t\":\"pong\",\"seq\":"+std::to_string(n)+"}");
      else if (s.find("\"pulse\"")!=std::string::npos) { CFRunLoopPerformBlock(loop,kCFRunLoopCommonModes,^{ if (CGEventTapIsEnabled(tap)) send("{\"t\":\"pulse-ack\",\"seq\":"+std::to_string(n)+"}"); }); CFRunLoopWakeUp(loop); }
      else if (s.find("\"reset\"")!=std::string::npos) { CFRunLoopPerformBlock(loop,kCFRunLoopCommonModes,^{ release("reset"); epoch=n; }); CFRunLoopWakeUp(loop); }
      else if (s.find("\"stop\"")!=std::string::npos) { CFRunLoopStop(loop); return; }
    }
    CFRunLoopStop(loop);
  }); reader.detach();
  // CGEventTap does not expose a verified keyboard device identity. Fail closed
  // until a device-level implementation passes the same-keyboard acceptance test.
  send("{\"t\":\"ready\",\"platform\":\"darwin\",\"permission\":\"granted\",\"sameDevice\":false}");
  while (CFRunLoopRunInMode(kCFRunLoopDefaultMode,0.05,true)!=kCFRunLoopRunStopped) {
    if (!armed && allReleased()) { armed=true; send("{\"t\":\"armed\",\"epoch\":"+std::to_string(epoch)+"}"); }
  }
  IOHIDManagerUnscheduleFromRunLoop(hidManager,loop,kCFRunLoopDefaultMode); IOHIDManagerClose(hidManager,kIOHIDOptionsTypeNone); CFRelease(hidManager);
  CFRunLoopRemoveSource(loop,source,kCFRunLoopCommonModes); CFRelease(source); CFRelease(tap); return 0;
} }
