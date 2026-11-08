# Adapted reference functions from ashukae/ComfyUI-MangaScreen
# Commit: 04c6867f8672d2de82c249076d8155f499e9aeb2
# Copyright (c) 2026 ashukae. MIT; see MANGASCREEN_LICENSE.txt.
"""Manga Finish: turns an illustration (or an AI "make it manga" edit) into a clean black-and-white
manga page. Keeps the drawing (lines, hatching, where it is dark), throws away every dot or soft grey
the image already has, pushes the values into a few flat regions and prints them with a real screen.

Manga Levels: grayscale + levels, the light path when no edit model is used.

Manga Panel: frames the finished page as a panel (crop, border, margin) with a light paper/ink look.
"""
import cv2
import numpy as np

ANGLE = 45.0


def print_screen(cover, pitch):
    """Page-aligned AM dots for a coverage map, rendered 3x supersampled so dots are round."""
    h, w = cover.shape
    s = 3
    y, x = np.mgrid[0:h * s, 0:w * s].astype(np.float32)
    a = np.deg2rad(ANGLE)
    u = (x * np.cos(a) + y * np.sin(a)) / (pitch * s)
    v = (-x * np.sin(a) + y * np.cos(a)) / (pitch * s)
    spot = 1 - (np.cos(2 * np.pi * u) + np.cos(2 * np.pi * v) + 2) / 4
    c = cv2.resize(cover, (w * s, h * s), interpolation=cv2.INTER_LINEAR)
    return cv2.resize((spot < c).astype(np.float32), (w, h), interpolation=cv2.INTER_AREA) > 0.5


def ink_layer(L, k):
    """Lines and solid blacks as a crisp mask. k is the image scale relative to 1024 px width."""
    solid = cv2.GaussianBlur(L, (0, 0), 1.5 * k) < 0.22
    Lb = cv2.GaussianBlur(L, (0, 0), 0.7 * k)
    line = (Lb < cv2.blur(Lb, (int(15 * k) | 1,) * 2) - 0.07) & (Lb < 0.65)
    _, lab, st, _ = cv2.connectedComponentsWithStats(line.astype(np.uint8), connectivity=8)
    w, h, area = st[:, cv2.CC_STAT_WIDTH], st[:, cv2.CC_STAT_HEIGHT], st[:, cv2.CC_STAT_AREA]
    # a stroke is long and thin; a dot, or a clump of generated dots, is compact
    keep = (np.maximum(w, h) >= 10 * k) & (area >= 12 * k * k) & (area < 0.6 * w * h + 40 * k * k)
    keep |= area >= 400 * k * k
    keep[0] = False
    ink = solid | keep[lab]
    _, lab, st, _ = cv2.connectedComponentsWithStats(ink.astype(np.uint8), connectivity=8)
    big = st[:, cv2.CC_STAT_AREA] >= 6 * k * k
    big[0] = False
    return big[lab]


def value_map(L, ink, k):
    """Descreened value with the ink masked out (normalized convolution), so lines leave no dark
    halo for the screen to pick up, then edge-preserving flattening."""
    m = (~ink).astype(np.float32)
    s = 2.5 * k
    V = cv2.GaussianBlur(L * m, (0, 0), s) / np.maximum(cv2.GaussianBlur(m, (0, 0), s), 1e-3)
    for _ in range(2):
        V = cv2.bilateralFilter(V, int(9 * k) | 1, 0.10, 9 * k)
    return V


def tone_plan(V, k, white, split, black, min_region=600):
    """0 white, 1 light tone, 2 dark tone, 3 black. Regions under min_region px (at 1024 px width)
    melt into their surroundings, so every tone is a deliberate flat area."""
    level = cv2.medianBlur(np.digitize(-V, [-white, -split, -black]).astype(np.uint8), int(11 * k) | 1)
    for lv in (1, 2, 3, 0):
        _, lab, st, _ = cv2.connectedComponentsWithStats((level == lv).astype(np.uint8), connectivity=4)
        small = st[:, cv2.CC_STAT_AREA] < min_region * k * k
        small[0] = False
        hole = small[lab]
        if hole.any():
            fill = cv2.medianBlur(np.where(hole, 255, level).astype(np.uint8), int(21 * k) | 1)
            level = np.where(hole & (fill != 255), fill, level).astype(np.uint8)
    return level


def region_spread(level, V):
    """Standard deviation of V inside each flat region of the plan: a region that hides a gradient spreads wide."""
    out = np.zeros_like(V)
    for lv in range(4):
        n, lab = cv2.connectedComponents((level == lv).astype(np.uint8), connectivity=4)
        cnt = np.maximum(np.bincount(lab.ravel(), minlength=n), 1)
        mean = np.bincount(lab.ravel(), V.ravel(), minlength=n) / cnt
        std = np.sqrt(np.maximum(np.bincount(lab.ravel(), (V * V).ravel(), minlength=n) / cnt - mean * mean, 0))
        out = np.where(level == lv, std[lab], out)
    return out.astype(np.float32)


def white_cut(candidates, k):
    """The strokes worth keeping in white inside beta: long ones only, thinned, so a dark coat shows
    its main folds and seams instead of looking like an inverted line drawing."""
    _, lab, st, _ = cv2.connectedComponentsWithStats(candidates.astype(np.uint8), connectivity=8)
    keep = np.maximum(st[:, cv2.CC_STAT_WIDTH], st[:, cv2.CC_STAT_HEIGHT]) >= 40 * k
    keep[0] = False
    return cv2.erode(keep[lab].astype(np.uint8), np.ones((2 if k < 1.6 else 3,) * 2, np.uint8)) > 0


def finish(img, lines, white, black, light_tone, dark_tone, gradation, pen, pen_threshold, white_lines):
    """pen: line strength map (0..1) drawn on top, or None."""
    L = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
    k = L.shape[1] / 1024
    ink = ink_layer(L, k)
    strokes = ink & ~(cv2.GaussianBlur(L, (0, 0), 1.5 * k) < 0.22)      # lines without the solid masses
    if pen is not None:
        strokes |= pen > pen_threshold
    V = value_map(L, ink, k)
    level = tone_plan(V, k, white, (white + black) / 2, black)
    cover = np.take(np.float32((0.0, light_tone, dark_tone, 1.0)), level)
    if gradation:
        # gradation tone: where a flat region hides a ramp, the dot area follows the darkness instead
        Vs = cv2.GaussianBlur(V, (0, 0), 3 * k)
        a = cv2.GaussianBlur(np.clip((region_spread(level, Vs) - 0.03) / 0.05, 0, 1) * gradation, (0, 0), 4 * k)
        cover = cover * (1 - a) + np.clip((white - Vs) / (white - black), 0, 1) * a
    page = print_screen(cover, L.shape[1] / lines) | ink | strokes
    if white_lines:
        # black on black is invisible: inside beta the main strokes (folds, seams, zips) are cut out
        # in white, the way a dark coat is inked; the region is shrunk so its outline stays black
        beta = cv2.erode((level == 3).astype(np.uint8), np.ones((int(3 * k) | 1,) * 2, np.uint8)) > 0
        candidates = strokes if pen is None else pen > 1 - white_lines
        page = (page | beta) & ~(beta & white_cut(candidates, k))
    return ~page


