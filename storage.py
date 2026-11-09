"""Local content-addressed assets, optimistic saves and portable archives."""
from __future__ import annotations
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import zipfile
from PIL import Image, ImageOps
from .schema import (ToolError, identifier, uid, dimensions, validate_document, asset_ids,
                     default_document, MAX_JSON_BYTES, MAX_PIXELS)

MAX_UPLOAD = 64 * 1024 * 1024
MAX_ARCHIVE = 256 * 1024 * 1024

class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.lock = threading.RLock()
        for name in ("assets", "projects", "jobs"):
            (self.root / name).mkdir(parents=True, exist_ok=True)

    def _path(self, collection, key):
        identifier(key, "asset" if collection == "assets" else collection)
        return self.root / collection / (key + (".png" if collection == "assets" else ".json"))

    def _write(self, path, payload):
        """Atomic replacement on the same filesystem; never mutates a prior asset."""
        fd, temp = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, path)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)

    def _json(self, path, value):
        self._write(path, json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2).encode("utf-8"))

    def _read(self, path):
        try:
            return json.loads(path.read_text("utf-8"))
        except FileNotFoundError as exc:
            raise ToolError("NOT_FOUND", "The requested local item does not exist", 404) from exc
        except (ValueError, OSError) as exc:
            raise ToolError("CORRUPT_STORAGE", "Cannot read stored data; the file was left unchanged", 409) from exc

    def image(self, key):
        path = self._path("assets", key)
        try:
            with Image.open(path) as image:
                dimensions(*image.size)
                return image.convert("RGBA")
        except FileNotFoundError as exc:
            raise ToolError("MISSING_ASSET", "A referenced image is missing", 404) from exc

    def put_image(self, value):
        if isinstance(value, bytes):
            if len(value) > MAX_UPLOAD:
                raise ToolError("IMAGE_TOO_LARGE", "Image upload exceeds 64 MiB", 413)
            try:
                with Image.open(io.BytesIO(value)) as raw:
                    dimensions(*raw.size)
                    if getattr(raw, "n_frames", 1) != 1:
                        raise ToolError("ANIMATED_IMAGE", "Import a still image, not an animation")
                    image = ImageOps.exif_transpose(raw).convert("RGBA")
            except ToolError:
                raise
            except (OSError, ValueError, Image.DecompressionBombError) as exc:
                raise ToolError("INVALID_IMAGE", "Cannot decode this image") from exc
        else:
            dimensions(*value.size)
            image = value.convert("RGBA")
        output = io.BytesIO()
        image.save(output, format="PNG", compress_level=4)
        data = output.getvalue()
        key = hashlib.sha256(data).hexdigest()
        path = self._path("assets", key)
        with self.lock:
            if not path.exists():
                self._write(path, data)
        return {"asset": key, "width": image.width, "height": image.height}

    def _check_assets(self, document):
        for key in asset_ids(document):
            if not self._path("assets", key).is_file():
                raise ToolError("MISSING_ASSET", f"Image {key[:12]} is missing")

    def create(self, document=None):
        doc = validate_document(document or default_document())
        self._check_assets(doc)
        with self.lock:
            key = uid()
            record = {"id": key, "revision": 0, "saved_at": time.time(), "document": doc}
            self._json(self._path("projects", key), record)
            return record

    def read(self, key):
        with self.lock:
            record = self._read(self._path("projects", key))
            validate_document(record["document"])
            return record

    def save(self, key, document, expected_revision):
        doc = validate_document(document)
        self._check_assets(doc)
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool):
            raise ToolError("INVALID_REVISION", "A revision integer is required")
        with self.lock:
            previous = self.read(key)
            if previous["revision"] != expected_revision:
                raise ToolError("SAVE_CONFLICT", "The project changed in another editor. Reopen it or save as a new project.", 409)
            record = {"id": key, "revision": expected_revision + 1, "saved_at": time.time(), "document": doc}
            self._json(self._path("projects", key), record)
            return record

    def projects(self):
        result = []
        with self.lock:
            for path in (self.root / "projects").glob("*.json"):
                try:
                    record = self._read(path)
                    result.append({"id": record["id"], "revision": record["revision"],
                                   "title": record["document"]["title"], "saved_at": record["saved_at"]})
                except (ToolError, KeyError):
                    continue
        return sorted(result, key=lambda row: row["saved_at"], reverse=True)

    def create_job(self, project_id, request):
        self.read(project_id)
        with self.lock:
            key = uid()
            job = {"id": key, "project_id": project_id, "created_at": time.time(),
                   "status": "prepared", "request": copy.deepcopy(request), "results": []}
            self._json(self._path("jobs", key), job)
            return job

    def job(self, key):
        with self.lock:
            return self._read(self._path("jobs", key))

    def mark_job(self, key, changes):
        with self.lock:
            job = self.job(key)
            if changes.get("only_if_unfinished") is True:
                if job["status"] not in {"prepared", "queued", "running"} or job.get("results") or job.get("text"):
                    return job
                if changes.get("expected_prompt_id") != job.get("prompt_id"):
                    return job
            if "prompt_id" in changes:
                value = changes["prompt_id"]
                if not isinstance(value, str) or not 1 <= len(value) <= 128 or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_." for c in value):
                    raise ToolError("INVALID_PROMPT_ID", "Invalid queued prompt identifier")
                job["prompt_id"] = value
            if "suppress_auto" in changes:
                job["suppress_auto"] = changes["suppress_auto"] is True
            if "cancel_requested" in changes:
                job["cancel_requested"] = changes["cancel_requested"] is True
            if job["status"] != "succeeded" and changes.get("status") in {"queued", "failed"}:
                job["status"] = changes["status"]
            if "error" in changes:
                job["error"] = str(changes["error"])[:4000]
            self._json(self._path("jobs", key), job)
            return job

    def finish_job(self, key, results=None, text=None):
        with self.lock:
            job = self.job(key)
            # A cached/retried capture cannot append the same candidate twice.
            job.update(status="succeeded", completed_at=time.time())
            if results is not None:
                job["results"] = results
            if text is not None:
                job["text"] = str(text)
            self._json(self._path("jobs", key), job)
            return job

    def jobs(self, project_id):
        self.read(project_id)
        result = []
        with self.lock:
            for path in (self.root / "jobs").glob("*.json"):
                try:
                    job = self._read(path)
                    if job.get("project_id") == project_id:
                        result.append(job)
                except ToolError:
                    continue
        return sorted(result, key=lambda item: item["created_at"], reverse=True)[:100]

    def export(self, key):
        record = self.read(key)
        self._check_assets(record["document"])
        output = io.BytesIO()
        total = 0
        with zipfile.ZipFile(output, "w", zipfile.ZIP_STORED) as archive:
            archive.writestr("project.json", json.dumps(record["document"], ensure_ascii=False))
            for asset in sorted(asset_ids(record["document"])):
                data = self._path("assets", asset).read_bytes()
                total += len(data)
                if total > MAX_ARCHIVE:
                    raise ToolError("ARCHIVE_TOO_LARGE", "Portable project exceeds 256 MiB")
                archive.writestr(f"assets/{asset}.png", data)
        return output.getvalue()

    def import_archive(self, data):
        if len(data) > MAX_ARCHIVE:
            raise ToolError("ARCHIVE_TOO_LARGE", "Portable project exceeds 256 MiB", 413)
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                names = [entry.filename for entry in entries]
                if len(entries) > 1024 or len(set(names)) != len(names):
                    raise ToolError("INVALID_ARCHIVE", "Too many or duplicate archive entries")
                if sum(entry.file_size for entry in entries) > MAX_ARCHIVE:
                    raise ToolError("ARCHIVE_TOO_LARGE", "Uncompressed project exceeds 256 MiB")
                if "project.json" not in names:
                    raise ToolError("INVALID_ARCHIVE", "Project metadata is missing")
                for entry in entries:
                    name = entry.filename
                    if name == "project.json":
                        if entry.file_size > MAX_JSON_BYTES:
                            raise ToolError("INVALID_ARCHIVE", "Project metadata exceeds the limit")
                    elif not (name.startswith("assets/") and name.endswith(".png") and len(name) == 75):
                        raise ToolError("INVALID_ARCHIVE", "Unexpected archive path")
                    else:
                        identifier(name[7:-4], "asset")
                        if entry.file_size > MAX_UPLOAD:
                            raise ToolError("INVALID_ARCHIVE", "An image exceeds the size limit")
                doc = validate_document(json.loads(archive.read("project.json")))
                needed = asset_ids(doc)
                verified = {}
                for asset in needed:
                    name = f"assets/{asset}.png"
                    if name not in names:
                        raise ToolError("MISSING_ASSET", "Project archive is missing an image")
                    raw = archive.read(name)
                    if hashlib.sha256(raw).hexdigest() != asset:
                        raise ToolError("ASSET_HASH_MISMATCH", "Project image checksum mismatch")
                    with Image.open(io.BytesIO(raw)) as image:
                        dimensions(*image.size)
                        image.load()
                    verified[asset] = raw
                with self.lock:
                    for asset, raw in verified.items():
                        path = self._path("assets", asset)
                        if not path.exists():
                            self._write(path, raw)
                    return self.create(doc)
        except ToolError:
            raise
        except (OSError, ValueError, KeyError, zipfile.BadZipFile, Image.DecompressionBombError) as exc:
            raise ToolError("INVALID_ARCHIVE", "Cannot read the portable project") from exc
