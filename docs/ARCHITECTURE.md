# Architecture / implementation boundaries

## One document owner

The authoritative server record is `{id, revision, document}`. Document format is `ph3-image-tool`, version 1. It contains editable layers, settings, prompts, selection and references; images are SHA-256 asset references, not base64 payloads. A project write uses expected revision, a lock and temporary-file replacement. This is not a claim of fully transactional multi-file durability under all hardware failures.

The browser edits a draft. Save renders a native-resolution composite, uploads it as an asset, and writes the document with compare-and-swap. Node widgets retain only project ID/revision. Browser metadata drafts support recovery; server assets are retained without automatic garbage collection. `.ph3tool` exports referenced assets plus JSON with bounded import validation and no arbitrary archive extraction.

## P-H3 execution

1. Browser saves its document snapshot and uploads a flat image-only or explicit combined source.
2. Backend validates the project revision and installed node/model identifiers.
3. Selection mode computes a bounding crop with context, retains source and mask and builds a standard API graph.
4. Browser submits it to ComfyUI `/prompt`. HTTP routes never load a model or execute sampling.
5. Standard core loaders, PH3ImageConditioning, guider, sigma/sampler and decode nodes run in ComfyUI's normal queue.
6. The output node captures raw result PNG and a region-sized image/mask candidate.
7. Browser compares project identity, canvas revision and original input contract. An applicable result may be adopted as a new image layer; otherwise it stays in the candidate list.
8. Adoption is an edit, not an automatic persistent save. User saves/applies before normal downstream output.

The image graph uses `images.image_1` etc. Prompt enhancement is a separate `TextGenerateV2` graph using `images.image1` etc. Each uses its own result node and immutable job input record. Images are not fed as a target in new-image mode. Editing has at most seven additional references.

## Pixel and mask contract

Internal assets are normalized RGBA PNG. Generation input white-mattes transparent pixels. Selection is grayscale R-channel, white=regenerate. Candidate feathering is `original_mask * blurred_mask`, keeping all original zero-mask pixels at zero. Output mapping resizes the entire model frame to the recorded crop, without a second center crop. The actual model may change geometry; pixel alignment is a compositing contract, not a model-quality guarantee.

Image layers have placement/rotation/opacity and a separate local mask. Canvas selection can be mapped to image-local coordinates. Native output is rendered using the same browser canvas routines as the display, then read by the node; editable text is not separately re-rendered in Pillow, avoiding a second text engine with different metrics. Preview uses bounded resolution; native export uses full resolution.

The node exports RGB, opacity mask and selection. Opacity mask is not Comfy LoadImage's inverted transparency mask. Fonts remain installed client resources and are not embedded into project archives.

## Module map

| Module | Responsibility |
|---|---|
| `schema.py` | Bounded portable JSON, IDs and dimensions |
| `storage.py` | Immutable PNG assets, revisioned projects, job snapshots, archives |
| `generation.py` | Context crop, inward feather, standard API graphs, result capture |
| `processing.py` | CPU comic filters, connected color/selection cutout, optional local ISNet |
| `runtime.py` | Lazy ComfyUI folders/catalog integration |
| `nodes.py` | Editor input/output and internal asset/result wrappers |
| `exporting.py` | Validated Pillow PNG/WebP/JPEG encoding, alpha/matte behavior, no metadata copying |
| `web/viewport.mjs` | View-only zoom/pan/rotation and anchor-preserving resize geometry |
| `web/graphics.mjs` | Inline icons and true renderer-based preset/layer thumbnails |
| `web/comic-engine.mjs` / `web/edge-refine.mjs` | MIT source image algorithms in cancellable workers |
| `web/processing-ui.mjs` | Before/after UI, reduced preview, native-source apply and stale-target protection |
| `api.py` | Bounded HTTP operations and same-origin write check |
| `web/core.mjs` | Document operations, metadata history, transforms and candidate checks |
| `web/selection.mjs` | Selection-only primitives adapted from author's MIT editor |
| `web/render.mjs` | Object/image/mask rendering and original-size export |
| `web/studio.mjs` | Single editor UI and lifecycle |
| `web/extension.js` | Node button, actual upstream image capture and revision-aware apply |

## View and processing invariants (rc3)

View zoom/pan/angle are not part of saved document geometry and never rotate exported pixels. Pointer coordinates pass through the inverse view transform before selection/hit testing. Layer rotation is a separate document operation. Editing gestures form one history entry; viewport changes do not.

Processing starts from the immutable source at its native resolution, with its current local mask. Preview is reduced to at most 640 pixels on its long edge; pixel-dependent details can differ at full resolution. Apply retains placement, rotation, opacity and the hidden source layer and adds a new immutable PNG asset. Closing cancels worker computation and invalidates responses. The color-picker maps object-fit letterboxing before computing its source pixel.

Export renders a native transparent composition, then applies selected transparency/matte policy and PNG/WebP/JPEG encoding in the existing Pillow runtime. The modal shows an actual encoded blob and byte count; the download uses exactly that blob. This does not modify node output metadata or downstream SaveWebPMeta settings.

## Deliberate exclusions and remaining engineering limits

No separate paint/retouch application, general PSD engine, comic-page model, remote generation provider, automatic model manager, or global host monkey patch. Single-user local storage only. Eight-bit sRGB-oriented browser editing, without complete color-management or HDR pipeline. Legacy `.sbeproj` files are not silently converted. Procedural/text preset library is intentionally smaller than legacy raster catalogues.

Model state stays under ComfyUI; the tool does not promise model residency, acceleration backend support or VRAM bounds. Candidate/asset storage currently grows until the user manually backs up and manages it. Actual ComfyUI execution and model inference remain acceptance gates.
