# Model-specific editor workflows

- [P-H3 Image](PH3_Image_Tool_P-H3_Image.json): ComfyUI v0.44.0 or later.
- [MiniMax-H3-Image](PH3_Image_Tool_MiniMax-H3-Image.json): ComfyUI v0.45.0 or later.

Each workflow opens a new editor project with the matching generation model selected. The workflow stores suggested model filenames and matches them against your ComfyUI model list. If a model is missing or its name is ambiguous, check the selection in Settings. Existing saved projects keep their own settings.

Open the editor before queueing, create or import an image, and generate inside the editor. After adopting a result, click Save / Apply to Node and save the workflow. Queue the workflow for RGB output through Save Image, or export PNG in the editor to retain transparency.
