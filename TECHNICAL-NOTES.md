# TAC Interview Agent — 技术验证记录

## 产品边界（2026-11-13 更新的需求）

- 目标是 Windows 与 macOS 桌面面试辅助工具。音频原始数据仅在内存处理，不写入磁盘；云端 ASR 可将音频发送至用户配置的服务商，本地 ASR 为可选方案。
- 应用必须根据当前选择的 ASR 和 LLM 动态显示音频和文本的实际去向，并在首次从本地切换到云端时要求用户确认。不得笼统承诺数据全部留在本机。
- 模型文本仅发送到用户主动配置的本地或远程端点；远程端点须清楚显示会接收哪些文字。
- 用户提供的 PROMPT.md 和 SPEC.md 是产品需求参考。实现状态与验证结果应分别记录，不能把计划功能描述为已经完成。

## 必须验证的兼容性

1. 内容保护：Electron 官方说明，macOS 上基于 ScreenCaptureKit 的较新捕获应用仍可能捕获 `setContentProtection(true)` 的窗口。不得承诺在所有会议软件或录屏工具中不可见。Windows 10 2004 及以后通常排除窗口，更早版本可能显示黑块。使用前应在目标会议软件的接收端或录制结果中实际检查。来源：https://www.electronjs.org/docs/latest/api/browser-window/#winsetcontentprotectionenable-macos-windows
2. macOS 系统音频：Electron 39 起 macOS 14.2+ 默认使用 CoreAudio Tap，需系统音频录制权限及 `NSAudioCaptureUsageDescription`。权限缺失可能产生没有样本的音轨。Electron 45 起旧的回退开关不再有效。更新后的文档仍假设只需要屏幕录制权限；应按实际 Electron 版本和系统测试。来源：https://www.electronjs.org/docs/latest/api/desktop-capturer#caveats
3. 穿透与控制：Windows 上，当较高权限窗口位于前台时，鼠标事件转发可能暂时失效。需在目标系统测试按钮、拖动、穿透和恢复。来源：https://www.electronjs.org/docs/latest/api/browser-window/#winsetignoremouseeventsignore-options
4. 整屏共享时的按住展开和松开收起，必须实际验证全局热键松开事件能否被当前实现可靠检测；Electron `globalShortcut` 的触发回调自身不提供按键释放事件。

## 验证层级

编译通过不等于本机应用运行通过；本机运行通过不等于另一操作系统通过；系统截图通过也不等于所有会议软件的屏幕共享通过。应记录操作系统版本、Electron 版本、目标软件及另一端实际画面。
