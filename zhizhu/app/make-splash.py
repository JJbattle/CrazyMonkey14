# 生成启动画面：绿呢底 + 「墩布纸牌」+ 副标题，替换 Capacitor 默认图。
# 跑法：python make-splash.py
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, glob

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, 'android', 'app', 'src', 'main', 'res')

FONTS = [r'C:\Windows\Fonts\msyhbd.ttc', r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf']


def load_font(size):
    for f in FONTS:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except Exception:
                pass
    return ImageFont.load_default()


def make(w, h, out_path):
    # 绿呢底 + 中间偏上一点更亮的绿光晕
    img = Image.new('RGB', (w, h), (37, 106, 65))
    glow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(glow).ellipse((w * 0.10, -h * 0.45, w * 0.90, h * 0.85), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(h * 0.15))
    img.paste(Image.new('RGB', (w, h), (46, 125, 79)), (0, 0), glow)

    d = ImageDraw.Draw(img)

    # 装饰：三张倾斜的小牌角（红/黑/红，点出扑克的感觉）
    cy = int(h * 0.24)
    for i, col in enumerate([(224, 91, 58), (255, 255, 255), (224, 91, 58)]):
        cx = int(w * (0.40 + i * 0.10))
        r = int(h * 0.030)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=col)

    txt = '墩布纸牌'
    f = load_font(int(h * 0.15))
    bb = d.textbbox((0, 0), txt, font=f)
    d.text((w / 2 - (bb[2] - bb[0]) / 2 - bb[0], int(h * 0.36)), txt, font=f, fill=(255, 255, 255))

    sub = '字大 · 牌大 · 不催人'
    fs = load_font(int(h * 0.065))
    bs = d.textbbox((0, 0), sub, font=fs)
    d.text((w / 2 - (bs[2] - bs[0]) / 2 - bs[0], int(h * 0.62)), sub, font=fs, fill=(210, 235, 222))

    img.save(out_path)
    return (w, h)


n = 0
for p in sorted(glob.glob(os.path.join(RES, 'drawable*', 'splash.png'))):
    with Image.open(p) as old:
        size = old.size
    make(size[0], size[1], p)
    n += 1
    print('  %-40s %s' % (os.path.relpath(p, RES), size))

print('启动画面生成完毕，共 %d 张' % n)
