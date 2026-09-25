#!/usr/bin/env python3
"""The ranges seen before dawn in Moon: real Jirisan skylines, layer on layer.

From a viewpoint on the southern spur below Samsinbong the main ridge of Jirisan (Banyabong to
Cheonwangbong) lies across the view to the north. For every azimuth this finds, in each band of
distance, the highest point as seen from the eye (its elevation angle, with the Earth's curve
and standard refraction), and where it is. The shader draws each band as a silhouette at that
distance, nearest first, and lays the valley fog over their feet.

Reads the terrain textures already built into assets/ (terrain_near.webp, terrain_far.webp,
terrain.json) and writes assets/mist_ridges.bin and assets/mist_ridges.json.

Usage:
  pip install numpy pillow scipy
  python3 build_ridges.py [assets_dir]
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy.ndimage import uniform_filter1d

A = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'assets')
meta = json.load(open(os.path.join(A, 'terrain.json')))

VIEW = (15061.0, -3736.0)   # east, north (m from Nogodan): the top of the spur below Samsinbong
EYE_ABOVE = 2.0             # eye over the ground there (m)
NAZ = 4096                  # azimuths round the horizon
BANDS = [15, 600, 1500, 3500, 8000, 18000, 60000]   # edges of the distance bands (m)
EL_RANGE = 0.6              # elevation angles stored in [-EL_RANGE, EL_RANGE] (rad)
REFF = 7310000.0            # Earth radius stretched for standard refraction (as terrain.js)


def load(name, m):
    im = np.asarray(Image.open(os.path.join(A, name)).convert('RGBA')).astype(np.float64)
    return (im[:, :, 0] * 256 + im[:, :, 1]) * m['step']


near, far = load('terrain_near.webp', meta['near']), load('terrain_far.webp', meta['far'])


def bilinear(img, u, v):
    n = img.shape[0]
    u = np.clip(u, 0, n - 1.001)
    v = np.clip(v, 0, n - 1.001)
    i, j = np.floor(u).astype(np.int64), np.floor(v).astype(np.int64)
    fu, fv = u - i, v - j
    return (img[j, i] * (1 - fu) + img[j, i + 1] * fu) * (1 - fv) + (img[j + 1, i] * (1 - fu) + img[j + 1, i + 1] * fu) * fv


def height(e, n):
    def uv(m):
        return (e - m['x0']) / (m['x1'] - m['x0']) * m['n'] - 0.5, (m['y1'] - n) / (m['y1'] - m['y0']) * m['n'] - 0.5
    hn, hf = bilinear(near, *uv(meta['near'])), bilinear(far, *uv(meta['far']))
    mn = meta['near']
    edge = np.minimum.reduce([e - mn['x0'], mn['x1'] - e, n - mn['y0'], mn['y1'] - n])
    w = np.clip((edge - 1000.0) / 1000.0, 0, 1)      # the fine grid, blended out near its edge
    return hf * (1 - w) + hn * w


eye = float(height(np.array([VIEW[0]]), np.array([VIEW[1]]))[0]) + EYE_ABOVE
d = [BANDS[0]]
while d[-1] < BANDS[-1]:
    d.append(d[-1] * 1.003 + 2.0)
d = np.array(d)
nb = len(BANDS) - 1
el_out = np.zeros((nb, NAZ))
d_out = np.zeros((nb, NAZ))
az = np.arange(NAZ) / NAZ * 2 * np.pi               # from north, clockwise
for a0 in range(0, NAZ, 256):
    a = az[a0:a0 + 256]
    E = VIEW[0] + np.outer(np.sin(a), d)
    N = VIEW[1] + np.outer(np.cos(a), d)
    el = np.arctan2(height(E, N) - eye - d * d / (2 * REFF), d)
    for k in range(nb):
        m = (d >= BANDS[k]) & (d < BANDS[k + 1])
        sub = el[:, m]
        i = np.argmax(sub, axis=1)
        el_out[k, a0:a0 + 256] = sub[np.arange(len(a)), i]
        d_out[k, a0:a0 + 256] = d[m][i]
# where the highest point lies jumps about along a band: keep only its broad course (in log
# distance, over about 5 degrees, round the circle), so the fog on a range doesn't stripe
for k in range(nb):
    d_out[k] = np.exp(uniform_filter1d(uniform_filter1d(np.log(d_out[k]), size=41, mode='wrap'), size=41, mode='wrap'))

el_code = np.clip(np.round((el_out + EL_RANGE) / (2 * EL_RANGE) * 65535), 0, 65535).astype('<u2')
d_code = np.clip(np.round(d_out), 0, 65535).astype('<u2')
np.stack([el_code, d_code], -1).tofile(os.path.join(A, 'mist_ridges.bin'))   # [band][azimuth][el, dist]
json.dump({'view': VIEW, 'eye': round(eye, 1), 'naz': NAZ, 'bands': BANDS, 'elRange': EL_RANGE},
          open(os.path.join(A, 'mist_ridges.json'), 'w'), indent=1)
print('eye', round(eye, 1), 'm; highest crest per band (deg):', np.round(np.degrees(el_out.max(axis=1)), 2))
