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

## Persistent knowledge and review (0.5)

- Open `classroom {operation:"open",args:"{\"mode\":\"library\"}"}` for the current conversation's knowledge panel. Recordings, notes, course materials and video evidence are indexed into a local Markdown store. It is persistent retrieval, not permanent neural-model memory.
- `classroom_knowledge` uses `operation` and a JSON object string in `args`. Search before answering a course question: `search` with `{query,scope:"project",limit:6}`, then `read` with the actual returned document id and line offset. Use `scope:"all"` only for the human's request across courses/projects. Preserve returned page/time/job/source references.
- `import` accepts `{attachment:"exact uploaded filename"}` or `{path,title}` and stores an original copy before scheduling extraction. `defer:true` waits for the current DSH turn to finish before background GPU analysis. Automatic native-attachment imports are deduplicated. A queued or catalog-only entry is NOT evidence that its contents were fully understood.
- `note` accepts `{title,text,tags:[]}`. `ask` accepts `{question,scope}` and returns an asynchronous answer job; poll `answer` with `{id}`. Missing evidence must produce an explicit limitation, never a guessed answer. Read snippets and the source when exact wording matters.
- Never endlessly poll a GPU task within one model turn. Return the actual queued/running state and job id; saved analysis continues between DSH inference steps. The browser panel updates automatically.
- Review tools on stopped jobs: `review_edit {id,chunk,segment,text,revision}`, `speaker_name {id,speaker,name}`, `speaker_merge {id,source,target}`, `speaker_assign {id,start,end,target}`. Corrections keep a snapshot and make prior translations/summaries stale; use `resummarize {id}` to rebuild from the saved corrected evidence.
- `note_save {id,text,time,page?,source?}` and `note_delete {id,noteId}` manage time-linked course notes/bookmarks. `history {id}` returns real snapshot ids; `review_restore {id,snapshot}` restores one after creating another snapshot.
- Original files, timestamps and raw extracted evidence remain available even when a summary omits a detail. CPU multilingual retrieval does not guarantee every query will find everything. If search is weak, try exact terms, English/Chinese variants, source filenames and paginated reads.
- The UI exposes optional Windows native microphone recording, Word/PDF export, portable backup/merge, project/all-course scope and explicit cleanup. Capture starts only after the human chooses a device or grants browser sharing. Closing a browser does not stop native capture; exiting DSH does. Never start hidden recording through tools.

## Review workspace and portable backups (0.6)

- The UI adds handwriting/screenshot annotations, five review templates, page/transcript semantic candidates with human confirmation, and multi-select records/notes management. For annotations, only claim text actually returned by image analysis; saved/queued images are not yet understood.
- Set a preset through `course_options {id,template:"lecture"|"cornell"|"exam"|"problems"|"meeting"}` then `resummarize`. Exam notes do not predict real exam questions. Changing a template invalidates old summary cache reuse.
- `classroom_knowledge` operation `align` with `{id}` returns slide-page candidates and actual transcript times. Similarity scores are not confidence or proof of exact synchronization. Human-confirmed links are marked explicitly.
- Backup/restore, bulk removal and microphone/screen capture remain explicit UI actions. Do not bypass confirmation or start hardware capture through shell tools. A version-2 backup verifies files and restores stopped tasks under new IDs, source assets, histories and recycle states into the current project. Old backups cannot restore material they never contained; report any warning.

Give Chinese and English notes when requested. Link claims to transcript times, slide pages, and video timestamps. Speaker labels are anonymous clusters, not verified identities. Video frames are sampled; disclose the sampling interval and do not claim every-frame understanding. Report processing lag and incomplete work explicitly.
