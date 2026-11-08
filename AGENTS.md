# Repository instructions

- Scope: ComfyUI-PH3-Image-Tool only. Preserve unrelated repositories and user work.
- Before changes inspect git status, active branch and applicable instructions.
- Preserve the single-image workflow: new generation, full edit, crop/selection edit, normal layered decoration in one editor.
- Do not add a separate Quick Retouch workspace, four-panel comic mode, model download, runtime dependency, public publishing or global sampler/core patch without explicit approval.
- P-H3 selection editing is crop/edit/composite, not a native model mask. Keep raw result, source, placement and mask separately.
- Queue only standard ComfyUI API graphs; never run nested samplers inside an HTTP route.
- Source, document revision, selection, seed and job IDs must be captured before queueing. Stale results remain candidates; never overwrite later edits.
- Do not globally interrupt ComfyUI for a tool-local cancellation.
- Keep generated images below editable text/decorations by default. Never destroy source images.
- Persist assets as content-addressed PNG; bounded JSON and portable archives; no absolute client filesystem paths.
- Keep single-user/local-only limitations explicit until actual isolation is implemented.
- Retain MIT attribution for adapted selection code. Do not copy GPL application code into the MIT package or distribute fonts/weights.
- Relevant checks: Python unittest suites, Node core tests, JS syntax, isolated browser smoke. Distinguish these from live ComfyUI, Windows, GPU and model-quality tests.
- Commit/push/release only when explicitly authorized. Never claim unperformed validation.
