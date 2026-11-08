from pathlib import Path
import importlib
import sys
import types

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "ph3tool_test_package"
if PACKAGE not in sys.modules:
    module = types.ModuleType(PACKAGE)
    module.__path__ = [str(ROOT)]
    sys.modules[PACKAGE] = module

def load(name):
    return importlib.import_module(PACKAGE + "." + name)

schema = load("schema")
storage = load("storage")
generation = load("generation")
processing = load("processing")

MODELS = {"diffusion_models": ["h3.safetensors"], "text_encoders": ["ph3.safetensors", "up.safetensors"],
          "vae": ["vae.safetensors"], "loras": ["ph3_lora.safetensors"], "samplers": ["er_sde", "euler"]}
NODE_NAMES = set(generation.CORE_NODES) | {"TextGenerateV2", "PH3ImageToolAsset", "PH3ImageToolResult", "PH3ImageToolTextResult"}

def document(w=128, h=96):
    doc = schema.default_document(w,h)
    doc["settings"].update(unet_name="h3.safetensors",clip_name="ph3.safetensors",vae_name="vae.safetensors",
                           lora_name="ph3_lora.safetensors",enhancer_name="up.safetensors",random_seed=False)
    doc["prompt"]["original"] = "Add a red apple on the palm."
    return doc
