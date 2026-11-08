"""Prompts adapted from ashukae/ComfyUI-MangaScreen QWEN-Manga.json (MIT).
Source commit: 04c6867f8672d2de82c249076d8155f499e9aeb2.
Only the image reference syntax is adapted to PH3; sampling remains PH3's.
"""
PRESETS = {
    'standard': "Redraw <Picture 1> as a printed black-and-white manga page panel, as if inked by the original artist for serialization. Keep the exact composition, pose, character design, face, expression and drawing style of <Picture 1>. Use confident ink lines with varied line weight, solid black for dark hair and deep shadows, white paper for skin and light surfaces, ink hatching lines for shadows on cloth, and regular screentone only where a mid tone is needed. No color and no smooth gradients. Do not add anything that is not in <Picture 1>.",
    'bold': "Redraw <Picture 1> as a printed black-and-white manga page panel, as if inked by the original artist for serialization. Keep the exact composition, pose, character design, face, expression and drawing style of <Picture 1>. Use confident ink lines with varied line weight. Decide every area as paper white, screentone, or solid black ink: anything that is dark or black in color in <Picture 1> (dark clothing, dark hair, deep shadows) is filled with solid black ink, with its folds and seams left as thin white lines; skin and light surfaces stay white paper; mid colors become flat screentone. No grey gradients, no soft airbrushed shading, no color. Do not add anything that is not in <Picture 1>."
}
