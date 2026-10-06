# 生成启动画面：深蓝底 + 「跳棋」+ 副标题，替换 Capacitor 默认图。
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
    # 深蓝底（和游戏菜单一个色）+ 中间偏上一点亮蓝色光晕
    img = Image.new('RGB', (w, h), (44, 62, 80))
    glow = Image.new('L', (w, h), 0)
    ImageDraw.Draw(glow).ellipse((w * 0.10, -h * 0.45, w * 0.90, h * 0.85), fill=70)
    glow = glow.filter(ImageFilter.GaussianBlur(h * 0.15))
    img.paste(Image.new('RGB', (w, h), (47, 111, 224)), (0, 0), glow)

    d = ImageDraw.Draw(img)

    # 装饰：三个彩色小圆点，点出「跳棋 = 玻璃珠」的感觉
    cy = int(h * 0.30)
    for i, col in enumerate([(255, 213, 74), (255, 255, 255), (120, 190, 255)]):
        cx = int(w * (0.42 + i * 0.08))
        r = int(h * 0.035)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=col)

    txt = '跳棋'
    f = load_font(int(h * 0.20))
    bb = d.textbbox((0, 0), txt, font=f)
    d.text((w / 2 - (bb[2] - bb[0]) / 2 - bb[0], int(h * 0.40)), txt, font=f, fill=(255, 255, 255))

    sub = '简单 · 字大 · 不催人'
    fs = load_font(int(h * 0.07))
    bs = d.textbbox((0, 0), sub, font=fs)
    d.text((w / 2 - (bs[2] - bs[0]) / 2 - bs[0], int(h * 0.70)), sub, font=fs, fill=(210, 222, 235))

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
