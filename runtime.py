"""Lazy ComfyUI environment access, kept out of pure modules/tests."""
from functools import lru_cache
from pathlib import Path
from .storage import Store

@lru_cache(maxsize=1)
def get_store():
    import folder_paths
    return Store(Path(folder_paths.get_user_directory()) / "default" / "ph3_image_tool")


def model_catalog():
    import folder_paths
    import nodes
    from comfy.samplers import KSampler
    from .generation import CORE_NODES
    from .processing import onnx_available
    result = {}
    for category in ("diffusion_models", "text_encoders", "vae", "loras"):
        try:
            result[category] = folder_paths.get_filename_list(category)
        except KeyError:
            result[category] = []
    result["samplers"] = list(KSampler.SAMPLERS)
    result["missing_nodes"] = [name for name in CORE_NODES if name not in nodes.NODE_CLASS_MAPPINGS]
    result["enhancer_available"] = "TextGenerateV2" in nodes.NODE_CLASS_MAPPINGS
    path = Path(folder_paths.models_dir) / "rembg" / "isnet-general-use.onnx"
    result["cutout"] = {"onnx_available": onnx_available(), "model_available": path.is_file(),
                         "model": "isnet-general-use.onnx", "network_downloads": False}
    result["storage"] = str(get_store().root)
    return result
