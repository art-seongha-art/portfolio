#!/usr/bin/env python3
"""Rebuild the web textures for Moon from NASA source data.

Sources (public domain, NASA):
  CGI Moon Kit  https://svs.gsfc.nasa.gov/4720
    lroc_color_16bit_srgb_8k.tif, lroc_color_16bit_srgb_16k.tif  (LRO LROC WAC, 2025 colour)
    ldem_64_uint.tif  (LRO LOLA, 64 px/deg, uint16 half-metres + 20000 over R=1727.4 km)
  Visible Earth  world.topo.bathy.200408.3x5400x2700.jpg, cloud_combined_2048.jpg,
                 dnb_land_ocean_ice.2012.3600x1800.jpg
  HYG star database v4.1 (CC BY-SA 4.0)  hygdata_v41.csv
  NASA SVS Deep Star Maps 2020  https://svs.gsfc.nasa.gov/4851
    milkyway_2020_8k.exr  (diffuse Milky Way, equatorial plate carree)
  Terrain Tiles (Mapzen / AWS Open Data; SRTM over Korea), terrarium PNG tiles:
    zoom 12 over 35.00-35.58N 127.18-127.92E  ->  <source_dir>/terrain/t_12_<x>_<y>.png
    zoom  9 over 33.9-36.7N 125.9-129.2E      ->  <source_dir>/terrain/t_9_<x>_<y>.png
    https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png

Usage:
  pip install numpy pillow tifffile imagecodecs scipy OpenEXR
  python3 build_assets.py <source_dir> <out_dir>

Height maps are stored losslessly as 16-bit values split over R (high) and G (low)
bytes: metres = (R*256 + G) * 2 - 10000, relative to the 1737.4 km reference sphere.
"""
import csv
import json
import os
import sys

import numpy as np
import tifffile
from PIL import Image
from scipy.ndimage import map_coordinates

SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def src(name):
    return os.path.join(SRC, name)


def enc_height(hm, step=2.0, off=10000.0):
    v = np.clip(np.round((hm + off) / step), 0, 65535).astype(np.uint32)
    return np.stack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), np.zeros(v.shape, np.uint8)], -1)


def resize_f(a, w, h):
    return np.asarray(Image.fromarray(np.ascontiguousarray(a, dtype=np.float32), mode='F').resize((w, h), Image.BOX), dtype=np.float32)


def save_webp_lossless(rgb, name):
    Image.fromarray(rgb).save(os.path.join(OUT, name), 'WEBP', lossless=True, quality=100, method=6)


# ---------------------------------------------------------------- colour
c8 = tifffile.imread(src('lroc_color_16bit_srgb_8k.tif'))
c8 = np.clip(np.round(c8.astype(np.float32) / 257.0), 0, 255).astype(np.uint8)
im = Image.fromarray(c8)
im.save(os.path.join(OUT, 'moon_color_8k.webp'), 'WEBP', quality=90, method=6)
im.resize((4096, 2048), Image.LANCZOS).save(os.path.join(OUT, 'moon_color_4k.webp'), 'WEBP', quality=90, method=6)
im.resize((2048, 1024), Image.LANCZOS).save(os.path.join(OUT, 'moon_color_2k.jpg'), 'JPEG', quality=90, subsampling=0, optimize=True)
del c8, im

# ---------------------------------------------------------------- height (global)
d = tifffile.imread(src('ldem_64_uint.tif'))            # (11520, 23040)
h = d.astype(np.float32) / 2.0 - 10000.0                  # metres over 1737.4 km
del d
save_webp_lossless(enc_height(resize_f(h, 4096, 2048)), 'moon_height_4k.webp')
save_webp_lossless(enc_height(resize_f(h, 2048, 1024)), 'moon_height_2k.webp')

meta = {}
# ---------------------------------------------------------------- Copernicus patch (native 64 ppd)
lon0, lon1, lat0, lat1 = -32.0, -6.0, -2.0, 22.0
c0, c1 = int(round((lon0 + 180) * 64)), int(round((lon1 + 180) * 64))
r0, r1 = int(round((90 - lat1) * 64)), int(round((90 - lat0) * 64))
pc = np.array(h[r0:r1, c0:c1], dtype=np.float32)
save_webp_lossless(enc_height(pc), 'patch_copernicus_h.webp')
meta['copernicus'] = dict(type='equirect', lon0=lon0, lon1=lon1, lat0=lat0, lat1=lat1, w=pc.shape[1], h=pc.shape[0])
with tifffile.TiffFile(src('lroc_color_16bit_srgb_16k.tif')) as tf:
    full = tf.pages[0].asarray()
Wc, Hc = full.shape[1], full.shape[0]
cc0, cc1 = int(round((lon0 + 180) / 360 * Wc)), int(round((lon1 + 180) / 360 * Wc))
rr0, rr1 = int(round((90 - lat1) / 180 * Hc)), int(round((90 - lat0) / 180 * Hc))
cp = np.clip(np.round(full[rr0:rr1, cc0:cc1].astype(np.float32) / 257.0), 0, 255).astype(np.uint8)
Image.fromarray(cp).save(os.path.join(OUT, 'patch_copernicus_c.jpg'), 'JPEG', quality=92, subsampling=0, optimize=True)
meta['copernicus'].update(cw=cp.shape[1], ch=cp.shape[0])
del full

# ---------------------------------------------------------------- South pole patch (stereographic, 18° cap)
N = 2304
rho = float(np.tan(np.radians(18.0) / 2))
xs = (np.arange(N) + 0.5) / N * 2 - 1
X, Z = np.meshgrid(xs * rho, xs * rho)
s = X * X + Z * Z
px, pz, py = 2 * X / (1 + s), 2 * Z / (1 + s), (s - 1) / (1 + s)
lat = np.degrees(np.arcsin(np.clip(py, -1, 1)))
lon = np.degrees(np.arctan2(px, pz))
rows, cols = (90 - lat) * 64 - 0.5, (lon + 180) * 64 - 0.5
hp = map_coordinates(h, [rows.ravel(), cols.ravel()], order=1, mode='wrap').reshape(N, N).astype(np.float32)
save_webp_lossless(enc_height(hp), 'patch_southpole_h.webp')
meta['southpole'] = dict(type='polar_south', rho=rho, capDeg=18.0, w=N, h=N)
json.dump(meta, open(os.path.join(OUT, 'patches.json'), 'w'), indent=1)

# ---------------------------------------------------------------- Earth
day = Image.open(src('world.topo.bathy.200408.3x5400x2700.jpg')).convert('RGB').resize((2048, 1024), Image.LANCZOS)
day.save(os.path.join(OUT, 'earth_day_2k.jpg'), 'JPEG', quality=90, optimize=True)
clouds = Image.open(src('cloud_combined_2048.jpg')).convert('L').resize((2048, 1024), Image.LANCZOS)
night = Image.open(src('dnb_land_ocean_ice.2012.3600x1800.jpg')).convert('L').resize((2048, 1024), Image.LANCZOS)
Image.merge('RGB', (clouds, night, Image.new('L', (2048, 1024), 0))).save(
    os.path.join(OUT, 'earth_clouds_night_2k.jpg'), 'JPEG', quality=90, optimize=True)

# ---------------------------------------------------------------- stars (ra deg, dec deg, mag, B-V) sorted by magnitude
rows_ = []
with open(src('hygdata_v41.csv'), newline='') as f:
    for r in csv.DictReader(f):
        if r['proper'] == 'Sol':
            continue
        try:
            m = float(r['mag'])
        except ValueError:
            continue
        if m > 6.5:
            continue
        ci = float(r['ci']) if r['ci'] not in ('', None) else 0.6
        rows_.append((float(r['ra']) * 15.0, float(r['dec']), m, ci))
arr = np.array(sorted(rows_, key=lambda x: x[2]), dtype=np.float32)
arr.tofile(os.path.join(OUT, 'stars_hyg_m65.f32'))

# ---------------------------------------------------------------- Milky Way (sqrt-encoded, 1 = 0.14 of the EXR's scale)
import OpenEXR  # noqa: E402
ch = OpenEXR.File(src('milkyway_2020_8k.exr')).parts[0].channels
if 'RGB' in ch:
    mw = np.asarray(ch['RGB'].pixels, dtype=np.float32)
else:
    pick = lambda k: next(np.asarray(ch[n].pixels, dtype=np.float32) for n in ch if n.split('.')[-1] == k)
    mw = np.stack([pick('R'), pick('G'), pick('B')], -1)
mw = mw.reshape(2048, 2, 4096, 2, 3).mean(axis=(1, 3))
Image.fromarray((np.sqrt(np.clip(mw / 0.14, 0, 1)) * 255 + 0.5).astype(np.uint8)).save(
    os.path.join(OUT, 'milkyway_4k.jpg'), 'JPEG', quality=90, subsampling=0, optimize=True)

# ---------------------------------------------------------------- Jirisan terrain
# Azimuthal equidistant grid centred on Nogodan (x = east, y = north, metres), heights
# stored as metres / 16 in 16 bits over R (high) and G (low).
import glob  # noqa: E402
import math  # noqa: E402
LAT0, LON0, RE = 35.2946, 127.5311, 6371008.8


def mosaic(z):
    fs = glob.glob(src(f'terrain/t_{z}_*.png'))
    key = lambda f: os.path.basename(f)[:-4].split('_')
    xs = sorted({int(key(f)[2]) for f in fs})
    ys = sorted({int(key(f)[3]) for f in fs})
    H = np.zeros((len(ys) * 256, len(xs) * 256), np.float32)
    for i, y in enumerate(ys):
        for j, x in enumerate(xs):
            a = np.asarray(Image.open(src(f'terrain/t_{z}_{x}_{y}.png')).convert('RGB')).astype(np.float32)
            H[i * 256:(i + 1) * 256, j * 256:(j + 1) * 256] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    return H, xs[0], ys[0]


def terrain_grid(z, x0m, x1m, y0m, y1m, n):
    H, tx0, ty0 = mosaic(z)
    X, Y = np.meshgrid(x0m + (np.arange(n) + 0.5) / n * (x1m - x0m), y1m - (np.arange(n) + 0.5) / n * (y1m - y0m))
    rho = np.hypot(X, Y) + 1e-9
    c = rho / RE
    p0 = math.radians(LAT0)
    lat = np.arcsin(np.cos(c) * math.sin(p0) + Y * np.sin(c) * math.cos(p0) / rho)
    lon = math.radians(LON0) + np.arctan2(X * np.sin(c), rho * math.cos(p0) * np.cos(c) - Y * math.sin(p0) * np.sin(c))
    NP = 2 ** z * 256
    px = (np.degrees(lon) + 180) / 360 * NP - tx0 * 256 - 0.5
    py = (1 - np.log(np.tan(lat) + 1 / np.cos(lat)) / math.pi) / 2 * NP - ty0 * 256 - 0.5
    return map_coordinates(H, [py.ravel(), px.ravel()], order=1, mode='nearest').reshape(n, n)


def enc_terrain(h, step=0.0625):
    v = np.clip(np.round(np.maximum(h, 0.0) / step), 0, 65535).astype(np.uint32)
    return np.stack([(v >> 8).astype(np.uint8), (v & 255).astype(np.uint8), np.zeros(v.shape, np.uint8)], -1)


tmeta = dict(site=dict(name='Nogodan, Jirisan', lat=LAT0, lon=LON0),
             near=dict(x0=-24000, x1=32000, y0=-30000, y1=26000, n=2048, step=0.0625),
             far=dict(x0=-150000, x1=150000, y0=-150000, y1=150000, n=2048, step=0.0625))
for key, z in (('near', 12), ('far', 9)):
    m = tmeta[key]
    save_webp_lossless(enc_terrain(terrain_grid(z, m['x0'], m['x1'], m['y0'], m['y1'], m['n'])), f'terrain_{key}.webp')
json.dump(tmeta, open(os.path.join(OUT, 'terrain.json'), 'w'), indent=1)
print('done:', sorted(os.listdir(OUT)))
