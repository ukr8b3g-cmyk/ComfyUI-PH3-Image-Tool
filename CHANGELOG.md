# Changelog

## 0.9.1 — 2026-11-12

- Add MiniMax-H3-Image alongside P-H3 Image, with configurable sampling and local model selection. Choose generation scope automatically and tailor MiniMax prompt enhancement to new images, full edits, or selections.
- Preserve source colors around selection edits when the surrounding crop provides a reliable match. Show the selection as a dotted outline without a tint.
- Add editable canvas backgrounds, keep the active tab while selecting, float Layers on first use, and place Lasso and AI Brush first.
- Add a layer eraser, guard oversized native references before queueing, and bound the decoded image cache.
- Improve project backup round trips, undo/redo, draft and close handling, and delayed generation and filter results.
- See [release notes and validation](docs/releases/v0.9.1.md).

## 0.9.0 — 2026-11-10

- Publish the current single-image editor with generation review, shared progress/stop, non-destructive adoption, AI effect lettering and retained text assets.
- Add selection adjustments/curves/fill/delete/copy, editable paint and sources/masks, auto language, server-local output folder selection and WebP auto-save.
- Consolidate symbol stamps, compact controls/swatches, color important actions, enlarge cutout, remove duplicate Close and move view rotation into the top toolbar.
- Preserve node contracts, project format and historical validation assets. Four-panel comics remain an uncommitted future consideration.
- See [release scope and validation](docs/releases/v0.9.0.md).

## Development — 2026-11-08

- Add AI lettering templates with T2I/reference modes, pop/cute/fancy styles, vertical/horizontal text, color and gradients.
- Generate only an empty spiky/thought bubble when decorating an existing candidate; composite the original glyph pixels unchanged and retain separate source/frame/result assets. Reject open or clipped frames.
- Verify horizontal and vertical ビクッ!! with seeds42/43/44 on actual P-H3: unchanged glyph region, separated dakuten, two exclamation marks, no clipping, transparent exterior. Python126/JavaScript99 passed; updated live editor UI flow not exercised.
- Include the accumulated local editor ports and UI improvements documented below and in README. Initial private repository import; no Release/Manager publication.


## 0.2.0-rc3 — 2026-11-07

Brush-up based on the rc2 package that the user reported working. The generation graph, node IDs/outputs, model settings and project format remain unchanged.

- Replace text-only decoration buttons with graphical previews, searchable galleries and persistent layer thumbnails. Add editable text styles, speech-bubble body paths from the author's app, more focus-line and frame presets.
- Port the author's comic-converter grayscale/monochrome/comic/XDoG computation and background-edge correction. Add before/after comparison, parameter preview, cancellation and native-source-resolution apply. Keep original layers and their transforms; optional ISNet integration remains unchanged.
- Add cursor-anchored wheel zoom, Space/middle-button panning, view-only rotation, eight resize handles and independent layer rotation. Undo/Redo side buttons only when delivered to the canvas; preserve text-input editing and IME.
- Add actual Pillow export preview, byte size, PNG lossless compression 0–9, WebP/JPEG quality 1–100, lossless WebP and explicit alpha/matte behavior. The preview and download use the same encoded bytes.
- Correct color-picker coordinates with letterboxed previews, cancel export setup safely on modal close, retain the selected processing preset and keep gesture cancellation out of committed history.
- Add 11 Python, 31 JavaScript and 22 targeted Chromium checks, alongside existing tests. Total: **73 Python + 51 JavaScript + 44 isolated Chromium checks, no failures**. Browser generation is simulated. Live ComfyUI/Windows/P-H3 GPU/ISNet inference for rc3 are not included.
- No runtime dependencies, model/font downloads, full legacy raster catalogue, separate Quick Retouch, four-panel/page workspace, commits, push or public release.

## 0.1.1-rc2 — 2026-11-07

First-use repair: preselect only unique, exact known installed P-H3 weights without overriding explicit settings, expose clear missing-model/missing-node messages in the generator, and include the repository name in the node display/search label. No actual ComfyUI/GPU host run was performed.

Tests: 62 Python, 20 JS and 22 isolated Chromium checks passed. **Model and ComfyUI integration remain unverified.**

## 0.1.0-rc1 — 2026-11-07

Initial single-image editor implementation. ComfyUI entry/output node, standard P-H3 API graphs, cropped selection editing with separate masks, editable image/text/bubble/SFX/symbol/focus-line/frame layers, CPU comic finishing, color/selection cutout, optional preinstalled local ISNet, project storage/archive/export and Japanese/English UI.

Includes source/revision guards, saved-node conflict checks, immutable image assets, bounded imports, no global interrupt, no automatic dependency or weight installation. Contains selection primitives adapted from the author's MIT editor; does not include its separate Quick Retouch workspace or comic-page modes.

Validation: 62 Python tests, 18 JavaScript tests and 22 isolated Chromium checks passed. Browser generation responses are simulated; live ComfyUI, GPU, Windows and optional AI-cutout inference remain unverified. This package was created locally and has not been committed/pushed/published to GitHub.
