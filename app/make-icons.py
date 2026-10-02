# 用家里那只猫的照片生成安卓 APP 图标。
# 源图：../tractor/assets/cat-joker.jpg（就是牌面上的那张猫）
# 跑法：python make-icons.py
from PIL import Image, ImageDraw
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'tractor', 'assets', 'cat-joker.jpg')
RES = os.path.join(HERE, 'android', 'app', 'src', 'main', 'res')

BG = (20, 83, 45, 255)          # 深绿，和牌桌一个色
# 各密度：mdpi / hdpi / xhdpi / xxhdpi / xxxhdpi
DENSITIES = [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]
# 自适应图标前景画布固定 108dp，内容要留在中间 66% 的安全区里
FOREGROUND_RATIO = 0.66


def face_crop(im):
    """把猫脸那块裁成正方形。原图是竖构图，脸偏左上。"""
    w, h = im.size
    # 脸大致在宽度 7%~73%、高度 8%~52% 的位置
    left, top = int(w * 0.05), int(h * 0.04)
    side = int(min(w * 0.72, h * 0.52))
    return im.crop((left, top, left + side, top + side))


def circle(im, size):
    """缩放成 size×size 的圆形贴图（四角透明），自带一圈浅边。"""
    im = im.resize((size, size), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * 4 - 1, size * 4 - 1), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    ring = ImageDraw.Draw(out)
    ring.ellipse((0, 0, size - 1, size - 1), outline=(255, 213, 74, 255), width=max(2, size // 32))
    return out


def rounded_square(im, size, radius_ratio=0.22):
    """整张照片做成圆角方块（老式图标用）"""
    im = im.resize((size, size), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1),
                                           radius=int(size * 4 * radius_ratio), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)
    return out


src = Image.open(SRC).convert('RGB')
face = face_crop(src)

for name, scale in DENSITIES:
    d = os.path.join(RES, 'mipmap-' + name)
    if not os.path.isdir(d):
        continue

    # 自适应图标的前景层：绿底 + 中间圆形猫脸
    fs = int(round(108 * scale))
    fg = Image.new('RGBA', (fs, fs), (0, 0, 0, 0))
    c = int(fs * FOREGROUND_RATIO)
    fg.paste(circle(face, c), ((fs - c) // 2, (fs - c) // 2), circle(face, c))
    fg.save(os.path.join(d, 'ic_launcher_foreground.png'))

    # 老式图标：绿底 + 圆形猫脸（圆的、方的各来一份）
    s = int(round(48 * scale))
    base = Image.new('RGBA', (s, s), BG)
    circ = circle(face, int(s * 0.80))
    base.paste(circ, ((s - circ.width) // 2, (s - circ.height) // 2), circ)
    base.save(os.path.join(d, 'ic_launcher.png'))
    base.save(os.path.join(d, 'ic_launcher_round.png'))

    print('  %-10s 前景 %dpx / 图标 %dpx' % (name, fs, s))

print('图标生成完毕')
