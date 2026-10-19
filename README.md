# DSH Classroom / 课堂纪要

A local-first DeepSeek Harness plugin for English/Chinese classes. Import recordings, capture microphone audio, produce timestamped transcripts, anonymous speaker labels, bilingual translation and rolling summaries. Create a separate enhanced edition from the saved recording plus slides and video frames.

**Pre-release:** this plugin provides a pipeline, not a guarantee of commercial-service accuracy or latency. Test with your classroom microphone and recordings before relying on the notes. Human review remains necessary for ambiguous speech, equations, names, accents and overlapping speakers.

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

The official Session-scoped composer slot now contains a **课堂** button. It opens an embedded recording/file-analysis or Chrome-capture panel while the conversation remains available. The panel shows the actual Session `cwd` and output directory; sidebar grouping labels are not used as filesystem paths. Collapsing the panel keeps its recording alive; closing/reloading the browser still interrupts collection. Microphone and screen-sharing permissions require a human action.

Tasks created from the embedded panel or `classroom` conversation tool bind to their originating Session and canonical workspace. Generated minutes, a readable transcript, SRT subtitles, captured frames/material evidence and recording audio (for live/watch jobs) are archived into `cwd/课堂记录/date-title-jobId/`. Source audio files for file analysis remain at their original path, recorded in `记录信息.json`; they are not duplicated. The central cache/checkpoints remain intact. Completion or failure posts a durable notice to the originating conversation without triggering an extra LLM response. Archive failures keep source results and retry; the project's job metadata exposes `archiveError`. Links include absolute output paths for workspace file tools.

The tool supports `open` (`{"mode":"record"}` or `{"mode":"watch"}`) and bounded literal `search` (`{"query":"kinetic energy","limit":15}`) over archived reports in the current project, as well as the existing analysis operations. `open` asks the browser UI to open the panel; it never starts capture silently. Cross-project job access is rejected by scoped operations. Legacy standalone `/classroom` remains available with its global record list; existing unbound jobs are not moved automatically. Browser pending-upload queues are isolated by Session in the embedded workflow. Existing legacy pending uploads remain in the standalone page's original database.

Project bindings and notification status persist in the central `project-bindings.json`. Renamed/deleted workspace directories and directory junctions pointing outside the workspace fail explicitly. Two simultaneous browser clients may operate the same project, but each job's original notification destination is preserved. These protections scope classroom outputs; they do not sandbox all other DSH tools.

- Microphone PCM is uploaded as independently decodable WAV chunks, approximately every 15 seconds. Keep the page open while recording. Pending chunks are stored in browser IndexedDB and retry after connection recovery; the server acknowledges only after writing a durable copy. The most recent unsubmitted buffer can be lost if the browser crashes.
- **Real-time:** faster-whisper large-v3-turbo, GPU `int8_float16`, then CPU speaker segmentation/embedding. Translation and summaries use the configured local Ollama model. Queue length and phases show lag; this is chunk-based processing, not instantaneous streaming.
- **File/enhanced:** large-v3 by default, in bounded 60-second blocks. Raw audio and the real-time edition remain separate. A new enhanced job links to its parent.
- Restarted jobs pause with their checkpoints intact. Click **继续处理** to resume. Cancel stops processing and preserves data.
- Markdown reports and SRT subtitles remain in each job directory. Word-level anonymous speaker labels and speaker-turn timestamps remain in JSON results. Labels can change across revisions and are not real-world identity recognition.
- ASR loads only on GPU. When VRAM is insufficient it asks Ollama to unload only the configured classroom model (including an existing chat lease on that same model). Other Ollama models and other applications are left alone. Any remaining shortage fails after a bounded 120-second wait with a resumable error; there is no CPU fallback. The streaming model is released before image analysis, a new LLM load, completion, or 60 seconds without queued work. File-quality weights are released after each block. Available-memory checks are a guard, not a universal VRAM guarantee against concurrent applications.
- Classroom Gemma requests use a five-minute keep-alive. When work finishes or the inference queue is idle for 60 seconds, the worker also requests immediate unloading of its own last Gemma lease. If another client has refreshed that lease, normal cleanup leaves it alone. Ollama is shared across clients: simultaneous calls can race with lease inspection, and reloading after ASR yields adds latency. Set the Ollama server's global `OLLAMA_KEEP_ALIVE` to `5m` as well so ordinary DSH chat cannot leave a 24-hour lease. Closing the worker abruptly leaves the model to expire instead of running cleanup.
- Inference is serialized with microphone chunks prioritized. File jobs yield after each 60-second audio block; source analysis yields after each page/frame or summary step. A currently running inference still has to finish, so simultaneous work can increase live latency.

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
