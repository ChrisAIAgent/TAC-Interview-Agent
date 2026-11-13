# TAC Interview Agent

Windows / macOS 面试辅助应用原型，界面参考 `TAC Marketing` 素材。当前阶段仅围绕共享范围声明与按住显示，不提供完整面试流程。

## 本地启动

需要 Node.js、npm，以及本机 C++ 工具链：Windows 需 Visual Studio C++ Build Tools，macOS 需 Xcode 命令行工具。项目根目录执行：

```bash
npm install
npm run build:native
npm run dev
```

在设置页确认共享范围。Windows 上要测试 B 档，请阅读隐私提示后点击“启用按键监听”，选择“整个屏幕”并确认，再按住 `Alt+Shift+H`。退出时可使用托盘菜单。原始音频采集与面试回答尚未接入。

macOS 原生源码和构建命令已提供，但此环境未能编译或验证 macOS；设备级同键盘识别在实机通过验收前被安全禁用。设置页的权限申请仅由用户点击触发；权限归属、系统条目、签名及重新授权流程仍需在 Mac 上检查。

macOS 开发打包应选择固定 bundle ID 和 Keychain 中的固定证书（例如通过 `CSC_NAME` 指定）；签名身份改变后，可能需要清理旧的输入监控授权条目并重新授权。helper 被放入应用的 `Contents/Resources/keylistener` 并列入额外签名项；这不保证 TCC 显示为单一条目。发布签名、公证及授权均未验证。

## 保护边界

- 展开期间，内容可能出现在屏幕共享画面。屏幕采集排除依赖系统与采集工具，macOS ScreenCaptureKit 可能捕获受保护窗口；使用目标会议软件及第二设备实测。
- 系统会把键盘事件提供给监听程序；程序只识别组合键状态，不记录、保存或上传其他按键，也不拦截输入。
- Windows 支持按同一物理键盘识别组合、设备拔出清理及版本号过滤；程序事件线程快速租约为 100ms 一次、300ms 超时。常规心跳为 5s 一次、15s 超时。进程退出立即处理；主进程或系统冻结时无法保证收起时限。
- 显示器休眠通知通过 Windows 原生消息尝试接入，尚未实机验证；macOS 显示器休眠通知尚未接入。锁屏、系统休眠与显示器移除/缩放变化由主进程处理。
- 窗口 API 耗时和监听进程通信往返上界不包含系统采集、显示合成或远端网络延迟。

## 检查

```bash
npm run typecheck
npm run build
node --test tests/*.test.mjs
```

截至目前，已验证 Windows 原生程序可编译、监听进程通信及模拟按键状态；真实键盘、缩放、系统休眠、会议软件接收端与 macOS 验收均待完成。不要将编译和模拟测试当作实机验收。
