# 生成启动画面：绿底 + 猫脸 + 「拖拉机」，替换 Capacitor 的默认图。
# 跑法：python make-splash.py
from PIL import Image, ImageDraw, ImageFont
import os, glob

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'tractor', 'assets', 'cat-joker.jpg')
RES = os.path.join(HERE, 'android', 'app', 'src', 'main', 'res')

# 中文字体：微软雅黑（Windows 自带）
FONTS = [r'C:\Windows\Fonts\msyhbd.ttc', r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf']


def load_font(size):
    for f in FONTS:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except Exception:
                pass
    return ImageFont.load_default()


def face_crop(im):
    w, h = im.size
    left, top = int(w * 0.05), int(h * 0.04)
    side = int(min(w * 0.72, h * 0.52))
    return im.crop((left, top, left + side, top + side))


def circle(im, size, ring=255):
    im = im.resize((size, size), Image.LANCZOS).convert('RGBA')
    m = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(m).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    m = m.resize((size, size), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    if ring:
        ImageDraw.Draw(out).ellipse((0, 0, size - 1, size - 1), outline=(255, 213, 74, 255),
                                    width=max(2, size // 28))
    return out


def make(w, h, out_path):
    # 深绿底 + 中间亮一点的径向光晕
    img = Image.new('RGB', (w, h), (20, 83, 45))
    glow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(glow).ellipse((w * 0.15, -h * 0.5, w * 0.85, h * 1.1), fill=70)
    glow = glow.filter(__import__('PIL.ImageFilter', fromlist=['ImageFilter']).GaussianBlur(h * 0.15))
    img.paste(Image.new('RGB', (w, h), (42, 122, 71)), (0, 0), glow)

    d = int(h * 0.42)                       # 猫脸直径按高度算，横竖屏都不会变形
    cx, cy = w // 2, int(h * 0.36)
    img.paste(circle(face, d), (cx - d // 2, cy - d // 2), circle(face, d))

    draw = ImageDraw.Draw(img)
    txt = '拖拉机'
    f = load_font(int(h * 0.17))
    bb = draw.textbbox((0, 0), txt, font=f)
    draw.text((w / 2 - (bb[2] - bb[0]) / 2 - bb[0], int(h * 0.62)), txt, font=f, fill=(255, 213, 74))

    sub = '升级 · 陪家里人打牌'
    fs = load_font(int(h * 0.062))
    bs = draw.textbbox((0, 0), sub, font=fs)
    draw.text((w / 2 - (bs[2] - bs[0]) / 2 - bs[0], int(h * 0.84)), sub, font=fs, fill=(255, 255, 255))

    img.save(out_path)
    return (w, h)


face = face_crop(Image.open(SRC).convert('RGB'))

n = 0
for p in sorted(glob.glob(os.path.join(RES, 'drawable*', 'splash.png'))):
    with Image.open(p) as old:
        size = old.size
    make(size[0], size[1], p)
    n += 1
    print('  %-40s %s' % (os.path.relpath(p, RES), size))
print('启动画面生成完毕，共 %d 张' % n)
