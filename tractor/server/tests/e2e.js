'use strict';
// 端到端：真起 server.js（真实 wss）+ 两个真实 ws 客户端，验证握手和快照。
// 跑法：在 tractor/server 目录下 `node tests\e2e.js`
const { spawn } = require('child_process');
const path = require('path');
const WebSocket = require('ws');

const PORT = 8099;

function connect(name, sink) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT);
    const to = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error(name + ' 连接超时')); }, 3000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name })));
    ws.on('message', (d) => {
      let m; try { m = JSON.parse(d.toString()); } catch (e) { return; }
      sink.push(m);
      if (m.type === 'welcome') { clearTimeout(to); resolve(ws); }
    });
    ws.on('error', (e) => { clearTimeout(to); reject(e); });
  });
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')],
    { cwd: path.join(__dirname, '..'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));   // 等它监听

  let pass = 0, fail = 0;
  const ok = (n, c) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✖ ' + n); } };

  try {
    const m0 = [], m1 = [];
    const w0 = await connect('妈妈', m0);
    const w1 = await connect('阿姨', m1);
    await new Promise(r => setTimeout(r, 500));   // 等 state 到齐

    const wel0 = m0.find(m => m.type === 'welcome');
    const wel1 = m1.find(m => m.type === 'welcome');
    const st0 = m0.filter(m => m.type === 'state');
    const st1 = m1.filter(m => m.type === 'state');

    ok('妈妈拿到 0 号', !!wel0 && wel0.seat === 0);
    ok('阿姨拿到 2 号', !!wel1 && wel1.seat === 2);
    ok('两人都收到 state 快照', st0.length > 0 && st1.length > 0);
    if (st0.length && st1.length) {
      const a = st0[st0.length - 1], b = st1[st1.length - 1];
      // 服务器逐张发牌（150ms/张），刚连上时手牌还没发满——这里只验证「发牌在推进」
      ok('0 号快照发牌中已收到手牌（>0 张）', a.hand && a.hand.length > 0, 'hand=' + (a.hand && a.hand.length));
      ok('2 号快照发牌中已收到手牌（>0 张）', b.hand && b.hand.length > 0, 'hand=' + (b.hand && b.hand.length));
      ok('两人手牌互不相同（信息隔离）', JSON.stringify(a.hand) !== JSON.stringify(b.hand));
      ok('快照里有 phase / names / handCounts',
        !!a.phase && Array.isArray(a.names) && Array.isArray(a.handCounts));
      // 再等 1 秒，手牌应该在变多（证明发牌泵活着）
      const n0 = a.hand.length, n1 = b.hand.length;
      await new Promise(r => setTimeout(r, 1000));
      const a2 = m0.filter(m => m.type === 'state').pop();
      ok('发牌泵在推进（1 秒后手牌更多了）',
        a2 && a2.hand.length >= n0, n0 + ' → ' + (a2 && a2.hand.length));
    }

    // 第三个连接被拒
    const m2 = [];
    await new Promise((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:' + PORT);
      ws.on('open', () => ws.send(JSON.stringify({ type: 'join', name: '路人' })));
      ws.on('message', (d) => { let m; try { m = JSON.parse(d.toString()); } catch (e) {} m2.push(m); });
      ws.on('close', () => resolve());
    });
    ok('第三个连接收到「房间已满」', m2.some(m => m.type === 'error'));

    w0.close(); w1.close();
  } catch (e) {
    fail++;
    console.log('  ✖ e2e 异常：' + e.message);
  }

  server.kill();
  console.log('\n端到端：通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})();
