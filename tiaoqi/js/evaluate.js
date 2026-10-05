// evaluate.js —— 完整局面评价（AI v2 核心），只读 state，不碰规则/UI
//
// state 形如 game：{ players:[{pieces,targetCamp,startCamp,finished}], board:Map, current, playerCount, moveNumber }
// 真实 game 对象也满足这个形状，所以真实对局与搜索用的轻量 state 共用同一套评价。
//
// 评价的不是「这一步走了多远」，而是「走完这一步后，整个阵型离最终获胜还有多远」。
// 返回单玩家评分（越大越好），附逐项分解（供调试面板）。

(function () {
  'use strict';
  const B = (typeof module !== 'undefined') ? require('./board.js') : globalThis.Board;
  const R = (typeof module !== 'undefined') ? require('./rules.js') : globalThis.Rules;

  // —— 预计算距离表（121 × 6，模块加载时算一次）——
  const TIP = B.CAMPS.map(camp =>
    camp.find(c => Math.abs(c.q) === 8 || Math.abs(c.r) === 8 || Math.abs(c.s) === 8));
  // DIST_CAMP[key][camp] = 到该营区（任一格）的最短距离，营内 = 0
  // DIST_TIP[key][camp]  = 到该营尖的距离，营内 = 0..3（0 最深、3 入口）
  const DIST_CAMP = new Map();
  const DIST_TIP = new Map();
  for (const c of B.CELLS) {
    const k = B.keyOf(c);
    const dc = [], dt = [];
    for (let i = 0; i < 6; i++) {
      let min = 999;
      for (const cc of B.CAMPS[i]) { const d = B.dist(c, cc); if (d < min) min = d; }
      dc.push(min);
      dt.push(B.dist(c, TIP[i]));
    }
    DIST_CAMP.set(k, dc);
    DIST_TIP.set(k, dt);
  }

  // 营内深度奖励：depth 0（最深）→ depth 3（入口）
  const GOAL_DEPTH = [110, 90, 60, 30];

  // 阶段
  const PHASE = { OPENING: 'opening', MIDGAME: 'midgame', ENDGAME: 'endgame' };
  function phaseOf(state, playerIdx) {
    const p = state.players[playerIdx];
    const camp = p.targetCamp;
    let inGoal = 0, maxDist = 0;
    for (const c of p.pieces) {
      if (B.campOf(c) === camp) inGoal++;
      const d = DIST_CAMP.get(B.keyOf(c))[camp];
      if (d > maxDist) maxDist = d;
    }
    if (inGoal >= 5 || (inGoal >= 3 && maxDist <= 3)) return PHASE.ENDGAME;
    if (state.moveNumber < 8) return PHASE.OPENING;
    return PHASE.MIDGAME;
  }

  // —— 各评分组件（都返回「越大越好」的带符号值）——

  // 到目标营尖端的平方距离和（越小越好，取负）。
  // 平方让「最落后的棋子」权重最高：天然逼 AI 疏散起始营、运输后排、先填深处——
  // 这三件事 V1 的尖端平方距离已经证明有效，这里直接吸收为核心推进项。
  function goalDistance(state, playerIdx) {
    const p = state.players[playerIdx];
    const camp = p.targetCamp;
    let s = 0;
    for (const c of p.pieces) {
      const d = DIST_TIP.get(B.keyOf(c))[camp];
      s -= d * d;
    }
    return s * 6;
  }

  // 目标营深度奖励（先填深处，避免堵死入口）
  function goalCamp(state, playerIdx) {
    const p = state.players[playerIdx];
    const camp = p.targetCamp;
    let s = 0;
    for (const c of p.pieces) {
      if (B.campOf(c) === camp) s += GOAL_DEPTH[DIST_TIP.get(B.keyOf(c))[camp]];
    }
    return s;
  }

  // 后排运输：对最落后的那枚棋额外加重惩罚
  function rearPiece(state, playerIdx) {
    const p = state.players[playerIdx];
    const camp = p.targetCamp;
    let worst = 0;
    for (const c of p.pieces) {
      const d = DIST_CAMP.get(B.keyOf(c))[camp];
      if (d > worst) worst = d;
    }
    return -worst * worst * 6;
  }

  // 跳板网络：正向跳跃边（借己方/对方子作支点向目标前进）
  function jumpNetwork(state, playerIdx) {
    const p = state.players[playerIdx];
    const camp = p.targetCamp;
    let s = 0;
    for (const c of p.pieces) {
      const myD = DIST_CAMP.get(B.keyOf(c))[camp];
      for (const jt of R.jumpTargets(state.board, c)) {
        const jd = DIST_CAMP.get(B.keyOf(jt))[camp];
        if (jd < myD) s += (myD - jd) * 5;
      }
    }
    return s;
  }

  // 队形：奖励有跳板/连通的间距（≤2），惩罚孤立
  function formation(state, playerIdx) {
    const p = state.players[playerIdx];
    let s = 0;
    for (const c of p.pieces) {
      let nearest = 999;
      for (const o of p.pieces) {
        if (o === c) continue;
        const d = B.dist(c, o);
        if (d < nearest) nearest = d;
      }
      if (nearest <= 2) s += 6;
      else if (nearest >= 4) s -= 10;
    }
    return s;
  }

  // 机动性：单步 + 单跳的合法落点总数（廉价代理，不做整条连跳 DFS）
  function mobility(state, playerIdx) {
    const p = state.players[playerIdx];
    let n = 0;
    for (const c of p.pieces) {
      n += R.stepTargets(state.board, c).length;
      n += R.jumpTargets(state.board, c).length;
    }
    return n;
  }

  // 残局结构：营口（depth 3）被占、而深处（depth ≤1）还空着 → 判堵，扣分
  function endgameStructure(state, playerIdx) {
    if (phaseOf(state, playerIdx) !== PHASE.ENDGAME) return 0;
    const p = state.players[playerIdx];
    const camp = p.targetCamp;
    const occupied = new Set();
    for (const c of p.pieces) if (B.campOf(c) === camp) occupied.add(B.keyOf(c));
    let penalty = 0;
    const deepEmpty = B.CAMPS[camp].some(cc =>
      DIST_TIP.get(B.keyOf(cc))[camp] <= 1 && !occupied.has(B.keyOf(cc)));
    if (deepEmpty) {
      for (const c of B.CAMPS[camp]) {
        if (DIST_TIP.get(B.keyOf(c))[camp] === 3 && occupied.has(B.keyOf(c))) penalty += 40;
      }
    }
    return -penalty;
  }

  // 节奏：己方入营数领先对手多少
  function tempo(state, playerIdx) {
    const camp = state.players[playerIdx].targetCamp;
    let mine = 0;
    for (const c of state.players[playerIdx].pieces) if (B.campOf(c) === camp) mine++;
    let oppSum = 0, n = 0;
    for (let j = 0; j < state.playerCount; j++) {
      if (j === playerIdx) continue;
      let inG = 0;
      for (const c of state.players[j].pieces) if (B.campOf(c) === state.players[j].targetCamp) inG++;
      oppSum += inG; n++;
    }
    if (n === 0) return 0;
    return (mine - oppSum / n) * 15;
  }

  // 堵塞：还有子未入营，却把自己营口全部占满
  function blocking(state, playerIdx) {
    const p = state.players[playerIdx];
    const camp = p.targetCamp;
    const occupied = new Set();
    let outside = 0;
    for (const c of p.pieces) {
      if (B.campOf(c) === camp) occupied.add(B.keyOf(c));
      else outside++;
    }
    if (outside === 0) return 0;
    const mouthCells = B.CAMPS[camp].filter(c => DIST_TIP.get(B.keyOf(c))[camp] === 3);
    const mouthFilled = mouthCells.every(c => occupied.has(B.keyOf(c)));
    return mouthFilled ? -outside * 25 : 0;
  }

  // 敌占我营：对手棋子赖在我的目标营里占着格子 → 我永远凑不满 10 格，无法获胜。
  // 强惩罚逼 AI 别把对手棋子「堵回」我的目标营（那种交叉堵死最后只能是和棋）。
  function enemyInCamp(state, playerIdx) {
    const camp = state.players[playerIdx].targetCamp;
    let penalty = 0;
    for (let j = 0; j < state.playerCount; j++) {
      if (j === playerIdx) continue;
      for (const c of state.players[j].pieces) {
        if (B.campOf(c) === camp) penalty += 40;
      }
    }
    return -penalty;
  }

  // 孤子：离目标远 + 四周无任何子 + 无子可借跳
  function isolation(state, playerIdx) {
    const p = state.players[playerIdx];
    const camp = p.targetCamp;
    let s = 0;
    for (const c of p.pieces) {
      const d = DIST_CAMP.get(B.keyOf(c))[camp];
      if (d <= 3) continue;
      let nearAny = false;
      for (const n of B.neighbors(c)) if (R.occupant(state.board, n) >= 0) { nearAny = true; break; }
      if (nearAny) continue;
      let jumpable = false;
      for (const dir of B.DIRS) {
        const mid = B.cell(c.q + dir.q, c.r + dir.r);
        const to = B.cell(c.q + 2 * dir.q, c.r + 2 * dir.r);
        if (B.isOnBoard(mid.q, mid.r, mid.s) && B.isOnBoard(to.q, to.r, to.s) &&
            R.occupant(state.board, mid) >= 0 && R.occupant(state.board, to) < 0) { jumpable = true; break; }
      }
      if (!jumpable) s -= 12;
    }
    return s;
  }

  // 倒退/滞留：仍留在起始营的子（疏散不力）。
  // 起始营正是对手的目标营，随时会被对手的棋子堵死；越深、越晚越危险，
  // 所以必须尽早疏散。按离目标营距离平方加重——tip 最远（≈13）最先被逼出去，
  // 否则一旦对手棋子到了营口，这枚子就再也出不去了。
  function regression(state, playerIdx) {
    const p = state.players[playerIdx];
    const camp = p.targetCamp;
    let s = 0;
    for (const c of p.pieces) {
      if (B.campOf(c) === p.startCamp) {
        const d = DIST_CAMP.get(B.keyOf(c))[camp];
        s -= d * d * 3;
      }
    }
    return s;
  }

  const COMPONENTS = ['goalDistance', 'goalCamp', 'rearPiece', 'formation', 'jumpNetwork',
    'mobility', 'endgame', 'tempo', 'blocking', 'enemyInCamp', 'isolation', 'regression'];

  function emptyBreakdown(phase) {
    const b = { phase: phase, total: 0 };
    for (const k of COMPONENTS) b[k] = 0;
    return b;
  }

  // 主入口：某玩家的完整局面评分（返回 breakdown 对象，含 total）
  function evaluate(state, playerIdx) {
    if (state.players[playerIdx].finished) {
      const b = emptyBreakdown(PHASE.ENDGAME);
      b.total = 900000;   // 已完成 ≈ 必胜（胜负分压倒一切）
      return b;
    }
    const b = { phase: phaseOf(state, playerIdx) };
    b.goalDistance = goalDistance(state, playerIdx);
    b.goalCamp = goalCamp(state, playerIdx);
    b.rearPiece = rearPiece(state, playerIdx);
    b.formation = formation(state, playerIdx);
    b.jumpNetwork = jumpNetwork(state, playerIdx);
    b.mobility = mobility(state, playerIdx);
    b.endgame = endgameStructure(state, playerIdx);
    b.tempo = tempo(state, playerIdx);
    b.blocking = blocking(state, playerIdx);
    b.enemyInCamp = enemyInCamp(state, playerIdx);
    b.isolation = isolation(state, playerIdx);
    b.regression = regression(state, playerIdx);
    b.total = b.goalDistance + b.goalCamp + b.rearPiece + b.formation + b.jumpNetwork +
      b.mobility + b.endgame + b.tempo + b.blocking + b.enemyInCamp + b.isolation + b.regression;
    return b;
  }

  // 所有玩家的评分向量（MaxN 用）
  function evaluateAll(state) {
    const v = [];
    for (let i = 0; i < state.playerCount; i++) v.push(evaluate(state, i).total);
    return v;
  }

  const Eval = { evaluate, evaluateAll, phaseOf, PHASE, DIST_CAMP, DIST_TIP, GOAL_DEPTH, TIP, COMPONENTS };
  globalThis.Eval = Eval;
  if (typeof module !== 'undefined' && module.exports) module.exports = Eval;
})();
