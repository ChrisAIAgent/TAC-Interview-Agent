# 任务：实现 interview-copilot（Windows + macOS 双端）

你是一名资深桌面应用工程师。请从零实现一个**在线面试实时辅助工具**，双端运行（Windows 10/11 与 macOS 14+）。

详细技术规格见同目录 `SPEC.md`。本文件定义任务边界、技术选型、已验证的技术决策、交付节奏与验收标准。**开始编码前请完整读完 SPEC.md。**

---

## 1. 产品是什么

用户正在进行在线视频面试（浏览器里的腾讯会议 / 飞书 / Zoom / Teams / 牛客等）。**绝大多数在线面试只开摄像头与麦克风，不要求共享屏幕**，所以工具的核心任务只有四件：

1. 采集**电脑正在播放的系统声音**（面试官的声音），不接入任何会议软件
2. 把音频送去做语音识别，得到问题文本
3. 结合用户填写的**结构化简历**，调用大模型生成口语化的回答要点
4. 在一个**置顶、半透明、点击穿透**的悬浮窗里流式展示答案，并提供一键收起

用户视线在面试窗口上，所以答案必须浮在面试软件之上。这一条只需要窗口层级设置，不涉及任何系统权限。

### 1.1 范围划分（决定了工作量分配）

| 能力 | 优先级 | 说明 |
|---|---|---|
| 系统音频采集 → 云端 ASR → 简历驱动回答 → 悬浮窗展示 | **核心，必做** | 这是产品的全部价值，约占 80% 工作量 |
| 一键收起 / 恢复（热键） | **核心，必做** | `globalShortcut` + `hide/show`，半天 |
| 只共享标签页时天然不可见 | **天然成立，无需实现** | 浏览器只采集该标签页渲染结果，桌面窗口不在范围内 |
| 防整屏共享被看到（三档模型 + 原生按键监听） | **可选，暂不排期** | 见 SPEC §8。仅当面试方明确要求「共享整个屏幕」时才有意义 |

**任何时候都不要为了最后一项推迟前三项。** 前三项跑通就已经能用；最后一项是整套方案里唯一需要原生代码和 macOS 系统权限的部分。

**关于「防采集」的前提必须理解清楚**：不存在对所有采集方式都不可见的窗口。macOS 12.3 之后系统级采集（ScreenCaptureKit）直接读取窗口像素，会忽略窗口的「禁止共享」标记，而新款会议软件全部走这条路径。所以 SPEC §8 的三档降级模型是「尽力而为 + 如实告知」，不是可靠保证。**不要把它做成「打开就绝对隐身」的开关，也不要向用户承诺对方看不到。**

**稳定性是第一优先级。** 语音识别与大模型都以云端大厂服务为默认实现（延迟稳定、准确率高、不占本机算力），同时保留本地离线实现作为可切换的备选。两套都必须实现，运行时切换，不是二选一砍掉一个。

---

## 2. 四条硬约束

### 2.1 音频不落盘

- 系统音频的原始 PCM **只在内存中流转**，绝不写磁盘、绝不做临时文件中转
- 代码中不允许出现任何把音频 buffer 写入文件的路径（`fs.writeFile` / `createWriteStream` / `appendFile` 均禁止用于音频）
- 这条与「是否上云」无关，它防的是音频在磁盘上残留

### 2.2 数据流向必须如实标注

音频与文本的去向取决于当前选中的后端组合，**界面必须按 SPEC §7.1 的矩阵动态展示真实流向**，不能用笼统的「隐私安全」一带而过。

- 首次从本地后端切到任一云端后端时，弹一次确认
- 悬浮窗状态栏常驻一个小流向标记（如 `音频→腾讯云`）
- 不允许出现「承诺音频不出本机」但实际走云端的表述

### 2.3 双端一套代码

- 不写两套实现。所有平台差异收敛到 `src/main/platform/` 下的适配层
- Windows 与 macOS 的功能必须对等，不允许「Mac 上暂不支持」这类降级
- 主链路平台差异共**三处**：音频采集、窗口防截屏、全局热键修饰键
- 启用附录 A（防整屏共享）后才多出第四处：原生按键监听进程。**不要把第四处当成主链路的一部分提前实现**

### 2.4 无自建后端

- 没有自己的服务器、没有账号体系、没有登录、没有订单、没有点数计费
- 所有状态存在本机
- 外部依赖只有两个，都由用户在设置里填自己的凭证：
  1. 语音识别服务（腾讯云 / 阿里云，二选一，可切本地）
  2. 大模型服务（任意 OpenAI 兼容接口，可切本地 Ollama）

---

## 3. 技术选型（已定，不要改）

| 层 | 选型 | 版本要求 |
|---|---|---|
| 壳 | **Electron** | 31+ |
| 语言 | **TypeScript** | 5.4+，`strict: true` |
| 构建 | **electron-vite** | 最新稳定 |
| UI | **React** + **Tailwind CSS** | React 18 |
| 状态 | **Zustand** | 4.x |
| ASR（云） | **原生 `WebSocket`**（Node 22 与 Chromium 均内置），不用任何厂商 SDK | 见 SPEC §4.2 / §4.3 |
| ASR（本地） | **sherpa-onnx-node**（主）+ **nodejs-whisper**（备） | 见 SPEC §4.4 / §4.5 |
| VAD（仅本地路径） | **silero-vad**（onnxruntime-node） | 见 SPEC §3.4 |
| LLM | 原生 `fetch` + SSE 解析，无 SDK | 见 SPEC §6 |
| Markdown | react-markdown + remark-gfm + remark-math | — |
| 打包 | electron-builder（nsis + dmg） | — |

**禁止引入**：厂商官方 SDK（`tencentcloud-sdk-nodejs`、`aliyun-sdk` 等）、任何遥测/埋点库、任何远程配置拉取、任何 RAG 框架。

> 厂商 SDK 都是面向服务端的重量级包，无法直接消费浏览器里的 `MediaStream` 音频，且会把整个云产品线拖进来。实时语音识别就两个东西：一个签名、一个 WebSocket。自己写两百行比集成 SDK 更可控。

---

## 4. 已验证的技术决策（照做，不要重新论证）

下面每一条都是这类产品上反复踩过坑才定下来的。**如果实现时觉得某条不合理，先按它做，把疑问写在交付说明里，不要自行改方案。**

| # | 决策 | 理由 | 违反的后果 |
|---|---|---|---|
| — | **1–26 条属于主链路，必须遵守。27–44 条属于附录 A（防整屏共享），未启用该部分时可整段跳过** | | |
| 1 | 用 Electron，不用 Tauri / Flutter / 纯原生 | Chromium 在 macOS 上已能直接采系统音频，Windows 走 WASAPI loopback；`setContentProtection`、全局热键、录屏采集都是内置能力。**除按键监听进程（SPEC §8.7）外不需要任何原生模块**，而那一个原生件是独立可执行文件，不是 Node 插件，不参与 `node-gyp` 与 ABI 匹配 | 改用 Tauri 需自己写 unsafe 的 objc2 调用与 Windows API 绑定；Flutter 需维护两套平台通道 |
| 2 | **不用虚拟声卡**（BlackHole / Soundflower / VB-Cable） | 虚拟声卡要求用户手动建「多输出设备」并改系统音频路由，路由一错就全场无声，且面试中无法排查 | 首次使用成功率掉到一半以下，这是同类工具最大的翻车点 |
| 3 | macOS 用 `desktopCapturer`（ScreenCaptureKit），只需**屏幕录制**权限 | 系统级采集，不改变用户的音频设备配置 | 走 CoreAudio tap 需处理设备枚举，复杂且易随系统版本失效 |
| 4 | 云端 ASR 用**原生 WebSocket 手写**，不集成厂商 SDK | SDK 面向服务端、体积大、吃不了浏览器音频流；直连协议只有签名 + 二进制帧两件事 | 包体积涨几十 MB，且 SDK 的音频入口与实际数据源对不上，最后还得手写 |
| 5 | **默认腾讯云 ASR**（`engine_model_type=16k_zh`） | 签名一次直连，无需预换 token，少一次往返与一个定时刷新；上行是裸二进制，协议最简 | 走阿里云做默认要多维护 token 刷新，多一个失败点 |
| 6 | 音频必须 **Float32 → Int16LE** 显式转换后再发云端 | 云端只收 16bit PCM；把 Float32 字节直接发过去，服务端解析出的是噪声，识别结果全是乱码且不报错 | 排查半天以为是采样率问题 |
| 7 | 发送用**严格 100ms 节拍器**（每包 3200 字节），**不用 `requestAnimationFrame`** | 云端限制上行速率不超过 1:1 实时率，超了直接 `4000` 断连；`rAF` 在页面不可见时降到 1fps，音频立刻断流 | 攒包突发 → 被服务端踢掉；用 rAF → 切到面试页就静音 |
| 8 | 缓冲不足时**发静音填充**，不跳包 | 服务端按「包间隔」判超时，15 秒无数据直接 `4008` | 面试官停顿一会就断连 |
| 9 | **只对 `slice_type === 2`（稳态句子）做问题判定** | `slice_type === 1` 的中间结果还会变，拿它触发会一个问题生成三遍答案 | 答案反复重置，界面乱跳 |
| 10 | 签名 / 换 token **只在主进程**，渲染进程只拿「已签名的 URL」或「临时 token」 | SecretKey 一旦进渲染层，任何一次 XSS 或调试器都能拿到 | 云账号被盗刷 |
| 11 | **不做静默自动切换后端** | 静默换后端会让用户以为一切正常，但识别质量已变，出问题无法归因 | 用户以为是产品坏了，实际是降级到了本地小模型 |
| 12 | 暂停时**保留 WS 连接但停发流**；暂停超 10 秒主动 end 并断开 | 短暂停不重连，长暂停不触发服务端超时错误 | 每次暂停恢复都重连，丢 2-3 秒音频；或暂停久了直接报错 |
| 13 | 云端 ASR 必带**热词表**（面试领域术语） | `RAG`、`Kubernetes`、`QPS`、`灰度`这类词通用模型经常认错，热词能显著提升 | 技术面试里术语错误率高，答案跟着跑偏 |
| 14 | 简历**结构化五段**存储，不存整段文本 | 分段后模型能精确引用「你在 A 公司做的那个会员改版」，而不是笼统复述 | 存整段文本时答案会泛化，且无法定位引用来源 |
| 15 | 简历**不做向量检索**，按关键词重合度选段后整段注入 | 简历只有一两页，整段塞进 prompt 比 RAG 准确；RAG 会把一条经历切成碎片，模型容易张冠李戴 | 引入 embedding + 向量库的复杂度，准确率反而下降 |
| 16 | 悬浮窗必须 `focusable: false` + `setAlwaysOnTop(true, 'screen-saver')` | `focusable: true` 会在点击悬浮窗时抢走面试页面的键盘焦点；普通 alwaysOnTop 会被全屏会议窗口覆盖 | 用户一打字就断，或答案被全屏面试窗口挡住 |
| 17 | 点击穿透**按命中区域动态切换**，不一刀切 | 一刀切 `setIgnoreMouseEvents(true)` 后按钮全部点不到，等于没有交互 | 产品不可用 |
| 18 | 会话状态机必须覆盖 **9 个状态 + 全部失败分支**（见 SPEC §2.2） | 这类产品 80% 的问题出在音频与连接中断，不是识别或生成 | 连接一断整个工具静默失效，用户以为是自己没说话 |
| 19 | 必须实现 **9 个诊断字段**并展示（见 SPEC §2.3） | 没有 `lastChunkAgeMs`、`sentBytesPerSec`、`asrLatencyMs`，出问题时无法区分是采集、上行速率、识别还是模型的问题 | 排障只能靠猜 |
| 20 | LLM 调用在**主进程**；ASR 的 WebSocket 在**渲染进程** | 音频在渲染层（MediaStream），WS 跟着音频走少一层 IPC 拷贝；LLM 不吃音频，放主进程方便管 Key | 反过来则音频要过 IPC 且有延迟，Key 又可能漏到渲染层 |
| 21 | `baseUrl` 只要求用户填到 `/v1` 一级，代码里拼 `/chat/completions` | 让用户填完整路径必然填错（少 `/v1`、多 `/chat/completions`、结尾多个 `/`） | 设置页永远连不通 |
| 22 | 首 token 超时 **20s**，整体 60s，超时立即 `AbortController.abort()` | 面试中答案晚 20 秒等于没有；不主动 abort 会让并发请求堆积 | 卡住的请求越积越多，界面一直转圈 |
| 23 | 生成参数固定 `temperature: 0.4`、`max_tokens: 400` | 面试回答要稳定、要短；高温度会编造细节，长输出来不及看 | 答案看着漂亮但不可信 |
| 24 | 中文相似度按 **2-gram** 切分计算重合度；问题去重阈值 0.85，排除「嗯/对/好」开头 | 中文没有空格，按词切需要分词器；2-gram 无需词典且对短句足够准 | 引入分词依赖收益不明显；口头确认语会被误判成新问题 |
| 25 | 复制**只在用户点击时**才写剪贴板 | 自动写剪贴板会覆盖用户正在复制的内容 | 用户投诉「剪贴板老是被清空」 |
| 26 | 日志打印 URL 时把 `signature=` / `token=` 之后的内容替换成 `***` | 签名 URL 与临时 token 泄漏后可直接盗用服务 | 凭证随日志外流 |
| 27 | **把「隐身」实现为三档降级模型（SPEC §8.5），不要当成一个 API 开关** | macOS 12.3 之后 ScreenCaptureKit 直接采集窗口字节，`NSWindowSharingNone` 对它无效；新版会议软件全部迁到 SCK。换 Tauri 或原生 AppKit 同样无效——限制来自系统采集 API，不是框架 | 用户以为安全，在整屏共享时被完整看到；或反过来，因为做不到而放弃 macOS |
| 28 | **主路径是「用户只共享面试标签页」**，UI 必须主动引导到这一档 | 共享标签页时浏览器只捕获目标标签页的渲染结果，桌面窗口不在采集范围，与任何 API 无关。这是双端唯一 100% 可靠的方式 | 默认让用户整屏共享，然后靠 API 兜底，等于把可靠性押在最不可靠的环节 |
| 29 | 整屏共享时用**物理隐藏**（收成 1px 边条 + 按住组合键才展开），不做透明度/字号规避 | 被采集的是像素，降低透明度只会让内容更难读，不会让它不可见。1px 静止态即使被采集也无内容可读 | 用户在最需要隐藏的场景里，把答案以半透明形态完整暴露 |
| 30 | 共享范围**必须由用户声明**，每场开局强制确认，进程扫描只作辅助提示 | macOS 无可靠 API 告知「当前正在被谁采集」。企图靠检测猜状态，会在最关键的时候猜错 | 猜错一次，整场面试的答案暴露 |
| 31 | 所有对外文案**不得出现「绝对隐身」「对方看不到」这类断言**，只说具体条件 | 这是个会随系统版本和软件更新变化的能力，断言一旦失效，代价由用户承担 | 用户基于错误承诺做决策 |
| 32 | B 档用**独立原生进程**做按住显示：Windows `Raw Input` + `RIDEV_INPUTSINK`，macOS `CGEventTap` + `kCGEventTapOptionListenOnly`（SPEC §8.7） | `globalShortcut` 只有按下事件，没有松开事件，这是硬限制。Raw Input 不拦截输入、不进入系统输入路径，比低级键盘钩子温和得多；独立进程还能避开 Chromium 自身的 Raw Input 注册冲突 | 用 `globalShortcut` 就做不出松开语义；用 `WH_KEYBOARD_LL` 钩子则容易被杀软判为键盘记录器 |
| 33 | **不要用现成第三方封装**（`uiohook-napi`、`node-global-key-listener` 等），自己写监听二进制 | 这些库多数走低级钩子而非 Raw Input，且把 macOS 权限流程、二进制签名、架构打包都藏在包里，出问题时无法定位；自己写可以把「只读三个键」这点做成可审计的 | 引入不可控的输入拦截实现，与「不拦截输入」的隐私承诺冲突 |
| 34 | 按键判定**不看顺序只看到齐**，任一键松开立即收起；重复 down 必须丢弃 | 用户可能先按 H 再补 Alt+Shift；自动重复会持续发 down，不去重会导致状态抖动 | 组合键时灵时不灵，按住 5 秒窗口反复闪 |
| 35 | 必须处理 `kCGEventTapDisabledByTimeout` / `ByUserInput`，收到后 `CGEventTapEnable(true)` 并上报 | tap 被系统禁用后不重启用，监听会**静默永久失效**，用户以为热键坏了 | 面试进行到一半按住热键没反应，且没有任何提示 |
| 36 | 监听用**独立进程 + stdio 行协议 + 5 秒心跳**（3 次丢失即判定失联） | 无心跳则进程挂掉后界面仍显示「正常」，用户按住没反应却不知道该重开 | 最坏情况：整场面试热键都是死的 |
| 37 | macOS **Input Monitoring 权限必须由用户手势触发申请，授权后重启应用**；开发期固定 bundle ID 与签名身份，监听二进制放 `.app/Contents/Resources/` 并随包签名 | TCC 变更对运行中进程不生效；ad-hoc 签名每次构建都可能改变 cdhash 导致授权失效 | 用户在系统设置里反复授权、堆出多条重复记录 |
| 38 | helper 的 **TCC 归属必须实机验证**，不能仅凭放在 `Contents/Resources/` 就断言归到主 bundle | helper 是独立可执行文件，归属取决于 responsible process 机制，实际可能显示为主应用、也可能自成一条 | 交付时才发现「多了一个陌生的授权条目」，用户以为装了木马 |
| 39 | macOS tap 优先 **`kCGSessionEventTap`**，不用 `kCGHIDEventTap`，**不用 root 兜底** | HID 位置在 Apple 文档里是「HID 系统进入点插入」，普通用户权限下 `CGEventTapCreate` 常直接返回 NULL，表现为「权限给了却创建不出来」 | 陷入「照抄示例代码跑不通，只能加 root」的死路，破坏正常分发 |
| 40 | tap 被禁用时**先通知收起、再 `CGEventTapEnable`、再用 `CGEventTapIsEnabled` 校验** | 反过来会留下「tap 已坏但窗口还开着」的暴露窗口；`CGEventTapEnable` 无返回值，不校验就不知道是否真的恢复 | 界面显示监听正常，实际热键已失效 |
| 41 | `ping` / `pong` **必须带单调递增 `seq`**，只有 `pong.seq` 匹配最近一次 `ping.seq` 才算有效 | 不带序号时，一个迟到的旧 `pong` 会让已假死的进程看起来还活着 | 心跳形同虚设，进程挂了两分钟界面还显示正常 |
| 42 | 边条宽度目标是 **1–2 物理像素**，不是严格的 1 物理像素；五档缩放逐一实测 | Electron 尺寸单位是 DIP，150% 缩放下 1 物理像素 = 0.667 DIP，写 `1/dpr` 会落到亚像素、可能直接不可见 | 为了「严格 1px」把唯一的状态指示弄没了 |
| 43 | 系统事件里 **只有 `lock-screen` / `suspend` / `display-removed` / `display-metrics-changed` 是 Electron 能给的**，显示器休眠必须走平台原生通知或明列为缺口 | `screen` 模块没有 `display-sleep`，`powerMonitor` 也没有；凭空写这个事件名会编译不过或永远不触发 | 以为处理了显示器休眠，实际完全没接上 |
| 44 | 发生锁屏/休眠/切档/监听失效后**清空按键状态并重置 armed**，必须三键全部松开重新按下才能展开 | 系统事件期间丢掉的 keyup 补不回来，不重置会出现「手早松开但状态里 Alt 仍按下」的假按住 | 窗口卡在展开态，用户以为程序失控 |
| 38 | 监听不可用时**如实显示原因并禁用 B 档展开**，禁止用定时器模拟按住、禁止退化成单击闪现 | 伪装可用比不可用更危险——用户会以为按住有效，实际窗口一直开着 | 用户在最需要隐藏的场景里全程暴露 |

---

## 5. 目录结构（按此创建）

```
interview-copilot/
├─ package.json
├─ electron.vite.config.ts
├─ tsconfig.json
├─ SPEC.md
├─ PROMPT.md
├─ resources/
│  ├─ models/                      # 本地 ASR/VAD 模型，构建时拷贝
│  └─ keylistener/                 # 【可选】原生监听二进制（附录 A 启用时才需要）
│     ├─ win32-x64/keylistener.exe
│     └─ darwin-arm64/keylistener  # 随主应用签名，置于 .app/Contents/Resources/
├─ native/                         # 【可选】原生监听源码（附录 A，SPEC §8.7.2 / §8.7.3）
│  ├─ win32/                       # C/C++：Raw Input + 消息窗口 + stdio 协议
│  └─ darwin/                      # Objective-C/C：CGEventTap(ListenOnly) + CFRunLoop
│     └─ Info.plist                # 含 NSInputMonitoringUsageDescription 说明
├─ src/
│  ├─ main/                        # Electron 主进程
│  │  ├─ index.ts                  # app 生命周期、单实例锁
│  │  ├─ windows/
│  │  │  ├─ overlay.ts             # 悬浮窗创建与窗口属性（SPEC §8.1）
│  │  │  ├─ settings.ts            # 设置窗口
│  │  │  └─ tray.ts                # 托盘菜单
│  │  ├─ platform/
│  │  │  ├─ index.ts               # 平台能力探测与导出
│  │  │  ├─ stealth.ts             # 三档隐身状态机、进程扫描、自检（SPEC §8.5–8.9）
│  │  │  ├─ hotkeys.ts             # globalShortcut 注册（含失败兜底）
│  │  │  ├─ keylistener.ts         # 原生监听子进程管理：spawn/心跳/协议解析（SPEC §8.7.5）
│  │  │  ├─ hold-state.ts          # 三键按住状态机 + stateVersion 竞态防护（SPEC §8.7.4）
│  │  │  └─ permissions.ts         # macOS 屏幕录制/麦克风/输入监控授权检查（SPEC §8.7.6）
│  │  ├─ asr/                      # 只放「需要密钥」的部分
│  │  │  ├─ tencent-sign.ts        # 腾讯云 URL 签名（SPEC §4.2）
│  │  │  ├─ aliyun-token.ts        # 阿里云 token 换取与缓存（SPEC §4.3）
│  │  │  └─ index.ts               # 对渲染进程暴露 sign/issueToken
│  │  ├─ llm/
│  │  │  ├─ provider.ts            # LlmProvider 接口（SPEC §6）
│  │  │  ├─ openai-compat.ts       # 云：OpenAI 兼容 + SSE 解析
│  │  │  ├─ ollama.ts              # 本地
│  │  │  └─ presets.ts             # 预设 baseUrl / 模型名（SPEC §6.1）
│  │  ├─ ipc/
│  │  │  ├─ channels.ts            # 通道常量，主/渲染共用
│  │  │  └─ handlers.ts            # ipcMain.handle 注册
│  │  └─ store/
│  │     ├─ settings.ts            # 设置读写 + safeStorage 加密凭证
│  │     ├─ resume.ts              # 简历 CRUD
│  │     └─ session.ts             # 会话记录落盘
│  ├─ preload/
│  │  └─ index.ts                  # contextBridge 暴露的类型化 API
│  ├─ renderer/
│  │  ├─ index.html                # 悬浮窗页面
│  │  ├─ settings.html             # 设置/简历管理页面
│  │  └─ src/
│  │     ├─ overlay/
│  │     │  ├─ App.tsx
│  │     │  ├─ AnswerCard.tsx      # 流式答案，Markdown 渲染
│  │     │  ├─ StatusPill.tsx      # 状态 + 流向标记
│  │     │  ├─ SoundBars.tsx
│  │     │  └─ Toolbar.tsx         # 拖动条 + 按钮组
│  │     ├─ settings/
│  │     │  ├─ App.tsx
│  │     │  ├─ AsrPanel.tsx        # 后端选择 + 凭证 + 热词 + 连接测试
│  │     │  ├─ ModelPanel.tsx      # 预设下拉 + Key + 连接测试
│  │     │  ├─ ResumePanel.tsx     # 五段结构化编辑器
│  │     │  ├─ InstructionPanel.tsx
│  │     │  ├─ DataFlowBadge.tsx   # 流向矩阵展示（SPEC §7.1）
│  │     │  └─ DiagnosticsPanel.tsx
│  │     ├─ audio/
│  │     │  ├─ capture.ts          # desktopCapturer → MediaStream
│  │     │  ├─ worklet.ts          # AudioWorklet 累积 + Float32→Int16
│  │     │  ├─ ringBuffer.ts       # 环形缓冲
│  │     │  └─ pacer.ts            # 100ms 发送节拍器（SPEC §3.3）
│  │     ├─ asr/
│  │     │  ├─ engine.ts           # AsrEngine 接口 + 工厂（SPEC §4.1）
│  │     │  ├─ tencent.ts
│  │     │  ├─ aliyun.ts
│  │     │  ├─ sherpa.ts
│  │     │  └─ whisper.ts
│  │     ├─ session/
│  │     │  ├─ stateMachine.ts     # SPEC §2 的状态机，纯函数
│  │     │  ├─ reducer.ts          # 消息收敛
│  │     │  └─ questionDetect.ts   # 问题判定规则（SPEC §3.5）
│  │     ├─ prompt/
│  │     │  ├─ profile.ts          # 简历 → 候选人画像
│  │     │  ├─ select.ts           # 素材选择（SPEC §5.3）
│  │     │  └─ build.ts            # 最终 prompt 组装
│  │     └─ shared/
│  │        ├─ types.ts            # SPEC §1 的全部类型
│  │        └─ store.ts            # Zustand
├─ tests/
│  ├─ stateMachine.test.ts
│  ├─ questionDetect.test.ts
│  ├─ promptBuild.test.ts
│  ├─ pacer.test.ts                # 节拍器速率不超 1:1
│  └─ reducer.test.ts
└─ README.md
```

---

## 6. 分阶段交付（每阶段必须可运行、可验收）

**不要一次性写完所有代码再交付。按下面五个阶段推进，每阶段结束给出一句可复现的验证方式，等我确认后再进入下一阶段。**

阶段顺序刻意如此：**先把「采集 → 识别 → 回答 → 显示」这条主链路打通，再考虑防屏幕采集**。防采集需要原生代码与 macOS 系统权限，是本项目最贵、服务于最边缘场景的部分，见附录 A。

### 阶段 1：骨架、悬浮窗与设置壳

目标：能启动一个置顶、半透明、点击穿透的窗口，热键可一键收起，并有一个能填凭证的设置页。

必须做到：

- `npm run dev` 能起 Electron
- 悬浮窗样式：圆角、半透明毛玻璃、右上角三个小按钮（收起/设置/关闭）
- 顶部 32px 为拖动条（`-webkit-app-region: drag`）
- 非交互区点击穿透（SPEC §8.2）
- 窗口层级：`setAlwaysOnTop(true, 'screen-saver')` + `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` + `focusable: false`
- `setContentProtection(true)`（低成本顺带开启，不算保证，见 SPEC §8.1）
- **一键收起/恢复热键**：`Alt+Shift+H` / `Option+Shift+H`，用 `globalShortcut` + `hide()/show()`。注册失败要提示并允许改键
- 托盘图标 + 退出菜单
- 设置页：能填腾讯云 AppId / SecretId / SecretKey、LLM 预设与 Key，保存后落 `safeStorage` 密文
- 凭证只显示前 4 后 4 位

**本阶段不涉及**：屏幕共享检测、三档模型、原生代码、macOS 除屏幕录制外的任何权限。目标是最小可运行骨架。

验收：
1. 浏览器全屏播放视频，悬浮窗稳定浮在其上；打字时焦点不被抢走。
2. 悬浮窗空白区域鼠标穿透到下层窗口，只有按钮和拖动条可点。
3. 热键收起后再按恢复；反复切换 10 次无闪烁、无焦点异常。
4. 系统截图工具（macOS ⌘⇧4 / Windows Win+Shift+S）截屏时悬浮窗不出现（`setContentProtection` 生效则通过，不生效则记录为已知限制，不阻塞阶段推进）。

### 阶段 2：音频采集 → 云端 ASR 打通（**本阶段是最大风险点**）

目标：说话 → 控制台/界面出稳定中文转写。

必须做到：

- Windows 与 macOS 都能采到系统播放的声音（不是麦克风）
- AudioWorklet 累积到 100ms，Float32 正确转 Int16LE
- 节拍器严格 100ms 取包发送，`sentBytesPerSec` 稳定在 32000 左右（不超 1:1）
- 腾讯云签名在主进程计算，渲染层只拿到签名 URL
- 收到 `slice_type === 2` 时落一条 `TranscriptLine(isFinal: true)`
- 声波动画随 RMS 变化
- 断线按指数退避重连（1/2/4/8s，上限 5 次），对话框给可操作文案
- 诊断面板能看到 `lastChunkAgeMs` / `asrLatencyMs` / `sentBytesPerSec` / `reconnectAttempts`

验收：在电脑上播一段中文面试对话视频，界面按句滚动出转写，断句合理，术语基本正确；手动断网 5 秒再恢复，能自动重连继续转写。

### 阶段 3：问题判定 → LLM 流式答案（到此 MVP 可用）

目标：识别出问题后，结合简历生成答案并流式展示。

必须做到：

- 问题判定（SPEC §3.5）触发后自动生成，不重复生成
- LLM 预设下拉（百炼/方舟/混元/DeepSeek/智谱/自定义），连接测试按钮
- 答案流式渲染，支持 Markdown
- 首 token 超过 20s 自动中止并提示
- 「下一题」能中断当前流
- 隐私提示按当前后端组合动态显示（SPEC §7.1 矩阵）

验收：手动输入一个问题，悬浮窗 3s 内开始出字；或在阶段 2 的基础上真实播一段提问，自动生成答案。

### 阶段 4：简历、Prompt 与指令系统

目标：答案能引用简历里的具体项目，而不是泛泛而谈。

必须做到：

- 五段结构化简历编辑器（SPEC §1.1），支持从粘贴文本解析
- 三套内置回答指令可切换、可编辑、可新建
- 候选人画像生成（SPEC §5.2）
- 素材选择算法（SPEC §5.3），**不做向量检索**
- 答案能标注引用了哪几条素材

验收：同一问题，在不同回答指令下产出可辨的风格差异；答案中出现简历里的具体公司名或项目名。

### 阶段 5：多后端切换、双端打磨与打包

目标：四个 ASR 引擎与两个 LLM 后端全部可切换，出两个平台安装包。

必须做到：

- `sherpa` / `whisper` 本地引擎可跑，模型缺失时给明确报错与下载指引
- 阿里云 ASR 可跑（token 换取 + 24h 缓存 + 到期前刷新）
- 切换后端不丢当前会话数据，且给出明确的状态提示
- 首次切到云端后端弹一次数据流向确认
- 悬浮窗状态栏常驻流向标记
- macOS：`dmg`，屏幕录制权限引导（授权后提示重启应用）
- Windows：`nsis`，`WDA_EXCLUDEFROMCAPTURE` 在旧系统不可用时给降级提示
- 全局热键四组（SPEC §8.4），占用时提示可改键
- 隐身自检流程（SPEC §8.8）+ 档位状态标识（SPEC §8.9）
- 所有错误码文案按 SPEC §10 实现

验收：两端各装一次，完成一次完整流程（授权 → 采音 → 识别 → 生成 → 显示）；把 ASR 切到本地能继续工作。

---

## 7. 代码要求

- TypeScript `strict: true`，不使用 `any`（第三方库边界除外，需注释原因）
- 状态机、reducer、节拍器必须是**纯函数或可注入时钟**，可单测；`tests/` 下五个测试文件必须全部通过
- 所有 IPC 通过 `contextBridge` 暴露，`nodeIntegration: false`、`contextIsolation: true`
- **密钥类计算（签名、换 token）只在主进程**；渲染进程不得出现 SecretKey / AccessKeySecret
- 所有用户可见文案用中文，语气简短、直给、不客套
- 每个平台适配点用 `// platform: macos` / `// platform: windows` 注释标注
- 云端协议解析（JSON 字段名、错误码）写成独立的纯函数，便于单测与换供应商

---

## 8. 明确的禁止事项

1. 不要把音频写入磁盘，也不要用临时文件中转
2. 不要把 SecretKey / AccessKeySecret 下发到渲染进程，签名与换 token 只能在主进程
3. 不要集成厂商官方 SDK（腾讯云/阿里云/OpenAI 皆同），用原生 `WebSocket` 与 `fetch`
4. 不要做静默自动切换后端——切换必须让用户看见
5. 不要用 `requestAnimationFrame` 驱动音频发送节拍
6. 不要在启动时发起任何非用户配置的网络请求（包括更新检查、统计上报、远程配置）
7. 不要用 `setIgnoreMouseEvents(true)` 一刀切，否则按钮点不到
8. 不要在 macOS 上用虚拟声卡方案，必须走 ScreenCaptureKit
9. 不要把平台差异写成 `if (process.platform === 'darwin')` 散落在业务代码里，统一收敛到 `platform/`
10. 不要引入向量数据库、embedding 模型或任何 RAG 框架
11. 不要在日志或错误弹窗里输出未脱敏的签名 URL、token 或 Key
【以下 12–18 条仅在启用附录 A 时适用。未启用时可整段跳过】

12. **不要把「隐身」实现为单一的 `setContentProtection(true)` 开关**，也不要在任何文案里写「绝对隐身」「对方看不到」——必须按 SPEC §8.5 的三档模型实现，且状态标识如实反映当前档位
13. **不要用自动检测来替代用户声明共享范围**。进程扫描只能作辅助提示，判定权在用户
14. **B 档启用时必须先 `globalShortcut.unregister()` 掉 `Alt+Shift+H` 再启动原生监听**。否则主链路的一键收起热键会和按住显示抢同一个组合，`RegisterHotKey` 会拦截它导致 Raw Input 收不到，表现为「按住热键完全没反应」；退出 B 档时再重新注册回来
15. **不要在 B 档（整屏共享）用降低透明度或缩小字号来「规避」采集**。被采集的是像素，唯一可靠手段是物理隐藏
16. **不要引入第三方全局键盘监听封装**（`uiohook-napi`、`node-global-key-listener`、`iohook` 等）。必须按 SPEC §8.7 自己写独立原生进程：Windows 用 Raw Input，macOS 用只读 CGEventTap
17. **不要在 Windows 上用 `WH_KEYBOARD_LL`、也不要在 macOS 上用非 ListenOnly 的 CGEventTap**。前者进入系统输入路径且易被杀软判为键盘记录器，后者会拦截并等待回调，违反「不拦截输入」的承诺
18. **不要在监听不可用时用定时器模拟按住效果**，也不要退化成单击闪现。用不了就如实显示原因并禁用 B 档展开

---

## 9. 开始之前

请先输出：

1. 你对 `SPEC.md` 与本文档第 4 节「已验证的技术决策」的理解摘要（300 字内）
2. 你认为存在的技术风险点，以及每一点的验证方式（重点说阶段 2 的音频上行链路）
3. 阶段 1 的具体文件清单
4. **明确声明本次实现范围**：只做主链路（阶段 1–5），**不实现附录 A**。如果你认为必须实现附录 A，先说明理由

确认后再开始写阶段 1 的代码。

**范围纪律**：本任务的主链路是「音频采集 → ASR → 简历驱动回答 → 悬浮窗展示」。附录 A 的防整屏共享是可选增强，成本约等于主链路全部工作量，且可靠性只能做到尽力而为。**不要主动实现它，也不要在主链路代码里为它预留抽象层或空实现**——真需要时再加，那时加的成本远低于现在猜着留接口的成本。


---

## 附录 A：可选增强 —— 防整屏共享（暂不排期）

**仅在面试方明确要求「共享整个屏幕」时才需要实现。** 若面试只需要开摄像头与麦克风，或只共享标签页/单个窗口，本节内容全部可以不做。

启用条件与成本：

| 项 | 说明 |
|---|---|
| 前置条件 | 用户确认「面试要求共享整个屏幕」 |
| 新增复杂度 | 双平台原生按键监听进程（C / Objective-C）+ macOS 输入监控权限 + 代码签名与公证 |
| 可靠性 | 尽力而为。不存在对 ScreenCaptureKit 采集不可见的窗口，只能物理隐藏 + 如实告知 |
| 工作量 | 约等于前面四个阶段之和 |

启用时，按下面这段规格实现（本段与 SPEC §8.5–8.7 配套，编号沿用原排期）：

### A.1 原生按键监听 → 按住显示

目标：整屏模式下，按住 `Alt/Option+Shift+H` 展开、松开任一键 300ms 内收起。双端都要实机跑通。

**注意：本附录排在主链路之后。只有确认面试需要共享整个屏幕时才启动。**

必须做到：

- 独立的 `keylistener` 原生程序，Windows 与 macOS 各一份实现（SPEC §8.7.2 / §8.7.3）
- Windows：Raw Input + `RIDEV_INPUTSINK` + 有效 `hwndTarget`（`HWND_MESSAGE` 消息窗口）；按下集合按 `(hDevice, scancode)` 维护；`RIDEV_DEVNOTIFY` 处理设备拔出
- macOS：`CGEventTapCreate(kCGSessionEventTap, ..., kCGEventTapOptionListenOnly, ...)`；tap 禁用时按「先收起 → `CGEventTapEnable` → `CGEventTapIsEnabled` 校验」顺序处理
- 自动重复去重（Windows 维护按下集合；macOS 用 `kCGKeyboardEventAutorepeat`）
- stdio 行协议 + `ping`/`pong` 带 `seq` + 5 秒间隔 / 连续 3 次判失联（SPEC §8.7.5）
- 主进程侧按键状态机：顺序无关、任一松开即收起、`armed` 闸门、`stateVersion` 防异步竞态（SPEC §8.7.4）
- 系统事件接入：`lock-screen` / `suspend` / `resume` / `display-removed` / `display-metrics-changed` 全部清空状态；显示器休眠走平台原生通知或明列为缺口
- macOS 权限：`IOHIDCheckAccess` 检测 + `IOHIDRequestAccess` 由按钮触发 + 授权后提示重启（SPEC §8.7.6）
- 设置页显示权限状态、监听健康状态、当前快捷键、展开风险提示；隐私说明按 SPEC §8.7.7 原文
- 边条宽度按 `Math.max(1, Math.round(1/dpr))` 计算，五档缩放逐一记录
- 监听不可用时禁用 B 档展开并显示原因，**不得用定时器模拟**
- 诊断面板分别显示 `collapseApiMs`（`hide()` 返回耗时）与 `expandApiMs`

验收（按 SPEC §8.7.11 的验收矩阵逐项记录，**双端各自实机完成，不允许一处通过就代表两端通过**）：

1. 按键行为：三种松开顺序、三种按下顺序、左右修饰键四种组合、按住 5 秒不抖动、多键盘不误合成、按住期间拔键盘能收起。
2. 系统事件：锁屏/解锁、休眠/唤醒、拔显示器、改缩放后边条仍可见且位置正确。
3. 故障路径：权限拒绝后 B 档保持边条并显示原因；手动 kill 进程**立即**收起；进程假死（SIGSTOP）15 秒内判定无响应并收起；tap 禁用后能自愈或进入不可用状态。
4. 时延：按下→展开、松开→收起均 ≤300ms，诊断有数值。画面级验证（录屏逐帧）只做一次，单独记录，不混入 `collapseApiMs`。
5. 接收端验证：在目标会议软件的另一台设备上观察 B 档边条与展开画面。

每项结论必须写：平台 / 系统版本 / 缩放比例 / 实测值 / 通过与否。不通过就写不通过。
