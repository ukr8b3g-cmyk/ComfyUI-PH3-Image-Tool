"""Portable, bounded project document validation; no ComfyUI imports."""
from __future__ import annotations
import copy
import json
import math
import re
import uuid

FORMAT = "ph3-image-tool"
VERSION = 1
MAX_PIXELS = 16_777_216
MAX_SIDE = 8192
MAX_LAYERS = 256
MAX_JSON_BYTES = 4 * 1024 * 1024
ASSET_RE = re.compile(r"^[0-9a-f]{64}$")
ID_RE = re.compile(r"^[0-9a-f]{32}$")
KINDS = {"image", "text", "bubble", "sfx", "symbol", "speed", "frame"}
COLORS = re.compile(r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
SIGMAS = "1.0, 0.984753, 0.967905, 0.951688, 0.925372, 0.881923, 0.810083, 0.528718, 0.0"

class ToolError(ValueError):
    def __init__(self, code: str, message: str, status: int = 400):
        self.code, self.status = code, status
        super().__init__(message)


def uid() -> str:
    return uuid.uuid4().hex


def identifier(value: str, kind: str = "project") -> str:
    regex = ASSET_RE if kind == "asset" else ID_RE
    if not isinstance(value, str) or not regex.fullmatch(value):
        raise ToolError("INVALID_ID", f"Invalid {kind} identifier")
    return value


def number(value, low, high, name, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ToolError("INVALID_NUMBER", f"{name} must be finite")
    if not low <= value <= high or (integer and int(value) != value):
        raise ToolError("OUT_OF_RANGE", f"{name} must be between {low} and {high}")
    return int(value) if integer else value


def dimensions(width, height):
    w = number(width, 1, MAX_SIDE, "width", True)
    h = number(height, 1, MAX_SIDE, "height", True)
    if w * h > MAX_PIXELS:
        raise ToolError("IMAGE_TOO_LARGE", "Canvas exceeds the 16 megapixel editing limit")
    return w, h


def default_document(width=1024, height=1024):
    dimensions(width, height)
    return {
        "format": FORMAT, "version": VERSION, "title": "Untitled", "canvas_revision": 0,
        "width": width, "height": height, "background": "#ffffff", "transparent": False,
        "layers": [], "selection_asset": None, "composite_asset": None,
        "settings": {"locale": "ja", "theme": "dark", "auto_apply": True, "include_text": False,
            "history_limit": 40, "export_format": "png", "export_quality": 0.92,
            "png_compression": 6, "webp_lossless": False, "mouse_undo": True,
            "context": 0.25, "feather": 4, "brush": 32, "max_megapixels": 1.0,
            "unet_name": "", "clip_name": "", "vae_name": "", "lora_name": "", "enhancer_name": "",
            "ph3_lora_strength": 1.0,
            "extra_loras": [{"enabled": False, "name": "", "strength": 1.0} for _ in range(2)],
            "sampler": "er_sde", "sigmas": SIGMAS, "seed": "42", "random_seed": True,
            "background_method": "color", "background_model": "", "background_tolerance": 32},
        "prompt": {"original": "", "ai": "", "source": "original"}, "references": [],
    }


def extra_loras(settings):
    slots = settings.get("extra_loras", [])
    if not isinstance(slots, list) or len(slots) > 2:
        raise ToolError("INVALID_LORA", "Use at most two additional LoRAs")
    for slot in slots:
        if not isinstance(slot, dict) or not isinstance(slot.get("enabled", False), bool):
            raise ToolError("INVALID_LORA", "Invalid LoRA enable switch")
        if not isinstance(slot.get("name", ""), str) or len(slot.get("name", "")) > 512:
            raise ToolError("INVALID_LORA", "Invalid LoRA filename")
        number(slot.get("strength", 1.0), -10, 10, "LoRA strength")
    return slots


def asset_ids(value):
    """Only explicit asset fields are references; user text is never a path."""
    result = set()
    def walk(item):
        if isinstance(item, dict):
            for key, val in item.items():
                if key in {"asset", "mask_asset", "selection_asset", "composite_asset", "source_asset", "raw_asset"} and val:
                    result.add(identifier(val, "asset"))
                else:
                    walk(val)
        elif isinstance(item, list):
            for val in item:
                walk(val)
    walk(value)
    return result


def validate_document(value):
    if not isinstance(value, dict):
        raise ToolError("INVALID_DOCUMENT", "Project must be a JSON object")
    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, RecursionError) as exc:
        raise ToolError("INVALID_DOCUMENT", "Project is not finite JSON") from exc
    if len(encoded.encode("utf-8")) > MAX_JSON_BYTES:
        raise ToolError("DOCUMENT_TOO_LARGE", "Project metadata exceeds 4 MiB")
    if value.get("format") != FORMAT or value.get("version") != VERSION:
        raise ToolError("UNSUPPORTED_PROJECT", "Unsupported project format/version")
    doc = copy.deepcopy(value)
    dimensions(doc.get("width"), doc.get("height"))
    number(doc.get("canvas_revision", 0), 0, 2**53 - 1, "canvas_revision", True)
    if not isinstance(doc.get("title"), str) or len(doc["title"]) > 200:
        raise ToolError("INVALID_TITLE", "Project title must contain at most 200 characters")
    if not COLORS.fullmatch(str(doc.get("background", ""))):
        raise ToolError("INVALID_COLOR", "Invalid background color")
    if not isinstance(doc.get("transparent"), bool):
        raise ToolError("INVALID_DOCUMENT", "transparent must be boolean")
    layers = doc.get("layers")
    if not isinstance(layers, list) or len(layers) > MAX_LAYERS:
        raise ToolError("LAYER_LIMIT", "At most 256 layers are supported")
    seen = set()
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("type") not in KINDS:
            raise ToolError("INVALID_LAYER", "Unsupported layer type")
        key = identifier(layer.get("id"), "layer")
        if key in seen:
            raise ToolError("DUPLICATE_LAYER", "Layer IDs must be unique")
        seen.add(key)
        for name in ("x", "y"):
            number(layer.get(name), -32768, 32768, name)
        for name in ("w", "h"):
            number(layer.get(name), 1, 32768, name)
        number(layer.get("rotation", 0), -36000, 36000, "rotation")
        number(layer.get("opacity", 1), 0, 1, "opacity")
        if layer["type"] == "image":
            identifier(layer.get("asset"), "asset")
        if len(str(layer.get("text", ""))) > 10000:
            raise ToolError("TEXT_TOO_LONG", "Layer text exceeds 10,000 characters")
        for field in ("fill", "stroke", "tintColor"):
            if field in layer and not COLORS.fullmatch(str(layer[field])):
                raise ToolError("INVALID_COLOR", f"Invalid {field} color")
        for field, low, high in (("fontSize", 4, 2048), ("lineWidth", 0, 256), ("lines", 8, 400), ("gap", 0, .95), ("tailX", -1, 2), ("tailY", -1, 3)):
            if field in layer:
                number(layer[field], low, high, field)
        for field, low, high in (("fontScaleX",10,500),("fontScaleY",10,500),("tracking",-200,500),("asymmetry",0,100),("textOutline",0,256),("innerWidth",0,256),("gapY",.03,.65),("speedWidth",.0005,.035),("lineLength",.15,1),("taper",0,1),("lengthRandom",0,1),("innerRandom",0,1),("widthRandom",0,1),("spacingRandom",0,1)):
            if field in layer:
                number(layer[field],low,high,field)
        if layer.get("fontId") and not re.fullmatch(r"[0-9a-f]{20}",str(layer["fontId"])):
            raise ToolError("INVALID_FONT", "Invalid local font identifier")
    refs = doc.get("references", [])
    if not isinstance(refs, list) or len(refs) > 7:
        raise ToolError("REFERENCE_LIMIT", "Use at most 7 reference images plus the source")
    for ref in refs:
        if not isinstance(ref, dict):
            raise ToolError("INVALID_REFERENCE", "Invalid reference image")
        identifier(ref.get("asset"), "asset")
        if len(str(ref.get("role", ""))) > 200:
            raise ToolError("INVALID_REFERENCE", "Reference role is too long")
    settings = doc.get("settings")
    prompt = doc.get("prompt")
    if not isinstance(settings, dict) or not isinstance(prompt, dict):
        raise ToolError("INVALID_DOCUMENT", "Missing settings or prompt")
    number(settings.get("ph3_lora_strength", 1.0), -10, 10, "P-H3 LoRA strength")
    extra_loras(settings)
    for key in ("original", "ai"):
        if not isinstance(prompt.get(key, ""), str) or len(prompt.get(key, "")) > 16000:
            raise ToolError("PROMPT_TOO_LONG", "Prompt exceeds 16,000 characters")
    if prompt.get("source") not in {"original", "ai"}:
        raise ToolError("INVALID_PROMPT", "Prompt source must be original or ai")
    asset_ids(doc)
    return doc
