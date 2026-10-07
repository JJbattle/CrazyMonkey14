'use strict';
// 联网客户端：只管 WebSocket 连接、收包分发、断线自动重连。
// 不碰 DOM，不碰引擎——UI 怎么响应，由 ui.js 传进来的 handlers 决定。
const Net = (function () {
  let ws = null;
  let ip = '';
  let name = '';
  let handlers = {};
  let retryTimer = null;
  let closedByUser = false;

  function connect(ip_, name_, h) {
    ip = ip_;
    name = name_ || '';
    handlers = h || {};
    closedByUser = false;
    open();
  }

  function open() {
    if (closedByUser) return;
    let s;
    try { s = new WebSocket('ws://' + ip + ':8099'); }
    catch (e) { scheduleRetry(); return; }
    ws = s;
    s.onopen = () => {
      if (handlers.onOpen) handlers.onOpen();
      send({ type: 'join', name });
    };
    s.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg && handlers.onMessage) handlers.onMessage(msg);
    };
    s.onclose = () => { ws = null; if (!closedByUser) scheduleRetry(); };
    s.onerror = () => {};
  }

  function scheduleRetry() {
    if (closedByUser || retryTimer) return;
    if (handlers.onDisconnect) handlers.onDisconnect();
    retryTimer = setTimeout(() => { retryTimer = null; open(); }, 2000);
  }

  function send(obj) {
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); } catch (e) {}
    }
  }

  function close() {
    closedByUser = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (ws) { try { ws.close(); } catch (e) {} ws = null; }
  }

  function isConnected() { return !!(ws && ws.readyState === 1); }

  return { connect, send, close, isConnected };
})();
