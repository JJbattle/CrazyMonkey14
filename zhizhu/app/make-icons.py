# 生成墩布纸牌 APP 图标：绿呢底 + 白色「墩」字。
# 跑法：python make-icons.py
from PIL import Image, ImageDraw, ImageFont
import os

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, 'android', 'app', 'src', 'main', 'res')

BG = (46, 125, 79)           # 绿呢 #2E7D4F，和游戏桌面一个色
FG = (255, 255, 255)         # 白字
FONTS = [r'C:\Windows\Fonts\msyhbd.ttc', r'C:\Windows\Fonts\msyh.ttc', r'C:\Windows\Fonts\simhei.ttf']
DENSITIES = [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]


def load_font(size):
    for f in FONTS:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except Exception:
                pass
    return ImageFont.load_default()


def draw_char(size, char='墩'):
    """透明底 + 居中白字"""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = load_font(int(size * 0.60))
    bb = d.textbbox((0, 0), char, font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((size - tw) / 2 - bb[0], (size - th) / 2 - bb[1]), char, font=f, fill=FG + (255,))
    return im


def draw_tile(size, char='墩'):
    """绿底圆角方块 + 居中白字（老式图标用）"""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=int(size * 0.22), fill=BG + (255,))
    f = load_font(int(size * 0.62))
    bb = d.textbbox((0, 0), char, font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((size - tw) / 2 - bb[0], (size - th) / 2 - bb[1]), char, font=f, fill=FG + (255,))
    return im


for name, scale in DENSITIES:
    d = os.path.join(RES, 'mipmap-' + name)
    if not os.path.isdir(d):
        continue

    # 自适应图标前景：透明画布 + 居中白字（背景色由 values/ic_launcher_background.xml 提供）
    fs = int(round(108 * scale))
    fg = Image.new('RGBA', (fs, fs), (0, 0, 0, 0))
    c = int(fs * 0.72)          # 内容留在 72% 的安全区里
    ch = draw_char(c)
    fg.paste(ch, ((fs - c) // 2, (fs - c) // 2), ch)
    fg.save(os.path.join(d, 'ic_launcher_foreground.png'))

    # 老式图标：整块绿底圆角 + 白字（圆的、方的各一份）
    s = int(round(48 * scale))
    ic = draw_tile(s)
    ic.save(os.path.join(d, 'ic_launcher.png'))
    ic.save(os.path.join(d, 'ic_launcher_round.png'))

    print('  %-10s 前景 %dpx / 图标 %dpx' % (name, fs, s))

print('图标生成完毕')
