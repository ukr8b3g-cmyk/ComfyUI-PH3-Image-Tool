"""Standalone effect lettering: prompt presets and deterministic raster finishing."""
from __future__ import annotations
import copy
import json
import re
import unicodedata
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageOps, ImageFilter
from .schema import ToolError, number

DATA = json.loads((Path(__file__).parent / 'web' / 'lettering-presets.json').read_text(encoding='utf-8'))
PRESETS = {item['id']: item for item in DATA['presets']}
STYLES = {item['id']: item for item in DATA['styles']}
DECORATIONS = {item['id']: item for item in DATA['decorations']}
LEGACY = {'round': ('pop', 'none'), 'thin': ('thin', 'none'),
          **{key: ('angular', key) for key in ('spiky', 'thought', 'vibration', 'wavy')}}


def options(value):
    if not isinstance(value, dict):
        raise ToolError('INVALID_LETTERING', 'Invalid lettering options')
    text = value.get('text', '')
    if not isinstance(text, str) or not text.strip() or len(text) > 128:
        raise ToolError('INVALID_LETTERING', 'Enter 1–128 characters for effect lettering')
    preset = value.get('preset', 'angular')
    if not isinstance(preset, str) or preset not in PRESETS:
        raise ToolError('INVALID_LETTERING', 'Unknown effect lettering preset')
    result = dict(text=text.strip(), preset=preset)
    style, decoration = LEGACY.get(preset, (preset, 'none'))
    for key, default, choices in [('style', style, STYLES), ('decoration', decoration, DECORATIONS),
                                  ('color_mode', 'black', ('black', 'solid', 'gradient')),
                                  ('gradient_direction', 'vertical', ('horizontal', 'vertical', 'diagonal'))]:
        result[key] = value.get(key, default)
        if not isinstance(result[key], str) or result[key] not in choices:
            raise ToolError('INVALID_LETTERING', f'Unknown lettering {key}')
    for key, default in [('color', '#ff2020'), ('gradient_end', '#ff9c00')]:
        result[key] = value.get(key, default)
        if not isinstance(result[key], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', result[key]):
            raise ToolError('INVALID_LETTERING', f'Invalid lettering {key}')
    result['tremble_strength'] = number(value.get('tremble_strength', .75), 0, 1, 'tremble_strength')
    for key, default in [('vertical', False), ('use_reference', False), ('transparent', True)]:
        result[key] = value.get(key, default)
        if not isinstance(result[key], bool):
            raise ToolError('INVALID_LETTERING', f'{key} must be boolean')
    kind = value.get('reference_kind', 'text')
    if not isinstance(kind, str) or kind not in {'text', 'layer', 'candidate'}:
        raise ToolError('INVALID_LETTERING', 'Unknown reference source')
    result['reference_kind'] = kind
    return result


def vertical_units(text):
    chars = []
    for char in text:
        if char.isspace():
            continue
        if unicodedata.category(char).startswith('M') and chars:
            chars[-1] += char
        else:
            chars.append(char)
    match = re.search(r'[!！?？]{2,}$', ''.join(chars))
    if match:
        count = len(match.group())
        chars = chars[:-count] + [match.group()]
    return chars


def prompt(opts):
    if opts['vertical']:
        units = vertical_units(opts['text'])
        layout = DATA['vertical'].replace('{units}', json.dumps(units, ensure_ascii=False, separators=(',', ':'))).replace('{rows}', str(len(units)))
        ending = re.search(r'[!！?？]+$', opts['text'])
        if ending:
            marks = ending.group(); exclamations = sum(c in '!！' for c in marks); questions = sum(c in '?？' for c in marks)
            counts = []
            if exclamations: counts.append(f'{exclamations} exclamation mark(s)')
            if questions: counts.append(f'{questions} question mark(s)')
            layout += '\nEXACT FINAL-ROW COUNT: Render exactly ' + ' and '.join(counts) + f', {len(marks)} punctuation symbols in total. '
            if exclamations == 2 and questions == 0:
                layout += 'Draw a locked pair of two (2) upright exclamation marks on one shared baseline: a left mark and a right mark, each with one upper stem and one separate dot directly below it. There are exactly two stems and exactly two dots. '
            layout += 'The punctuation count is fixed. Do not repeat a symbol for emphasis; artistic tilt and motion must not add marks or dots.'
    else:
        layout = DATA['horizontal']
    # Style and decoration are independent: no contradictory "no bubble" clause.
    if opts['use_reference'] and opts['reference_kind'] == 'candidate' and opts['decoration'] != 'none':
        # A decoration pass edits existing glyphs. Repeating the T2I design
        # instructions can drown out the requested bubble and redraw the text.
        return DATA['candidate_template'].format(text=json.dumps(opts['text'], ensure_ascii=False),
                                                layout=layout, style=DECORATIONS[opts['decoration']]['style'])
    style = STYLES[opts['style']]['style'] + '\n' + DECORATIONS[opts['decoration']]['style']
    reference = DATA['reference_on' if opts['use_reference'] else 'reference_off']
    result = DATA['template'].format(text=json.dumps(opts['text'], ensure_ascii=False), reference=reference, layout=layout, style=style)
    if opts['style'] == 'pop' and not opts['use_reference'] and '\u3099' in unicodedata.normalize('NFD', opts['text']):
        result = DATA['dakuten_priority'] + '\n' + result
    return result


def material_size(opts):
    return (768, 1280) if opts['vertical'] else (1280, 768)


def parent_layer(doc, job, index):
    item = job['results'][index]
    return copy.deepcopy(next((layer for layer in doc['layers']
        if layer['type'] == 'image' and not layer.get('locked') and layer.get('asset') == item['asset']
        and layer.get('generation', {}).get('job_id') == job['id']
        and layer.get('generation', {}).get('result_index', 0) == index), None))


def request(store, record, payload, config, generation_size):
    doc = record['document']; opts = options(payload.get('lettering', {}))
    target = None
    if payload.get('source_layer_id'):
        target = next((l for l in doc['layers'] if l['id'] == payload['source_layer_id'] and l['type'] == 'text' and not l.get('locked')), None)
        if target is None:
            raise ToolError('INVALID_LETTERING', 'Select an unlocked text layer')
    source = None; reference_layer = None; parent = None; index = None; adopted_parent = None
    if opts['use_reference']:
        if opts['reference_kind'] == 'text' and target is None:
            raise ToolError('INVALID_LETTERING', 'Text raster reference needs a source text layer')
        if opts['reference_kind'] == 'layer':
            reference_layer = next((l for l in doc['layers'] if l['id'] == payload.get('reference_layer_id') and l['type'] == 'image'), None)
            if reference_layer is None:
                raise ToolError('INVALID_LETTERING', 'Select an image layer for reference')
        if opts['reference_kind'] == 'candidate':
            job = store.job(payload.get('reference_job_id'))
            if job['project_id'] != record['id'] or job['status'] != 'succeeded' or not job.get('results'):
                raise ToolError('INVALID_LETTERING', 'Select a finished candidate from this project')
            index = int(number(payload.get('reference_index', 0), 0, len(job['results']) - 1, 'reference_index', integer=True))
            item = job['results'][index]; source = item.get('raw_asset') or item['asset']
            if item.get('preserved_lettering_asset'):
                source = item['preserved_lettering_asset'] if opts['decoration'] in {'spiky','thought'} else item['asset']
            parent = job['id']
            adopted_parent = parent_layer(doc, job, index)
            if target is None and job['request']['mode'] == 'lettering':
                target = copy.deepcopy(job['request'].get('source_layer'))
        else:
            source = payload.get('source_asset')
        store.image(source)  # Validate the immutable uploaded reference before creating a job.
    preserved = source if source and opts['reference_kind'] == 'candidate' and opts['decoration'] in {'spiky', 'thought'} else None
    instruction = bubble_prompt(opts) if preserved else prompt(opts); width, height = material_size(opts)
    placement_box=payload.get('placement_box')
    if placement_box is not None:
        if not isinstance(placement_box,list) or len(placement_box)!=4:raise ToolError('INVALID_LETTERING','Invalid lettering placement')
        x,y,w,h=placement_box
        number(x,0,doc['width'],'placement x');number(y,0,doc['height'],'placement y')
        number(w,1,doc['width'],'placement width');number(h,1,doc['height'],'placement height')
        if x+w>doc['width'] or y+h>doc['height']:raise ToolError('INVALID_LETTERING','Placement exceeds canvas')
    return dict(mode='lettering', canvas_revision=doc['canvas_revision'], document_revision=record['revision'],
                canvas=[doc['width'], doc['height']], region=[0, 0, width, height], generation_size=list(generation_size),
                source_asset=source, crop_asset=None if preserved else source, preserved_lettering_asset=preserved, mask_asset=None, references=[], lettering=opts,
                placement_box=placement_box, source_layer=copy.deepcopy(target), reference_layer=copy.deepcopy(reference_layer),
                prompt=instruction, instruction=instruction, prompt_source='lettering',
                original_prompt=doc['prompt']['original'], config=config,
                parent_job_id=parent, parent_result_index=index, parent_layer=adopted_parent)


def _ink_alpha(rgba):
    gray = np.asarray(rgba.convert('L'), dtype=np.float32)
    return np.clip((245 - gray) / 245, 0, 1)


def _tremble(mask, strength):
    """Smooth inverse warp: deterministic, no new strokes or punctuation."""
    if strength == 0:
        return mask
    h, w = mask.shape
    yy, xx = np.indices((h, w), dtype=np.float32)
    amplitude = min(9, min(w, h) * .009) * strength
    period = max(16, min(w, h) * .055)
    sx = xx + amplitude * np.sin(yy * (2 * np.pi / period))
    sy = yy + amplitude * .45 * np.sin(xx * (2 * np.pi / (period * 1.3)) + .7)
    x0, y0 = np.floor(sx).astype(np.int32), np.floor(sy).astype(np.int32)
    dx, dy = sx - x0, sy - y0
    def at(x, y):
        return mask[np.clip(y, 0, h-1), np.clip(x, 0, w-1)] * ((x >= 0) & (x < w) & (y >= 0) & (y < h))
    return (at(x0, y0) * (1-dx) * (1-dy) + at(x0+1, y0) * dx * (1-dy) +
            at(x0, y0+1) * (1-dx) * dy + at(x0+1, y0+1) * dx * dy).astype(np.float32)


def _paint(mask, opts):
    h, w = mask.shape
    def rgb(color):
        return np.array([int(color[i:i+2], 16) for i in (1, 3, 5)], dtype=np.float32)
    first = rgb('#000000' if opts['color_mode'] == 'black' else opts['color'])
    colors = np.broadcast_to(first, (h, w, 3)).copy()
    if opts['color_mode'] == 'gradient':
        ys, xs = np.where(mask > .01)
        if len(xs):
            yy, xx = np.indices((h, w), dtype=np.float32)
            x = np.clip((xx-xs.min())/max(1, int(xs.max()-xs.min())), 0, 1)
            y = np.clip((yy-ys.min())/max(1, int(ys.max()-ys.min())), 0, 1)
            t = {'horizontal': x, 'vertical': y, 'diagonal': (x+y)/2}[opts['gradient_direction']]
            colors = first + (rgb(opts['gradient_end'])-first) * t[..., None]
    return Image.fromarray(np.dstack((np.rint(colors).astype(np.uint8), np.rint(np.clip(mask, 0, 1)*255).astype(np.uint8))))


def finish(image, opts):
    opts = options(opts)  # Old saved requests acquire compatible defaults here too.
    rgba = image.convert('RGBA'); pixels = np.asarray(rgba)
    coverage = _ink_alpha(rgba)
    ink = (np.asarray(rgba.convert('L')) < 240) & (pixels[..., 3] > 0)
    clipped = bool(ink[0].any() or ink[-1].any() or ink[:, 0].any() or ink[:, -1].any())
    source_alpha = pixels[..., 3].astype(np.float32) / 255
    if opts['decoration'] in {'spiky', 'thought'}:
        eligible = np.min(pixels[..., :3], axis=-1) >= 245
        eligible |= pixels[..., 3] == 0
        flood = ImageOps.expand(Image.fromarray(np.where(eligible, 255, 0).astype(np.uint8)), 1, 255)
        ImageDraw.floodfill(flood, (0, 0), 128, thresh=0)
        outside = np.asarray(flood)[1:-1, 1:-1] == 128
        # Follow the complete connected rim, including a thick inner edge. A
        # distance band alone would accidentally paint that inner edge as text.
        rim_flood = ImageOps.expand(Image.fromarray(np.where(outside | (coverage > 0), 255, 0).astype(np.uint8)), 1, 255)
        ImageDraw.floodfill(rim_flood, (0, 0), 128, thresh=0)
        rim = (np.asarray(rim_flood)[1:-1, 1:-1] == 128) & (~outside)
        # Only exterior-facing ink gets a black, antialiased matte. Keep opaque
        # white inside the bubble, including white gaps immediately behind its rim.
        radius = max(2, min(12, round(min(rgba.size)*.008)))
        boundary = np.asarray(Image.fromarray(outside.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(2*radius+1))) > 0
        alpha = np.where(boundary & (coverage > 0), coverage, (~outside).astype(np.float32)) * source_alpha
        # Tiny enclosed white speckles at the exterior are not bubble fill.
        # Protect the broad white interior, then clear only such rim speckles.
        interior_white = Image.fromarray(np.where(eligible & (~outside), 255, 0).astype(np.uint8))
        cy, cx = np.where(np.asarray(interior_white.filter(ImageFilter.MinFilter(9))) == 255)
        if len(cx):
            ImageDraw.floodfill(interior_white, (int(cx[0]), int(cy[0])), 128, thresh=0)
            protected_white = np.asarray(interior_white) == 128
            alpha[boundary & (coverage == 0) & (~protected_white)] = 0
        face = np.full((*coverage.shape, 3), 255, dtype=np.uint8)
        gray_rgb = np.repeat(np.rint((1-coverage)*255).astype(np.uint8)[..., None], 3, axis=-1)
        face[rim] = gray_rgb[rim]
        face[boundary & rim] = 0
        rgba = Image.fromarray(np.dstack((face, np.rint(alpha*255).astype(np.uint8))))
        # The rim remains black; only isolated interior lettering is painted.
        lettering_mask = coverage * (~rim) * source_alpha
        rgba = Image.alpha_composite(rgba, _paint(lettering_mask, opts))
    else:
        mask = coverage * source_alpha
        if opts['decoration'] == 'wavy':
            mask = _tremble(mask, opts['tremble_strength'])
        rgba = _paint(mask, opts)
    if not opts['transparent']:
        rgba = Image.alpha_composite(Image.new('RGBA', rgba.size, 'white'), rgba)
    bounds = rgba.getchannel('A').getbbox()
    if bounds is None:
        raise ToolError('EMPTY_LETTERING', 'The generated lettering image is empty')
    pad = max(4, round(min(rgba.size) * .01)); x, y, right, bottom = bounds
    return rgba.crop((max(0, x-pad), max(0, y-pad), min(rgba.width, right+pad), min(rgba.height, bottom+pad))), clipped


def bubble_prompt(opts):
    shape = 'spiky speech bubble with sharp tips' if opts['decoration'] == 'spiky' else 'rounded thought cloud'
    return ('A SMALL centered icon of one empty '+shape+', occupying only 60 percent of the image width and height, with one uninterrupted, completely CLOSED black outline with no gaps or broken segments and a pure white interior. '
            'No letters, text, punctuation, symbols or objects anywhere. Leave a large empty central area. '
            'Leave at least 20 percent of the canvas completely blank on EVERY side. Use only a few short spikes. Do not enlarge the icon to fill the canvas. Black and white only.')


def compose_preserved_bubble(image, source, opts):
    """Keep source glyph pixels unchanged; only the bubble may be enlarged."""
    glyph_opts = dict(opts, decoration='none', preset='angular', transparent=True)
    glyph, _ = finish(source, glyph_opts)
    rgba = image.convert('RGBA'); pixels=np.asarray(rgba); coverage=_ink_alpha(rgba)
    eligible=np.min(pixels[...,:3],axis=-1)>=245
    flood=ImageOps.expand(Image.fromarray(eligible.astype(np.uint8)*255),1,255)
    ImageDraw.floodfill(flood,(0,0),128,thresh=0)
    outside=np.asarray(flood)[1:-1,1:-1]==128
    rimfill=ImageOps.expand(Image.fromarray(np.where(outside|(coverage>0),255,0).astype(np.uint8)),1,255)
    ImageDraw.floodfill(rimfill,(0,0),128,thresh=0)
    rim=(np.asarray(rimfill)[1:-1,1:-1]==128)&(~outside)
    interior=(~outside)&(~rim)
    if not interior.any():raise ToolError('OPEN_BUBBLE','Generated bubble is not closed; keep this result as a failed candidate')
    # Remove every AI mark inside the rim, including accidental lettering.
    clean=np.full_like(pixels,255);clean[rim,:3]=pixels[rim,:3]
    clean_image=Image.fromarray(clean)
    bubble, clipped=finish(clean_image,dict(opts,color_mode='black',transparent=True))
    if clipped:raise ToolError('CLIPPED_BUBBLE','Bubble tips touch the image edge; generate another candidate before compositing')
    # Work in cropped bubble coordinates; detect a clear centered text rectangle.
    a=np.asarray(bubble);white=(np.min(a[...,:3],axis=-1)>=245)&(a[...,3]==255)
    cx,cy=bubble.width//2,bubble.height//2
    safe=None
    for f in np.linspace(1,.03,160):
        w=max(1,int(glyph.width*f));h=max(1,int(glyph.height*f))
        x=cx-w//2;y=cy-h//2
        if x>=0 and y>=0 and x+w<=bubble.width and y+h<=bubble.height and white[y:y+h,x:x+w].all():safe=(w,h);break
    if safe is None:raise ToolError('BUBBLE_INTERIOR','No clear interior for the preserved lettering')
    scale=max(1,glyph.width/safe[0],glyph.height/safe[1])*1.15
    size=(int(bubble.width*scale+1),int(bubble.height*scale+1))
    if size[0]*size[1]>16777216:raise ToolError('BUBBLE_SIZE','Bubble composition exceeds image limit')
    bubble=bubble.resize(size,Image.Resampling.LANCZOS)
    x=(bubble.width-glyph.width)//2;y=(bubble.height-glyph.height)//2
    # White backing makes transparent source counters independent of AI pixels.
    ImageDraw.Draw(bubble).rectangle((x,y,x+glyph.width-1,y+glyph.height-1),fill='white')
    bubble.alpha_composite(glyph,(x,y))
    if not opts['transparent']:bubble=Image.alpha_composite(Image.new('RGBA',bubble.size,'white'),bubble)
    return bubble,clipped,dict(x=x,y=y,w=glyph.width,h=glyph.height)


def refinish(store, project_id, payload):
    """Preview/save a finish from immutable raw data, without model inference."""
    record = store.read(project_id); source = store.job(payload.get('reference_job_id'))
    if source['project_id'] != project_id or source['status'] != 'succeeded' or source['request']['mode'] != 'lettering' or not source.get('results'):
        raise ToolError('INVALID_LETTERING', 'Choose a finished lettering candidate from this project')
    index = int(number(payload.get('reference_index', 0), 0, len(source['results'])-1, 'reference_index', integer=True))
    previous = options(source['request']['lettering']); opts = options(payload.get('lettering', {}))
    for key in ('text', 'style', 'decoration', 'vertical'):
        if previous[key] != opts[key]:
            raise ToolError('INVALID_LETTERING', 'Generate changed text, layout or decorations with P-H3 first')
    save = payload.get('save', False)
    if not isinstance(save, bool):
        raise ToolError('INVALID_LETTERING', 'save must be boolean')
    if save and payload.get('revision') != record['revision']:
        raise ToolError('REVISION_CONFLICT', 'Project changed; reload before saving the finish', 409)
    item = source['results'][index]; raw = item.get('raw_asset') or item['asset']
    patch, clipped = finish(store.image(raw), opts)
    if source['request'].get('preserved_lettering_asset'):
        patch, clipped, glyph_rect = compose_preserved_bubble(store.image(raw), store.image(source['request']['preserved_lettering_asset']), opts)
    req = copy.deepcopy(source['request'])
    req.update(lettering=opts, canvas_revision=record['document']['canvas_revision'], document_revision=record['revision'],
               canvas=[record['document']['width'], record['document']['height']],
               parent_job_id=source['id'], parent_result_index=index, parent_layer=parent_layer(record['document'], source, index), finish_only=True)
    result = store.put_image(patch)
    result.update(raw_asset=raw, edge_clipped=clipped, **placement(req, patch.size))
    if req.get('preserved_lettering_asset'):
        result.update(preserved_lettering_asset=req['preserved_lettering_asset'], glyph_rect=glyph_rect)
    if save:
        job = store.create_job(project_id, req)
        return {'job': store.finish_job(job['id'], results=[result])}
    return result


def placement(req, size):
    if req.get('placement_box'):
        x,y,bw,bh=req['placement_box'];width,height=size;scale=min(bw/width,bh/height,1)
        w,h=width*scale,height*scale
        return dict(x=x+(bw-w)/2,y=y+(bh-h)/2,w=w,h=h)
    cw, ch = req['canvas']; layer = req.get('parent_layer') or req.get('source_layer'); vertical = req['lettering']['vertical']
    wanted = (layer['h'] if vertical else layer['w']) if layer else (ch if vertical else cw) * .5
    width, height = size
    scale = min(wanted / (height if vertical else width), cw*.9/width, ch*.9/height, 1)
    w, h = max(1, width*scale), max(1, height*scale)
    cx, cy = (layer['x']+layer['w']/2, layer['y']+layer['h']/2) if layer else (cw/2, ch/2)
    return dict(x=round(max(0, min(cw-w, cx-w/2)), 3), y=round(max(0, min(ch-h, cy-h/2)), 3), w=w, h=h)
