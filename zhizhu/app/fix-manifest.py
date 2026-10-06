# 把 MainActivity 锁成横屏（sensorLandscape：两个方向都能横，不锁死单边）。
#
# 为什么要单独这一步：android/ 是 cap sync 生成的、不进 git，
# 一旦删掉 android/ 重新生成，手动改的 AndroidManifest.xml 就会丢。
# 所以把「锁横屏」做成一个幂等的小脚本，打包脚本在 cap sync 之后跑它，
# 无论 android/ 是不是全新的，都能保证锁屏存在。
import io
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
ATTR = 'android:screenOrientation="sensorLandscape"'

if not os.path.exists(MANIFEST):
    print('[错误] 找不到 ' + MANIFEST + '，请先跑 cap sync android')
    raise SystemExit(1)

s = io.open(MANIFEST, encoding='utf-8').read()

if ATTR in s:
    print('锁横屏：已是 sensorLandscape，无需修改')
else:
    # 在 .MainActivity 的 <activity ...> 开始标签末尾（> 之前）塞进锁屏属性。
    s2, n = re.subn(
        r'(<activity\b[^>]*android:name="\.MainActivity"[^>]*?)>',
        lambda m: (m.group(1) + ' ' + ATTR + '>') if ATTR not in m.group(1) else m.group(0),
        s,
        count=1,
    )
    if n == 0:
        print('[错误] 没找到 .MainActivity 的 activity 标签，无法锁横屏')
        raise SystemExit(1)
    io.open(MANIFEST, 'w', encoding='utf-8', newline='\n').write(s2)
    print('锁横屏：已写入 ' + ATTR)
