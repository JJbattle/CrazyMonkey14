// 把 ../（蜘蛛纸牌网页版）原样搬进 app/www，供 Capacitor 打进 APK。
// 改完网页版（zhizhu/ 里的东西）以后重新跑一次 node sync.js 就行。
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..');   // zhizhu/
const DST = path.resolve(__dirname, 'www');

// 只搬运行真正需要的东西，tests/ 不进去
const COPY_DIRS = ['js', 'assets'];
const COPY_FILES = ['index.html', 'style.css'];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const a = path.join(from, name), b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
  console.error('找不到网页版目录：' + SRC);
  process.exit(1);
}

rmrf(DST);
fs.mkdirSync(DST, { recursive: true });

for (const f of COPY_FILES) {
  const a = path.join(SRC, f);
  if (!fs.existsSync(a)) { console.error('缺少文件：' + a); process.exit(1); }
  fs.copyFileSync(a, path.join(DST, f));
}
for (const d of COPY_DIRS) copyDir(path.join(SRC, d), path.join(DST, d));

let n = 0, bytes = 0;
(function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else { n++; bytes += fs.statSync(p).size; }
  }
})(DST);

console.log('已同步 ' + n + ' 个文件（' + (bytes / 1024).toFixed(0) + ' KB）→ ' + DST);
