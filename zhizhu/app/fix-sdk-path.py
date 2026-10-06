# 写 android/local.properties，告诉 Gradle 安卓 SDK 在哪。
#
# 蜘蛛纸牌和拖拉机/跳棋共用同一套工具链（I:\CrazyMonkey14\app\.toolchain），
# 不重复占盘、不往 C 盘放东西。
#
# 两个坑（换电脑重装时照做）：
#  1. Java properties 里反斜杠必须写两个，否则会被当转义序列吃掉。
#  2. 路径里的冒号要转义成 \:。
import io
import os

APP = os.path.dirname(os.path.abspath(__file__))
# 共享工具链在 ../../app/.toolchain（就是拖拉机那套）
SDK = os.path.normpath(os.path.join(APP, '..', '..', 'app', '.toolchain', 'android-sdk'))
OUT = os.path.join(APP, 'android', 'local.properties')

if not os.path.isdir(SDK):
    raise SystemExit('找不到安卓 SDK：' + SDK + '\n请确认 ../../app/.toolchain/android-sdk 还在。')

value = SDK.replace('\\', '\\\\').replace(':', '\\:')
line = 'sdk.dir=' + value + '\n'

with io.open(OUT, 'w', encoding='latin-1', newline='\n') as f:
    f.write(line)

print('已写入 ' + OUT)
print('内容： ' + line.strip())
