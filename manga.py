"""Layered MangaScreen finishing. CPU only; no model/dependency downloads.

The original ashukae functions are retained in manga_reference.py (MIT).
Analysis runs at final canvas size; the screen uses one canvas origin. Each
pixel belongs to exactly one output layer, preserving even partial alpha.
"""
from __future__ import annotations
import importlib.util
import threading
import numpy as np
from PIL import Image
from .schema import ToolError, number, dimensions

LOCK = threading.Lock()
DEFAULTS = dict(screen_lines=200, white_point=.80, black_point=.30,
                light_tone=.18, dark_tone=.42, gradation=1., white_lines=.4)
MANGA_PROMPT = (
    'Edit <Picture 1>. Redraw this image as a black-and-white manga illustration. '
    'Preserve the composition, pose, character identity, face, expression and objects. '
    'Use confident ink contours with varied line weight. Keep skin and light clothing white; '
    'use solid black for dark clothing, dark hair and deep shadows, retaining important folds '
    'as thin white lines. Organize midtones into clean flat gray regions. '
    'Leave screentone dots for subsequent printing: no dot patterns, no paper texture, '
    'no color, no added text, no speech bubbles or new objects.'
)

def available():
    return importlib.util.find_spec('cv2') is not None

def options(value=None):
    if value is None: value = {}
    if not isinstance(value, dict): raise ToolError('INVALID_MANGA', 'Invalid manga settings')
    result = {**DEFAULTS, **{k:v for k,v in value.items() if k in DEFAULTS}}
    for k,v in result.items():
        number(v, 40 if k=='screen_lines' else 0, 600 if k=='screen_lines' else 1, k, k=='screen_lines')
    if result['white_point'] - result['black_point'] < .05:
        raise ToolError('INVALID_MANGA', 'White point must exceed black point by at least 0.05')
    if result['light_tone'] > result['dark_tone']:
        raise ToolError('INVALID_MANGA', 'Light tone must not exceed dark tone')
    return result

def screen(cover, pitch, cv2, rows=96):
    """Same 3x AM screen as upstream, in strips with global phase and interpolation halo."""
    h,w = cover.shape
    result = np.empty((h,w), bool)
    a = np.deg2rad(45.0)
    for top in range(0,h,rows):
        end=min(h,top+rows)
        lo,hi=max(0,top-1),min(h,end+1)
        c=cv2.resize(cover[lo:hi],(w*3,(hi-lo)*3),interpolation=cv2.INTER_LINEAR)[(top-lo)*3:(end-lo)*3]
        y,x=np.mgrid[top*3:end*3,0:w*3].astype(np.float32)
        u=(x*np.cos(a)+y*np.sin(a))/(pitch*3)
        v=(-x*np.sin(a)+y*np.cos(a))/(pitch*3)
        spot=1-(np.cos(2*np.pi*u)+np.cos(2*np.pi*v)+2)/4
        result[top:end]=cv2.resize((spot<c).astype(np.float32),(w,end-top),interpolation=cv2.INTER_AREA)>.5
    return result

def finish_layers(image, settings=None):
    p=options(settings)
    dimensions(*image.size)
    if not available(): raise ToolError('MANGA_UNAVAILABLE','MangaScreen finishing requires an existing OpenCV installation; nothing was installed.',409)
    import cv2
    from . import manga_reference as ref
    with LOCK:
        rgba=np.asarray(image.convert('RGBA'))
        alpha=rgba[...,3]
        # Invisible RGB must never contaminate edge/region analysis.
        rgb=rgba[...,:3].copy();rgb[alpha==0]=255
        L=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY).astype(np.float32)/255
        k=max(L.shape[1]/1024, .125)
        ink=ref.ink_layer(L,k)
        strokes=ink & ~(cv2.GaussianBlur(L,(0,0),1.5*k)<.22)
        V=ref.value_map(L,ink,k)
        level=ref.tone_plan(V,k,p['white_point'],(p['white_point']+p['black_point'])/2,p['black_point'])
        cover=np.take(np.float32((0,p['light_tone'],p['dark_tone'],1)),level)
        if p['gradation']:
            Vs=cv2.GaussianBlur(V,(0,0),3*k)
            a=cv2.GaussianBlur(np.clip((ref.region_spread(level,Vs)-.03)/.05,0,1)*p['gradation'],(0,0),4*k)
            cover=cover*(1-a)+np.clip((p['white_point']-Vs)/(p['white_point']-p['black_point']),0,1)*a
        # At least 5 pixels per dot; avoid aliased screens on small canvases.
        lines=min(p['screen_lines'],max(1,L.shape[1]/5))
        dots=screen(cover,L.shape[1]/lines,cv2)
        cuts=np.zeros_like(ink)
        if p['white_lines']:
            beta=cv2.erode((level==3).astype(np.uint8),np.ones((int(3*k)|1,)*2,np.uint8))>0
            # Without an external pen map upstream uses detected structural strokes.
            cuts=beta & ref.white_cut(strokes,k)
            ink=ink | beta
        black=(dots|ink)&~cuts
        masks={'paper':~black & ~cuts,'tone':dots & ~ink & ~cuts,'ink':ink & ~cuts,'white':cuts}
        layers={}
        for role,mask in masks.items():
            pixels=np.empty_like(rgba);pixels[...,:3]=255 if role in ('paper','white') else 0
            pixels[...,3]=np.where(mask,alpha,0)
            layers[role]=Image.fromarray(pixels,'RGBA')
        flat=Image.new('RGBA',image.size)
        for layer in layers.values(): flat=Image.alpha_composite(flat,layer)
        return layers,flat,{**p,'effective_screen_lines':lines}

def store_finish(store, image, settings=None, source_asset=None):
    layers,flat,p=finish_layers(image,settings)
    return {**store.put_image(flat),'layers':[{'role':role,**store.put_image(img)} for role,img in layers.items()],
            'source_asset':source_asset,'settings':p,'has_alpha':flat.getchannel('A').getextrema()[0]<255}
