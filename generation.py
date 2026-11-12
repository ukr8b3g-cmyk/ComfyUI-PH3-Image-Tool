"""Build standard ComfyUI API graphs. No model loading or nested execution here."""
from __future__ import annotations
import math
import numpy as np
from PIL import Image, ImageChops, ImageFilter
from .schema import ToolError, SIGMAS, MAX_SIDE, number, dimensions, extra_loras
from .manga_presets import PRESETS as MANGA_PRESETS
from . import lettering
from .manga import MANGA_PROMPT, options as manga_options, store_finish, available as manga_available

CORE_NODES = ("UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly",
              "MiniMaxH3SigmaShift", "PH3ImageConditioning", "ManualSigmas",
              "BasicGuider", "RandomNoise", "KSamplerSelect", "SamplerCustomAdvanced", "VAEDecode")
MODEL_FIELDS = {"unet_name": "diffusion_models", "clip_name": "text_encoders", "vae_name": "vae", "lora_name": "loras"}
NATIVE_IMAGE = "minimax_h3_image"
NATIVE_REFERENCE_MAX_PIXELS = 8_500_000
NATIVE_SAMPLING_DEFAULTS = {"sampler_name": "euler", "scheduler": "simple", "steps": 6, "cfg": 1.0, "denoise": 1.0}
NATIVE_NODES = ("UNETLoader", "CLIPLoader", "VAELoader", "MiniMaxH3ImageConditioning",
                "ConditioningZeroOut", "KSampler", "VAEDecode")
ENHANCER_NODES = ("CLIPLoader", "TextGenerateV2", "PH3ImageToolTextResult", "PH3ImageToolAsset")
NATIVE_ENHANCER_SYSTEM = (
    'Return one valid JSON object in the format {"expanded_caption":"Image prompt here"}. '
    "Use double quotes for the key and value, and escape embedded double quotes. "
    "Describe the finished image in English with detail proportionate to the request. "
    "Do not turn the user's instructions into visible lettering. If exact lettering is requested, "
    "quote it in its original language, preserving spelling, spacing, punctuation, line breaks and "
    "the requested placement and writing direction. Use only supplied references, numbered in input "
    "order, and borrow only the features assigned to each reference."
)
NATIVE_ENHANCER_TASKS = {
    "new": (
        "Start with the intended image and its composition, including relevant positions and counts. "
        "Then describe the subjects, their actions and the visible style. If lettering is not requested, "
        "describe an image without lettering."
    ),
    "full": (
        "Identify relevant content in <Picture 1>, the source image, and the roles of any additional "
        "references. Describe the finished image, separating the requested changes from the features "
        "that stay. Preserve unrelated details and existing lettering unless the request changes them."
    ),
    "selection": (
        "Use <Picture 1> as the source crop with surrounding context. The selection outline is not shown. "
        "Locate the requested target by visible features or positions within the crop. Describe the "
        "finished local edit and the adjustments needed to fit it into its surroundings. Preserve "
        "unrelated details, including any lettering the request leaves unchanged. Refer to the existing "
        "background as unchanged, including its color and tone, unless the requested edit changes it."
    ),
}


def check_native_reference(size, source, index=None):
    short_edge = min(size)
    # MiniMaxH3ImageConditioning uses a 1024 short edge for vision and
    # clamps the VAE short edge to 1024–2048. The VAE size bounds both paths.
    scale = min(max(short_edge, 1024), 2048) / short_edge
    w, h = (max(32, round(side * scale / 32) * 32) for side in size)
    if max(w, h) <= MAX_SIDE and w * h <= NATIVE_REFERENCE_MAX_PIXELS:
        return
    label = {"selection": "Selection crop", "canvas": "Source image",
             "additional": f"Reference image {index}", "lettering": "Lettering reference"}[source]
    hint = ("Widen the selection or increase Context padding in Settings." if source == "selection"
            else "Use an image with a less extreme aspect ratio.")
    raise ToolError(
        "NATIVE_REFERENCE_TOO_LARGE",
        f"{label} would resize to {w} × {h} px in MiniMax-H3-Image. "
        f"The reference limit is {MAX_SIDE} px on the long side and {NATIVE_REFERENCE_MAX_PIXELS / 1_000_000:g} MP. {hint}",
        details={"source": source, "index": index, "width": w, "height": h,
                 "max_side": MAX_SIDE, "max_pixels": NATIVE_REFERENCE_MAX_PIXELS},
    )


def fit_generation(width, height, megapixels=1.0, *, upscale=False):
    number(megapixels, 0.25, 8.5, "max_megapixels")
    scale = math.sqrt(megapixels * 1_000_000 / (width * height))
    scale = min(scale, MAX_SIDE / max(width, height) if upscale else 1.0)
    # Both axes use the native 32-pixel grid. The full crop is mapped back, never center-cropped.
    w = max(32, int(width * scale / 32) * 32)
    h = max(32, int(height * scale / 32) * 32)
    while w * h > megapixels * 1_000_000 and max(w, h) > 32:
        if w >= h:
            w -= 32
        else:
            h -= 32
    dimensions(w, h)
    return w, h


def checked_sigmas(value):
    try:
        values = [float(part.strip()) for part in str(value).split(",")]
    except ValueError as exc:
        raise ToolError("INVALID_SIGMAS", "Sigma schedule must be comma-separated numbers") from exc
    if not 3 <= len(values) <= 65 or values[0] != 1 or values[-1] != 0:
        raise ToolError("INVALID_SIGMAS", "Use 3–65 sigmas starting at 1 and ending at 0")
    if any(not math.isfinite(x) or x < 0 or x > 1 for x in values) or any(a <= b for a, b in zip(values, values[1:])):
        raise ToolError("INVALID_SIGMAS", "Sigmas must be finite and strictly decreasing")
    return ", ".join(str(x) for x in values)


def model_config(settings, available):
    native = settings.get("model_engine") == NATIVE_IMAGE
    config = {"model_engine": NATIVE_IMAGE} if native else {}
    for key, category in MODEL_FIELDS.items():
        if native and key == "lora_name":
            continue
        field = f"h3_image_{key}" if native else key
        value = settings.get(field, "")
        if value not in available.get(category, []):
            raise ToolError("MISSING_MODEL", f"Select an installed {field}; no model was downloaded or substituted")
        config[key] = value
    raw_seed = str(settings.get("seed", "42"))
    if not raw_seed.isdecimal() or int(raw_seed) > 2**53 - 1:
        raise ToolError("INVALID_SEED", "Seed must be 0–9007199254740991 (exact browser integer range)")
    config["seed"] = int(raw_seed)
    if native:
        config["sampling"] = {
            key: settings.get(f"h3_image_{key}", default) for key, default in NATIVE_SAMPLING_DEFAULTS.items()
        }
        sampling = config["sampling"]
        if sampling["sampler_name"] not in available.get("samplers", ["euler"]):
            raise ToolError("MISSING_SAMPLER", "Selected sampler is unavailable")
        if sampling["scheduler"] not in available.get("schedulers", ["simple"]):
            raise ToolError("MISSING_SCHEDULER", "Selected scheduler is unavailable")
        sampling["steps"] = number(sampling["steps"], 1, 10000, "Steps", integer=True)
        sampling["cfg"] = number(sampling["cfg"], 0, 100, "CFG")
        sampling["denoise"] = number(sampling["denoise"], 0, 1, "Denoise")
        return config

    config["ph3_lora_strength"] = number(settings.get("ph3_lora_strength", 1.0), -10, 10, "P-H3 LoRA strength")
    config["extra_loras"] = []
    for slot in extra_loras(settings):
        if not slot.get("enabled") or not slot.get("name") or slot.get("strength", 1.0) == 0:
            continue
        if slot["name"] not in available.get("loras", []):
            raise ToolError("MISSING_MODEL", "Selected additional LoRA is not installed: " + slot["name"])
        config["extra_loras"].append({"name": slot["name"], "strength": slot.get("strength", 1.0)})
    config["enhancer_name"] = settings.get("enhancer_name", "")
    config["sampler"] = settings.get("sampler", "er_sde")
    if config["sampler"] not in available.get("samplers", ["er_sde", "euler"]):
        raise ToolError("MISSING_SAMPLER", "Selected sampler is unavailable")
    config["sigmas"] = checked_sigmas(settings.get("sigmas", SIGMAS))
    return config


def prepare_job(store, project_id, payload, available, node_names):
    record = store.read(project_id)
    if payload.get("revision") != record["revision"]:
        raise ToolError("SAVE_CONFLICT", "Save/reload the current project before generating", 409)
    doc = record["document"]
    mode = payload.get("mode", "selection")
    if mode not in {"new", "full", "selection", "enhance", "manga", "lettering"}:
        raise ToolError("INVALID_MODE", "Unknown generation mode")
    enhance = mode == "enhance"
    settings = doc["settings"]
    native = settings.get("model_engine") == NATIVE_IMAGE
    native_enhance = enhance and native
    model_nodes = NATIVE_NODES if native else CORE_NODES
    required = ENHANCER_NODES if enhance else (*model_nodes, "PH3ImageToolResult", "PH3ImageToolAsset")
    if native_enhance:
        required = (*required, "JsonExtractString")
    missing = [name for name in required if name not in node_names]
    if missing:
        raise ToolError("MISSING_NODES", "Update ComfyUI; missing nodes: " + ", ".join(missing))
    if enhance:
        field = "h3_image_enhancer_name" if native_enhance else "enhancer_name"
        name = settings.get(field)
        if name not in available.get("text_encoders", []):
            raise ToolError("MISSING_ENHANCER", "Select an installed prompt enhancer")
        config = {"enhancer_name": name}
        if native_enhance:
            config["model_engine"] = NATIVE_IMAGE
    else:
        config = model_config(settings, available)
    if mode == "lettering":
        opts = lettering.options(payload.get('lettering', {}))
        size = fit_generation(*lettering.material_size(opts), settings.get('max_megapixels', 1.0))
        request = lettering.request(store, record, payload, config, size)
        if native and request["crop_asset"]:
            check_native_reference(store.image_size(request["crop_asset"]), "lettering")
        from .output_saving import options as output_options
        request['output_save']=output_options(doc['settings'])
        job = store.create_job(project_id, request)
        return job, build_graph(job)
    prompt = doc["prompt"].get("original" if enhance else doc["prompt"]["source"], "").strip()
    if mode == "manga":
        if not manga_available():
            raise ToolError("MANGA_UNAVAILABLE", "Manga finishing needs an existing OpenCV installation", 409)
        preset = payload.get('manga_preset')
        if preset is not None and (not isinstance(preset, str) or preset not in MANGA_PRESETS):
            raise ToolError('INVALID_MANGA', 'Unknown manga preset')
        prompt = MANGA_PRESETS[preset] if preset else MANGA_PROMPT
    if not prompt:
        raise ToolError("EMPTY_PROMPT", "Enter an instruction before generating")
    width, height = doc["width"], doc["height"]
    source_asset = payload.get("source_asset")
    scope = mode
    if enhance:
        scope = payload.get("enhance_scope", "full" if source_asset else "new")
        if scope not in ("new", "full", "selection"):
            raise ToolError("INVALID_MODE", "Unknown prompt enhancement scope")
        if scope == "new":
            source_asset = None
    crop_asset = None
    selected_mask = None
    region = [0, 0, width, height]
    if scope in {"full", "selection", "manga"}:
        source = store.image(source_asset)
        if source.size != (width, height):
            raise ToolError("SOURCE_SIZE", "Source snapshot must match the document canvas")
        if scope == "selection":
            mask = store.image(doc.get("selection_asset")).getchannel("R")
            if mask.size != source.size:
                raise ToolError("MASK_SIZE", "Selection mask must match the document canvas")
            bounds = mask.getbbox()
            if not bounds:
                raise ToolError("EMPTY_SELECTION", "Draw a selection first")
            context = number(settings.get("context", .25), 0, 1, "context")
            feather = number(settings.get("feather", 4), 0, 64, "feather")
            left, top, right, bottom = bounds
            pad = math.ceil(max(right - left, bottom - top) * context + feather * 2)
            left, top = max(0, left - pad), max(0, top - pad)
            right, bottom = min(width, right + pad), min(height, bottom + pad)
            region = [left, top, right - left, bottom - top]
        if native and not enhance:
            check_native_reference(region[2:], "selection" if scope == "selection" else "canvas")
        if scope == "selection":
            # Feather inward: no generated alpha is permitted outside the original selection.
            if not enhance:
                softened = ImageChops.multiply(mask, mask.filter(ImageFilter.GaussianBlur(feather))) if feather else mask
                selected_mask = store.put_image(softened.crop((left, top, right, bottom)))["asset"]
            source = source.crop((left, top, right, bottom))
        crop_asset = store.put_image(source)["asset"]
    elif mode != "new" and not enhance:
        raise ToolError("MISSING_SOURCE", "An image source is required")
    # A tiny selection can produce too few image tokens for the native model.
    # Render the crop at the chosen generation budget and place it back at its original size.
    gen_width, gen_height = fit_generation(region[2], region[3], settings.get("max_megapixels", 1.0),
                                           upscale=native and mode == "selection")
    refs = [] if mode == "new" or (enhance and not crop_asset) else doc.get("references", [])
    if native and not enhance:
        for index, ref in enumerate(refs, 1):
            check_native_reference(store.image_size(ref["asset"]), "additional", index)
    instruction = prompt
    if refs:
        role_text = " ".join(f"Use <Picture {i+2}> as a reference for {ref.get('role', 'appearance')}." for i, ref in enumerate(refs))
        instruction += "\n" + role_text
    if mode == "selection":
        if native:
            instruction += ("\nWithin this crop, make the requested change and the local adjustments "
                            "needed to fit it into the surroundings. Where the edit leaves the image "
                            "unchanged, match the original colors and tones in <Picture 1>, including "
                            "the existing background.")
        else:
            instruction += "\nKeep the original viewpoint, framing, lighting and unrelated details. Edit the requested subject within this crop."
    request = {"mode": mode, "canvas_revision": doc["canvas_revision"], "document_revision": record["revision"],
               "source_asset": source_asset if crop_asset else None, "crop_asset": crop_asset,
               "mask_asset": selected_mask, "region": region, "canvas": [width, height],
               "generation_size": [gen_width, gen_height], "prompt": prompt, "instruction": instruction,
               "prompt_source": "original" if enhance else doc["prompt"]["source"],
               "original_prompt": doc["prompt"]["original"], "references": refs, "config": config}
    if native_enhance or (enhance and "enhance_scope" in payload):
        request["enhance_scope"] = scope
    if mode == "manga":
        layer = next((l for l in doc['layers'] if l['id']==payload.get('source_layer_id') and l['type']=='image'), None)
        if layer is None or layer.get('locked'):
            raise ToolError('MISSING_SOURCE', 'Select an unlocked image layer for manga generation')
        request['source_layer'] = layer
        request['manga_preset'] = preset
        defaults = dict(screen_lines=250, black_point=.4 if preset=='bold' else .3) if preset else {}
        supplied = payload.get('manga_settings')
        if supplied is not None and not isinstance(supplied, dict):
            raise ToolError('INVALID_MANGA', 'Invalid manga settings')
        request['manga_settings'] = manga_options({**defaults, **(supplied or {})})
    from .output_saving import options as output_options
    request['output_save']=output_options(doc['settings'])
    job = store.create_job(project_id, request)
    return job, build_graph(job)


def build_graph(job):
    request, graph = job["request"], {}
    config = request["config"]
    def add(node_id, name, **inputs):
        graph[node_id] = {"class_type": name, "inputs": inputs}
        return [node_id, 0]
    images = []
    if request.get("crop_asset"):
        images.append(add("20", "PH3ImageToolAsset", asset_id=request["crop_asset"]))
    for index, ref in enumerate(request.get("references", [])):
        images.append(add(str(21 + index), "PH3ImageToolAsset", asset_id=ref["asset"]))
    if request["mode"] == "enhance":
        clip = add("1", "CLIPLoader", clip_name=config["enhancer_name"], type="minimax", device="default")
        inputs = {"clip": clip, "prompt": request["instruction"], "max_length": 1536,
                  "sampling_mode": "off", "thinking": True, "use_default_template": True, "mtp": "auto"}
        native = config.get("model_engine") == NATIVE_IMAGE
        if native:
            editing = bool(request.get("crop_asset"))
            scope = request.get("enhance_scope", "full" if editing else "new")
            task = NATIVE_ENHANCER_TASKS[scope]
            inputs.update({"system_prompt": NATIVE_ENHANCER_SYSTEM,
                           "prompt": task + "\n\nUser request:\n" + request["instruction"],
                           "max_length": 8196 if editing else 8192,
                           "sampling_mode": "on", "sampling_mode.temperature": 1.0, "sampling_mode.top_k": 20,
                           "sampling_mode.top_p": 0.95, "sampling_mode.min_p": 0.0,
                           "sampling_mode.repetition_penalty": 1.0, "sampling_mode.presence_penalty": 0.0,
                           "sampling_mode.seed": 0})
        for index, image in enumerate(images):
            inputs[f"images.image{index+1}"] = image
        text = add("2", "TextGenerateV2", **inputs)
        result_inputs = {"text": text, "job_id": job["id"]}
        if native:
            result_inputs["text"] = add("3", "JsonExtractString", json_string=text, key="expanded_caption")
            result_inputs["raw_text"] = text
        add("90", "PH3ImageToolTextResult", **result_inputs)
        return graph
    native = config.get("model_engine") == NATIVE_IMAGE
    model = add("1", "UNETLoader", unet_name=config["unet_name"], weight_dtype="default")
    if not native:
        model = add("2", "LoraLoaderModelOnly", model=model, lora_name=config["lora_name"], strength_model=config.get("ph3_lora_strength", 1.0))
        for index, slot in enumerate(config.get("extra_loras", [])):
            model = add(str(30 + index), "LoraLoaderModelOnly", model=model,
                        lora_name=slot["name"], strength_model=slot["strength"])
        model = add("3", "MiniMaxH3SigmaShift", model=model, shift_video=1.0, shift_audio=1.0)
    clip = add("4", "CLIPLoader", clip_name=config["clip_name"], type="minimax", device="default")
    vae = add("5", "VAELoader", vae_name=config["vae_name"])
    instruction = request["instruction"]
    if native and request.get("crop_asset") and not instruction.lstrip().lower().startswith("edit <picture 1>"):
        instruction = "Edit <Picture 1>. " + instruction
    width, height = request["generation_size"]
    cond_inputs = {"clip": clip, "vae": vae, "prompt": instruction, "width": width, "height": height}
    for index, image in enumerate(images):
        cond_inputs[f"images.image_{index+1}"] = image
    condition = add("6", "MiniMaxH3ImageConditioning" if native else "PH3ImageConditioning", **cond_inputs)
    if native:
        negative = add("7", "ConditioningZeroOut", conditioning=condition)
        sampling = {**NATIVE_SAMPLING_DEFAULTS, **config.get("sampling", {})}
        samples = add("11", "KSampler", model=model, seed=config["seed"], positive=condition,
                      negative=negative, latent_image=["6", 1], **sampling)
    else:
        guider = add("7", "BasicGuider", model=model, conditioning=condition)
        noise = add("8", "RandomNoise", noise_seed=config["seed"])
        sampler = add("9", "KSamplerSelect", sampler_name=config["sampler"])
        sigmas = add("10", "ManualSigmas", sigmas=config["sigmas"])
        samples = add("11", "SamplerCustomAdvanced", noise=noise, guider=guider, sampler=sampler,
                      sigmas=sigmas, latent_image=["6", 1])
    decoded = add("12", "VAEDecode", samples=samples, vae=vae)
    add("90", "PH3ImageToolResult", images=decoded, job_id=job["id"])
    return graph


def restore_selection_colors(source, patch, mask):
    """Restore matching colors using evidence from the unselected part of the crop."""
    bounds = mask.getbbox()
    if source.size != patch.size or not bounds or mask.getextrema()[0] != 0:
        return patch

    original, generated, selection = np.asarray(source), np.asarray(patch), np.asarray(mask)
    # Sample the surrounding context to estimate small, consistent shifts per source color.
    stride = max(1, math.ceil(math.sqrt(selection.size / 65_536)))
    before, after = original[::stride, ::stride], generated[::stride, ::stride]
    sample_mask = selection[::stride, ::stride]
    opaque = (before[..., 3] == 255) & (after[..., 3] == 255)
    context = opaque & (sample_mask == 0)
    if np.count_nonzero(context) < 16:
        return patch
    # A small uniform change on its own may be the requested edit. Require evidence
    # of a distinct edit before treating similar colors elsewhere as drift.
    selected = opaque & (sample_mask >= 128)
    edits = after[selected, :3].astype(np.int16) - before[selected, :3]
    if np.count_nonzero(np.max(np.abs(edits), axis=1) >= 24) < 8:
        return patch

    base = before[context, :3].astype(np.int16)
    shift = after[context, :3].astype(np.int16) - base
    bins = (base // 32) @ np.array([64, 8, 1], dtype=np.int16)
    counts = np.bincount(bins, minlength=512)
    anchors = []
    for bucket in np.argsort(counts)[-8:]:
        if counts[bucket] < max(16, len(base) * .02):
            continue
        group = bins == bucket
        offset = np.median(shift[group], axis=0)
        spread = np.quantile(np.max(np.abs(shift[group] - offset), axis=1), .75)
        if 2 <= np.max(np.abs(offset)) <= 18 and spread <= 6:
            anchors.append((np.median(base[group], axis=0), offset, min(5, math.ceil(spread) + 1)))
    if not anchors:
        return patch

    # Preserve alpha and keep temporary arrays bounded for large selections.
    corrected = np.array(patch)
    left, top, right, bottom = bounds
    rows = max(1, 131_072 // (right - left))
    for y in range(top, bottom, rows):
        part = np.s_[y:min(y + rows, bottom), left:right]
        dst, src = corrected[part], original[part]
        valid = (selection[part] > 0) & (src[..., 3] == 255) & (dst[..., 3] == 255)
        base = src[valid, :3].astype(np.int16)
        actual = dst[valid, :3].astype(np.int16)
        shift = actual - base
        weight = np.zeros(len(base))
        for color, offset, inner in anchors:
            color_distance = np.max(np.abs(base - color), axis=1)
            error = np.max(np.abs(shift - offset), axis=1)
            # Fade at the limits so a color close to a background sample does not
            # cause a hard edge around the new subject.
            strength = np.clip((16 - color_distance) / 8, 0, 1)
            strength *= np.clip((2 * inner + 1 - error) / (inner + 1), 0, 1)
            np.maximum(weight, strength, out=weight)
        dst[valid, :3] = np.rint(actual - shift * weight[:, None]).astype(np.uint8)
    return Image.fromarray(corrected)


def capture_images(store, job_id, images):
    job = store.job(job_id)
    request = job["request"]
    if request["mode"] == "enhance":
        raise ToolError("JOB_KIND", "Image result cannot finish a text request")
    x, y, width, height = request["region"]
    crop_asset = request.get("crop_asset") if request["mode"] == "selection" else None
    source_crop = store.image(crop_asset) if crop_asset and request.get("mask_asset") else None
    results = []
    for image in images[:4]:
        raw = store.put_image(image)["asset"]
        if request['mode'] == 'lettering':
            patch, clipped = lettering.finish(image, request['lettering'])
            glyph_rect = None
            if request.get('preserved_lettering_asset'):
                patch, clipped, glyph_rect = lettering.compose_preserved_bubble(image, store.image(request['preserved_lettering_asset']), request['lettering'])
            result = store.put_image(patch)
            result.update(raw_asset=raw, edge_clipped=clipped, preserved_lettering_asset=request.get('preserved_lettering_asset'), glyph_rect=glyph_rect, **lettering.placement(request, patch.size))
            results.append(result)
            continue
        patch = image.convert("RGBA").resize((width, height), Image.Resampling.LANCZOS)
        if request.get("mask_asset"):
            mask = store.image(request["mask_asset"]).getchannel("R")
            if mask.size != patch.size:
                raise ToolError("MASK_SIZE", "Stored selection mask does not match the generation region")
            if source_crop is not None:
                patch = restore_selection_colors(source_crop, patch, mask)
            patch.putalpha(mask)
        if request['mode'] == 'manga':
            patch.putalpha(store.image(request['source_asset']).getchannel('A'))
            generated = store.put_image(patch)['asset']
            result = store_finish(store, patch, request['manga_settings'], generated)
        else:
            result = store.put_image(patch)
        result.update(raw_asset=raw, x=x, y=y, w=width, h=height)
        results.append(result)
    from .output_saving import save_candidates
    try:
        save_candidates(store,job,results)
    except Exception as error:
        store.finish_job(job_id,results=results)
        store.mark_job(job_id,{'error':'Image output save failed: '+str(error)})
        raise
    return store.finish_job(job_id, results=results)
