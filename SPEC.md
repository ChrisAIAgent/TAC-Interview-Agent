# SPEC — 技术规格

本文件是 `PROMPT.md` 的配套规格。所有类型定义可直接复制使用。

---

## 1. 领域模型

### 1.1 简历（结构化，五段）

简历必须结构化存储，不要存成一整段文本。分段后模型引用精度显著提升——能明确说「你在 A 公司做的那个会员改版」，而不是笼统复述。

```ts
export interface Resume {
  id: string;
  title: string;                     // 简历名称，如「2026 版-后端」
  updatedAt: string;                 // ISO 8601
  personal: ResumePersonal;
  experiences: ResumeExperience[];   // 工作经历
  projects: ResumeProject[];         // 项目经历
  education: ResumeEducation[];      // 教育经历
  customSections: ResumeCustomSection[];
  rawText?: string;                  // 导入时的原始文本，仅用于再解析
}

export interface ResumePersonal {
  fullName: string;
  title?: string;                    // 当前职位，如「高级后端工程师」
  yearsOfExperience?: number;
  phone?: string;
  email?: string;
  location?: string;
  links?: { label: string; url: string }[];
  summary?: string;                  // 个人简介 / 一句话定位
  skills: string[];                  // 技能标签，按熟练度降序
}

export interface ResumeExperience {
  id: string;
  company: string;
  role: string;
  startDate?: string;                // YYYY-MM
  endDate?: string;                  // YYYY-MM；空表示至今
  location?: string;
  description?: string;
  highlights: string[];              // 每条一句，必须以结果/量化结尾
  techStack?: string[];
}

export interface ResumeProject {
  id: string;
  name: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  background?: string;               // 为什么做
  contribution?: string;             // 我做了什么（第一人称）
  result?: string;                   // 结果，尽量量化
  highlights: string[];
  techStack?: string[];
}

export interface ResumeEducation {
  id: string;
  school: string;
  major?: string;
  degree?: '专科' | '本科' | '硕士' | '博士' | '其他';
  startDate?: string;
  endDate?: string;
  highlights?: string[];
}

export interface ResumeCustomSection {
  id: string;
  title: string;                     // 如「开源贡献」「证书」
  items: string[];
}
```

### 1.2 回答指令

一套可切换的回答风格模板，每条含标题与正文。用户能新建、编辑、删除（内置三条不可删），当前选中一条生效。

```ts
export interface AnswerInstruction {
  id: string;
  title: string;                     // 如「精简结论式」
  body: string;                      // 指令正文，注入 system prompt
  isDefault?: boolean;
  builtin?: boolean;                 // 内置不可删
}
```

内置三套（初始数据，用户可改可删非 builtin 的）：

```yaml
- id: concise
  title: 精简结论式
  isDefault: true
  builtin: true
  body: |
    先给一句结论，再用一条真实经历佐证，控制在 3-4 句。
    用口语，不用「首先/其次/综上所述」。
    不编造公司名、数字、学历。

- id: star
  title: STAR 展开式
  builtin: true
  body: |
    用 STAR 结构回答：情境一句、任务一句、行动两句、结果一句（含量化）。
    总长不超过 6 句。结果要落在业务指标上。

- id: honest
  title: 坦诚迁移式
  builtin: true
  body: |
    若简历中无直接相关经历：先明确承认边界（一句），
    再指出最接近的迁移能力（一到两条），最后给出会如何上手（一句）。
    不假装做过。
```

### 1.3 消息与会话

```ts
export type MessageRole = 'question' | 'answer' | 'transcript';

export type AnswerStatus =
  | 'idle'          // 已识别问题，尚未生成
  | 'thinking'      // 已请求模型，无 token 返回
  | 'streaming'     // 正在流式输出
  | 'done'
  | 'interrupted'   // 用户点了「下一题」或新问题抢占
  | 'error';

export interface QuestionItem {
  id: string;
  text: string;                     // 问题原文（转写）
  normalized: string;               // 归一化后用于去重
  askedAt: number;                  // epoch ms
  source: 'asr' | 'manual';         // 自动识别 or 手动输入
  confidence: number;               // 0-1
}

export interface AnswerItem {
  id: string;
  questionId: string;
  text: string;                     // 已生成内容（流式累积）
  status: AnswerStatus;
  instructionId: string;            // 用哪套指令生成
  modelId: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  resumeRefs: string[];             // 引用到的 resume 片段 id
}

export interface TranscriptLine {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  isFinal: boolean;
  speaker: 'system' | 'mic';        // 系统声音 / 麦克风
  speakerIndex?: number;            // 云端返回的句序号，用于丢弃乱序结果
}

export interface SessionState {
  phase: SessionPhase;
  sessionId: string;
  startedAt?: number;
  questions: QuestionItem[];
  answers: Record<string, AnswerItem>;  // key = questionId
  activeQuestionId?: string;
  transcripts: TranscriptLine[];
  captureMode: CaptureMode;
  audioLevel: number;               // 0-1，用于声波动画
  lastChunkAgeMs: number;           // 诊断：距上一帧音频的毫秒数
  error?: { code: string; message: string };
}
```

### 1.4 引擎配置

ASR 与 LLM 都是可插拔的，本地与云端并存，运行时切换。

```ts
export type AsrProviderId = 'tencent' | 'aliyun' | 'sherpa' | 'whisper';
export type LlmProviderId = 'openai-compat' | 'ollama';

export interface AsrSettings {
  provider: AsrProviderId;          // 默认 'tencent'
  tencent?: {
    appId: string;
    secretId: string;               // 密文存储，见 §9
    secretKeyRef: string;           // 密文存储，仅在主进程解密
    engineModelType: string;        // 默认 '16k_zh'
    vadSilenceTime: number;         // 500-2000，默认 1000
    hotwords?: string[];            // 临时热词，最多 128 个，如「RAG」「Kubernetes」
  };
  aliyun?: {
    appKey: string;
    accessKeyId: string;
    accessKeySecretRef: string;
    region: string;                 // 默认 'cn-shanghai'
    maxSentenceSilence: number;     // 200-2000，默认 800
  };
  local?: {
    engine: 'sherpa' | 'whisper';
    modelPath: string;
  };
}

export interface LlmSettings {
  provider: LlmProviderId;          // 默认 'openai-compat'
  openaiCompat?: {
    baseUrl: string;                // 见 §6.2 预设
    apiKeyRef: string;
    model: string;
    preset?: string;                // 'dashscope' | 'ark' | 'hunyuan' | 'deepseek' | 'zhipu' | 'custom'
  };
  ollama?: {
    baseUrl: string;                // 默认 http://127.0.0.1:11434
    model: string;                  // 默认 qwen2.5:7b-instruct
  };
}
```

---

## 2. 会话状态机

状态机必须是纯函数，`tests/stateMachine.test.ts` 覆盖全部迁移。

### 2.1 状态

```ts
export type SessionPhase =
  | 'idle'            // 未开始
  | 'preparing'       // 检查权限、枚举音频源、连接 ASR
  | 'ready'           // 就绪，等待开始
  | 'listening'       // 采集中，等待识别出问题
  | 'answering'       // 正在生成/展示答案
  | 'paused'          // 用户暂停（屏幕共享场景）
  | 'reconnecting'    // 音频源或 ASR 连接中断，重试中
  | 'stopped'         // 已结束
  | 'failed';
```

### 2.2 事件与迁移

| 当前状态 | 事件 | 新状态 | 副作用 |
|---|---|---|---|
| idle | `START` | preparing | 请求屏幕录制权限，枚举音频源，建立 ASR 连接 |
| preparing | `PREPARE_OK` | ready | 显示声波检测条，等待用户点开始 |
| preparing | `PERMISSION_DENIED` | failed | 展示具体缺失的权限与开启路径 |
| preparing | `NO_AUDIO_SOURCE` | failed | 提示「未检测到可采集的音频设备」 |
| preparing | `ASR_CONNECT_FAILED` | failed | 按 §4.7 错误码表给出可操作文案 |
| ready | `BEGIN` | listening | 启动采集，启动发送节拍器 |
| listening | `QUESTION_DETECTED` | answering | 组装 prompt，发起 LLM 流式请求 |
| answering | `FIRST_TOKEN` | answering | 状态标记 thinking → streaming |
| answering | `STREAM_END` | listening | 答案落盘，标记 done |
| answering | `NEXT_QUESTION` | answering | 上一答案标 interrupted，为新问题起新请求 |
| answering | `STREAM_ERROR` | listening | 答案标 error，展示重试按钮 |
| listening | `AUDIO_LOST` | reconnecting | 记录 `lastChunkAgeMs`，指数退避重连（上限 5 次） |
| listening | `ASR_SOCKET_CLOSED` | reconnecting | 保存错误码，指数退避重连（上限 5 次） |
| reconnecting | `AUDIO_RESTORED` | listening | 重置退避计数 |
| reconnecting | `ASR_RECONNECTED` | listening | 重建 ASR 连接（新会话），重置退避计数 |
| reconnecting | `RETRY_EXHAUSTED` | failed | 文案「音频已断开，请检查设备后重试」 |
| listening / answering | `PAUSE` | paused | 停止采集与发流但保留 WS 连接，文案「已暂停实时转写」 |
| paused | `RESUME` | listening | 恢复采集 |
| any | `SWITCH_ASR` | preparing | 切换 ASR 后端，需重建连接 |
| any | `SWITCH_LLM` | （同状态） | 只影响下一次生成，不中断 |
| any | `STOP` | stopped | 释放音频与 WS，落盘会话记录 |

### 2.3 诊断字段

这些字段不是可选项——音频类应用出问题时，没有它们几乎无法定位。必须全部实现并展示在诊断面板。

- `lastChunkAgeMs` —— 距上一帧音频的毫秒数，超过 3000 触发 `AUDIO_LOST`
- `stopAckTimeout` —— 停止采集后等待最后一帧的超时，默认 2000ms
- `reconnectAttempts` —— 当前重连次数
- `decodeErrors` —— 音频帧解析失败计数
- `asrLatencyMs` —— 从句子结束到出转写的耗时
- `firstTokenLatencyMs` —— 从发起请求到首个 token 的耗时
- `asrRttMs` —— ASR WebSocket 往返时延（用 `voice_id` 首包回执估算）
- `asrDropCount` —— 云端返回乱序或重复句子被丢弃的次数
- `sentBytesPerSec` —— 实际音频上行速率，用于发现超出 1:1 实时率

---

## 3. 音频链路

### 3.1 采集

| 平台 | 方式 | 权限 |
|---|---|---|
| Windows 10/11 | WASAPI loopback（Chromium `desktopCapturer` 自带） | 无特殊权限 |
| macOS 14+ | ScreenCaptureKit（Chromium `desktopCapturer` 自带，无需虚拟声卡） | **屏幕录制**（系统设置 → 隐私与安全性 → 屏幕录制） |

实现要点：

```ts
// 主进程
const sources = await desktopCapturer.getSources({
  types: ['screen'],
  thumbnailSize: { width: 0, height: 0 },
});

// 渲染进程
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sources[0].id,
    },
  } as MediaStreamConstraints['audio'],
  video: false,   // 关键：不要视频，避免额外开销
});
```

注意：

- macOS 上首次调用会触发系统授权弹窗；**授权后必须重启应用才生效**，这一步要在 UI 里明确告知用户
- `video: false` 在部分 Electron 版本会抛错；失败则传 `video: { mandatory: {...} }` 拿到流后立刻 `track.stop()` 丢掉视频轨
- macOS 上 `desktopCapturer` 抓的是整块屏幕混音，会混入系统提示音，这是预期行为，不必过滤
- 不要用虚拟声卡方案（BlackHole 等）：需要用户手动建「多输出设备」，音频路由一错全场无声，是这类工具最常见的翻车点

### 3.2 重采样与分帧

目标格式：**PCM S16LE → 16 kHz → mono → 每包 100ms（1600 samples / 3200 bytes）**

```
AudioContext({ sampleRate: 16000 })
  → AudioWorklet 每次回调 128 samples (Float32)
  → 累积到 1600 samples (100ms)
  → Float32 → Int16LE（乘 32767 后 clamp，不要直接截断）
  → 3200 字节 ArrayBuffer
  → 交给发送节拍器
```

关键约束：

- **必须 Float32 → Int16 转换**。云端 ASR 只收 16bit PCM，直接把 Float32 字节发过去会得到全是噪声的识别结果
- 用 `new AudioContext({ sampleRate: 16000 })` 让浏览器做重采样，不要手写重采样器（插值误差累积会明显降低识别率）
- 若当前平台的 AudioContext 拒绝 16kHz，退化为用原生采样率（通常 48kHz）采集，再用 `OfflineAudioContext` 做一次性重采样到 16k

### 3.3 发送节拍器（云端 ASR 关键）

这是云端方案最容易出错的地方，必须严格实现：

```
环形缓冲写入（Worklet 线程，持续）
环形缓冲读取（定时器，严格 100ms 一次，每次取 3200 字节）
```

规则：

1. **不允许攒包突发发送**。攒了 2 秒再一次性发出去会触发腾讯云错误码 `4000`（发送速率超过 1:1 实时率），引擎直接断开
2. 用 `setInterval(100)` 或 `setTimeout` 自校正循环，**不要用 `requestAnimationFrame`**（页面不可见时会降频到 1fps，音频立刻断流）
3. 缓冲不足 3200 字节时，发静音填充（全 0）而不是跳过，否则服务端会因「数据包间隔过大」判超时
4. 缓冲积压超过 3 秒说明消费跟不上，丢弃最旧数据并记 `decodeErrors++`，宁可丢音频也不要触发速率限制
5. 暂停时**停止发送但保持 WS 连接**；若暂停超过 10 秒，主动发 end 并断开，恢复时重连（服务端 15 秒无数据会判 `4008`）

### 3.4 VAD 与切句

分两条路径，不要混用：

**云端路径（默认）**：不用本地 VAD。

- 断句完全交给服务端（腾讯云 `vad_silence_time`，阿里云 `max_sentence_silence`）
- 本地只算一个 RMS 用于声波动画和 `AUDIO_LOST` 判断，不参与切句
- 理由：本地 VAD 与服务端断句会打架，造成一句话被切成两半

**本地路径（sherpa / whisper）**：用 silero-vad。

- 阈值 0.5，最小静音 400ms 视为句末
- 最短语句 300ms，最长 30s 强制切分
- 切句后送入 ASR，落一条 `TranscriptLine(isFinal: true)`

### 3.5 问题判定

从 `isFinal` 的转写文本中判定是否为「面试官提问」。规则按优先级：

```ts
// 1. 以问号结尾，或包含疑问词：
//    什么 / 怎么 / 如何 / 为什么 / 哪些 / 是否 / 能不能 / 有没有 /
//    介绍一下 / 说说 / 讲讲 / 谈谈 / 描述一下 / 举例
// 2. 句长 >= 6 字
// 3. 与最近 5 条问题做归一化去重（去标点、转小写、去空白），相似度 > 0.85 视为重复
// 4. 排除以「嗯」「对」「好」「好的」「行」开头的确认语
```

判定为问题时产出 `QUESTION_DETECTED`，同时保留最近 3 轮问答作为上下文。

> 这一步的误判率直接决定产品可用性。纯规则能覆盖大部分场景；如果实测发现漏判严重，再考虑加一个小的分类模型，但不要一上来就上模型。

---

## 4. ASR（四引擎，云端为默认）

### 4.1 统一接口

```ts
export interface AsrEngine {
  readonly id: AsrProviderId;
  readonly kind: 'cloud' | 'local';

  /** 建立连接 / 加载模型。云端在此完成鉴权握手 */
  init(cfg: AsrSettings): Promise<void>;

  /**
   * 云端：送入一包 100ms Int16LE PCM（3200 字节），立即返回，不等结果
   * 本地：送入一帧 Float32（16k mono），可能同步返回结果
   * 结果统一通过 onResult 回调产出
   */
  push(pcm: ArrayBuffer | Float32Array): void | AsrResult | null;

  /** 音频结束：云端发 end 并等待最后结果；本地 flush 缓冲 */
  flush(): Promise<void>;

  /** 暂停/恢复：云端发送节拍器停但连接保留 */
  pause(): void;
  resume(): void;

  onResult(cb: (r: AsrResult) => void): void;
  onError(cb: (e: AsrError) => void): void;
  dispose(): void;
}

export interface AsrResult {
  text: string;
  isFinal: boolean;
  startMs: number;
  endMs: number;
  confidence: number;
  sentenceIndex?: number;      // 云端返回的句序号
}

export interface AsrError {
  code: string;                // 见 §4.7
  message: string;
  retryable: boolean;
  raw?: unknown;
}
```

四个实现都必须满足该接口：`TencentAsr`、`AliyunAsr`、`SherpaAsr`、`WhisperAsr`。切换由 `AsrSettings.provider` 决定，切换时走 `SWITCH_ASR` 事件重建连接。

**默认值：`provider = 'tencent'`。**

---

### 4.2 腾讯云实时语音识别（默认实现）

为什么选它做默认：签名一次直连，不需要预先换取 token，少一次网络往返和一个定时刷新逻辑；上行是裸二进制，协议最简单；错误码齐全，便于把失败映射成可操作文案。

#### 连接 URL

```
wss://asr.cloud.tencent.com/asr/v2/{appId}?{query}
```

query 参数（`&` 连接，参与签名的必须与最终 URL 完全一致）：

| 参数 | 必填 | 值 |
|---|---|---|
| `secretid` | 是 | 账号 SecretId |
| `timestamp` | 是 | 当前秒级时间戳 |
| `expired` | 是 | 过期秒级时间戳，要求 `expired > timestamp` 且差值 < 90 天；设为 `timestamp + 86400` |
| `nonce` | 是 | 随机正整数，最长 10 位 |
| `engine_model_type` | 是 | `16k_zh`（中文普通话 16k） |
| `voice_id` | 是 | 本次连接唯一标识，UUID 去掉横线，**每次重连必须重新生成** |
| `signature` | 是 | 见下方算法 |
| `voice_format` | 否 | `1` = PCM |
| `needvad` | 否 | `1` 开启服务端 VAD |
| `vad_silence_time` | 否 | 500–2000，默认 1000 |
| `max_speak_time` | 否 | 5000–90000，默认 60000 |
| `filter_punc` | 否 | `0` 保留句末句号（面试转写建议保留，便于判断句界） |
| `convert_num_mode` | 否 | `1` 中文数字转阿拉伯数字 |
| `filter_empty_result` | 否 | `0` 回调空结果（调试期建议 0，便于观察断句） |
| `hotword_list` | 否 | 临时热词，格式 `"热词\|权重"`，英文逗号分隔，最多 128 个 |

#### 签名算法（必须在主进程计算）

```
1. 取除 signature 外的全部参数，按 key 字典序升序排列
2. 拼成 "asr.cloud.tencent.com/asr/v2/{appId}?k1=v1&k2=v2..."（注意：去掉 wss://，保留 host 与 path）
3. sign = Base64(HmacSHA1(secretKey, 上面这串))
4. 对 sign 做 urlencode（+ / = 必须编码，否则偶发鉴权失败）
5. 拼进最终 URL
```

```ts
import { createHmac } from 'node:crypto';

export function buildTencentWsUrl(cfg: TencentAsrConfig): string {
  const params: Record<string, string> = {
    secretid: cfg.secretId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    expired: String(Math.floor(Date.now() / 1000) + 86400),
    nonce: String(Math.floor(Math.random() * 1e10)),
    engine_model_type: cfg.engineModelType ?? '16k_zh',
    voice_id: randomUuidNoDash(),
    voice_format: '1',
    needvad: '1',
    vad_silence_time: String(cfg.vadSilenceTime ?? 1000),
    filter_punc: '0',
    convert_num_mode: '1',
  };
  if (cfg.hotwords?.length) {
    params.hotword_list = cfg.hotwords.slice(0, 128).map((w) => `${w}|10`).join(',');
  }

  const qs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');

  const signStr = `asr.cloud.tencent.com/asr/v2/${cfg.appId}?${qs}`;
  const signature = createHmac('sha1', cfg.secretKey).update(signStr).digest('base64');

  return `wss://${signStr}&signature=${encodeURIComponent(signature)}`;
}
```

**`secretKey` 只能存在于主进程内存**，签名在主进程完成，只把签好的 URL 通过 IPC 交给渲染进程。

#### 上行

| 内容 | 形式 |
|---|---|
| 音频 | **裸二进制帧**，无任何包头。16k PCM 每包 100ms = 3200 字节 |
| 结束 | 文本帧 `{"type":"end"}` |

#### 下行（JSON 文本帧）

```jsonc
{
  "code": 0,
  "message": "success",
  "voice_id": "...",
  "message_id": "...",
  "result": {
    "slice_type": 2,          // 0=一段话开始, 1=识别中(非稳态), 2=一段话结束(稳态)
    "index": 0,               // 句序号，从 0 递增
    "start_time": 0,          // 该句在音频流中的起始 ms
    "end_time": 2840,
    "voice_text_str": "请先做个自我介绍。",
    "word_size": 0,
    "word_list": []
  },
  "final": 1                  // 仅音频流全部结束时出现
}
```

映射到 `AsrResult`：

| 云端字段 | 本地字段 |
|---|---|
| `result.voice_text_str` | `text` |
| `slice_type === 2` | `isFinal = true` |
| `result.index` | `sentenceIndex` |
| `result.start_time` / `end_time` | `startMs` / `endMs` |
| 无 | `confidence` 固定 `1.0`（该接口不返回置信度） |

处理规则：

- **只对 `slice_type === 2` 的句子做问题判定**，`slice_type === 1` 的中间结果只用于界面滚动预览
- 丢弃 `index` 小于已处理最大 `index` 的包（网络乱序），并 `asrDropCount++`
- `slice_type === 0` 表示新句开始，用于在 UI 上开一个新的转写行

#### 速率与超时（必须遵守）

| 限制 | 值 | 后果 |
|---|---|---|
| 发送速率 | 不超过 1:1 实时率 | 超出 → `4000`，连接断开 |
| 包间隔 | 不超过 6 秒 | 超出可能出错 |
| 无音频时长 | 不超过 15 秒 | 超出 → `4008` |

---

### 4.3 阿里云智能语音交互（备选实现）

为什么保留：事件模型更贴合「句子边界」语义（`SentenceBegin` / `SentenceEnd`），且返回 `confidence`。代价是多一次 token 交换和一个 24 小时刷新逻辑。

#### 鉴权（两步）

1. 主进程用 AccessKeyId/Secret 调 `CreateToken` 接口换取临时 token，**有效期 24 小时**
2. 带着 token 连 WebSocket：

```
wss://nls-gateway-cn-shanghai.aliyuncs.com/ws/v1?token={token}
```

token 必须缓存并在过期前 1 小时主动刷新。刷新失败不影响正在进行中的连接（token 只在建连时校验）。

#### 交互流程

```
连 WS → 发 StartTranscription（JSON 文本帧）
     → 等 TranscriptionStarted
     → 二进制帧持续发 PCM（100ms = 3200 字节）
     → 收 SentenceBegin / TranscriptionResultChanged / SentenceEnd
     → 发 StopTranscription
     → 收 TranscriptionCompleted → 关闭
```

#### StartTranscription 指令

```jsonc
{
  "header": {
    "message_id": "<32 位十六进制，每条指令新生成>",
    "task_id": "<32 位十六进制，同一任务内保持一致>",
    "namespace": "SpeechTranscriber",
    "name": "StartTranscription",
    "appkey": "<项目 Appkey>"
  },
  "payload": {
    "format": "pcm",
    "sample_rate": 16000,
    "enable_intermediate_result": true,
    "enable_punctuation_prediction": true,
    "enable_inverse_text_normalization": true,
    "max_sentence_silence": 800
  }
}
```

`message_id` 与 `task_id` **必须是 32 个十六进制字符**，长度对但含非十六进制字符会被拒（`40000002`）。

#### 下行事件

| 事件 | 载荷 | 映射 |
|---|---|---|
| `TranscriptionStarted` | — | 握手完成，开始发音频 |
| `SentenceBegin` | `index`（从 1 开始）、`time` | 新句开始 |
| `TranscriptionResultChanged` | `index`、`time`、`result` | `isFinal = false` 的中间结果 |
| `SentenceEnd` | `index`、`begin_time`、`result`、`confidence` | `isFinal = true`，`confidence` 直接用 |
| `TranscriptionCompleted` | — | 音频全部处理完 |
| `TaskFailed` | `header.status`、`header.status_text` | 转 `AsrError` |

成功状态码是 `20000000`。`TaskFailed` 的 `status` 是业务错误码，不是 WebSocket close code，两者不要混。

---

### 4.4 本地：sherpa-onnx（离线保底）

- 流式识别，自带 VAD
- 中文模型：`sherpa-onnx-streaming-zipformer-zh-14M` 或 `sherpa-onnx-sense-voice-zh`
- 延迟 < 500ms，纯 CPU 可跑
- 输入是 Float32（不需要 Int16 转换，这点与云端路径不同，注意在适配器里区分）

用途：网络不可用、或用户明确要求「音频不出本机」时切换。

### 4.5 本地：whisper.cpp（离线高准确率）

- 整句识别，`ggml-base` 或 `ggml-small` 中文模型
- 准确率高于 sherpa，延迟 1-2s

### 4.6 降级策略

```
默认 tencent
  ├─ 连接失败且不可重试（4002 鉴权 / 4003 未开通 / 4005 欠费）
  │    → 不自动切换，弹出明确提示 + 「改用本地识别」按钮（需本地模型已就绪）
  ├─ 连接失败但可重试（5000/5001/5002 抖动、网络错误）
  │    → 指数退避重连 5 次
  └─ 重连耗尽
       → 进入 failed，提示「语音识别连接失败」+ 三个选项：重试 / 换阿里云 / 换本地
```

**不要做静默自动切换。** 静默换后端会让用户以为「一切正常」，但实际识别质量已变，出问题时无法归因。

### 4.7 ASR 错误码映射

腾讯云：

| code | 含义 | 可重试 | 文案 |
|---|---|---|---|
| `4000` | 发送速率超限 | 是 | 「音频发送过快，已自动降速重连」 |
| `4001` | 参数不合法 | 否 | 「语音识别参数错误，请检查设置」 |
| `4002` | 鉴权失败 | 否 | 「腾讯云 SecretId / SecretKey 无效」 |
| `4003` | 服务未开通 | 否 | 「该账号未开通实时语音识别，请到控制台开通」 |
| `4004` | 资源包耗尽 | 否 | 「语音识别资源包已用完，请充值」 |
| `4005` | 账户欠费 | 否 | 「腾讯云账户欠费」 |
| `4006` | 并发超限 | 是 | 「并发超限，请稍后重试」 |
| `4007` | 音频解码失败 | 否 | 「音频格式不受支持，请检查采样率设置」 |
| `4008` | 超时未发送音频 | 是 | 「音频中断，正在重连」 |
| `4009` | 连接断开 | 是 | 「连接断开，正在重连」 |
| `4010` | 未知文本消息 | 否 | 「协议错误」 |
| `5000/5001/5002` | 服务端负载/网络抖动 | 是 | 「服务端临时不可用，正在重试」 |
| `6001` | 境外调用 | 否 | 「当前网络出口在境外，请使用对应区域节点」 |

阿里云：`header.status !== 20000000` 时一律包装为 `AsrError`，`message` 取 `status_text`，并把原始 `header` 放进 `raw` 供诊断面板展示。

---

## 5. Prompt 组装

### 5.1 结构

```
[system]
<角色与规则>
<候选人画像：从简历压缩生成>
<可用素材：相关经历摘录>
<回答指令：当前选中 instruction.body>

[user]
面试官问题：<question.text>
最近对话：
Q: ...
A: ...
```

### 5.2 候选人画像生成（本地模板，不调用模型）

从 `Resume` 压缩，控制在 800 字内：

```
身份：{yearsOfExperience}年{personal.title}，当前 {experiences[0].company} {experiences[0].role}
核心栈：{skills 前 5 项}
代表项目（按时间倒序取 3 个）：
1. {project.name}｜{project.role}｜{project.result 或 highlights[0]}
2. ...
3. ...
职业动因：{customSections 中标题含「动因/期望」的项，无则留空}
```

### 5.3 素材选择算法

**不要做向量检索。** 简历只有一两页，整段塞进去比 RAG 准确得多——RAG 会把「我在 A 公司做过 X」切成碎片，模型容易张冠李戴。按规则挑选即可：

1. 计算问题与每条 `highlights` / `project.result` / `project.contribution` 的关键词重合度（中文按 2-gram 切分）
2. 取重合度最高的 4 条，每条截断到 120 字
3. 若最高重合度 < 阈值（0.1），退化为「取最近两段工作经历各 2 条 highlights」
4. 总素材预算 600 字

### 5.4 生成参数

| 参数 | 值 | 理由 |
|---|---|---|
| temperature | 0.4 | 面试场景要稳定，不要发散 |
| max_tokens | 400 | 4-6 句话够用，太长看不过来 |
| stream | true | 首字延迟比完整延迟重要得多 |
| top_p | 0.9 | — |

---

## 6. LLM（两类后端，云端为默认）

```ts
export interface LlmProvider {
  id: LlmProviderId;
  label: string;                    // 界面显示名
  kind: 'cloud' | 'local';
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  /** 设置页的「测试连接」，返回模型回显的短文本 */
  test(): Promise<{ ok: boolean; latencyMs: number; model?: string; error?: string }>;
}

export interface ChatRequest {
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatChunk {
  delta: string;
  done: boolean;
}
```

### 6.1 云端：OpenAI 兼容（默认实现）

所有请求走标准 `/chat/completions`，`stream: true`，解析 SSE 的 `data:` 行，遇到 `[DONE]` 结束。

**设置页提供预设下拉，选中后自动填 baseUrl 与推荐模型**，用户只需填 API Key：

| 预设 | baseUrl | 推荐模型 | 备注 |
|---|---|---|---|
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | 中文问答稳，与阿里云 ASR 同厂同区时延更优 |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 需填推理接入点 ID（`ep-xxx`）或模型名 | 首字延迟低 |
| 腾讯混元 | `https://api.hunyuan.cloud.tencent.com/v1` | `hunyuan-turbos-latest` | 与腾讯云 ASR 同账号，凭证管理统一 |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | 性价比高，中文表达自然 |
| 智谱 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-plus` | — |
| 自定义 | 用户填写 | 用户填写 | 支持任何 OpenAI 兼容网关 |

约定：

- `baseUrl` 只到 `/v1` 一级，代码里拼 `/chat/completions`，不要要求用户填完整路径
- 请求头 `Authorization: Bearer {apiKey}`，`Content-Type: application/json`
- 超时：连接 10s，首 token 20s，整体 60s。首 token 超时立刻中止并报 `LLM_TIMEOUT`
- 429 / 5xx 自动重试一次（间隔 800ms），仍失败则报错，**不丢已产生的内容**
- 支持 `AbortSignal`，用户点「下一题」时中止上一个请求

### 6.2 本地：Ollama（离线保底）

- Endpoint：`http://127.0.0.1:11434/api/chat`
- 推荐模型：`qwen2.5:7b-instruct`
- 流式：NDJSON，逐行解析 `{"message":{"content":"..."},"done":false}`
- 未安装时 `test()` 返回明确错误：「未检测到本地 Ollama 服务，请先安装并 `ollama pull qwen2.5:7b-instruct`」

### 6.3 选择逻辑

- 默认 `provider = 'openai-compat'`
- 切换即时生效，只影响下一次生成，不中断当前流
- 生成失败时可一键「换后端重试」，问题文本与已生成内容全部保留

---

## 7. 数据流向声明（强制）

本地与云端并存，所以不能用一句笼统的「隐私安全」糊过去。必须按当前生效的后端组合，如实展示数据流向。

### 7.1 流向矩阵

| ASR 后端 | LLM 后端 | 音频去向 | 文本去向 | 展示文案 |
|---|---|---|---|---|
| tencent | openai-compat | 腾讯云 | 大模型服务商 | 「音频将实时发送至腾讯云语音识别；问题文本与简历片段将发送至 {llmHost}」 |
| tencent | ollama | 腾讯云 | 本机 | 「音频将实时发送至腾讯云语音识别；其余数据不出本机」 |
| sherpa / whisper | ollama | 本机 | 本机 | 「音频与文本均不出本机」 |
| sherpa / whisper | openai-compat | 本机 | 大模型服务商 | 「音频不出本机；问题文本与简历片段将发送至 {llmHost}」 |

### 7.2 交互要求

1. 设置页每个后端选项旁，直接显示该行的「音频去向 / 文本去向」两行小字，不要折叠进 tooltip
2. **首次从本地后端切换到任一云端后端时，弹一次确认框**，内容就是 7.1 的文案，用户点「我知道了」后记录到设置，不再重复弹
3. 悬浮窗状态栏常驻一个极小的流向指示（如 `音频→腾讯云`），让用户随时可见
4. 无论哪种组合，**音频一律不落盘**（见 §9），这条不受后端选择影响

---

## 8. 悬浮窗规格

**本章按优先级分为两部分，实现前务必先看这张表：**

| 小节 | 内容 | 优先级 |
|---|---|---|
| §8.1–8.4 | 窗口属性、点击穿透、交互、全局热键 | **核心，必做** |
| §8.5–8.9 | 三档隐身模型、共享范围声明、按住显示、自检、档位标识 | **可选，暂不排期**（见 PROMPT 附录 A） |

核心部分只需要「置顶 + 点击穿透 + 一键收起」，不涉及任何系统权限，也不依赖原生代码。可选部分是「面试方要求共享整个屏幕」时的兜底，成本高且只能尽力而为——**不要因为它而推迟主链路**。

### 8.1 窗口属性

```ts
const overlay = new BrowserWindow({
  width: 420,
  height: 320,
  frame: false,
  transparent: true,
  resizable: true,
  movable: true,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
  focusable: false,          // 不抢焦点
  fullscreenable: false,
  webPreferences: { preload, contextIsolation: true, nodeIntegration: false },
});

overlay.setAlwaysOnTop(true, 'screen-saver');   // 高于全屏应用
overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
overlay.setContentProtection(true);             // ★ 关键：双端防截屏
```

`setContentProtection(true)` 的平台行为与**可靠性边界**：

| 平台 | 底层实现 | 对谁有效 | 对谁无效 |
|---|---|---|---|
| macOS | `NSWindow.sharingType = NSWindowSharingNone` | 系统截图（⌘⇧4）、旧版 `CGWindowListCreateImage`、`CGDisplayStream` 采集、部分老版本会议软件 | **ScreenCaptureKit 采集路径（macOS 12.3+）**。腾讯会议、飞书、Zoom、Teams、钉钉的新版本均已迁到 SCK，其 `SCContentFilter` 会直接包含窗口字节，忽略 `sharingType` |
| Windows | `SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)` | 系统截图、浏览器屏幕共享、OBS、多数会议软件 | Win10 2004 之前的系统；部分不遵守该 affinity 的游戏/录屏工具 |

**这是必须写进代码注释的事实**：`setContentProtection` 是**尽力而为的降低可见性手段，不是安全边界**。任何在产品文案或界面里暗示「绝对隐身」的实现都是错误的，参见 §8.5 分级隐身模型。

### 8.1.1 多层隐身叠加（可选，启用 §8.5 时才做）

单靠 `setContentProtection` 不够，以下手段是叠加的，缺一层就少一层保障：

```ts
// 1. 不进 Dock、不进任务栏
if (process.platform === 'darwin') app.dock?.hide();

// 2. 窗口标题置空并固定 —— SCWindow.title 可被枚举
//    带中文标题的窗口会直接出现在会议软件的「共享哪个窗口」列表里
overlay.setTitle('');
overlay.setTitleBarOverlay?.(false);

// 3. 不响应 Mission Control / 调度中心
overlay.setVisibleOnAllWorkspaces(true, {
  visibleOnFullScreen: true,
  skipTransformProcessType: true,
});

// 4. 关闭所有窗口控件
overlay.setWindowButtonVisibility?.(false);   // macOS 专用
overlay.setSkipTaskbar(true);                 // Windows 专用

// 5. 不获取输入焦点、不参与 Cmd+Tab 切换
//    focusable: false 已在构造参数里；macOS 上还需 app.setActivationPolicy('accessory')
if (process.platform === 'darwin') app.setActivationPolicy('accessory');
```

`app.setActivationPolicy('accessory')` 这一条很关键：它让进程不以「普通应用」身份出现在系统 UI 中，窗口也不会被 `NSWorkspace.runningApplications` 之外的常规枚举列为活跃前台应用。

### 8.2 点击穿透

不要一刀切 `setIgnoreMouseEvents(true)`，否则按钮点不到。按命中区域动态切换：

```ts
// 默认穿透，但保留 mousemove 转发
overlay.setIgnoreMouseEvents(true, { forward: true });

// 渲染进程内用 mousemove 判断是否落在交互区
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const interactive = !!el?.closest('[data-interactive]');
  ipcRenderer.send('overlay:set-ignore-mouse', !interactive);
});
```

### 8.3 交互规格

| 元素 | 行为 |
|---|---|
| 顶部拖动条 | 按住可拖动整个窗口（`-webkit-app-region: drag`），高度 32px |
| 答案区 | 流式 Markdown 渲染，支持代码块与公式 |
| 字号滑块 | 实时调整答案字号并持久化 |
| 复制按钮 | 复制当前答案。**只在用户点击时才写剪贴板**，不要自动写入 |
| 下一题 | 中断当前答案（标 interrupted），为下一个问题重新生成 |
| 收起 / 展开 | 折叠为单行状态胶囊 |
| 状态胶囊 | 显示 listening / thinking / streaming / paused，右侧带流向标记 |
| 声波动画 | 随 `audioLevel` 变化 |

### 8.4 全局热键

以下热键用 `globalShortcut.register()` 实现（只做「按下触发」的动作，不需要松开语义）：

| 功能 | Windows | macOS |
|---|---|---|
| 显示/隐藏悬浮窗 | `Alt+Shift+Space` | `Option+Shift+Space` |
| 下一题 | `Alt+Shift+N` | `Option+Shift+N` |
| 暂停/恢复 | `Alt+Shift+P` | `Option+Shift+P` |
| 手动提问 | `Alt+Shift+Q` | `Option+Shift+Q` |

注册失败（被其他程序占用）必须提示「快捷键暂时无法使用，可能被其他程序占用」，并允许用户在设置里改键。

**关于 `Alt/Option+Shift+H` 的归属**（仅在启用附录 A 时才涉及）：

- 主链路里它是「一键收起/恢复」，由 `globalShortcut.register()` 实现。
- 附录 A 的 B 档里它变成「按住显示」，需要按下与松开两种事件，必须由 §8.7 的原生监听进程处理。

**两者会抢同一个组合，必须显式交接**：进入 B 档前先 `globalShortcut.unregister('Alt+Shift+H')`，退出 B 档后再 `register` 回来。原因是 Windows 的 `RegisterHotKey` 会独占该组合，其他机制收不到——包括同进程的 Raw Input。不注销的话，现象就是「按住热键完全没反应」，而且不会有任何报错。

另外，Raw Input 与 CGEventTap 不受**其他软件**抢占热键的影响（这是原生监听相对热键注册的优势），但挡不住**自己**注册的热键。

### 8.5 分级隐身模型（**可选，仅在需要防整屏共享时实现**）

**设计前提**：不存在「绝对对任何采集都不可见」的窗口。产品不能承诺隐身，只能做到**让用户清楚当前处在哪一档风险，并在高风险档提供可靠降级**。

分三档，档位决定悬浮窗形态：

| 档 | 触发条件 | 悬浮窗形态 | 内容可见性 |
|---|---|---|---|
| **A. 标签页 / 单窗口共享** | 用户声明「只共享面试标签页或单个窗口」 | 正常显示（所有隐身手段仍开启） | **天然不可见**。浏览器只捕获目标标签页的渲染结果，桌面窗口字节根本不在采集范围内，与 `sharingType` 无关 |
| **B. 整屏共享** | 用户声明「共享整个屏幕」或检测到整屏共享 | 自动收起为屏幕边缘 1px 竖条，**按住组合键才展开、松开即收起**（见 §8.7） | 展开期间可能被捕获；1px 静止态即使被捕获也无内容 |
| **C. 监考 / 未知环境** | 检测到已知监考或未知录屏进程 | 完全不显示，仅保留音频转写留档 | 不可见 |

**这一档的设计要点**：A 档是主路径，且它不依赖任何 API——这是本产品在 macOS 上仍然可用的根本原因。产品必须把用户引导到 A 档。

### 8.6 共享范围的判定

不依赖自动检测（macOS 无可靠 API 告知「当前正在被谁采集」），用**用户声明 + 进程名单辅助**：

```ts
interface ShareGuardState {
  mode: 'tab-or-window' | 'full-screen' | 'unknown';
  declaredAt: number;              // 用户声明时间戳
  detectedProcs: DetectedProcess[]; // 辅助信号
  riskLevel: 'low' | 'medium' | 'high';
}
```

**流程**（在用户点「开始面试」时触发）：

1. 弹出一个必须回答的确认面板，三个选项，无默认值、不可跳过：
   - 「我共享的是**面试标签页**」（→ A 档）
   - 「我共享的是**整个屏幕**」（→ B 档）
   - 「不确定 / 是专业监考系统」（→ C 档）
2. 同时做进程扫描作为辅助提示：命中已知**会议**类进程且在 A 档 → 提示「检测到腾讯会议正在运行，请确认你共享的不是整个屏幕」；命中已知**监考**类进程 → 强制降到 C 档并说明原因。
3. 声明结果记入本轮会话，**每 10 分钟复查一次进程列表**（用户可能中途改变共享范围，也可能新开了会议软件）。复查只做提示，不静默改档。

进程名单（bundle id / 进程名，大小写不敏感，匹配即命中）：

| 类别 | 名单 |
|---|---|
| 会议（需确认档位） | `com.tencent.meeting`、`com.bytedance.macos.feishu`、`us.zoom.xos`、`com.microsoft.teams2`、`com.alibaba.DingTalkMac`、`com.hnc.Discord`、`Google Chrome`（含 `meet.google.com` 时的标签） |
| 录屏（需确认档位） | `com.apple.QuickTimePlayerX`、`com.obsproject.obs-studio`、`com.tencent.wechat`（录屏功能） |
| 监考（强制 C 档） | `com.pearsonvue.*`、`com.proctoru.*`、`com.respondus.*`、`com.proctorio.*`、`com.examity.*` |

监考类判定必须在界面上说明依据：「检测到 Pearson VUE / ProctorU 等监考进程，本工具在该环境下停止显示答案」。

### 8.7 B 档：按住显示（原生按键监听）

整屏共享时用户不可能靠字号或透明度躲过捕获，唯一可靠手段是**物理隐藏**。

B 档的交互是**按住 `Alt/Option + Shift + H` 才展开，松开任一键立即收起**。`globalShortcut` 只有按下事件（全部公开方法为 `register` / `registerAll` / `isRegistered` / `unregister` / `unregisterAll` / `setSuspended` / `isSuspended`，文档原文 "callback is called when the registered shortcut is **pressed**"），因此必须引入独立的原生监听进程。

**不提供「单击后持续显示」**。若后续需要，属于新增需求，不在本期范围。

#### 8.7.1 架构：独立监听进程

```
┌──────────────────────────┐        stdio 行协议 (JSON)        ┌─────────────────────┐
│  keylistener  (native)   │ ───────────────────────────────▶ │  Electron 主进程     │
│  Win: Raw Input          │  down / up / health / error      │  窗口形态状态机       │
│  macOS: CGEventTap(只读)  │ ◀─────────────────────────────── │  (事件驱动，不轮询)   │
└──────────────────────────┘        start / stop / ping        └─────────────────────┘
```

**为什么是独立进程，而不是 Electron 里的原生插件**：

1. **Windows 上避免 Raw Input 注册冲突**。Chromium 自身已注册 Raw Input 处理触控与笔输入，同进程再注册会共享同一个 `WM_INPUT` 消息分发，容易互相吞消息。独立进程各有独立队列。
2. **隔离崩溃**。监听进程挂掉不能带走主应用；反之主应用 UI 卡住也不影响监听。
3. **权限归属清晰**。macOS 的 TCC 授权按进程判定，独立二进制的权限状态更容易查询与上报。

监听器**只上报三个键的按下/松开与健康状态，不记录、不缓存、不落盘、不上传任何其他按键，也不拦截输入**。这一条必须写进代码顶部注释与设置页文案。

#### 8.7.2 Windows：Raw Input

```c
RAWINPUTDEVICE rid = {0};
rid.usUsagePage = 0x01;        // Generic Desktop Controls
rid.usUsage     = 0x06;        // Keyboard
rid.dwFlags     = RIDEV_INPUTSINK;   // ★ 后台也能收到，不要求前台
rid.hwndTarget  = msgHwnd;     // ★ 必须是有效窗口：建 message-only 窗口 (HWND_MESSAGE)
RegisterRawInputDevices(&rid, 1, sizeof(RAWINPUTDEVICE));
```

要点：

- **`RIDEV_INPUTSINK` 与有效 `hwndTarget` 缺一不可**。漏了 `hwndTarget` 就只在窗口获得焦点时才收得到，而悬浮窗是 `focusable: false`，等于永远收不到。用一个 `HWND_MESSAGE` 消息窗口即可，窗口无需可见。
- 消息循环里 `WM_INPUT` → `GetRawInputData(..., RID_INPUT, ...)` → `RAWINPUT.data.keyboard`，设备句柄从 `RAWINPUT.header.hDevice` 取。
- 松开判定：`RAWKEYBOARD.Flags & RI_KEY_BREAK`。左右修饰键用标志位 `RI_KEY_E0` 配合 VKey 判断。
- 虚拟键码：`H` = `0x48`；Shift = `VK_LSHIFT 0xA0` / `VK_RSHIFT 0xA1`；Alt = `VK_LMENU 0xA4` / `VK_RMENU 0xA5`。**同时接受 `VK_MENU 0x12`**，部分自定义布局或注入设备只报通用码。
- **按下集合必须按「设备 + 物理键」维护**，不能只按 VKey。三个理由：
  1. 多键盘同时接入时，一台键盘按住 Alt、另一台按 H，不应该被判成组合键成立（也取决于是否要支持，默认不跨设备合成，见 §8.7.4）。
  2. 左/右 Shift 是两个物理键，只按 VKey 会把它们混成一个。
  3. 设备拔出后集合里会残留「按下」状态，永远收不到 break，导致窗口卡在展开态。

  集合的 key 用 `(hDevice, MakeScanCode(VKey, E0/E1))`，不要用 VKey 做 key。
- **设备移除必须清理状态**：监听 `WM_INPUT_DEVICE_CHANGE`（需注册时加 `RIDEV_DEVNOTIFY`），收到 `GIDC_REMOVAL` 时把该设备的按键全部标记为抬起，若因此破坏三键到齐条件则立即收起。
- **按键重复去重**：Raw Input 不提供 repeat 标志，连续 keydown 会持续到来。已在集合中的同一 `(device, scancode)` 再次 down **直接丢弃**，只有 break 才从集合移除。

#### 8.7.3 macOS：只读 CGEventTap

```c
CGEventMask mask = CGEventMaskBit(kCGEventKeyDown)
                 | CGEventMaskBit(kCGEventKeyUp)
                 | CGEventMaskBit(kCGEventFlagsChanged);   // 修饰键只走 flagsChanged

// ★ 优先用 kCGSessionEventTap，不要用 kCGHIDEventTap
CFMachPortRef tap = CGEventTapCreate(kCGSessionEventTap,
                                     kCGHeadInsertEventTap,
                                     kCGEventTapOptionListenOnly,   // ★ 只读，不拦截
                                     mask, tapCallback, NULL);
if (!tap) { /* 权限未授予或创建失败，立即上报 error，不要静默重试 */ }

CFRunLoopSourceRef src = CFMachPortCreateRunLoopSource(NULL, tap, 0);
CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
CGEventTapEnable(tap, true);
```

要点：

**tap 位置：优先 `kCGSessionEventTap`**

网上大量示例用 `kCGHIDEventTap`，但它在 Apple 文档里的语义是「在 HID 系统进入点插入」，与「普通用户授予输入监控权限即可读取」存在冲突：拿不到足够权限时 `CGEventTapCreate` 直接返回 `NULL`，表现为「权限也给了、代码也照抄了，就是创建不出来」。`kCGSessionEventTap` 挂在当前登录会话内，普通用户 + Input Monitoring 即可工作。

- 先按 `kCGSessionEventTap` 实现并验证；只有在实机确认它漏事件（例如某些外接键盘）时，才考虑退回 `kCGHIDEventTap` 并重新评估权限要求。
- **不得用 root 权限兜底**。要求用户以 root 运行辅助工具，既破坏信任也通不过正常分发。

**其余要点**

- **必须 `kCGEventTapOptionListenOnly`**。默认的 `kCGEventTapOptionDefault` 会拦截事件并等待回调返回，等于把工具塞进系统输入路径，违反「不拦截输入」的承诺。
- 修饰键只能从 `kCGEventFlagsChanged` 取，用 `CGEventGetFlags(event)` 读 `kCGEventFlagMaskAlternate` / `kCGEventFlagMaskShift`；左右区分用 keycode（`kVK_Option 0x3A` / `kVK_RightOption 0x3D` / `kVK_Shift 0x38` / `kVK_RightShift 0x3C`）。**左右两侧都要算作修饰键按下**，不要只认左侧。
- `H` 用 `kVK_ANSI_H = 0x04`，keydown / keyup 直接给。
- **按键重复**：`CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat) == 1` 时丢弃。这个字段能精确去重，不要用时间窗猜。
- 监听线程必须有运行中的 CFRunLoop（独立线程常驻 runloop，不能是忙等的纯循环）。

**tap 被系统禁用的处理顺序（顺序不能颠倒）**

回调的 `type` 可能是 `kCGEventTapDisabledByTimeout` 或 `kCGEventTapDisabledByUserInput`。正确顺序是：

```
1. 立即向主进程发 {"t":"up","reason":"tap-disabled"}    // 先让窗口收起
2. CGEventTapEnable(tap, true)                          // 再尝试恢复
3. if (!CGEventTapIsEnabled(tap)) 上报 error，进入不可用状态  // 校验结果，不要假定成功
    else 上报 {"t":"health","state":"tap-reenabled"}
```

**先收起、再重启用**——反过来的话，在重启用成功到主进程收到通知之间的窗口里，热键仍处于「按住」判定中，会出现「tap 已经坏了但窗口还开着」的暴露。第 3 步的 `CGEventTapIsEnabled` 不能省：`CGEventTapEnable` 没有返回值，不校验就无法知道自己是否真的恢复了。

**不处理这个回调，监听会在运行一段时间后静默失效**，用户以为热键坏了。

#### 8.7.4 按键状态机（双端统一，在主进程侧）

判定**不依赖按键顺序**，只看三个键当前是否同时处于按下状态——用户完全可能先按 H 再补 Alt+Shift。

```
held = { alt, shift, h }        // 布尔
armed = false                   // 是否允许展开

on down(k): held[k] = true      // 重复 down 已由监听进程过滤
on up(k):   held[k] = false

展开：armed && held.alt && held.shift && held.h
收起：曾经展开过，且 held 中任一为 false
```

`armed` 是新引入的闸门，用于「清空状态」语义：发生下列任一情况时把 `armed = false` **并清空 `held`**，之后必须**三键全部松开且重新按下**才能再次 `armed = true` 并展开。

| 触发清空的事件 | 说明 |
|---|---|
| 切换档位（A/C 之间） | 防止切回 B 档时残留的 held 让它直接展开 |
| 锁屏 / 解锁 | 锁屏期间按键不一定传得到 |
| 系统休眠 / 唤醒（`suspend` / `resume`） | 同上 |
| 显示器休眠 | 见下方的接入方式 |
| 显示器拔出 / 缩放变化 | 窗口几何已失效 |
| 监听进程退出、重启、心跳失联 | 状态已不可信 |
| tap 被禁用（`tap-disabled`） | 同上 |

**「清空并重新按下」而不是「恢复后按当前 held 重算」**，是因为系统事件期间丢掉的 keyup 无法补回：如果不强制重置，会出现「用户手早就松了，但状态里 Alt 还是按下」的假按住，窗口一直开着。

必须覆盖的边界：

| 场景 | 期望行为 |
|---|---|
| 按住期间再按其他键 | 保持展开（只关心这三键） |
| 先按 H，再补 Alt+Shift | 三键齐时展开（顺序无关） |
| 松开 Alt 但 H 仍按着 | **立即收起**（任一松开即收回） |
| 键盘自动重复 | 不影响状态（重复 down 已过滤） |
| 左右两侧修饰键混用 | 任一侧都算按下；两侧同时按不改变结果 |
| 多键盘：一台按 Alt、另一台按 H | **默认不合成**。按下集合按设备隔离，组合键必须在同一设备上完成 |
| 组合键期间切换 A/C 档 | 立即收起，清空状态，三键全部松开前不得重新展开 |
| 按住期间锁屏 / 休眠 / 显示器睡眠 | 立即收起，清空状态；恢复后需重新按下 |

**异步竞态防护**：展开是异步的（`setBounds` + `show` 两条 IPC）。维护单调递增的 `stateVersion`，每次状态变更 `++`；异步回调回写前比对版本号，不一致就丢弃。防止「刚展开又被迟到事件展开一次」。清空状态同样要 `++`，否则清空后仍在飞行中的展开请求会把窗口重新拉起来。

**系统事件的接入方式（Electron `powerMonitor` + `screen`）**

```ts
powerMonitor.on('lock-screen', () => resetHold('lock'));
powerMonitor.on('suspend',      () => resetHold('suspend'));
powerMonitor.on('resume',       () => resetHold('resume'));   // 不自动展开
powerMonitor.on('unlock-screen',() => resetHold('unlock'));

screen.on('display-removed',         () => resetHold('display-removed'));
screen.on('display-metrics-changed', () => { resetHold('metrics'); repositionStrip(); });
```

**显示器休眠没有 Electron 事件可用**——`screen` 模块只有 `display-added` / `display-removed` / `display-metrics-changed`，`powerMonitor` 也只有 `suspend` / `resume` / `lock-screen` / `unlock-screen` / `shutdown` 这一类，**没有 `display-sleep`**。必须走平台原生通知，作为可选增强：

- macOS：`NSWorkspace.shared.notificationCenter` 的 `NSWorkspaceScreensDidSleepNotification` / `NSWorkspaceScreensDidWakeNotification`；或用 `CGDisplayRegisterReconfigurationCallback`，其回调里判断 `kCGDisplayBeginConfigurationFlag` 与显示器是否 asleep。
- Windows：`WM_POWERBROADCAST` 的 `PBT_POWERSUSPENDRESUME`，或 `GUID_CONSOLE_DISPLAY_STATE`（`RegisterPowerSettingNotification`）。

这一项**没有原生通知时降级为不处理**，但要保证 `display-removed` 与 `lock-screen` 已覆盖绝大部分真实场景——不要为了它引入额外的系统权限。

#### 8.7.5 进程通信协议

stdio 行分隔 JSON，每行一个对象，UTF-8。

```jsonc
// 监听进程 → 主进程
{"t":"ready","platform":"win32|darwin","perm":"granted|denied|unknown","pid":1234}
{"t":"down","key":"alt","ts":1731554400123}     // ts 为单调时钟毫秒
{"t":"up","key":"alt","ts":1731554400456}
{"t":"up","reason":"tap-disabled"}              // 无 key，表示强制全部抬起
{"t":"pong","seq":42}
{"t":"health","state":"tap-reenabled","count":3}
{"t":"error","code":"tap_disabled_timeout|perm_denied|init_failed","detail":"..."}

// 主进程 → 监听进程
{"t":"start"}
{"t":"stop"}
{"t":"ping","seq":42}
```

- **`ping` / `pong` 必须带单调递增的 `seq`**，只有 `pong.seq` 与最近一次发出的 `ping.seq` 相等才计为有效响应。不带序号时，一个延迟到达的旧 `pong` 会让已经无响应的进程看起来是活的。
- 主进程每 **5 秒** `ping` 一次，**连续 3 次**（即 15 秒）无有效 `pong` 视为失联 → 立即收起窗口、清空按键状态、显示「按键监听无响应」。
- **15 秒是上限，不是承诺**。界面和文档都不得写「立即发现」——进程假死时最坏情况确实要等满 15 秒，这期间用户按住热键不会有任何反应，必须靠界面提示让用户知道该重开。
- 必须监听子进程 `exit`（这个能立即发现，不需要等心跳）。异常退出自动重启最多 3 次，超过后保持「监听不可用」，**不得用定时器模拟按住效果**。
- 重启成功后**必须清空按键状态并重置 `armed`**，新进程不知道之前按下了什么。
- 主应用退出时先发 `stop` 再 `kill`，Windows 上确保无残留进程（Job Object 或在 `before-quit` 强制结束）。
- `ts` 用单调时钟（`QueryPerformanceCounter` / `clock_gettime(CLOCK_MONOTONIC)`），只用于计算延迟，不用于显示。

#### 8.7.6 权限（macOS 的坑集中在这里）

```c
IOHIDAccessType t = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);  // granted|denied|unknown
IOHIDRequestAccess(kIOHIDRequestTypeListenEvent);   // 仅在用户点击按钮时调用
```

三个必须处理的点：

1. **`IOHIDRequestAccess` 必须由用户手势触发**（设置页按钮）。在 `app.whenReady` 里直接调用会被系统忽略且不弹窗。
2. **授权后必须重启应用**。TCC 变更对运行中的进程不生效。授权成功后提示「需要重启应用才能生效」，并提供「立即重启」按钮。
3. **权限与代码签名绑定**——开发期最容易踩的坑。Input Monitoring 授权记录绑定到签名的指定要求（bundle id + Team ID + cdhash）。用 Electron 默认的 ad-hoc 签名时，**每次重新构建都可能改变 cdhash，导致已授权记录失效，用户需要在系统设置里反复授权，列表里还会堆积重复条目**。
   - 开发期就固定一个自签名证书与固定 bundle id，`identity` 指向它。
   - 改签名后用户需删除旧条目再重新授权，写进故障排查文档。
   - 打包时把监听二进制放进 `.app/Contents/Resources/` 并随主应用一起签名，这是**最可能**让 TCC 归到主 app bundle 的做法，但**不能仅凭目录位置断定**：helper 是独立可执行文件，其 TCC 归属取决于辅助进程（responsible process）机制，可能显示为主应用、也可能显示为自己独立的条目。**必须实机验证**「授权后系统设置里出现几条、挂在哪个名字下」，再决定最终放置方式。
   - 若实机发现出现两个独立条目，宁可接受，也不要为了「只出现一条」去改签名结构——那会让授权更容易失效。

**权限未授予时的行为**：不启动监听 → B 档固定收成 1px 边条，设置页显示「整屏共享模式需要输入监控权限」+「去设置」按钮（`x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent`）+「重新检测」按钮。

#### 8.7.7 安全软件与隐私说明

Windows Raw Input **不拦截输入**，不进入系统输入路径，因此不像低级键盘钩子那样容易被判为键盘记录器。macOS 的 `CGEventTap` 即使 `ListenOnly`，系统授权时仍会显示「监控你的输入」，必须提前用文案解释。

设置页在权限按钮旁固定显示（措辞不得弱化，尤其不能省略第一句）：

> 开启本功能后，系统会把键盘事件提供给监听程序。
> 程序只识别 `Alt/Option`、`Shift`、`H` 三个键的按下与松开状态，用于判断组合键是否按住；
> 其他按键一律不记录、不保存、不上传，不拦截输入，也不影响其他软件。

第一句必须写，因为它在技术上是事实——`CGEventTap` 与 Raw Input 收到的都是**全部**键盘事件，程序只是不处理其余部分。写成「只读取这三个键」会让人误以为系统根本没把其他按键交给它，一旦有人审计就会发现描述不实。**如实描述比看起来更安全更重要。**

#### 8.7.8 边条宽度与缩放

B 档常驻形态：贴当前显示器右边缘，垂直居中对齐，通高 60%，颜色为用户设定的低对比度值（默认 12% 不透明度灰色），**不带任何文字或图标**。

**宽度目标是「1–2 个物理像素」，不是严格的 1 物理像素。** 原因：

- Electron 的 `setBounds` / CSS 尺寸单位都是 DIP（设备无关像素），不是物理像素。
- 在 150% 缩放下 1 物理像素 = 0.667 DIP，Chromium 会取整，实际渲染成 1 或 2 物理像素；125% / 175% 等非整数缩放下同样不可控。
- 把 `width` 写成 `1/dpr` DIP 会落到亚像素，可能被合成为半透明或直接不可见，反而**削弱**了「用户能看见工具还活着」这个唯一作用。

**实现要求**：

```ts
const dpr = screen.getDisplayNearestPoint(pos).scaleFactor;
// 目标 1 物理像素；取整后至少 1 DIP，避免亚像素渲染
const widthDip = Math.max(1, Math.round(1 / dpr));
```

- 必须在 **100% / 125% / 150% / 175% / 200%** 五档缩放下逐一实测，记录边条实际占用的物理像素数与是否可见。
- 若在某档缩放下宽度达到 2–3 物理像素仍可接受（无文字、极低对比度），就不要为了压到 1 像素而让它消失——**可见性优先于绝对宽度**。
- 切换显示器（`display-metrics-changed`）后必须重新计算并重定位。

#### 8.7.9 失效与降级（不得伪装）

| 故障 | 行为 |
|---|---|
| 权限被拒 | 边条保持，设置页显示原因 + 去授权按钮 |
| 监听进程启动失败 | 同上，附错误码 |
| 心跳超时 / 进程退出 | 立即收起窗口，边条变红，状态胶囊显示「按键监听已断开」 |
| tap 被禁用且无法重启用 | 同上 |
| 组合键被其他软件占用 | **不受影响**（Raw Input / CGEventTap 不受热键占用限制，这是相对 `globalShortcut` 的优势，文档要写明） |
| 监听不可用 | **禁止用定时器模拟「按住」**，也禁止退化成单击闪现——用不了就如实说 |

#### 8.7.10 展开期间仍会被采集

按住展开期间，内容**可能出现在屏幕共享画面中**，这是方案本身的取舍，不是缺陷。B 档状态下常驻提示：

> 按住显示期间，画面可能被对方看到。松开即收起。

**任何文案都不得暗示「对方看不到」**（见 §8.5 与 PROMPT 决策 31）。

#### 8.7.11 验收矩阵

**A. 时延指标**

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 松键 → 收起 | **≤ 300ms** | 监听进程 `up` 的单调时钟 → 主进程 `hide()` 返回，差值上报诊断面板 |
| 按下 → 展开 | ≤ 300ms | 同上，`down` → `show()` 返回 |
| 心跳检出失联 | ≤ 15 秒 | 5s × 3 次无有效 `pong` |
| 自动重复误触发 | 0 | 按住 5 秒，展开状态不得抖动 |
| 进程退出检出 | 立即（不等心跳） | `exit` 事件 |

**诊断必须区分两个时间**：`hide()` 返回 ≠ 画面已消失。合成器还有一帧的延迟，实际可见时间比 API 返回晚 1–2 帧。诊断面板要分别显示：

- `collapseApiMs`：`hide()` 调用的耗时
- 画面级验证（只在上表第 1 项上做，不要求每次运行）：录屏逐帧数，从松键那一帧到边条出现那一帧。两者相加才是用户真正感知的延迟。

300ms 是**正常运行条件**下的目标。系统或应用线程冻结时无法无条件保证，出现此类故障必须如实上报，不得宣称绝对隐身。

**B. 按键行为（双端各测一遍）**

| 用例 | 期望 |
|---|---|
| 三种松开顺序：先松 Alt / 先松 Shift / 先松 H | 均立即收起 |
| 三种按下顺序（H 先进等 6 种排列抽样 3 种） | 三键齐时展开 |
| 左右修饰键混用（左 Alt + 右 Shift 等 4 种组合） | 均能展开 |
| 按住 5 秒不松 | 窗口保持展开、不抖动、不闪烁 |
| 多键盘：A 键键盘按 Alt，B 键盘按 H | 默认不展开（按下集合按设备隔离） |
| 按住期间拔出键盘 | 收起，且不残留按下状态 |
| 按住期间再按其他字母键 | 保持展开 |

**C. 系统事件（双端各测一遍）**

| 用例 | 期望 |
|---|---|
| 锁屏 / 解锁 | 立即收起；解锁后需重新按下才展开 |
| 系统休眠 / 唤醒 | 同上 |
| 显示器休眠 / 唤醒 | 同上（无原生通知时记录为已知缺口，不伪装已处理） |
| 拔出外接显示器 | 收起；边条移动到新主屏右边缘 |
| 更改缩放比例（100→150%） | 边条宽度重算，仍可见 |
| 权限被拒绝 | B 档保持边条，设置页显示原因与「去设置」；按住无反应 |
| 手动 kill 监听进程 | 立即收起（不等 15 秒），界面显示「按键监听已断开」 |
| 监听进程假死（SIGSTOP） | 15 秒内判定无响应 |
| tap 被系统禁用 | 收起后自愈；无法自愈时进入不可用状态并显示原因 |

**D. 画面级验证（在目标会议软件接收端做）**

用你实际会用的会议软件（腾讯会议 / 飞书 / Zoom / 浏览器 Web 会议），共享整屏，在**接收端**观察：

1. B 档边条是否存在、是否有可读内容 → 期望：能看见一条极细的线，但读不出任何文字。
2. 按住展开时接收端看到什么 → 期望：内容可见（这是设计取舍，不是缺陷），且松开后 ≤300ms 内消失。
3. A 档（只共享标签页）时接收端是否完全看不到 → 期望：完全看不到。

**这一项必须用两台设备或两台机器做**，看自己屏幕的共享预览不算，它的刷新路径与实际编码传输不同。

**E. 结论记录方式**

每项验收要求给出：平台 / 系统版本 / 缩放比例 / 实测值 / 是否通过。不通过的项**如实标注为未通过**，不允许写「已实现但受限」这类模糊表述。

### 8.8 隐身自检（面试前一次性）

1. 悬浮窗内显示一行 6 位随机验证码
2. 分两步引导：
   - **第一步**：让用户用系统截图（macOS ⌘⇧4 / Windows Win+Shift+S）截全屏，看是否能截到验证码
   - **第二步**：让用户在**实际会用的面试软件**里开一次共享预览，看窗口列表和共享画面里是否出现验证码
3. 用户回报结果，写入本地记录：
   - 两步都看不到 → `protection=verified`
   - 系统截图看不到但会议预览看得到 → `protection=partial`，**自动建议降级到 B 档**
   - 两步都看得到 → `protection=none`，建议固定使用 B 档或 C 档
4. 自检结果决定下次启动的默认档位，用户可手动覆盖

**界面文案（必须原样使用，不得美化）**：

> 自检只能验证你这台机器上当前这套软件组合的结果。会议软件更新、系统升级后可能变化，重要面试前请重新自检一次。

### 8.9 各档在界面上的状态标识

状态胶囊右侧的隐身标记必须反映**真实档位**，不能只显示一个「已隐身」图标：

| 档位 | 标识文案 |
|---|---|
| A | `标签页共享 · 不可见` |
| B | `整屏共享 · 按住 H 显示` |
| C | `监考环境 · 已停止显示` |
| 未声明 | `共享范围未确认 · 点击设置`（橙色，持续闪烁直到用户确认） |

---

## 9. 凭证与本地存储

### 9.1 存储位置

| 内容 | 位置 | 加密 |
|---|---|---|
| 设置（含后端选择、模型名） | `app.getPath('userData')/settings.json` | 否 |
| 腾讯云 SecretId / SecretKey | 同上，单独字段 | `safeStorage.encryptString()` |
| 阿里云 AccessKeyId / AccessKeySecret | 同上 | `safeStorage.encryptString()` |
| 阿里云临时 token | 主进程内存 + `userData/token-cache.json` | `safeStorage.encryptString()` |
| LLM API Key | 同上 | `safeStorage.encryptString()` |
| 简历 | `userData/resumes/{id}.json` | 否（本地明文，界面可提示） |
| 会话记录 | `userData/sessions/{date}/{sessionId}.json` | 否 |
| 音频 | **不落盘** | — |

### 9.2 凭证纪律（硬约束）

1. **SecretKey / AccessKeySecret 永不出主进程**。签名、换 token 全在主进程完成
2. 渲染进程只拿「已签名的 WebSocket URL」或「临时 token」，两者都是有期限的派生凭证，泄漏影响可控
3. 日志里禁止输出任何原始凭证。打印 URL 时必须把 `signature=` 与 `token=` 之后的内容替换成 `***`
4. 诊断面板展示凭证时只显示前 4 后 4 位，中间打码

### 9.3 音频不落盘

音频绝不写磁盘，代码里不允许出现把 PCM 写入文件的路径，也不做临时文件中转（`fs.writeFile`、`createWriteStream`、`appendFile` 一律禁止用于音频缓冲）。

即使是云端 ASR 方案，这条依然成立——它防止的是「音频在磁盘上残留」，与会否上传无关。

---

## 10. 错误码与兜底文案

| code | 触发 | 文案 |
|---|---|---|
| `PERMISSION_SCREEN_DENIED` | macOS 未授权屏幕录制 | 「允许屏幕录制权限后，重启应用即可开始」 |
| `PERMISSION_MIC_DENIED` | 未授权麦克风 | 「未授权麦克风，改用手动提问仍可使用」 |
| `NO_AUDIO_SOURCE` | 枚举不到采集源 | 「未检测到可采集的音频设备」 |
| `AUDIO_LOST` | 连续 3s 无音频帧 | 「音频已断开，正在重连」 |
| `RECONNECT_EXHAUSTED` | 重连 5 次失败 | 「音频连接失败，请检查设备后重试」 |
| `ASR_AUTH` | 4002 / 阿里云鉴权失败 | 「语音识别凭证无效，请检查设置」 |
| `ASR_QUOTA` | 4004 / 4005 | 「语音识别额度已用完或账户欠费」 |
| `ASR_CONCURRENCY` | 4006 | 「并发超限，请稍后重试」 |
| `ASR_RATE_LIMIT` | 4000 | 「音频发送过快，已自动降速重连」 |
| `ASR_TIMEOUT` | 4008 | 「音频中断，正在重连」 |
| `ASR_INIT_FAILED` | 本地模型加载失败 | 「语音识别模型加载失败，请检查模型文件」 |
| `LLM_AUTH` | 401 | 「API Key 无效或已过期」 |
| `LLM_RATE_LIMIT` | 429 | 「请求过于频繁，请稍后重试」 |
| `LLM_TIMEOUT` | 20s 无首 token | 「模型响应超时，已保留你的问题」 |
| `LLM_NETWORK` | 连接失败 | 「无法连接模型服务，请检查网络或换后端」 |

失败一律**不丢用户数据**：问题文本、已生成的部分答案、转写记录都要留存，支持一键重试，且重试时可换后端。
