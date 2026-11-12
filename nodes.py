"""Small asset / result nodes around the unmodified ComfyUI sampling graph."""
from __future__ import annotations
import re
import numpy as np
import torch
from PIL import Image
from .runtime import get_store
from .generation import NATIVE_IMAGE, capture_images
from .schema import ToolError


def tensor_image(image):
    array = np.asarray(image.convert("RGBA"), dtype=np.float32).copy() / 255.0
    return torch.from_numpy(array[..., :3])[None], torch.from_numpy(array[..., 3])[None]


def pil_images(tensor):
    if tensor.ndim != 4 or tensor.shape[-1] not in (3, 4) or not torch.isfinite(tensor).all():
        raise ValueError("Invalid or non-finite image tensor")
    for item in tensor[:4]:
        pixels = (item.detach().cpu().float().clamp(0, 1).numpy() * 255).round().astype(np.uint8)
        yield Image.fromarray(pixels)


class PH3ImageTool:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"project_id": ("STRING", {"default": ""}),
                             "revision": ("INT", {"default": 0, "min": 0, "max": 2**31-1})},
                "optional": {"image": ("IMAGE",)}}
    RETURN_TYPES = ("IMAGE", "MASK", "MASK")
    RETURN_NAMES = ("image", "alpha", "selection")
    FUNCTION = "execute"
    CATEGORY = "image/PH3 Image Tool"
    SEARCH_ALIASES = ["ComfyUI-PH3-Image-Tool", "P-H3 image", "PH3ImageTool"]
    OUTPUT_NODE = True

    @classmethod
    def IS_CHANGED(cls, project_id, revision, image=None):
        if not project_id:
            return float("nan")
        try:
            record = get_store().read(project_id)
            return f'{project_id}:{record["revision"]}:{record["document"].get("composite_asset")}'
        except ToolError:
            return float("nan")

    def execute(self, project_id, revision, image=None):
        store = get_store()
        ui = {}
        if image is not None:
            # Capture an actual upstream tensor; never substitute an upstream LoadImage through transforms.
            input_info = store.put_image(next(pil_images(image)))
            ui["ph3_input"] = [input_info]
        if not project_id:
            if image is None:
                raise ValueError("Open PH3 Image Tool, create/import an image and use Save / Apply to Node first.")
            rgb, alpha = tensor_image(store.image(input_info["asset"]))
            return {"ui": ui, "result": (rgb, alpha, torch.zeros_like(alpha))}
        record = store.read(project_id)
        if record["revision"] != revision:
            raise ValueError("Project revision changed. Reopen PH3 Image Tool and Apply to Node; stale output was refused.")
        doc = record["document"]
        if not doc.get("composite_asset"):
            raise ValueError("Save / Apply the editor canvas before queueing this node.")
        flattened = store.image(doc["composite_asset"])
        if flattened.size != (doc["width"], doc["height"]):
            raise ValueError("Committed preview size does not match the document")
        rgb, alpha = tensor_image(flattened)
        selection = torch.zeros_like(alpha)
        if doc.get("selection_asset"):
            mask = store.image(doc["selection_asset"])
            if mask.size != flattened.size:
                raise ValueError("Selection size mismatch")
            selection = torch.from_numpy(np.asarray(mask.getchannel("R"), dtype=np.float32).copy() / 255)[None]
        ui["ph3_project"] = [{"id": project_id, "revision": revision, "asset": doc["composite_asset"]}]
        return {"ui": ui, "result": (rgb, alpha, selection)}


class PH3ImageToolAsset:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"asset_id": ("STRING", {"default": ""})}}
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "load"
    CATEGORY = "image/PH3 Image Tool/internal"
    def load(self, asset_id):
        image = get_store().image(asset_id)
        background = Image.new("RGBA", image.size, "white")
        image = Image.alpha_composite(background, image)
        return (tensor_image(image)[0],)


class PH3ImageToolResult:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "job_id": ("STRING", {"default": ""})}}
    RETURN_TYPES = ()
    FUNCTION = "capture"
    CATEGORY = "image/PH3 Image Tool/internal"
    OUTPUT_NODE = True
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")
    def capture(self, images, job_id):
        job = capture_images(get_store(), job_id, list(pil_images(images)))
        return {"ui": {"ph3_job": [job["id"]]}, "result": ()}


VISUAL_CAPTION_SECTIONS = ("subject_definitions", "summary", "retention_analysis", "detailed_description")
CAPTION_SECTION_HEADER = re.compile(
    r"^(" + "|".join((*VISUAL_CAPTION_SECTIONS, "overall_soundscape", "non_diegetic_music")) + r"):[ \t]*",
    re.IGNORECASE | re.MULTILINE,
)
MAX_ENHANCED_TEXT = 16000


def recover_visual_caption(raw_text):
    """Read the visual sections when an enhancer follows its own template instead of JSON."""
    if not isinstance(raw_text, str) or len(raw_text) > MAX_ENHANCED_TEXT:
        return ""
    raw_text = raw_text.strip()
    headers = list(CAPTION_SECTION_HEADER.finditer(raw_text))
    if not headers or headers[0].start() != 0:
        return ""
    sections = {}
    for index, header in enumerate(headers):
        end = headers[index + 1].start() if index + 1 < len(headers) else len(raw_text)
        sections[header.group(1).lower()] = raw_text[header.end():end].strip()
    if not sections.get("summary") or not sections.get("detailed_description"):
        return ""
    sections["summary"] = sections["summary"].removeprefix("[keyframe completion]").strip()
    return "\n\n".join(sections[name] for name in VISUAL_CAPTION_SECTIONS if sections.get(name))


class PH3ImageToolTextResult:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"text": ("STRING", {"forceInput": True}), "job_id": ("STRING", {"default": ""})},
                "optional": {"raw_text": ("STRING", {"forceInput": True})}}
    RETURN_TYPES = ()
    FUNCTION = "capture"
    CATEGORY = "image/PH3 Image Tool/internal"
    OUTPUT_NODE = True
    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")
    def capture(self, text, job_id, raw_text=None):
        store = get_store()
        request = store.job(job_id)["request"]
        if request["mode"] != "enhance":
            raise ValueError("Text result cannot finish an image request")
        if not str(text).strip() and request.get("config", {}).get("model_engine") == NATIVE_IMAGE:
            text = recover_visual_caption(raw_text)
        if not str(text).strip() or len(str(text)) > MAX_ENHANCED_TEXT:
            raise ValueError("Prompt upsampler returned empty or oversized text")
        store.finish_job(job_id, text=text)
        return {"ui": {"ph3_job": [job_id]}, "result": ()}

NODE_CLASS_MAPPINGS = {cls.__name__: cls for cls in (PH3ImageTool, PH3ImageToolAsset, PH3ImageToolResult, PH3ImageToolTextResult)}
NODE_DISPLAY_NAME_MAPPINGS = {"PH3ImageTool": "PH3 Image Tool (ComfyUI-PH3-Image-Tool)", "PH3ImageToolAsset": "PH3 Tool Asset (internal)",
                            "PH3ImageToolResult": "PH3 Tool Result (internal)", "PH3ImageToolTextResult": "PH3 Tool Text Result (internal)"}
