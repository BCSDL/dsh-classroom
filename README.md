# DSH Classroom / 课堂纪要

A local-first DeepSeek Harness plugin for English/Chinese classes. Import recordings, capture microphone audio, produce timestamped transcripts, anonymous speaker labels, bilingual translation and rolling summaries. Create a separate enhanced edition from the saved recording plus slides and video frames.

**Pre-release:** this plugin provides a pipeline, not a guarantee of commercial-service accuracy or latency. Test with your classroom microphone and recordings before relying on the notes. Human review remains necessary for ambiguous speech, equations, names, accents and overlapping speakers.

## Install

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

- Microphone PCM is uploaded as independently decodable WAV chunks, approximately every 15 seconds. Keep the page open while recording. Pending chunks are stored in browser IndexedDB and retry after connection recovery; the server acknowledges only after writing a durable copy. The most recent unsubmitted buffer can be lost if the browser crashes.
- **Real-time:** faster-whisper large-v3-turbo, GPU `int8_float16`, then CPU speaker segmentation/embedding. Translation and summaries use the configured local Ollama model. Queue length and phases show lag; this is chunk-based processing, not instantaneous streaming.
- **File/enhanced:** large-v3 by default, in bounded 60-second blocks. Raw audio and the real-time edition remain separate. A new enhanced job links to its parent.
- Restarted jobs pause with their checkpoints intact. Click **继续处理** to resume. Cancel stops processing and preserves data.
- Markdown reports and SRT subtitles remain in each job directory. Word-level anonymous speaker labels and speaker-turn timestamps remain in JSON results. Labels can change across revisions and are not real-world identity recognition.
- ASR loads only on GPU. It waits for available VRAM rather than falling back to CPU or unloading another application's model. ASR weights are unloaded before Ollama analysis. Available-memory checks are a guard, not a universal VRAM guarantee against other concurrent applications.

## Formats and evidence

Audio/video support follows the installed FFmpeg build, including ordinary M4A/AAC, MP3, WAV, FLAC, OGG/Opus, MP4, MOV, MKV and WebM. M4A is a container; codec, encryption and file integrity determine decodability.

PDF uses page text and rendered page images, including scanned PDFs via the vision model. PPTX uses text, notes and embedded images; export to PDF for complete slide layout. DOCX uses paragraphs/tables. XLSX/XLSM uses sheet cells and formulas without executing macros. Text/code/configuration files use bounded text blocks. Opaque binary and proprietary engineering formats require their own converter and are explicitly rejected.

Videos are analyzed through sampled visual frames **and** transcribed audio. Default frame interval is 30 seconds and can be changed. Every sampled timestamp is recorded. This is not continuous or every-frame comprehension; brief events between samples may be missed. Long materials use hierarchical summaries; report references support checking the original source.

## Architecture / security

The DSH plugin registers a tool, an authenticated UI and API on the existing Connection service. A lazy Python worker uses a JSON-lines pipe; it opens no additional TCP port. Worker failure is reported to the UI/tool and does not prevent the DSH host from starting. Uploads stream to disk with a configurable size limit and incomplete-upload cleanup. Paths for report retrieval accept only validated job IDs.

User speech, files and summaries go to local disk and local Ollama. Setup downloads dependencies and weights from public registries/upstream repositories. The plugin does not provide cloud transcription, paid services, account sign-in or automatic startup tasks.

## Models and licenses

Plugin code: MIT. Dependencies and model weights retain their own licenses; weights are downloaded separately and not redistributed in this package.

- [faster-whisper](https://github.com/SYSTRAN/faster-whisper), [large-v3](https://huggingface.co/Systran/faster-whisper-large-v3), [large-v3-turbo](https://huggingface.co/mobiuslabsgmbh/faster-whisper-large-v3-turbo).
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), official ONNX segmentation-3.0 release with its MIT license, and WeSpeaker VoxCeleb ResNet34-LM embedding release.

## Development checks

```powershell
node --test test/worker-client.test.mjs
python test/worker.test.py
node --check lib/index.js
python -m py_compile backend/worker.py
npm pack --dry-run --ignore-scripts
```

Unit checks cover retry idempotency, checkpoint recovery, path validation, bounded document previews, missing runtime handling and request routing. Real ASR/diarization, GPU-memory measurements, local-model translation and browser flow checks require the installed runtime/models and are separate from unit tests.
