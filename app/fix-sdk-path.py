# 写 android/local.properties，告诉 Gradle 安卓 SDK 在哪。
#
# 两个坑：
#  1. Java properties 文件里反斜杠必须写两个，否则 C:\Users 会被当成转义序列，
#     Gradle 报「文件名、目录名或卷标语法不正确」，而且报错点看不出来是路径问题。
#  2. SDK 装在 I 盘工程目录里（.toolchain\android-sdk），**不往 C 盘放东西**。
#
# 换了电脑或者挪了 SDK 目录，跑一下：python fix-sdk-path.py
import io
import os

APP = os.path.dirname(os.path.abspath(__file__))
SDK = os.path.join(APP, '.toolchain', 'android-sdk')
OUT = os.path.join(APP, 'android', 'local.properties')

if not os.path.isdir(SDK):
    raise SystemExit('找不到安卓 SDK：' + SDK + '\n请确认 .toolchain\\android-sdk 还在。')

# 每个反斜杠 -> 两个，冒号也要转义
value = SDK.replace('\\', '\\\\').replace(':', '\\:')
line = 'sdk.dir=' + value + '\n'

with io.open(OUT, 'w', encoding='latin-1', newline='\n') as f:
    f.write(line)

print('已写入 ' + OUT)
print('内容： ' + line.strip())
