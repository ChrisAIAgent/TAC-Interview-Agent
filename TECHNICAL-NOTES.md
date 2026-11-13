# TAC Interview Agent — 技术验证记录

## 产品边界（2026-11-13 更新的需求）

- 目标是 Windows 与 macOS 桌面面试辅助工具。音频原始数据仅在内存处理，不写入磁盘；云端 ASR 可将音频发送至用户配置的服务商，本地 ASR 为可选方案。
- 应用必须根据当前选择的 ASR 和 LLM 动态显示音频和文本的实际去向，并在首次从本地切换到云端时要求用户确认。不得笼统承诺数据全部留在本机。
- 模型文本仅发送到用户主动配置的本地或远程端点；远程端点须清楚显示会接收哪些文字。
- 用户提供的 PROMPT.md 和 SPEC.md 是产品需求参考。实现状态与验证结果应分别记录，不能把计划功能描述为已经完成。

## 必须验证的兼容性

1. 内容保护：Electron 官方说明，macOS 上基于 ScreenCaptureKit 的较新捕获应用仍可能捕获 `setContentProtection(true)` 的窗口。不得承诺在所有会议软件或录屏工具中不可见。Windows 10 2004 及以后通常排除窗口，更早版本可能显示黑块。使用前应在目标会议软件的接收端或录制结果中实际检查。来源：https://www.electronjs.org/docs/latest/api/browser-window/#winsetcontentprotectionenable-macos-windows
2. macOS 系统音频：本项目锁定 Electron **33.4.11**，不是 39。33 的文档对 `getUserMedia` 的系统音频采集列出限制；本项目使用的是 `getDisplayMedia` + `setDisplayMediaRequestHandler`，Electron 维护者曾报告类似路径在 Electron 31 / macOS 14.5 可用，但这不能证明本项目或其他 macOS 版本可用。Electron 39 起在 macOS 14.2+ 默认使用 CoreAudio Tap；其新版权限路径需要 `NSAudioCaptureUsageDescription`，权限缺失或拒绝可能产生 `ended` 音轨。Electron 45 起旧的回退开关已移除。项目现已加入用途说明，**不能仅凭该字段认定 Electron 33 的采集可用**。应在真实 Mac 上分别测试开发模式和签名包：播放已知声音、检查电平变化及停止、授权拒绝和恢复，记录系统及 Electron 版本。静音帧可能是正常静音，不能单独判定故障。来源：https://github.com/electron/electron/blob/v33.4.11/docs/api/desktop-capturer.md 、https://github.com/electron/electron/issues/42605 、https://www.electronjs.org/docs/latest/api/desktop-capturer#caveats
3. 穿透与控制：Windows 上，当较高权限窗口位于前台时，鼠标事件转发可能暂时失效。需在目标系统测试按钮、拖动、穿透和恢复。来源：https://www.electronjs.org/docs/latest/api/browser-window/#winsetignoremouseeventsignore-options
4. 整屏共享时的按住展开和松开收起，必须实际验证全局热键松开事件能否被当前实现可靠检测；Electron `globalShortcut` 的触发回调自身不提供按键释放事件。
5. macOS 签名：`build/entitlements.mac.plist` 显式保留当前 electron-builder 25.1.8 模板的三项权限（包括 JIT、无符号可执行内存及关闭库验证），同时用于主包和嵌套项，以避免在没有 Mac 验证时悄然改变既有默认签名行为。后两项放宽了 hardened runtime；应在 Mac 签名、启动和音频验收时评估能否收紧，不能仅凭配置推断可启动。Mic 用途字符串只是预留说明，当前音频链路没有麦克风采集功能。

## 验证层级

编译通过不等于本机应用运行通过；本机运行通过不等于另一操作系统通过；系统截图通过也不等于所有会议软件的屏幕共享通过。应记录操作系统版本、Electron 版本、目标软件及另一端实际画面。
