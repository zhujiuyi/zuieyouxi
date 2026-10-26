"""Extract illustrations from the user's seven photos, preserving the original artwork."""
from pathlib import Path
from PIL import Image, ImageOps, ImageEnhance
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public' / 'assets'
OUT.mkdir(parents=True, exist_ok=True)
# Coordinates refer to the EXIF-corrected photograph, normalized to 1368 x 1824.
# Each quadrilateral isolates the illustrated panel, without the photographed rules text.
PANELS = {
    'pride': (4, [(919, 884), (1209, 898), (1201, 1098), (916, 1091)]),
    'wrath': (4, [(911, 1388), (1203, 1417), (1189, 1572), (907, 1550)]),
    'corruption': (4, [(923, 348), (1215, 343), (1208, 561), (922, 560)]),
    'gluttony': (5, [(907, 182), (1156, 211), (1140, 403), (889, 372)]),
    'envy': (5, [(880, 737), (1153, 755), (1151, 954), (874, 938)]),
    'sloth': (5, [(877, 1338), (1164, 1337), (1158, 1543), (875, 1549)]),
    'lust': (6, [(924, 386), (1194, 335), (1219, 529), (950, 574)]),
    'greed': (6, [(942, 897), (1220, 880), (1228, 1062), (954, 1087)]),
    'purity': (7, [(953, 268), (1141, 272), (1146, 410), (954, 410)]),
    'halo': (7, [(994, 566), (1197, 568), (1201, 712), (997, 716)])
}
manifest = {}
for name, (page, points) in PANELS.items():
    im = ImageOps.exif_transpose(Image.open(ROOT / 'image' / f'{page}.jpg')).convert('RGB')
    sx, sy = im.width / 1368, im.height / 1824
    # Pillow QUAD requires upper-left, lower-left, lower-right, upper-right.
    q = [points[i] for i in [0, 3, 2, 1]]
    data = tuple(v for x, y in q for v in (x * sx, y * sy))
    art = im.transform((600, 440), Image.Transform.QUAD, data, Image.Resampling.BICUBIC)
    art = ImageEnhance.Color(art).enhance(1.12)
    art = ImageEnhance.Contrast(art).enhance(1.06)
    art.save(OUT / f'{name}.webp', quality=92, method=6)
    manifest[name] = {'source': f'image/{page}.jpg', 'quad': points, 'size': [600, 440]}
    # Reference thumbnails for the in-game rules gallery.
for page in range(1, 8):
    im = ImageOps.exif_transpose(Image.open(ROOT / 'image' / f'{page}.jpg')).convert('RGB')
    im.thumbnail((1200, 1600))
    im.save(OUT / f'rules-{page}.webp', quality=84, method=6)
(ROOT / 'docs' / 'asset-sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print('Extracted 10 illustration panels and 7 rule-page images.')
