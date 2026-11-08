# Minimal editor workflow

Open `PH3_Image_Tool.json` in ComfyUI. It contains the editor node and standard SaveImage only; no models, source images or private paths are embedded.

Open the editor **before the initial Queue**. Create/import a project, choose your installed model files in Settings, and generate inside the editor as needed. Save / Apply to Node, save the ComfyUI workflow, then Queue to output the committed RGB result through SaveImage.

For upstream input, add your normal LoadImage or generation nodes, connect IMAGE to the editor node, execute once, then select Import input in the editor. Optional input changes never silently replace an existing edited project. Use editor PNG export for transparent images; RGB SaveImage does not preserve the separate alpha output.

The supplied JSON is schema-checked, but has not been imported into a live ComfyUI host in this session.
