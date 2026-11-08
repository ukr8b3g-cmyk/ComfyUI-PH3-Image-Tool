"""Explicit, reproducible image encoding using ComfyUI's existing Pillow.
No browser-dependent quality fallback, metadata copying or filesystem destination.
"""
from __future__ import annotations
import io
import re
from PIL import Image, ImageColor, features
from .schema import ToolError, number, dimensions


def encode_image(image, options=None):
    options = options or {}
    if not isinstance(options, dict):
        raise ToolError("INVALID_EXPORT", "Export settings must be an object")
    kind = options.get("format", "png")
    if kind not in {"png", "webp", "jpeg"}:
        raise ToolError("INVALID_FORMAT", "Choose PNG, WebP or JPEG")
    dimensions(*image.size)
    quality = number(options.get("quality", 92), 1, 100, "quality", True)
    compression = number(options.get("png_compression", 6), 0, 9, "PNG compression", True)
    lossless = options.get("webp_lossless", False)
    preserve = options.get("preserve_alpha", True)
    if not isinstance(lossless, bool) or not isinstance(preserve, bool):
        raise ToolError("INVALID_EXPORT", "Alpha and lossless settings must be boolean")
    matte = options.get("matte", "#ffffff")
    if not isinstance(matte, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", matte):
        raise ToolError("INVALID_COLOR", "Export matte must be a six-digit color")
    rgba = image.convert("RGBA")
    if kind == "jpeg" or not preserve:
        bg = Image.new("RGBA", rgba.size, ImageColor.getrgb(matte)+(255,))
        bg.alpha_composite(rgba)
        rgba = bg.convert("RGB")
    out = io.BytesIO()
    if kind == "png":
        rgba.save(out, format="PNG", compress_level=compression)
    elif kind == "webp":
        if not features.check("webp"):
            raise ToolError("WEBP_UNAVAILABLE", "This Pillow build does not support WebP", 409)
        rgba.save(out, format="WEBP", quality=quality, lossless=lossless, method=4, exact=True)
    else:
        rgba.save(out, format="JPEG", quality=quality, subsampling=0, optimize=True)
    return out.getvalue(), "image/"+kind
