"""CPU finishing for a generated patch and its original selection."""
from io import BytesIO
import math

import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps

from .schema import MAX_SIDE, ToolError, dimensions, number


def inward_distance(mask, box, radius):
    """Distance in pixel steps to the nearest unselected pixel, up to the effect radius."""
    x, y, right, bottom = box
    reach = math.ceil(radius) + 1
    left, top = max(0, x - reach), max(0, y - reach)
    area = mask.crop((left, top, min(mask.width, right + reach), min(mask.height, bottom + reach)))
    distance = np.zeros((area.height, area.width), dtype=np.int16)
    distance[np.asarray(area) > 0] = reach
    sweep = np.empty_like(distance)
    for axis, length in enumerate(distance.shape):
        coords = np.arange(length, dtype=np.int16).reshape((-1, 1) if axis == 0 else (1, -1))
        np.subtract(distance, coords, out=sweep)
        np.minimum.accumulate(sweep, axis=axis, out=sweep)
        np.add(sweep, coords, out=sweep)
        np.minimum(distance, sweep, out=distance)
        np.add(distance, coords, out=sweep)
        backwards = np.flip(sweep, axis=axis)
        np.minimum.accumulate(backwards, axis=axis, out=backwards)
        np.subtract(sweep, coords, out=sweep)
        np.minimum(distance, sweep, out=distance)
    return distance[y - top:bottom - top, x - left:right - left]


def feathered_mask(selection, radius, distance):
    if not radius:
        return selection
    # A symmetric blur leaves about half the patch at the edge and can reveal a hard seam.
    t = np.clip((distance.astype(np.float32) - .5) / radius, 0, 1)
    ramp = t * t * (3 - 2 * t)
    return Image.fromarray(np.rint(np.asarray(selection) * ramp).astype(np.uint8))


def feather_selection(mask, radius, box):
    return feathered_mask(mask.crop(box), radius, inward_distance(mask, box, radius) if radius else None)


def match_boundary(source, patch, distance, radius, strength):
    """Estimate small, local RGB offsets from the preserved side of the seam."""
    band = np.where(distance > 0, np.maximum(0, 1 - distance / np.float32(2 * radius)), 0)
    inside_band = Image.fromarray(np.rint(band * 255).astype(np.uint8))
    source_rgb = source.convert("RGB")
    channels = ImageChops.difference(source_rgb, patch).split()
    largest_delta = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    # Reject colors that have changed substantially, such as a newly painted object.
    similar = largest_delta.point(lambda v: min(255, max(0, (32 - v) * 12)))
    opaque = source.getchannel("A").point([0] * 255 + [255])
    trusted = ImageChops.multiply(similar, opaque)
    # Favor samples outside the edit. Use similarly colored pixels just inside
    # when the crop runs up to the boundary and no outside pixels are available.
    outside = Image.fromarray(np.where(distance == 0, 255, 0).astype(np.uint8))
    samples = ImageChops.multiply(ImageChops.lighter(outside, inside_band.point(lambda v: v // 3)), trusted)

    factor = 4 if max(patch.size) > 2048 else 2
    reduced_size = tuple(max(1, (edge + factor - 1) // factor) for edge in patch.size)

    def nearby(image):
        return (image.resize(reduced_size, Image.Resampling.BOX)
                .filter(ImageFilter.GaussianBlur(2 * radius / factor))
                .resize(patch.size, Image.Resampling.BILINEAR))

    support = np.asarray(nearby(samples))
    boundary = np.asarray(ImageChops.multiply(inside_band, trusted))
    usable = (boundary > 0) & (support >= 12)
    if not np.any(usable):
        return patch
    confidence = support[usable].astype(np.float32)
    weight = boundary[usable] * (strength / 25_500) * np.minimum(1, (confidence - 8) / 40)
    result = np.array(patch)
    neutral = Image.new("L", patch.size, 128)
    for index, (old, generated) in enumerate(zip(source_rgb.split(), patch.split())):
        # Encode signed offsets around 128 and normalize by valid sample coverage.
        shift = ImageChops.subtract(old, generated, offset=128).point(
            lambda v: max(0, min(255, 128 + (v - 128) * 4)))
        local = np.asarray(nearby(Image.composite(shift, neutral, samples)))
        correction = (local[usable].astype(np.float32) - 128) * 255 / (4 * confidence)
        plane = result[..., index]
        plane[usable] = np.rint(np.clip(plane[usable] + correction * weight, 0, 255)).astype(np.uint8)
    return Image.fromarray(result)


def reblend(store, payload):
    feather = number(payload.get("feather"), 0, 64, "Feather")
    strength = number(payload.get("color_strength"), 0, 100, "Boundary color matching")
    region = payload.get("region")
    if not isinstance(region, list) or len(region) != 4:
        raise ToolError("INVALID_REGION", "A crop rectangle is required")
    x = number(region[0], 0, MAX_SIDE - 1, "Crop X", integer=True)
    y = number(region[1], 0, MAX_SIDE - 1, "Crop Y", integer=True)
    width, height = dimensions(*region[2:])
    source = store.image(payload["source_asset"])
    if x + width > source.width or y + height > source.height:
        raise ToolError("INVALID_REGION", "The crop must fit within the source image")
    box = (x, y, x + width, y + height)
    patch = store.image(payload["result_asset"]).convert("RGB")
    if patch.size != (width, height):
        raise ToolError("SOURCE_SIZE", "The saved result must match the crop")
    if payload.get("selection_asset"):
        original = store.image(payload["selection_asset"]).getchannel("R")
        if original.size != source.size:
            raise ToolError("MASK_SIZE", "The selection must match the original canvas")
        mask_box = box
    else:
        # Old jobs retain their original composite mask rather than the pre-feather selection.
        original = store.image(payload["mask_asset"]).getchannel("R")
        if original.size != patch.size:
            raise ToolError("MASK_SIZE", "The saved mask must match the crop")
        # Pixels beyond an interior crop edge are outside the old selection.
        # A canvas edge, on the other hand, has no neighboring canvas pixels.
        border = (int(x > 0), int(y > 0), int(x + width < source.width), int(y + height < source.height))
        if any(border):
            original = ImageOps.expand(original, border=border, fill=0)
        left, top = border[:2]
        mask_box = (left, top, left + width, top + height)
    selection = original.crop(mask_box)
    if not selection.getbbox():
        raise ToolError("EMPTY_SELECTION", "The original selection is empty")

    color_radius = max(8, min(feather, 24))
    radius = max(feather, color_radius * 2 if strength else 0)
    distance = inward_distance(original, mask_box, radius) if radius else None
    mask = feathered_mask(selection, feather, distance)
    if strength:
        patch = match_boundary(source.crop(box), patch, distance, color_radius, strength)
    if payload.get("preview") is True:
        patch.putalpha(mask)
        patch.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        buffer = BytesIO()
        patch.save(buffer, format="PNG", compress_level=1)
        return buffer.getvalue()
    return {"asset": store.put_image(patch)["asset"], "mask_asset": store.put_image(mask)["asset"]}
