// ai-worker.js —— AI 搜索 Web Worker（Android/浏览器后台线程，不卡 UI）
//
// 通过 importScripts 加载与主线程同一套 board/rules/evaluate/zobrist/search/ai，
// 主线程把「局面状态」postMessage 过来，这里重建一个轻量 game 形状（有 board Map、
// players、current 等），调 AI.chooseMove 搜索，再把 {pieceIdx, move, ...} postMessage 回去。
// 走法与主线程完全一致，不存在两套实现。

importScripts('board.js', 'rules.js', 'evaluate.js', 'zobrist.js', 'search.js', 'ai.js');

function rebuildGame(state) {
  const players = state.players.map(p => ({
    pieces: p.pieces,            // [{q,r,s}, ...]，结构化克隆后原样可用
    targetCamp: p.targetCamp,
    startCamp: p.startCamp,
    finished: p.finished,
    rank: p.rank || 0,
  }));
  const board = new Map();
  for (let p = 0; p < players.length; p++) {
    for (const c of players[p].pieces) board.set(Board.keyOf(c), p);
  }
  return {
    playerCount: state.playerCount,
    current: state.current,
    moveNumber: state.moveNumber,
    board: board,
    players: players,
  };
}

self.onmessage = function (e) {
  const msg = e.data;
  if (msg && msg.type === 'chooseMove') {
    try {
      const game = rebuildGame(msg.state);
      const res = AI.chooseMove(game, msg.playerIdx, msg.level);
      self.postMessage({ type: 'result', id: msg.id, res: res });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, error: String(err && err.stack || err) });
    }
  }
};
