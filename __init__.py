"""ComfyUI-PH3-Image-Tool. No installation, model download or GPU load at import."""
from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .api import register_routes
from server import PromptServer

WEB_DIRECTORY = "./web"
__version__ = "0.2.0-rc3+manga.1"
register_routes(PromptServer.instance.routes)
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
