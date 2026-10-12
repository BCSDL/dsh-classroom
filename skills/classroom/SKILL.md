---
name: classroom
description: Import classroom recordings, analyze bilingual transcripts with anonymous speaker labels, and create an enhanced edition using slides and video evidence through the local classroom tool.
---

Use the `classroom` tool with `operation` and a JSON object string in `args`.

- Check `status` first. Missing models require the explicit setup script; do not replace official DSH launchers or packages.
- `start_file`: supply `path`, `title`, `options` (`language`: en/zh/auto, `quality`: turbo/large-v3, `translate`, `summarize`) and optional `materials`: [{kind: document/video, path}]. The job starts asynchronously.
- `get`: supply `id`, `offset`, `limit`. Poll for state and follow `nextOffset` to read all result blocks. Preserve the job ID and original source references.
- Use `/classroom` on the authenticated DSH origin for live microphone recording. Tool calls do not capture the microphone themselves.
- Chrome streaming playback uses `/classroom/watch`: the human selects the playing tab and shares its audio. Native screen sharing cannot be granted by this tool. Read saved captions, source frames and analyses with `watch_playback({id,offset,limit})`. The optional companion reads visible captions and current player time after the user connects that tab. Capture time and course/player time are distinct; never invent a missing course timestamp. Check pending frames/chunks before claiming completion.
- After recording and transcription finish, `enhance` with `id`, optional `materials`, and options creates a separate improved edition. Include both slides and additional videos when supplied. The parent recording remains available.
- `cancel` preserves recordings. Restarted jobs pause; `resume` continues from saved checkpoints.
- `document` returns bounded page text and image paths. For CLI use, `read_document` also returns page images to the vision model. DXF/STEP/IGES/mesh readers need the optional engineering runtime. Export proprietary formats with a licensed vendor converter.

Give Chinese and English notes when requested. Link claims to transcript times, slide pages, and video timestamps. Speaker labels are anonymous clusters, not verified identities. Video frames are sampled; disclose the sampling interval and do not claim every-frame understanding. Report processing lag and incomplete work explicitly.
