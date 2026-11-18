"""ComfyUI-PH3-Image-Tool. No installation, model download or GPU load at import."""
from .nodes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .api import register_routes
from .runtime import TOOL_VERSION as __version__
from server import PromptServer

WEB_DIRECTORY = "./web"
register_routes(PromptServer.instance.routes)
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
