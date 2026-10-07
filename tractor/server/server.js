'use strict';
const http = require('http');
const os = require('os');
const { WebSocketServer } = require('ws');
const { Room } = require('./room');

const PORT = 8099;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('拖拉机联网服务器运行中');
});

const wss = new WebSocketServer({ server });
const room = new Room();

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch (e) { return; }
    if (!msg || typeof msg.type !== 'string') return;
    room.onMessage(ws, msg);
  });
  ws.on('close', () => room.onLeave(ws));
  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log('拖拉机联网服务器已启动，端口 ' + PORT);
  console.log('请在手机「联网对战」里输入下面其中一个地址：');
  const ifaces = os.networkInterfaces();
  let found = false;
  for (const name of Object.keys(ifaces)) {
    for (const it of ifaces[name]) {
      if (it.family === 'IPv4' && !it.internal) {
        console.log('    ' + it.address + ':' + PORT + '    （' + name + '）');
        found = true;
      }
    }
  }
  if (!found) console.log('    （没找到局域网网卡，请确认已连 WiFi）');
  console.log('按 Ctrl+C 退出。');
});
