"""Build standard ComfyUI API graphs. No model loading or nested execution here."""
from __future__ import annotations
import math
from PIL import Image, ImageChops, ImageFilter
from .schema import ToolError, SIGMAS, number, dimensions, extra_loras
from .manga_presets import PRESETS as MANGA_PRESETS
from . import lettering
from .manga import MANGA_PROMPT, options as manga_options, store_finish, available as manga_available

CORE_NODES = ("UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly",
              "MiniMaxH3SigmaShift", "PH3ImageConditioning", "ManualSigmas",
              "BasicGuider", "RandomNoise", "KSamplerSelect", "SamplerCustomAdvanced", "VAEDecode")
MODEL_FIELDS = {"unet_name": "diffusion_models", "clip_name": "text_encoders", "vae_name": "vae", "lora_name": "loras"}


def fit_generation(width, height, megapixels=1.0):
    number(megapixels, 0.25, 8.5, "max_megapixels")
    scale = min(1.0, math.sqrt(megapixels * 1_000_000 / (width * height)))
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
    config = {}
    for key, category in MODEL_FIELDS.items():
        value = settings.get(key, "")
        if value not in available.get(category, []):
            raise ToolError("MISSING_MODEL", f"Select an installed {key}; no model was downloaded or substituted")
        config[key] = value
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
    raw_seed = str(settings.get("seed", "42"))
    if not raw_seed.isdecimal() or int(raw_seed) > 2**53 - 1:
        raise ToolError("INVALID_SEED", "Seed must be 0–9007199254740991 (exact browser integer range)")
    config["seed"] = int(raw_seed)
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
    required = ["CLIPLoader", "TextGenerateV2", "PH3ImageToolTextResult", "PH3ImageToolAsset"] if enhance else list(CORE_NODES) + ["PH3ImageToolResult", "PH3ImageToolAsset"]
    missing = [name for name in required if name not in node_names]
    if missing:
        raise ToolError("MISSING_NODES", "Update ComfyUI; missing nodes: " + ", ".join(missing))
    settings = doc["settings"]
    if enhance:
        if settings.get("enhancer_name") not in available.get("text_encoders", []):
            raise ToolError("MISSING_ENHANCER", "Select an installed P-H3 prompt upsampler")
        config = {"enhancer_name": settings["enhancer_name"]}
    else:
        config = model_config(settings, available)
    if mode == "lettering":
        opts = lettering.options(payload.get('lettering', {}))
        size = fit_generation(*lettering.material_size(opts), settings.get('max_megapixels', 1.0))
        request = lettering.request(store, record, payload, config, size)
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
    crop_asset = None
    selected_mask = None
    region = [0, 0, width, height]
    if mode in {"full", "selection", "manga"} or (enhance and source_asset):
        source = store.image(source_asset)
        if source.size != (width, height):
            raise ToolError("SOURCE_SIZE", "Source snapshot must match the document canvas")
        if mode == "selection":
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
            # Feather inward: no generated alpha is permitted outside the original selection.
            softened = ImageChops.multiply(mask, mask.filter(ImageFilter.GaussianBlur(feather))) if feather else mask
            selected_mask = store.put_image(softened.crop((left, top, right, bottom)))["asset"]
            source = source.crop((left, top, right, bottom))
        crop_asset = store.put_image(source)["asset"]
    elif mode != "new" and not enhance:
        raise ToolError("MISSING_SOURCE", "An image source is required")
    gen_width, gen_height = fit_generation(region[2], region[3], settings.get("max_megapixels", 1.0))
    refs = [] if mode == "new" or (enhance and not crop_asset) else doc.get("references", [])
    instruction = prompt
    if refs:
        role_text = " ".join(f"Use <Picture {i+2}> as a reference for {ref.get('role', 'appearance')}." for i, ref in enumerate(refs))
        instruction += "\n" + role_text
    if mode == "selection":
        instruction += "\nKeep the original viewpoint, framing, lighting and unrelated details. Edit the requested subject within this crop."
    request = {"mode": mode, "canvas_revision": doc["canvas_revision"], "document_revision": record["revision"],
               "source_asset": source_asset if crop_asset else None, "crop_asset": crop_asset,
               "mask_asset": selected_mask, "region": region, "canvas": [width, height],
               "generation_size": [gen_width, gen_height], "prompt": prompt, "instruction": instruction,
               "prompt_source": "original" if enhance else doc["prompt"]["source"],
               "original_prompt": doc["prompt"]["original"], "references": refs, "config": config}
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
    job = store.create_job(project_id, request)
    return job, build_graph(job)


def build_graph(job):
    request, graph = job["request"], {}
    config = request["config"]
    def add(key, name, **inputs):
        graph[key] = {"class_type": name, "inputs": inputs}
        return [key, 0]
    images = []
    if request.get("crop_asset"):
        images.append(add("20", "PH3ImageToolAsset", asset_id=request["crop_asset"]))
    for index, ref in enumerate(request.get("references", [])):
        images.append(add(str(21 + index), "PH3ImageToolAsset", asset_id=ref["asset"]))
    if request["mode"] == "enhance":
        clip = add("1", "CLIPLoader", clip_name=config["enhancer_name"], type="minimax", device="default")
        inputs = {"clip": clip, "prompt": request["instruction"], "max_length": 1536,
                  "sampling_mode": "off", "thinking": True, "use_default_template": True, "mtp": "auto"}
        for index, image in enumerate(images):
            inputs[f"images.image{index+1}"] = image
        text = add("2", "TextGenerateV2", **inputs)
        add("90", "PH3ImageToolTextResult", text=text, job_id=job["id"])
        return graph
    model = add("1", "UNETLoader", unet_name=config["unet_name"], weight_dtype="default")
    model = add("2", "LoraLoaderModelOnly", model=model, lora_name=config["lora_name"], strength_model=config.get("ph3_lora_strength", 1.0))
    for index, slot in enumerate(config.get("extra_loras", [])):
        model = add(str(30 + index), "LoraLoaderModelOnly", model=model,
                    lora_name=slot["name"], strength_model=slot["strength"])
    model = add("3", "MiniMaxH3SigmaShift", model=model, shift_video=1.0, shift_audio=1.0)
    clip = add("4", "CLIPLoader", clip_name=config["clip_name"], type="minimax", device="default")
    vae = add("5", "VAELoader", vae_name=config["vae_name"])
    cond_inputs = {"clip": clip, "vae": vae, "prompt": request["instruction"],
                   "width": request["generation_size"][0], "height": request["generation_size"][1]}
    for index, image in enumerate(images):
        cond_inputs[f"images.image_{index+1}"] = image
    condition = add("6", "PH3ImageConditioning", **cond_inputs)
    guider = add("7", "BasicGuider", model=model, conditioning=condition)
    noise = add("8", "RandomNoise", noise_seed=config["seed"])
    sampler = add("9", "KSamplerSelect", sampler_name=config["sampler"])
    sigmas = add("10", "ManualSigmas", sigmas=config["sigmas"])
    samples = add("11", "SamplerCustomAdvanced", noise=noise, guider=guider, sampler=sampler,
                  sigmas=sigmas, latent_image=["6", 1])
    decoded = add("12", "VAEDecode", samples=samples, vae=vae)
    add("90", "PH3ImageToolResult", images=decoded, job_id=job["id"])
    return graph


def capture_images(store, job_id, images):
    job = store.job(job_id)
    request = job["request"]
    if request["mode"] == "enhance":
        raise ToolError("JOB_KIND", "Image result cannot finish a text request")
    x, y, width, height = request["region"]
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
            patch.putalpha(mask)
        if request['mode'] == 'manga':
            patch.putalpha(store.image(request['source_asset']).getchannel('A'))
            generated = store.put_image(patch)['asset']
            result = store_finish(store, patch, request['manga_settings'], generated)
        else:
            result = store.put_image(patch)
        result.update(raw_asset=raw, x=x, y=y, w=width, h=height)
        results.append(result)
    return store.finish_job(job_id, results=results)
