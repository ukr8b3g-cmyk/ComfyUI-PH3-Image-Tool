"""CPU comic finishing and local cutout; never downloads weights or dependencies."""
from __future__ import annotations
import importlib.util
import threading
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from .schema import ToolError, number

COMIC_PRESETS = ("grayscale", "manga", "ink", "soft", "bold", "screentone")
_ONNX_LOCK = threading.Lock()


def comic(image, preset="manga", strength=1.0):
    if preset not in COMIC_PRESETS:
        raise ToolError("INVALID_PRESET", "Unknown comic finishing preset")
    number(strength, 0, 1, "strength")
    original = image.convert("RGBA")
    gray = ImageOps.grayscale(original)
    if preset == "grayscale":
        result = gray
    elif preset == "soft":
        result = ImageOps.posterize(ImageEnhance.Contrast(gray).enhance(1.15), 3)
    elif preset == "ink":
        result = ImageEnhance.Contrast(gray).enhance(1.5).point(lambda v: 255 if v >= 140 else 0)
    else:
        tone = np.asarray(ImageEnhance.Contrast(gray).enhance(1.35 if preset == "bold" else 1.15), dtype=np.float32) / 255
        yy, xx = np.indices(tone.shape)
        cell = 7 if preset == "bold" else 6
        distance = (((xx % cell) - cell / 2) ** 2 + ((yy % cell) - cell / 2) ** 2) / (cell * cell / 2)
        dots = np.where(distance < (1 - tone) * .72, 0, 255).astype(np.uint8)
        result = Image.fromarray(dots)
        if preset != "screentone":
            edges = ImageOps.invert(gray.filter(ImageFilter.FIND_EDGES)).point(lambda v: 0 if v < 200 else 255)
            # FIND_EDGES has an artificial border, which is excluded.
            edge_array = np.array(edges)
            edge_array[[0, -1], :] = 255
            edge_array[:, [0, -1]] = 255
            result = ImageChops.darker(result, Image.fromarray(edge_array))
    rgba = Image.merge("RGBA", (result, result, result, original.getchannel("A")))
    return Image.blend(original, rgba, strength)


def color_cutout(image, tolerance=32, seed=None, regions=None):
    if regions is not None:
        if not isinstance(regions, list) or len(regions)>64:
            raise ToolError('INVALID_REGIONS', 'Use at most 64 clicked regions')
        original=image.convert('RGBA');out=original.copy()
        original_alpha=np.asarray(original.getchannel('A'))
        alpha=original_alpha.copy()
        number(tolerance,0,255,'tolerance')
        for region in regions:
            if not isinstance(region,dict) or not isinstance(region.get('remove'),bool):
                raise ToolError('INVALID_REGIONS','Invalid clicked region')
            point=region.get('seed')
            if not isinstance(point,list) or len(point)!=2:
                raise ToolError('INVALID_REGIONS','A region needs an x/y point')
            # Each flood fill uses the immutable original: restored regions cannot
            # revive originally transparent pixels or depend on prior erasures.
            cut=color_cutout(original,tolerance,point)
            changed=np.asarray(cut.getchannel('A'))!=original_alpha
            alpha[changed]=0 if region['remove'] else original_alpha[changed]
        out.putalpha(Image.fromarray(alpha));return out
    number(tolerance, 0, 255, "tolerance")
    rgba = image.convert("RGBA")
    x, y = seed or (0, 0)
    x = int(number(x, 0, rgba.width - 1, "seed x"))
    y = int(number(y, 0, rgba.height - 1, "seed y"))
    pixels = np.asarray(rgba)
    target = pixels[y, x, :3].astype(np.int16)
    eligible = np.max(np.abs(pixels[..., :3].astype(np.int16) - target), axis=-1) <= tolerance
    fill = Image.fromarray(np.where(eligible, 255, 0).astype(np.uint8)).copy()
    ImageDraw.floodfill(fill, (x, y), 128, thresh=0)
    alpha = pixels[..., 3].copy()
    alpha[np.asarray(fill) == 128] = 0
    result = rgba.copy()
    result.putalpha(Image.fromarray(alpha))
    return result


def selection_cutout(image, mask):
    if image.size != mask.size:
        raise ToolError("MASK_SIZE", "Cutout mask must match the selected image")
    out = image.convert("RGBA")
    out.putalpha(ImageChops.multiply(out.getchannel("A"), mask.convert("L")))
    return out


def onnx_available():
    return importlib.util.find_spec("onnxruntime") is not None


def isnet_cutout(image, model_path):
    """ISNet General Use ONNX only; no rembg import and no implicit network access."""
    path = Path(model_path)
    if not onnx_available():
        raise ToolError("ONNX_UNAVAILABLE", "AI cutout needs an existing ONNX Runtime installation. Color/selection cutout remains available.", 409)
    if not path.is_file() or path.suffix.lower() != ".onnx":
        raise ToolError("MODEL_MISSING", "Place isnet-general-use.onnx in ComfyUI/models/rembg. No model was downloaded.", 409)
    import onnxruntime as ort
    # Sessions are released after a request, keeping H3's GPU memory separate.
    with _ONNX_LOCK:
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        session = ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])
        feed = session.get_inputs()[0]
        size = [int(v) if isinstance(v, int) and v > 0 else 1024 for v in feed.shape[-2:]]
        if max(size) > 2048:
            raise ToolError("MODEL_SHAPE", "Unexpected cutout model input size")
        rgb = np.asarray(image.convert("RGB").resize((size[1], size[0]), Image.Resampling.LANCZOS), dtype=np.float32)
        rgb /= max(float(rgb.max()), 1.0)
        tensor = (rgb - .5).transpose(2, 0, 1)[None]
        output = np.asarray(session.run(None, {feed.name: tensor})[0]).squeeze()
        del session
    if output.ndim != 2 or not np.isfinite(output).all():
        raise ToolError("MODEL_OUTPUT", "Cutout model returned an invalid mask")
    lo, hi = float(output.min()), float(output.max())
    if hi - lo < 1e-8:
        raise ToolError("MODEL_OUTPUT", "Cutout model returned a constant mask")
    mask = Image.fromarray(np.uint8(np.clip((output - lo) / (hi - lo), 0, 1) * 255)).resize(image.size, Image.Resampling.LANCZOS)
    return selection_cutout(image, mask)
