# DSH Classroom / 课堂纪要

A local-first DeepSeek Harness plugin for English/Chinese classes. Import recordings, capture microphone audio, produce timestamped transcripts, anonymous speaker labels, bilingual translation and rolling summaries. Create a separate enhanced edition from the saved recording plus slides and video frames.

**Pre-release:** this plugin provides a pipeline, not a guarantee of commercial-service accuracy or latency. Test with your classroom microphone and recordings before relying on the notes. Human review remains necessary for ambiguous speech, equations, names, accents and overlapping speakers.

## 0.6.1：Windows 恢复目录占用修复

真实 GPU 流程生成含图片 PDF 后，Windows 可能短暂占用刚复制的恢复目录。发布目录改为有限重试；持续占用会给出明确错误，原始备份和已经恢复的记录保留，不修改系统权限或关闭安全软件。

## 0.6.0：完整迁移与课堂复习工作台

- **迁移复查与修正**：新备份包含知识、原件、独立笔记历史、回收内容，以及停止处理的课堂任务、音频片段、逐字稿修订、批注和播放器时间轴。SHA-256 清单在合并前验证；文件损坏/缺失、路径越界、重复 ZIP 条目或空间不足会报错。导出前需结束录音并完成或暂停分析。旧版 ZIP 可读，但缺少的历史任务和完整性清单不能凭空补回。
- **安全合并**：恢复任务使用新编号并重定位本机路径，绑定到发起恢复的当前项目/对话；保留本机现有任务和笔记，不自动执行备份中的推理。相同备份重复导入复用已恢复的任务；更新过的任务形成新快照。回收状态和独立笔记历史一并保存。备份较大，导出、暂存和合并需要足够磁盘空间；它是本机可携带备份，没有云同步或账号服务。
- **手写与截图批注**：白板画笔、颜色/粗细、橡皮、撤销；可导入截图，或点击按钮通过 Chrome 人工选择共享范围截取一张。保存为带时间/页码的 PNG，可排队让现有 Gemma 读取，识别内容进入摘要与知识检索。批注图片进入项目归档、完整备份和 Word/PDF 附录。跨次编辑保存的是图片，不是无限可逆的矢量笔画；模糊手写可能无法识别。
- **复习模板**：课堂笔记、康奈尔、考前复习/自测、解题推导、会议纪要；可用于新录音或基于完整资料重新生成，模板变更不会复用旧模板的总结缓存。考前模板不会预测真实试题。
- **同步复习**：CPU 多语言语义匹配课件页与转写时间段，展示页图、原文和可回听候选；可以手动校准起止时间并确认，确认结果持久保存。语义分数不是准确率，当前不承诺自动精确同步、跨播放器完整兼容或短暂画面不遗漏。
- **多选整理**：项目内按标题筛选课堂记录/独立知识笔记，分页、多选、批量移入回收区/恢复，导出所选记录 ZIP 或合并笔记 Markdown。原件保留，永久删除仍需单条明确确认。
- **运行与安装**：增加 Windows `scripts/setup-windows.bat`，可检查/引导安装 Node、uv、FFmpeg、Ollama，准备隔离 Python/语音/检索模型，并安装指定公开固定提交。已有组件不会强制升级，不改 Codex CLI、启动器或模型上下文。首次 DSH/Ollama 模型连接仍使用官方设置；新电脑还需有足够显存、磁盘、下载权限及驱动。WinGet 组件可需要系统安装权限。
- **课堂请求显存保护**：主聊天的模型和 262K 上下文配置保持；课堂分块请求按实际证据长度、图片和输出预算申请上下文，保留全部已提供的证据。`adaptiveRequestContext` 可关闭，`maxRequestContext` 默认仍为 262144。推理前检查配置模型和剩余显存预算（默认至少 10240 MiB，`minLLMFreeMiB` 可设置），不足时等待并给出可恢复提示，保留采集数据；不会关闭游戏或其他应用。结果交付前检查模型权重是否驻留 GPU。该保护无法预测其他应用在推理途中突然增加占用。
- **故障恢复**：原生录音异常退出后清理失效的运行标志；点击继续时尝试恢复尚未确认的本地音频片段。片段复制和元数据提交之间的进程中断也能从校验收据恢复；无法解码的末尾数据会记录警告，不能恢复从未录到的声音。批注识别失败可随记录继续处理。Windows PowerShell 5.1 的中文脚本编码已修正。

安装来源说明：[Microsoft WinGet](https://learn.microsoft.com/en-us/windows/package-manager/winget/install)、[uv 官方安装](https://docs.astral.sh/uv/getting-started/installation/)、[FFmpeg 下载](https://ffmpeg.org/download.html)、[Ollama Windows](https://ollama.com/download/windows)。本版本没有增加常驻 GPU 模型。

## 0.5.0：课堂工作台与持久知识库

下面保留 0.5.0 的架构和使用说明；新备份/复习功能以 0.6.0 节为准。

在原对话点击 **课堂**，可切换 **录音 / 文件、Chrome 视频、知识库**。所有页面使用现有 DSH 端口和认证，不替换启动入口，也不修改独立 Codex CLI。

- **知识保存**：课堂原文、翻译、摘要、时间点笔记、课件页图分析、视频画面证据自动入库。原始导入资料按 SHA-256 复制保存，移动用户原文件不会破坏后续引用。没有成功提取的文件也保留资料目录条目和失败状态，不能冒充已读懂内容。
- **现成数据层优先**：复用 `dsh-knowledge-base-local@1.2.5` 的 Markdown、版本、回收和 BM25 数据层，保留其许可证。没有挂载它的独立 Host HTTP/MCP 路由。参见 THIRD_PARTY.md。
- **中英检索与问答**：多语言 E5 small INT8 在 CPU 上运行，语义向量按原文块持久保存，结合 BM25 检索；默认当前项目，可显式选择全部课程。问答只收到实际检索的原文，回答保留可读取的来源；无有效来源编号时返回资料不足。检索分数不是准确率，无法保证每个问法都召回所有知识。
- **自动附件入库**：DSH 原生消息附件会保存原始副本并去重排队。为避免同一块显卡抢占，自动 GPU 分析在当前 DSH 回复结束后启动。回答前自动进行当前项目检索；排队成功不等于分析完成。
- **转写先显示**：浏览器录音默认约 5 秒一块，可选 10/15 秒；转写先保存，翻译和摘要随后排队。页面显示等待分析的段数。不是词级连续流式，冷启动、分人及模型切换会增加延迟。
- **聊天和课堂共用显卡**：通过 DSH 公开推理/会话事件协调，聊天开始前等待当前课堂推理步骤结束并释放 ASR；聊天产生完整助手消息后再继续课堂队列。原始音频采集持续。其他 Ollama/CLI/游戏客户端不在这项协调范围内，不能承诺任意外部并发都满足 16 GB。云端聊天可配置 `coordinateChatGPU:false`。
- **持续麦克风录音**：Windows 可先列出设备，人工选择并点击“开始本机持续录音”。FFmpeg 采集独立于网页；关闭网页仍采集，退出 DSH 则结束，子进程由 Windows Job Object 保护。已关闭片段落盘，异常重启后的分析可继续；最后未完整写出的片段仍可能损失。设备/驱动兼容性需要实机确认。Chrome 标签页共享仍需页面保持打开和人工授权，不能静默续接浏览器共享。
- **校对与分人**：点句回听、播放高亮、逐句校对、说话人名称、合并、按时间段修正、修订历史和恢复。原 ASR 检查点保留。校对会标记旧翻译和摘要过时，过时内容退出知识检索；重新总结会重译过时块并遍历所有保存的原文，采用有检查点的分层归纳。人工重写后单词时间对齐失效，保留句子时间。
- **课堂笔记**：保存时间点、课件名称/页码与书签；设置术语表供后续转写使用。关键词提醒可在页面显示，桌面通知需用户允许。后台节流、系统睡眠和页面关闭会影响浏览器提醒。
- **双区域与多播放器**：可分别保存课件、教授裁剪区域，各自取样去重；字幕助手分别记录它能访问的播放器，用户选择主时间轴以及区域对应时间轴。无法访问的跨域 iframe 仍需在授权的独立播放器页连接。不是连续原视频存档或逐帧理解，DOM 重排、播放器版本及学校网站仍需验证。
- **课件时间对应**：保留页面和取样时间，并对全部转写块提供词语重合的候选对应；候选明确标为未验证，不把相似内容当作精确同步。可通过时间点笔记人工关联。PPTX 复杂版式仍推荐先导出 PDF。
- **文件和迁移**：批量导入音视频/课件；增加 Word/PDF 导出，保留 Markdown/SRT。PDF/Word 渲染标题、段落、列表、表格和代码；复杂 LaTeX 保留源表达式。完整 ZIP 包含原始资料和知识数据，可在另一台机器合并到当前项目；原有知识保留。持续云同步和多人协同需要另行指定服务，未偷偷开放 LAN/公网端口。
- **清理与维护**：回收区支持明确输入标题后永久删除记录及缓存；原始知识资料另外保留。可预览并明确清理超过保留天数、没有引用的原始资料，默认不自动删除。提供依赖自检、固定 SHA 安装与回滚 `.bat`/PowerShell 入口。清理不会删除用户原始输入文件。

### 准备语义检索

已准备过语音环境时运行 `scripts/setup-knowledge.ps1`；新环境运行 `scripts/setup.ps1 -DownloadModels`，会一起准备 CPU 检索模型。模型按固定上游 revision 下载，权重不包含在插件包中。未准备好时保留 BM25 检索并显示提示。

知识目录默认为 `$DSH_HOME/classroom/knowledge`：`docs` 是可直接阅读的 Markdown，`assets` 保存原始资料，`semantic` 是可重建的 CPU 向量，`versions/trash` 保存版本和回收内容。卸载插件不删除这些资料。持久储存和来源检索降低遗忘风险，不构成零丢失、零幻觉或所有文件都可解析的保证。

### 验证范围

单元/协议测试、真实短英文音频与本地 Gemma、实际 CPU 中英检索、带来源问答、备份合并、Word/PDF 页面检查分别验证。四小时文件验收使用首尾英文语音、中间大量静音的合成时间线，240 个块完成；它不是四小时真实课堂、实体麦克风或学校播放器的实机压力测试。具体证据以发布验收记录为准，不拿安装成功或测试数量代替质量结论。

## Install

### Chrome streaming playback (0.2.0)

Open `/classroom/watch` from the existing authenticated DSH origin. Click the
capture button, choose the Chrome tab playing the lecture, and enable tab audio.
The browser picker is a human action. This does not retrieve media manifests,
download URLs, cookies or DRM material. Capture runs while this page stays open.

Audio is saved in recoverable 15-second PCM chunks and uses the existing local
Whisper/Gemma queue. Changed screen frames are sampled at a minimum 12-second
interval by default; static content is deduplicated, with a periodic 60-second
evidence frame. Drag on the preview to crop to the slide area. The real saved
images, visual interpretations, player captions, queue counts and report are
visible. Translation/summary work shares one inference queue; delays are reported.
This is sampled interpretation, not exhaustive frame-by-frame video understanding.

Optional `chrome-companion/` is a tiny Manifest V3 extension with `activeTab`,
`scripting`, session storage and loopback-only host permissions. Load that folder
with Chrome's **Load unpacked**, then copy a pairing code from the capture page,
open the video tab, click the extension and connect. The content script reads
visible caption cues and video time only in the tab you connect. No broad site
permission is requested. Pairing can write only clock/caption metadata to one
local job, expires after 16 hours, is rotated on regeneration and revoked on stop.
Reconnection is required after navigation/browser or DSH restart. Some players
do not expose native caption cues; their visible captions are still available in
sampled images, and full speech uses audio ASR. No promise is made that every
Panopto theme's DOM caption layout is supported without testing.

Capture seconds and lecture/player seconds are stored separately. Pause, seek and
speed changes from the companion create fresh anchors. Stale/missing anchors
produce an unknown course time rather than a fabricated one. Manual calibration
is available, but is intentionally short-lived. Finish first, wait for the audio
and frames, then add slides/videos for an enhanced edition with the saved audio,
screen evidence and timing report; the original job stays intact. Screen-only
sessions can produce a report; audio-based enhanced transcription requires audio.

The DSH model can read an existing capture through the typed `watch_playback`
tool. A successful start is not a completed analysis. Long sessions and the
actual school's Panopto instance need practical validation.

Version 0.1.8 adds a typed DSH `read_document` tool, native-upload receipt resolution,
PDF page images, paginated reads and a tool-discipline hook. Every new user input
executes a local `tool_context` probe before inference and automatically reads the
first three native attachments (three units each). Remaining units/files require
explicit reads. Failed/partial reads are marked. The Stop hook requests at most
two corrections for missing web evidence or missing file readback. Streaming
drafts are not hidden; this is evidence guidance and bounded runtime correction,
not a guarantee that a small model cannot hallucinate. Set `toolDiscipline: false`
in the classroom profile row to disable the hooks while keeping the file reader.
This hook applies only to DSH; the separate CLI configuration is unchanged.
`tool_help` returns a live tool schema; failed calls receive the real schema or
an unknown-name correction. Schema lookup is not counted as task/source evidence.

Use the official native attachment button. The third-party `dsh-file-upload`
0.5.4 has a conflicting `read_document` tool and was observed failing with
`cannot get property "fs" without inject` on DSH 0.2.0-rc.2; remove that optional
bundle before enabling this reader. Removing it does not remove native upload.

Requires Windows, Node 22+, DeepSeek Harness 0.2.0-rc.2, Ollama, uv, FFmpeg/ffprobe on PATH, and an NVIDIA GPU with sufficient available VRAM. Python 3.12 runs in a separate environment. No official launcher or package is patched.

1. Download a fixed GitHub release/tag and inspect the source.
2. Run `scripts/setup.ps1 -DownloadModels`. This explicitly installs the Python environment and downloads upstream model weights; installation/startup does not run it automatically.
3. Add the release package using `dsh plugin --profile web add <package.tgz>`.
4. Start DSH normally. Open the **课堂纪要** link, or `/classroom` on the same authenticated DSH origin. The plugin uses DSH's existing port and authentication.

Runtime and models default to `~/.local-ai-tools/classroom`. Recordings, results and checkpoints default to `$DSH_HOME/classroom` or `~/.dsh/classroom`. They are not stored in the plugin checkout. Removing the plugin does not delete recordings.

Override paths in the profile patch:

```yaml
- id: classroom
  name: dsh-classroom
  config:
    pythonExecutable: 'C:\path\to\python.exe'
    modelsDirectory: 'C:\path\to\models'
    dataDirectory: 'C:\path\to\recordings'
    ffmpegExecutable: 'C:\path\to\ffmpeg.exe'
    ollamaURL: http://127.0.0.1:11434
    model: gemma4:12b-it-qat
```

## Recording and enhancement

### Conversation and project workflow (0.3.0)

### Record management and titles (0.4.0)

The in-conversation result cards and both capture panels provide **改名/修改标题**, **自动命名/根据内容命名**, **删除记录**, **回收区**, and **恢复**. Deletion is recoverable: the selected stopped job's cache and generated archive move into the central `recycle-bin`, while original imported files remain untouched. The record disappears from active lists, search and result cards. Stop/cancel active work first; remove dependent enhanced editions before their source recording. No automatic permanent purge is installed. Directory moves use canonical bounds checks and bounded Windows sharing-violation retries; cross-volume/locked moves may fail, leaving the original record available for retry rather than deleting it permanently.

Leave the course-name field blank to generate a specific title from transcript/summary evidence after analysis completes. The configured local Ollama model receives at most 5,000 characters and returns a bounded JSON title; it is not called on every chunk. Manually entered titles are preserved. Existing records can request a new automatic title explicitly. Model failure leaves the completed analysis usable, keeps the old title and reports a title warning. Title changes update generated reports and the job's archive folder in the same project; subsequent cards/search use the new path. Earlier textual notices may still mention the previous path.

The official Session-scoped composer slot now contains a **课堂** button. It opens an embedded recording/file-analysis or Chrome-capture panel while the conversation remains available. A **课堂任务与结果** card above the composer displays the current conversation's latest five tasks, progress, archive errors, summary excerpts, file links and actual output paths. Durable plugin notices also enter Session history for subsequent model questions; DSH does not display these notices as ordinary assistant bubbles. The panel shows the actual Session `cwd` and output directory; sidebar grouping labels are not used as filesystem paths. Collapsing the panel keeps its recording alive; closing/reloading the browser still interrupts collection. Microphone and screen-sharing permissions require a human action.

Tasks created from the embedded panel or `classroom` conversation tool bind to their originating Session and canonical workspace. Generated minutes, a readable transcript, SRT subtitles, captured frames/material evidence and recording audio (for live/watch jobs) are archived into `cwd/课堂记录/date-title-jobId/`. Source audio files for file analysis remain at their original path, recorded in `记录信息.json`; they are not duplicated. The central cache/checkpoints remain intact. Completion or failure posts a durable notice to the originating conversation without triggering an extra LLM response. Archive failures keep source results and retry; the project's job metadata exposes `archiveError`. Links include absolute output paths for workspace file tools.

The tool supports `open` (`{"mode":"record"}` or `{"mode":"watch"}`) and bounded literal `search` (`{"query":"kinetic energy","limit":15}`) over archived reports in the current project, as well as the existing analysis operations. `open` asks the browser UI to open the panel; it never starts capture silently. Cross-project job access is rejected by scoped operations. Legacy standalone `/classroom` remains available with its global record list; existing unbound jobs are not moved automatically. Browser pending-upload queues are isolated by Session in the embedded workflow. Existing legacy pending uploads remain in the standalone page's original database.

Project bindings and notification status persist in the central `project-bindings.json`. Renamed/deleted workspace directories and directory junctions pointing outside the workspace fail explicitly. Two simultaneous browser clients may operate the same project, but each job's original notification destination is preserved. These protections scope classroom outputs; they do not sandbox all other DSH tools.

- Microphone PCM is uploaded as independently decodable WAV chunks, approximately every 5 seconds by default (configurable 5/10/15). Keep the page open while recording. Pending chunks are stored in browser IndexedDB and retry after connection recovery; the server acknowledges only after writing a durable copy. The most recent unsubmitted buffer can be lost if the browser crashes.
- **Real-time:** faster-whisper large-v3-turbo, GPU `int8_float16`, then CPU speaker segmentation/embedding. Translation and summaries use the configured local Ollama model. Queue length and phases show lag; this is chunk-based processing, not instantaneous streaming.
- **File/enhanced:** large-v3 by default, in bounded 60-second blocks. Raw audio and the real-time edition remain separate. A new enhanced job links to its parent.
- Restarted jobs pause with their checkpoints intact. Click **继续处理** to resume. Cancel stops processing and preserves data.
- Markdown reports and SRT subtitles remain in each job directory. Word-level anonymous speaker labels and speaker-turn timestamps remain in JSON results. Labels can change across revisions and are not real-world identity recognition.
- ASR loads only on GPU. When VRAM is insufficient it asks Ollama to unload only the configured classroom model (including an existing chat lease on that same model). Other Ollama models and other applications are left alone. Any remaining shortage fails after a bounded 120-second wait with a resumable error; there is no CPU fallback. The streaming model is released before image analysis, a new LLM load, completion, or 60 seconds without queued work. File-quality weights are released after each block. Available-memory checks are a guard, not a universal VRAM guarantee against concurrent applications.
- Classroom Gemma requests use a five-minute keep-alive. When work finishes or the inference queue is idle for 60 seconds, the worker also requests immediate unloading of its own last Gemma lease. If another client has refreshed that lease, normal cleanup leaves it alone. Ollama is shared across clients: simultaneous calls can race with lease inspection, and reloading after ASR yields adds latency. Set the Ollama server's global `OLLAMA_KEEP_ALIVE` to `5m` as well so ordinary DSH chat cannot leave a 24-hour lease. Closing the worker abruptly leaves the model to expire instead of running cleanup.
- Inference is serialized with microphone chunks prioritized. File jobs yield after each 60-second audio block; source analysis yields after each page/frame or summary step. A currently running inference still has to finish. DSH chat inference is coordinated through public events; other clients are not covered, and waiting increases live latency.

## Formats and evidence

Audio/video support follows the installed FFmpeg build, including ordinary M4A/AAC, MP3, WAV, FLAC, OGG/Opus, MP4, MOV, MKV and WebM. M4A is a container; codec, encryption and file integrity determine decodability.

PDF uses page text and rendered page images, including scanned PDFs via the vision model. PPTX uses text, notes and embedded images; export to PDF for complete slide layout. DOCX uses paragraphs/tables. XLSX/XLSM uses sheet cells and formulas without executing macros. Text/code/configuration files use bounded text blocks. Opaque binary and proprietary engineering formats require their own converter and are explicitly rejected.

Videos are analyzed through sampled visual frames **and** transcribed audio. Default frame interval is 30 seconds and can be changed. Every sampled timestamp is recorded. This is not continuous or every-frame comprehension; brief events between samples may be missed. Long materials use hierarchical summaries; report references support checking the original source.

Additional videos supplied for enhancement have their own audio transcription and timestamp references. They are not assumed to share the recording's timeline. Engineering exchange files (DXF, STEP/IGES, STL/OBJ/PLY/OFF/glTF) can be read with `scripts/setup.ps1 -Engineering`: established CPU parsers return geometry metadata and visual previews. Mesh previews are sampled. DWG, SolidWorks/CATIA and proprietary PCB formats require vendor conversion; feature histories, constraints and all proprietary formats are not supported.

## Architecture / security

The DSH plugin registers a tool, an authenticated UI and API on the existing Connection service. A lazy Python worker uses a JSON-lines pipe; it opens no additional TCP port. Worker failure is reported to the UI/tool and does not prevent the DSH host from starting. Uploads stream to disk with a configurable size limit and incomplete-upload cleanup. Paths for report retrieval accept only validated job IDs.

User speech, files and summaries go to local disk and local Ollama. Setup downloads dependencies and weights from public registries/upstream repositories. The plugin does not provide cloud transcription, paid services, account sign-in or automatic startup tasks.

## Models and licenses

Plugin code: MIT. Dependencies and model weights retain their own licenses; weights are downloaded separately and not redistributed in this package.

- [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [large-v3](https://huggingface.co/Systran/faster-whisper-large-v3), [large-v3-turbo](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo).
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), official ONNX segmentation-3.0 release with its MIT license, and WeSpeaker VoxCeleb ResNet34-LM embedding release.

## Development checks

### Optional Codex CLI interoperability adapter

`scripts/mcp-guard.mjs` wraps a tools-only stdio MCP server that silently ignores resource discovery. It returns empty resource lists, forwards tool requests unchanged, and fails timed-out requests explicitly. Example: `node scripts/mcp-guard.mjs node path/to/dsh-memory-mcp.mjs`. This does not change the upstream memory plugin or its storage. Use it only for tools-only servers; resource-capable servers should connect directly.

```powershell
node --test test/worker-client.test.mjs
python test/worker.test.py
node --check lib/index.js
python -m py_compile backend/worker.py
npm pack --dry-run --ignore-scripts
```

Unit checks cover retry idempotency, checkpoint recovery, path validation, bounded document previews, missing runtime handling and request routing. Real ASR/diarization, GPU-memory measurements, local-model translation and browser flow checks require the installed runtime/models and are separate from unit tests.
