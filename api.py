"""HTTP editing/storage only. Diffusion is queued through ComfyUI's normal /prompt."""
from __future__ import annotations
import asyncio
from functools import wraps
import json
import logging
from pathlib import Path
from urllib.parse import urlsplit
from aiohttp import web
from .schema import ToolError, MAX_JSON_BYTES, default_document
from .storage import MAX_UPLOAD, MAX_ARCHIVE
from .generation import prepare_job
from .processing import comic, color_cutout, selection_cutout, isnet_cutout, COMIC_PRESETS
from .runtime import get_store, model_catalog
from . import lettering
from .exporting import encode_image
from .manga import available as manga_available, store_finish

BASE = "/ph3_image_tool"
log = logging.getLogger(__name__)


def same_origin(request):
    if request.method in {"POST", "PUT", "DELETE"}:
        origin = request.headers.get("Origin")
        if origin and urlsplit(origin).netloc != request.host:
            raise ToolError("CROSS_ORIGIN", "Cross-origin editing requests are refused", 403)
        if request.headers.get("Sec-Fetch-Site") == "cross-site":
            raise ToolError("CROSS_ORIGIN", "Cross-site editing requests are refused", 403)


def guarded(fn):
    @wraps(fn)
    async def handler(request):
        try:
            same_origin(request)
            return await fn(request)
        except ToolError as exc:
            return web.json_response({"error": {"code": exc.code, "message": str(exc)}}, status=exc.status)
        except web.HTTPException:
            raise
        except (KeyError, TypeError, json.JSONDecodeError) as exc:
            return web.json_response({"error": {"code": "INVALID_REQUEST", "message": "Invalid request fields or JSON"}}, status=400)
        except Exception:
            log.exception("PH3 Image Tool request failed")
            return web.json_response({"error": {"code": "INTERNAL_ERROR", "message": "Operation failed; existing project data was not intentionally changed. See the ComfyUI console."}}, status=500)
    return handler


async def json_body(request):
    if request.content_length and request.content_length > MAX_JSON_BYTES:
        raise ToolError("REQUEST_TOO_LARGE", "JSON exceeds 4 MiB", 413)
    pieces, size = [], 0
    async for block in request.content.iter_chunked(65536):
        size += len(block)
        if size > MAX_JSON_BYTES:
            raise ToolError("REQUEST_TOO_LARGE", "JSON exceeds 4 MiB", 413)
        pieces.append(block)
    raw = b"".join(pieces)
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ToolError("INVALID_REQUEST", "Expected a JSON object")
    return data


async def uploaded(request, limit):
    reader = await request.multipart()
    field = await reader.next()
    if field is None or not field.filename:
        raise ToolError("MISSING_FILE", "Upload one file")
    chunks, length = [], 0
    while True:
        block = await field.read_chunk(64 * 1024)
        if not block:
            break
        length += len(block)
        if length > limit:
            raise ToolError("UPLOAD_TOO_LARGE", "Upload exceeds its limit", 413)
        chunks.append(block)
    return b"".join(chunks)


def register_routes(routes, store_provider=get_store, catalog_provider=model_catalog, nodes_provider=None, cutout_model=None):
    if nodes_provider is None:
        def nodes_provider():
            import nodes
            return nodes.NODE_CLASS_MAPPINGS
    if cutout_model is None:
        def cutout_model():
            import folder_paths
            return Path(folder_paths.models_dir) / "rembg" / "isnet-general-use.onnx"

    @routes.get(BASE + "/fonts")
    @guarded
    async def fonts(request):
        from .font_catalog import public_fonts
        return web.json_response(await asyncio.to_thread(public_fonts))

    @routes.get(BASE + "/fonts/{font_id}")
    @guarded
    async def font_file(request):
        from .font_catalog import font_by_id
        font = await asyncio.to_thread(font_by_id, request.match_info['font_id'])
        if not font:
            raise web.HTTPNotFound()
        return web.FileResponse(font['path'])

    @routes.get(BASE + "/capabilities")
    @guarded
    async def capabilities(request):
        data = await asyncio.to_thread(catalog_provider)
        data.update(lettering_presets=[{k: p[k] for k in ("id", "ja", "en")} for p in lettering.PRESETS.values()],
                    lettering_styles=[{k: p[k] for k in ('id', 'ja', 'en')} for p in lettering.STYLES.values()],
                    lettering_decorations=[{k: p[k] for k in ('id', 'ja', 'en')} for p in lettering.DECORATIONS.values()],
                    lettering_finishing=True, preserved_lettering_bubbles=True, version="0.2.0-rc3+manga.1", comic_presets=list(COMIC_PRESETS), max_pixels=16_777_216, manga_available=manga_available())
        return web.json_response(data)

    @routes.post(BASE + "/lettering/preview")
    @guarded
    async def lettering_preview(request):
        opts = lettering.options(await json_body(request))
        return web.json_response({'prompt': lettering.prompt(opts), 'size': lettering.material_size(opts)})

    @routes.post(BASE + '/projects/{id}/lettering/finish')
    @guarded
    async def lettering_finish(request):
        payload = await json_body(request)
        return web.json_response(await asyncio.to_thread(lettering.refinish, store_provider(), request.match_info['id'], payload))

    @routes.get(BASE + "/projects")
    @guarded
    async def projects(request):
        return web.json_response(await asyncio.to_thread(store_provider().projects))

    @routes.post(BASE + "/projects")
    @guarded
    async def create(request):
        payload = await json_body(request)
        doc = payload.get("document") or default_document(payload.get("width", 1024), payload.get("height", 1024))
        return web.json_response(await asyncio.to_thread(store_provider().create, doc))

    @routes.get(BASE + "/projects/{id}")
    @guarded
    async def read(request):
        return web.json_response(await asyncio.to_thread(store_provider().read, request.match_info["id"]))

    @routes.put(BASE + "/projects/{id}")
    @guarded
    async def save(request):
        payload = await json_body(request)
        record = await asyncio.to_thread(store_provider().save, request.match_info["id"], payload["document"], payload["revision"])
        return web.json_response(record)

    @routes.post(BASE + "/assets")
    @guarded
    async def upload(request):
        raw = await uploaded(request, MAX_UPLOAD)
        return web.json_response(await asyncio.to_thread(store_provider().put_image, raw))

    @routes.get(BASE + "/assets/{id}")
    @guarded
    async def asset(request):
        path = store_provider()._path("assets", request.match_info["id"])
        if not path.is_file():
            raise ToolError("MISSING_ASSET", "Image not found", 404)
        return web.FileResponse(path, headers={"Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff"})

    @routes.get(BASE + "/projects/{id}/export")
    @guarded
    async def export(request):
        data = await asyncio.to_thread(store_provider().export, request.match_info["id"])
        return web.Response(body=data, content_type="application/zip", headers={"Content-Disposition": 'attachment; filename="project.ph3tool"'})

    @routes.post(BASE + "/import")
    @guarded
    async def import_project(request):
        raw = await uploaded(request, MAX_ARCHIVE)
        return web.json_response(await asyncio.to_thread(store_provider().import_archive, raw))

    @routes.post(BASE + "/projects/{id}/prepare")
    @guarded
    async def prepare(request):
        payload = await json_body(request)
        catalog = await asyncio.to_thread(catalog_provider)
        job, graph = await asyncio.to_thread(prepare_job, store_provider(), request.match_info["id"], payload, catalog, set(nodes_provider()))
        return web.json_response({"job": job, "prompt": graph})

    @routes.post(BASE + "/jobs/{id}/state")
    @guarded
    async def mark_job(request):
        payload = await json_body(request)
        return web.json_response(await asyncio.to_thread(store_provider().mark_job, request.match_info["id"], payload))

    @routes.get(BASE + "/jobs/{id}")
    @guarded
    async def job(request):
        return web.json_response(await asyncio.to_thread(store_provider().job, request.match_info["id"]))

    @routes.get(BASE + "/projects/{id}/jobs")
    @guarded
    async def jobs(request):
        return web.json_response(await asyncio.to_thread(store_provider().jobs, request.match_info["id"]))

    @routes.post(BASE + "/process")
    @guarded
    async def process(request):
        payload = await json_body(request)
        store = store_provider()
        def work():
            image = store.image(payload["asset"])
            action = payload.get("action")
            if action == "manga_finish":
                return store_finish(store, image, payload.get("settings"), payload["asset"])
            elif action == "comic":
                output = comic(image, payload.get("preset", "manga"), payload.get("strength", 1))
            elif action == "remove_background":
                method = payload.get("method", "color")
                if method == "color":
                    output = color_cutout(image, payload.get("tolerance", 32), payload.get("seed"), payload.get("regions"))
                elif method == "selection":
                    mask = store.image(payload["mask_asset"]).getchannel("R")
                    if payload.get('selection_action','keep') == 'remove':
                        from PIL import ImageOps
                        mask = ImageOps.invert(mask)
                    elif payload.get('selection_action','keep') != 'keep':
                        raise ToolError('INVALID_METHOD','Unknown selection action')
                    output = selection_cutout(image, mask)
                elif method == "isnet":
                    output = isnet_cutout(image, cutout_model())
                else:
                    raise ToolError("INVALID_METHOD", "Unknown cutout method")
            else:
                raise ToolError("INVALID_ACTION", "Unknown image action")
            return store.put_image(output)
        return web.json_response(await asyncio.to_thread(work))

    @routes.post(BASE + "/encode")
    @guarded
    async def encode(request):
        payload = await json_body(request)
        def work():
            return encode_image(store_provider().image(payload["asset"]), payload)
        data, content_type = await asyncio.to_thread(work)
        return web.Response(body=data, content_type=content_type, headers={
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
