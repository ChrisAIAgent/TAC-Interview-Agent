// Only target shortcut state is retained or sent; other keys are discarded.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <powrprof.h>
#include <cstdio>
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <chrono>
#include <map>
#include <set>
#include <string>
#include <thread>
#include <mutex>
#include <atomic>
#include <algorithm>

static HWND receiver = nullptr;
static std::mutex outMutex;
static std::mutex metricMutex;
static unsigned nextEventId = 0;
static std::map<unsigned,std::chrono::steady_clock::time_point> eventTimes;
static std::map<HANDLE, std::set<unsigned>> held;
static bool armed = false, active = false;
static unsigned epoch = 0;
static HANDLE activeDevice = nullptr;
static const GUID SESSION_DISPLAY_GUID = {0x2b84c20e,0xad23,0x4ddf,{0x93,0xdb,0x05,0xff,0xbd,0x7e,0xfc,0xa5}};
static constexpr UINT CMD_RESET = WM_APP + 1;
static constexpr UINT CMD_STOP = WM_APP + 2;

static void send(const std::string& line) {
  std::lock_guard<std::mutex> lock(outMutex);
  std::fputs(line.c_str(), stdout); std::fputc('\n', stdout); std::fflush(stdout);
}
static unsigned markEvent() {
  std::lock_guard<std::mutex> lock(metricMutex);
  const unsigned id=++nextEventId; eventTimes[id]=std::chrono::steady_clock::now();
  while (eventTimes.size()>32) eventTimes.erase(eventTimes.begin());
  return id;
}
static void ackEvent(unsigned id, const char* kind) {
  double ms=-1;
  { std::lock_guard<std::mutex> lock(metricMutex); auto i=eventTimes.find(id);
    if (i!=eventTimes.end()) { ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-i->second).count(); eventTimes.erase(i); } }
  if (ms>=0) send(std::string("{\"t\":\"latency\",\"kind\":\"")+kind+"\",\"ms\":"+std::to_string(ms)+"}");
}
static bool physicalClear() {
  return !(GetAsyncKeyState(VK_LMENU) & 0x8000) && !(GetAsyncKeyState(VK_RMENU) & 0x8000)
      && !(GetAsyncKeyState(VK_LSHIFT) & 0x8000) && !(GetAsyncKeyState(VK_RSHIFT) & 0x8000)
      && !(GetAsyncKeyState('H') & 0x8000);
}
static bool isAlt(unsigned scan) { return scan == 0x0038 || scan == 0xe038; }
static bool isShift(unsigned scan) { return scan == 0x002a || scan == 0x0036; }
static bool isH(unsigned scan) { return scan == 0x0023; }
static bool complete(const std::set<unsigned>& keys) {
  bool alt=false, shift=false, h=false;
  for (auto key : keys) { alt |= isAlt(key); shift |= isShift(key); h |= isH(key); }
  return alt && shift && h;
}
static void release(const char* why) {
  if (active) send(std::string("{\"t\":\"combo\",\"pressed\":false,\"reason\":\"") + why + "\",\"epoch\":" + std::to_string(epoch) + ",\"id\":" + std::to_string(markEvent()) + "}");
  active=false; activeDevice=nullptr;
}
static void resetState(const char* why) { release(why); held.clear(); armed=false; }
static void onTargetKey(HANDLE device, unsigned scan, bool up) {
  if (!isAlt(scan) && !isShift(scan) && !isH(scan)) return;
  if (!device) { resetState("unknown-device"); return; }
  auto& keys=held[device];
  if (up) keys.erase(scan); else if (!keys.insert(scan).second) return;
  if (active && device == activeDevice && !complete(keys)) { release("key-up"); armed=false; }
  if (armed && !active && complete(keys)) {
    active=true; activeDevice=device;
    send("{\"t\":\"combo\",\"pressed\":true,\"epoch\":" + std::to_string(epoch) + ",\"id\":" + std::to_string(markEvent()) + "}");
  }
}
static bool keyboardPacketSizeValid(UINT size) {
  return size >= offsetof(RAWINPUT,data.keyboard) + sizeof(RAWKEYBOARD) && size <= 4096;
}
static void onInput(HRAWINPUT input) {
  UINT size=0;
  if (GetRawInputData(input, RID_INPUT, nullptr, &size, sizeof(RAWINPUTHEADER)) != 0 || !keyboardPacketSizeValid(size)) return;
  alignas(RAWINPUT) BYTE buffer[4096];
  if (GetRawInputData(input, RID_INPUT, buffer, &size, sizeof(RAWINPUTHEADER)) != size) return;
  auto* raw=reinterpret_cast<RAWINPUT*>(buffer);
  if (raw->header.dwType != RIM_TYPEKEYBOARD) return;
  const RAWKEYBOARD& k=raw->data.keyboard;
  if (k.MakeCode == KEYBOARD_OVERRUN_MAKE_CODE || k.VKey == 255) { resetState("overrun"); return; }
  unsigned scan=(k.MakeCode & 0x7f) | ((k.Flags & RI_KEY_E0) ? 0xe000 : ((k.Flags & RI_KEY_E1) ? 0xe100 : 0));
  if (!k.MakeCode) scan=MapVirtualKeyW(k.VKey,MAPVK_VK_TO_VSC_EX);
  onTargetKey(raw->header.hDevice,scan,(k.Flags & RI_KEY_BREAK)!=0);
}
static unsigned parseSeq(const std::string& s) {
  auto p=s.find("\"seq\""); if (p == std::string::npos) return 0;
  p=s.find(':',p); if (p == std::string::npos) return 0;
  return static_cast<unsigned>(std::strtoul(s.c_str()+p+1,nullptr,10));
}
static LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_INPUT: onInput(reinterpret_cast<HRAWINPUT>(lp)); return DefWindowProcW(hwnd,msg,wp,lp);
    case WM_INPUT_DEVICE_CHANGE:
      if (wp == GIDC_REMOVAL) { if (active && activeDevice == reinterpret_cast<HANDLE>(lp)) release("device-removed"); held.erase(reinterpret_cast<HANDLE>(lp)); armed=false; }
      return 0;
    case WM_POWERBROADCAST:
      if (wp == PBT_POWERSETTINGCHANGE && lp) {
        const auto* setting=reinterpret_cast<POWERBROADCAST_SETTING*>(lp);
        if (IsEqualGUID(setting->PowerSetting,SESSION_DISPLAY_GUID) && setting->DataLength >= sizeof(DWORD)) {
          DWORD state=0; std::memcpy(&state,setting->Data,sizeof(state));
          if (state == 0) { resetState("display-sleep"); send("{\"t\":\"display-sleep\"}"); }
        }
      }
      return TRUE;
    case WM_TIMER:
      if (!armed && physicalClear()) { held.clear(); armed=true; send("{\"t\":\"armed\",\"epoch\":" + std::to_string(epoch) + "}"); }
      return 0;
    case CMD_RESET: resetState("reset"); epoch=static_cast<unsigned>(wp); return 0;
    case CMD_STOP: DestroyWindow(hwnd); return 0;
    case WM_DESTROY: PostQuitMessage(0); return 0;
  }
  return DefWindowProcW(hwnd,msg,wp,lp);
}
int main(int argc, char** argv) {
  if (argc == 2 && std::strcmp(argv[1],"--size-self-test") == 0) {
    const auto min=static_cast<UINT>(offsetof(RAWINPUT,data.keyboard)+sizeof(RAWKEYBOARD));
    std::printf("{\"minimum\":%u,\"unionSize\":%zu,\"acceptMinimum\":%s,\"rejectShort\":%s}\n",min,sizeof(RAWINPUT),keyboardPacketSizeValid(min)?"true":"false",keyboardPacketSizeValid(min-1)?"false":"true");
    return 0;
  }
  if (argc == 2 && std::strcmp(argv[1],"--self-test") == 0) {
    HANDLE first=reinterpret_cast<HANDLE>(1), second=reinterpret_cast<HANDLE>(2);
    armed=true; epoch=1;
    onTargetKey(first,0x38,false); onTargetKey(second,0x2a,false); onTargetKey(second,0x23,false);
    onTargetKey(first,0x36,false); onTargetKey(first,0x23,false); onTargetKey(first,0x23,false);
    onTargetKey(first,0x36,true);
    held.clear(); armed=true;
    onTargetKey(first,0xe038,false); onTargetKey(first,0x2a,false); onTargetKey(first,0x23,false);
    wndProc(nullptr,WM_INPUT_DEVICE_CHANGE,GIDC_REMOVAL,reinterpret_cast<LPARAM>(first));
    return 0;
  }
  WNDCLASSW cls={}; cls.lpfnWndProc=wndProc; cls.hInstance=GetModuleHandleW(nullptr); cls.lpszClassName=L"TacKeylistenerMessageWindow";
  if (!RegisterClassW(&cls)) { send("{\"t\":\"error\",\"code\":\"register-window-failed\"}"); return 1; }
  receiver=CreateWindowExW(0,cls.lpszClassName,L"",0,0,0,0,0,HWND_MESSAGE,nullptr,cls.hInstance,nullptr);
  if (!receiver) { send("{\"t\":\"error\",\"code\":\"create-window-failed\"}"); return 1; }
  RAWINPUTDEVICE rid={}; rid.usUsagePage=0x01; rid.usUsage=0x06; rid.dwFlags=RIDEV_INPUTSINK | RIDEV_DEVNOTIFY; rid.hwndTarget=receiver;
  if (!RegisterRawInputDevices(&rid,1,sizeof(rid))) { send("{\"t\":\"error\",\"code\":\"raw-input-failed\"}"); return 1; }
  HPOWERNOTIFY displayNotify=RegisterPowerSettingNotification(receiver,&SESSION_DISPLAY_GUID,DEVICE_NOTIFY_WINDOW_HANDLE);
  SetTimer(receiver,1,50,nullptr);
  std::thread reader([] {
    char buf[512];
    while (std::fgets(buf,sizeof(buf),stdin)) {
      std::string s(buf); unsigned seq=parseSeq(s);
      if (s.find("\"event-ack\"") != std::string::npos) ackEvent(seq, s.find("\"expand\"") != std::string::npos ? "expand" : "collapse");
      else if (s.find("\"ping\"") != std::string::npos) send("{\"t\":\"pong\",\"seq\":" + std::to_string(seq) + "}");
      else if (s.find("\"pulse\"") != std::string::npos) PostMessageW(receiver, WM_APP+3, seq, 0);
      else if (s.find("\"reset\"") != std::string::npos) PostMessageW(receiver,CMD_RESET,seq,0);
      else if (s.find("\"stop\"") != std::string::npos) { PostMessageW(receiver,CMD_STOP,0,0); return; }
    }
    PostMessageW(receiver,CMD_STOP,0,0);
  });
  reader.detach();
  send(std::string("{\"t\":\"ready\",\"platform\":\"win32\",\"permission\":\"granted\",\"sameDevice\":true,\"displaySleep\":") + (displayNotify ? "true}" : "false}"));
  MSG msg; while (GetMessageW(&msg,nullptr,0,0)>0) {
    if (msg.message == WM_APP+3) send("{\"t\":\"pulse-ack\",\"seq\":" + std::to_string(static_cast<unsigned>(msg.wParam)) + "}");
    else { TranslateMessage(&msg); DispatchMessageW(&msg); }
  }
  return 0;
}
