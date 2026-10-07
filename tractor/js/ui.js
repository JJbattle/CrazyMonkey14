'use strict';
// 《拖拉机》(升级) —— 界面与交互

const game = new Game();
let selected = new Set();
let aiTimer = null;
let dealTimer = null;
let dealDelay = 850;   // 轮到自己拿牌时的停顿(ms)，可调（AI 的牌瞬间发完）
let viewLast = false;  // 是否手动查看上一圈出牌
let waitingNext = false;     // 一圈打完了，停在那儿等玩家自己点「下一轮」
let shownTrick = null;       // 已经停下来展示过的那一圈
let sideFolded = true;       // 战报栏默认收起，把地方让给牌桌
// 别人出牌之间的间隔。要够长：一手牌一张张蹦完本身就要 1 秒上下，
// 前一手还没蹦完下一手就压上来，看着更乱。慢一点，眼睛才跟得上。
const PLAY_GAP = 1200;
const HUMAN_GAP = 900;       // 自己出完牌后，停一下再轮到别人
const flourishShown = new Set();  // 已经放大招牌的牌，一手只放一次
const popShown = new Set();       // 已经逐张蹦过的牌，一手只蹦一次
let flourishTimer = null;
// 已经为「哪一个叫牌」停下来问过玩家了。同一个叫牌不重复停，
// 但玩家的牌变好了（单张 → 两张能加保、凑齐双王能反无主）就再停一次。
let bidSigShown = null;

// ---------- 联网模式 ----------
let mode = 'menu';       // 'menu'（选模式）| 'solo'（单机）| 'net'（联网）
let bidOptions = [];     // 服务器下发的「现在能亮的叫牌」（联网才用）
let yourTurn = false;    // 服务器下发的「轮到我行动了没」（联网才用）
let netSeat = 0;         // 联网时我的座位号
let compactMode = false; // 视觉模式：false=正常（手牌区固定 40%），true=压缩牌桌
let showingLast = false; // 联网下一圈打完，正在展示上一圈的牌

const $ = id => document.getElementById(id);

// 头像配置：以后你给谁配了图就填进来（键 = 名字，值 = 图片路径）。
// 没填的人自动用「名字第一个字」当头像，所以现在不用准备任何图也能跑。
const AVATARS = {
  '墩布': 'assets/cat-joker.jpg',   // 家里的猫，先用这张猫照
  // '李淑静': 'assets/avatar-lishujing.jpg',
};

function trumpName(ts) {
  if (ts === -1) return '无主';
  if (ts == null) return '未定';
  return SUIT_CN[ts];
}

function render() {
  // 这三件都必须排在最前面：前两个一个决定手牌区占多高、一个决定牌桌占多宽，
  // applyHandHeight 再按手里的牌把「手牌区该多高」落到实处（必要时压牌桌），
  // 而 renderHand / renderTrick 都要先量了地方才知道牌该摆多大。
  applyDiscardMode();
  applySideFold();
  applyHandHeight();
  renderInfo();
  renderPlayers();
  renderSeats();
  renderHand();
  renderTrick();
  renderStatus();
  renderActions();
  renderSideNow();
  renderTaunts();
  renderBanner();
  renderLog();
  renderMode();
  applyTurnHint();
}

// 轮到我了：整屏边缘一圈金色呼吸框（联网下轮到真人行动时亮起）
function applyTurnHint() {
  const app = $('app');
  if (app && app.classList) {
    app.classList.toggle('turn-hint', mode === 'net' && yourTurn && game.phase !== 'roundEnd');
  }
}

// 联网/单机的界面开关：必打提示不同。重开按钮文案固定（联网=发起投票，单机=直接重开），不再复用成「退出」。
function renderMode() {
  const h = $('hurdle-info');
  if (h) h.title = (mode === 'net') ? '联网时由电脑统一判定，这里不能改' : '随时可切，下一轮结算生效';
}

// 扣底阶段把上方牌桌压低，给手牌腾地方（33 张牌得摆得开才选得动）
function applyDiscardMode() {
  const b = $('body');
  if (!b || !b.classList) return;
  b.classList.toggle('discarding', game.phase === 'discard');
}

// 战报栏收起 / 展开。收起时牌桌占满宽度，展开时把牌桌挤窄。
function applySideFold() {
  const s = $('side');
  if (!s || !s.classList) return;
  s.classList.toggle('folded', sideFolded);
  const b = $('side-toggle');
  if (b) {
    b.textContent = sideFolded ? '战报 ▸' : '收起 ◂';
    b.title = sideFolded ? '点开看每轮都发生了什么' : '把战报收起来，牌桌更宽敞';
  }
}

// 手牌优先：先保证手里的牌全摆得下（撑高手牌区、必要时压矮牌桌），
// 剩下的地方再给牌桌。以前手牌区写死占 40%，屏幕一矮最后一行就被裁掉；
// 现在按「手里到底有几张牌」现算需要多高，把 min-height 顶上去，牌桌自然往下压。
// 必须在 renderHand 之前跑——renderHand 要先量了地方才知道牌该摆多大。
function applyHandHeight() {
  const seatBottom = $('seat-bottom');
  if (!seatBottom || !seatBottom.style) return;
  // 正常模式：手牌区保持 CSS 固定的 40%，不做「按手牌数撑高、压牌桌」——
  // 那是「压缩牌桌」模式（给旧手机 / 系统字放大的屏幕用）才做的事。
  if (!compactMode) { seatBottom.style.minHeight = ''; return; }
  const hand = $('hand');
  const body = $('body');
  if (!hand || !body) return;
  const cards = game.hands[game.humanSeat];
  if (!cards || !cards.length) { seatBottom.style.minHeight = ''; return; }

  const bodyH = body.clientHeight;
  if (!bodyH) return;   // 还没布局好（测试环境量不到）就不插手，保持 CSS 默认

  const ts = handTrumpSuit();
  const sorted = sortHand(cards, ts, game.levelRank);
  const groups = groupHand(sorted, ts).map(r => ({ n: r.length }));

  const handBar = $('hand-bar');
  const handBarH = (handBar && handBar.offsetHeight) || 0;
  // 牌桌最多被压到 TABLE_FLOOR 那么矮，再压出牌区就没地方摆了
  const maxHandH = Math.max(40, bodyH - TABLE_FLOOR - handBarH - SEAT_BOTTOM_PAD);
  const need = Math.min(handNeedHeight(groups, hand.clientWidth), maxHandH);
  seatBottom.style.minHeight = Math.ceil(need + handBarH + SEAT_BOTTOM_PAD) + 'px';
}

function renderInfo() {
  if (game.phase === 'dealing' && game.bidDecidesDealer) {
    // 第一局：谁先亮主谁坐庄，发牌时还在抢
    $('dealer-info').textContent = '坐庄：抢主中' + (game.firstBidSeat != null ? '（' + game.pname(game.firstBidSeat) + '）' : '');
  } else {
    $('dealer-info').textContent = '坐庄：' + game.pname(game.dealerSeat)
      + '（' + (game.teamOf(game.dealerSeat) === 0 ? '你方' : '对方') + '）';
  }
  $('level-info').textContent = '本局打：' + levelName(game.levelRank);
  $('trump-info').textContent = '主牌：' + trumpName(game.trumpSuit);
  const h = $('hurdle-info');
  h.textContent = '5/10/K 必打：' + (game.mustPlayHurdles ? '开' : '关');
  h.classList.toggle('on', game.mustPlayHurdles);
}

// 四个座位的头像框 + 名字（头像图见 AVATARS，没配就用名字第一个字）
function renderPlayers() {
  for (const seat of [0, 1, 2, 3]) {
    const name = game.pname(seat);
    const av = $('avatar-' + seat);
    if (av) {
      av.textContent = '';
      const src = AVATARS[name];
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = name;
        av.appendChild(img);
      } else {
        av.textContent = name.slice(0, 1);
      }
      av.title = name;
      av.classList.toggle('cat', name === CAT_NAME);
    }
    const nm = $('name-' + seat);
    if (nm) {
      // 真人就是名字本身（HUMAN_NAME），陪玩直接显示陪玩的名字
      nm.textContent = name;
      nm.classList.toggle('me', seat === game.humanSeat);
    }
  }
}

function cardBack() {
  const d = document.createElement('div');
  d.className = 'card back';
  return d;
}

function renderSeats() {
  // 其他三家只摆一叠卡背（不是一整列），旁边写张数
  for (const [seat, id] of [[2, 'cards-top'], [3, 'cards-left'], [1, 'cards-right']]) {
    const box = $(id);
    box.innerHTML = '';
    const n = game.hands[seat] ? game.hands[seat].length : 0;
    if (n === 0) { box.classList.remove('dealer'); continue; }
    const stack = document.createElement('div');
    stack.className = 'card-stack';
    for (let i = 0; i < 3; i++) stack.appendChild(cardBack());
    box.appendChild(stack);
    const cnt = document.createElement('div');
    cnt.className = 'seat-count';
    cnt.textContent = n + ' 张';
    box.appendChild(cnt);
    if (game.phase !== 'dealing' && seat === game.dealerSeat) box.classList.add('dealer');
    else box.classList.remove('dealer');
  }
}

// 每局结算：结算文字 + 底牌常驻在玩家上方 #round-result；
// 各家嘴炮还是走原来的座位气泡，9 秒后收掉。
let tauntTick = null, tauntShownFor = null;
function renderTaunts() {
  const el = $('round-result');
  if (!el) return;
  const t = game.taunts || {};
  const any = Object.keys(t).length > 0;
  if (any && game.taunts !== tauntShownFor) {
    tauntShownFor = game.taunts;
    if (tauntTick) clearTimeout(tauntTick);
    tauntTick = setTimeout(() => { tauntTick = null; render(); }, 9000);
  }
  const inEnd = game.phase === 'roundEnd' && !!game.result;

  el.innerHTML = '';
  if (inEnd) {
    const r = game.result;
    const sum = document.createElement('div');
    sum.className = 'rs-summary';
    sum.textContent = r.summary;
    el.appendChild(sum);

    // 底牌亮出来 + 抠底结果标注（成功/失败、倍率、得分）
    const bc = r.bottomCards;
    if (bc && bc.length) {
      const bottom = document.createElement('div');
      bottom.className = 'rs-bottom';
      // 顺序：单局结算 → 底牌 → 底牌结算。先把 8 张亮出来，下面再标抠底结果。
      const cards = document.createElement('div');
      cards.className = 'rs-bottom-cards';
      for (const c of bc) cards.appendChild(makeCardEl(c, { small: true }));
      bottom.appendChild(cards);
      const label = document.createElement('div');
      label.className = 'rs-bottom-label';
      if (r.bottomWon) {
        label.textContent = '抠底成功：' + r.bottomPts + ' 分 × ' + r.bottomMult + ' 倍 = ' + r.bottomScore + ' 分';
      } else {
        label.textContent = '抠底失败：庄家守住，底牌 ' + r.bottomPts + ' 分不计';
      }
      bottom.appendChild(label);
      el.appendChild(bottom);
    }
  }
  el.classList.toggle('on', !!inEnd);

  // —— 嘴炮气泡：还是各座位旁的气泡 ——
  const show = any && !!tauntTick;
  for (const seat of [1, 2, 3]) {
    const b = $('bubble-' + seat);
    if (!b) continue;
    const txt = show ? t[seat] : null;
    b.textContent = txt || '';
    b.classList.toggle('on', !!txt);
  }
}

function clearTaunts() {
  if (tauntTick) { clearTimeout(tauntTick); tauntTick = null; }
  tauntShownFor = null;
  hideBanner();
  bannerShownFor = null;
}

// 弹一下的横幅，两种：
//   warn = 甩牌失败的红条 → 贴牌桌**右上角**，不挡中间的牌面
//   否则 = 绕完一圈的表扬 → 还是摆**屏幕正中**，隆重一点
//          （那会儿这一局已经打完了，牌桌上没有要看的牌，挡不着谁）
let bannerTick = null, bannerShownFor = null;
function showBanner(text, ms, warn) {
  const el = $('banner');
  if (!el) return;
  if (bannerTick) clearTimeout(bannerTick);
  el.textContent = text;
  el.classList.toggle('on', !!text);
  el.classList.toggle('warn', !!warn);
  el.classList.toggle('praise', !warn);
  bannerTick = setTimeout(() => { bannerTick = null; hideBanner(); }, ms || 5000);
}

function hideBanner() {
  if (bannerTick) { clearTimeout(bannerTick); bannerTick = null; }
  const el = $('banner');
  if (el) { el.textContent = ''; el.classList.remove('on', 'warn', 'praise'); }
}

// 绕完一整圈（从 2 打到王）→ 弹表扬
function renderBanner() {
  const cycle = (game.phase === 'roundEnd') ? game.cycleDone : null;
  if (cycle != null && game.result !== bannerShownFor) {
    bannerShownFor = game.result;
    showBanner(game.cyclePraise(cycle).trim(), 7000, false);
  }
}

// 战报栏顶部：这一圈的情况
function renderSideNow() {
  const el = $('side-now');
  if (!el) return;
  const parts = [];
  if (game.lastTrick) {
    parts.push('上一圈：' + game.pname(game.lastTrick.winner) + ' 赢'
      + (game.lastTrick.points ? '（+' + game.lastTrick.points + ' 分）' : ''));
  }
  if (game.phase === 'playing') parts.push('本圈轮 ' + game.pname(game.currentSeat()));
  else if (game.phase === 'discard') parts.push('扣底中');
  else if (game.phase === 'dealing') parts.push('发牌中');
  el.textContent = parts.join('　');
}

function makeCardEl(c, opts = {}) {
  const d = document.createElement('div');
  d.className = 'card face';
  if (c.suit === 1 || c.suit === 3) d.classList.add('red');
  if (opts.selected) d.classList.add('selected');
  if (opts.highlight) d.classList.add('highlight');
  if (opts.small) d.classList.add('small');
  d.dataset.uid = c.uid;
  if (c.rank >= 16) {
    // 大小王：同一张图片，靠边框和角标区分，不改图片本身
    d.classList.add('joker', c.rank === 17 ? 'joker-big' : 'joker-small');
    d.innerHTML = '<span class="jbadge">' + (c.rank === 17 ? '大' : '小') + '</span>';
  } else {
    d.innerHTML = '<span class="crank">' + rankName(c.rank) + '</span><span class="csuit">' + SUITS[c.suit] + '</span>';
  }
  return d;
}

// ---------- 手牌怎么摆 ----------
// 目标：手里的牌**永远全部同时看得见**，不用上下滚动。
// 手牌按花色分成几个「组」，组内横着排、组与组之间留缝，宽度不够才换行。
// 这里从「完全不叠」开始一点点加大重叠，直到行数塞得下为止；
// 实在塞不下就整手牌一起缩一号。纯计算、不碰 DOM，方便测试。
const HAND_CARD_W = 52;      // 基准牌面大小，跟 style.css 里 #hand 的 --cw/--ch 一致
const HAND_CARD_H = 74;
const HAND_GAP = 8;          // 花色组之间的缝
const HAND_ROW_GAP = 4;      // 两行之间的缝
// 手牌区的内边距（上下加起来）。上面那 20px 是给「选中的牌往上抬 18px」
// 腾的地方，跟 style.css 里 #hand 的 padding 对得上，少了会被裁掉。
const HAND_PAD = 24;
const HAND_MIN_FACE = 26;    // 叠到最紧时每张牌至少露这么宽，保证点数看得清
const HAND_SCALES = [1, 0.95, 0.9, 0.85, 0.8, 0.75];   // 塞不下就按这些比例缩小
const HAND_FALLBACK_W = 900, HAND_FALLBACK_H = 130;    // 量不到大小时的兜底（横屏手机）
// 手牌区下面那条（头像+按钮）会占一点高，上面是 #hand，最底下还有条内边距。
// 算「手牌区该给多高」时要把这俩一并算进去，跟 style.css 对得上。
const SEAT_BOTTOM_PAD = 4;   // #seat-bottom 的下内边距（padding: 0 5px 4px）
const TABLE_FLOOR = 96;      // 手牌再挤也不许把牌桌压得比这还矮（= #trick 的 min-height）

// 一手牌按牌面大小和重叠量摆，需要几行（一个花色组不能拆到两行去，整组一起换行）
function handRows(groups, W, cardW, ov) {
  let rows = 1, cur = 0;
  for (const g of groups) {
    const gw = cardW + (g.n - 1) * (cardW + ov);
    if (cur > 0 && cur + HAND_GAP + gw > W) { rows++; cur = gw; }
    else cur += (cur > 0 ? HAND_GAP : 0) + gw;
  }
  return rows;
}

// 手牌摆满（一整副 25 张、扣底 33 张）**至少**需要多高：按整张大小（52×74）、
// 组内叠到最紧来算，返回的高度已经含 HAND_PAD 上下留白。
// 这是「手牌优先」的下限——低于它，最后一行就会被 overflow 裁掉。
// （屏幕矮、要压牌桌时就把手牌区撑到这个高度；实在撑不到就整手缩一号。）
function handNeedHeight(groups, availW) {
  const W = Math.max(80, (availW || HAND_FALLBACK_W) - HAND_PAD);
  const minOv = -(HAND_CARD_W - Math.max(HAND_MIN_FACE, Math.round(HAND_CARD_W * 0.5)));
  const rows = handRows(groups, W, HAND_CARD_W, minOv);
  return rows * HAND_CARD_H + (rows - 1) * HAND_ROW_GAP + HAND_PAD;
}

// groups: [{ n: 这个花色有几张 }]
// 返回 { cardW, cardH, ov, rows, scale, fits }
function planHandLayout(groups, availW, availH) {
  const W = Math.max(80, (availW || HAND_FALLBACK_W) - HAND_PAD);
  const H = Math.max(40, (availH || HAND_FALLBACK_H) - HAND_PAD);

  for (const scale of HAND_SCALES) {
    const cardW = Math.round(HAND_CARD_W * scale);
    const cardH = Math.round(HAND_CARD_H * scale);
    const maxRows = Math.max(1, Math.floor((H + HAND_ROW_GAP) / (cardH + HAND_ROW_GAP)));
    const minOv = -(cardW - Math.max(HAND_MIN_FACE, Math.round(cardW * 0.5)));
    for (let ov = 0; ov >= minOv; ov--) {
      const r = handRows(groups, W, cardW, ov);
      if (r <= maxRows) return { cardW, cardH, ov, rows: r, scale, fits: true };
    }
  }

  // 缩到最小也塞不下（牌实在太多）：用最小牌面 + 最紧重叠保底，
  // 这时候可能要多行甚至要滚动，属于极端情况
  const scale = HAND_SCALES[HAND_SCALES.length - 1];
  const cardW = Math.round(HAND_CARD_W * scale);
  const cardH = Math.round(HAND_CARD_H * scale);
  const ov = -(cardW - HAND_MIN_FACE);
  return { cardW, cardH, ov, rows: handRows(groups, W, cardW, ov), scale, fits: false };
}

// ---------- 出牌区：那几张牌能摆多大 ----------
// 出牌区摆成三行三列：上=对家、左=上家、右=下家、下=你自己。
// 高度上三行而且中间那行还夹着一块得分牌；宽度上三列并排。
// **宽度比高度更紧**——甩牌一甩就是七八张，一行能拉出去老远。
// 所以两边都要算，取更小的那个。
// 基准牌面**跟手牌一样大**（HAND_CARD_W/H）——牌桌上这几张本来就是给人看的，
// 没道理比手里的小。摆不下时才一层层往下缩（见 TRICK_SCALES）。
const TRICK_CARD_W = HAND_CARD_W;
const TRICK_CARD_H = HAND_CARD_H;
const TRICK_GAP = 3;         // 同一手牌之间（= css 里 .trick-cards 的 gap）
const TRICK_COL_GAP = 6;     // 三列之间（= css 里 #trick 的列间距）
const TRICK_ROW_GAP = 1;     // 三行之间（= css 里 #trick 的行间距）
const TRICK_TAG_W = 40;      // 「最大」那个小牌子 + 跟牌组之间的缝
// 中间那块得分牌的高度。**量过**：「闲家 0 / 80」+「你方 2 · 对方 2」两行
// 加上收窄后的内边距约 48px。这个数卡着出牌区的牌能有多大
// （h + max(h, 它) + h + 行距 ≤ 牌桌高度），估高了牌就白缩一号。
// 点「看上轮」时下面会多一行「上圈：谁赢」，那会儿会高一截、
// 牌跟着缩一点——反正那会儿桌上的牌是旧的，看得清看不清无所谓。
const TRICK_INFO_H = 50;
// 一圈里牌多到摆不下就整手一起缩，一轮轮试到塞得进去为止；
// 缩到这么小还塞不下（一甩十几张那种）就认了，总比挤出牌桌强。
const TRICK_SCALES = [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52];
// 量不到大小时的兜底（横屏手机实测：出牌区约 700×160）
const TRICK_FALLBACK_W = 700, TRICK_FALLBACK_H = 160;
// 对家（顶部那家）出的牌**张数 ≥ 这个数**，就从居中位置往右伸半截，
// 别待在中间列往左伸、挤着左上角（跟 css 里的 .trick-play.right-col 对得上）。
const TRICK_RIGHT_MIN = 6;

// 某一手出的牌该归到出牌区哪一列：左=0、中=1、右=2。
// 上家在左、下家在右、你和对家都在中间那一列；
// 唯独**对家（顶部那家）出的牌特别多时算到「右」这一档**——不是整手挪到右边那列，
// 而是从居中位置往右伸半截（见 css .right-col 的 translateX），
// 别在中间列往左伸、挤着左上角的提示条和上家。
// fitTrickCards 和 renderTrickPlays 都用它，保证「牌摆哪」和「牌算多大」对得上。
function trickCol(p) {
  if (p.seat === 3) return 0;
  if (p.seat === 1) return 2;
  if (p.seat === 2 && p.cards.length >= TRICK_RIGHT_MIN) return 2;
  return 1;
}

// ns = [左边几张, 中间几张, 右边几张]；shiftedN = 对家那手牌张数（若有，则它只占右半边）
function planTrickCards(ns, availW, availH, shiftedN) {
  // 量不到大小时（测试环境、或者还没布局完）按横屏手机的牌桌估一个
  const W = Math.max(120, availW || TRICK_FALLBACK_W);
  const H = Math.max(80, availH || TRICK_FALLBACK_H);
  const colW = (n, w) => (n > 0 ? n * w + (n - 1) * TRICK_GAP : 0);

  for (const scale of TRICK_SCALES) {
    const w = Math.round(TRICK_CARD_W * scale);
    const h = Math.round(TRICK_CARD_H * scale);
    // 高：上中下三行。中间那行有得分牌，得分牌更高时按得分牌算
    if (h + Math.max(h, TRICK_INFO_H) + h + TRICK_ROW_GAP * 2 > H) continue;
    // 宽：三列并排，再给「最大」牌子留一条（一圈最多只挂一个）
    const usedCols = [ns[0], ns[1], ns[2]].filter(n => n > 0).length;
    const need = colW(ns[0], w) + colW(ns[1], w) + colW(ns[2], w)
      + Math.max(0, usedCols - 1) * TRICK_COL_GAP + TRICK_TAG_W;
    if (need > W) continue;
    // 对家那手牌从居中往右伸，只占右半边（见 css .right-col 的 translateX），别伸出牌桌
    if (shiftedN && colW(shiftedN, w) > W / 2) continue;
    return { cardW: w, cardH: h, scale };
  }

  const scale = TRICK_SCALES[TRICK_SCALES.length - 1];
  return { cardW: Math.round(TRICK_CARD_W * scale), cardH: Math.round(TRICK_CARD_H * scale), scale };
}

// 按**这一圈实际出的牌**决定出牌区的牌摆多大，写进 #trick 的 CSS 变量。
// 每一圈都重算：就出一两张时能摆到最大，甩牌七八张时自己缩回去，绝不挤出牌桌。
function fitTrickCards(box, plays) {
  const center = $('center');
  if (!box || !box.style || !box.style.setProperty || !center || !plays) return;
  // 对家和你都在中间那一列（一个在上、一个在下），取更宽的那个；
  // 对家牌特别多时从居中往右伸（见 trickCol）。
  const ns = [0, 0, 0];
  let shiftedN = 0;
  for (const p of plays) {
    const col = trickCol(p);
    ns[col] = Math.max(ns[col], p.cards.length);
    if (p.seat === 2 && col === 2) shiftedN = Math.max(shiftedN, p.cards.length);
  }
  const plan = planTrickCards(ns, center.clientWidth, center.clientHeight, shiftedN);
  // 字号按牌面宽度的比例走，跟手牌用的是同一套系数（见 renderHand），
  // 这样缩到再小，点数和花色也还是占那么大地方、不会糊成一团
  box.style.setProperty('--tw', plan.cardW + 'px');
  box.style.setProperty('--th', plan.cardH + 'px');
  box.style.setProperty('--tf', Math.max(15, Math.round(plan.cardW * 0.52)) + 'px');
  box.style.setProperty('--ts', Math.max(13, Math.round(plan.cardW * 0.45)) + 'px');
  box.style.setProperty('--tj', Math.max(10, Math.round(plan.cardW * 0.27)) + 'px');
}

// 现在定的主花色。发牌中主还没锁死（别人随时能反主）时，
// 已经有人亮主了，就先把亮的那门当临时主花色排，让主级牌立即提到最前。
function handTrumpSuit() {
  return game.trumpSuit != null ? game.trumpSuit
    : (game.phase === 'dealing' && game.bid && game.bid.kind !== 'jokers' ? game.bid.suit : null);
}

// 手牌按花色分组成 [{ c, isT }, ...] 的列表：主牌在最前，然后黑红梅方（顺序见 sortHand）
function groupHand(hand, ts) {
  const rows = [];
  let lastKey = null;
  for (const c of hand) {
    const isT = isTrump(c, ts, game.levelRank);
    const key = isT ? 'trump' : ('suit' + c.suit);
    if (key !== lastKey) { rows.push([]); lastKey = key; }
    rows[rows.length - 1].push({ c, isT });
  }
  return rows;
}

function renderHand() {
  const box = $('hand');
  box.innerHTML = '';
  if (!game.hands[game.humanSeat]) return;
  const ts = handTrumpSuit();
  const hand = sortHand(game.hands[game.humanSeat], ts, game.levelRank);

  // 先按花色分组（主牌在最前，然后黑红梅方，顺序见 sortHand）
  const rows = groupHand(hand, ts);

  // 算出该怎么叠，保证所有的牌一眼全看得见
  const groups = rows.map(r => ({ n: r.length }));
  const plan = planHandLayout(groups, box.clientWidth, box.clientHeight);
  if (box.style && box.style.setProperty) {
    box.style.setProperty('--cw', plan.cardW + 'px');
    box.style.setProperty('--ch', plan.cardH + 'px');
    box.style.setProperty('--ov', plan.ov + 'px');
    // 点数占牌面宽的一半多一点（0.52）、花色 0.45 —— 比过去的 0.39 / 0.36
    // 大了三成。牌面本来就是给老人看的，点数越大越不用眯眼；
    // 52px 宽的牌上「10」两个字约 28px，牌里 48px 的地方放得下，
    // 手牌叠起来时露出的那一条（通常 35px 上下）也够看全。
    box.style.setProperty('--cf', Math.max(15, Math.round(plan.cardW * 0.52)) + 'px');
    box.style.setProperty('--cs', Math.max(13, Math.round(plan.cardW * 0.45)) + 'px');
  }

  for (const row of rows) {
    const group = document.createElement('div');
    group.className = 'suit-group' + (row[0].isT ? ' trump-group' : '');
    box.appendChild(group);
    for (const item of row) {
      const c = item.c;
      const isLevel = c.rank === game.levelRank;
      const d = makeCardEl(c, {
        selected: selected.has(c.uid),
        highlight: (game.phase === 'dealing' && isLevel) || (game.phase === 'playing' && item.isT),
      });
      d.addEventListener('click', () => onCardClick(c));
      group.appendChild(d);
    }
  }
}

function onCardClick(c) {
  if (mode === 'net') {
    // 联网：只有轮到自己、阶段对时才能选牌，绝不本地推进（推进全在服务器）
    if (game.phase !== 'discard' && game.phase !== 'playing') return;
    if (!yourTurn) return;
    const h = game.hands[game.humanSeat];
    if (!h.some(x => x.uid === c.uid)) return;
    if (selected.has(c.uid)) selected.delete(c.uid); else selected.add(c.uid);
    render();
    return;
  }
  // 一圈打完、停在那儿等点「下一轮」时，点手牌就当按了「下一轮」：
  // 老人出牌出顺了手，不会去够那个小按钮，直接点下一张要出的牌接着打。
  if (waitingNext) {
    nextTrick();
    return;
  }
  // 一局打完（roundEnd）手牌还摆在桌上：老人习惯直接点手牌接着玩，
  // 这里把它当成按「下一轮」，省得再去找按钮
  if (game.phase === 'roundEnd') {
    selected.clear();
    game.nextRound();
    beginRound();
    return;
  }
  if (game.phase !== 'discard' && game.phase !== 'playing') return; // 发牌阶段点牌无效
  const h = game.hands[game.humanSeat];
  if (!h.some(x => x.uid === c.uid)) return;
  if (selected.has(c.uid)) selected.delete(c.uid); else selected.add(c.uid);
  render();
}

function renderTrick() {
  const box = $('trick');
  box.innerHTML = '';
  const showLast = !!((viewLast || showingLast) && game.lastTrick);
  const plays = showLast ? game.lastTrick.plays : game.currentTrick;
  if (plays && plays.length) {
    // 显示上一圈就用引擎记下的赢家；显示当前圈就现算谁最大
    const leader = showLast ? game.lastTrick.winner : trickLeader(plays);
    // 先按这一圈的牌量算好牌该多大，再往里头塞牌
    fitTrickCards(box, plays);
    renderTrickPlays(box, plays, leader, !showLast);
  }
  // 一局打完（roundEnd）：牌桌中间的「闲家 x/80」得分牌会跟下面结算区
  // 叠在一块，先把它藏起来——结算区自己会把得分、底牌、抠底结果列全。
  if (game.phase !== 'roundEnd') box.appendChild(makePileInfo(showLast));
}

// 闲家得分越高越「刺激」的颜色：绿 → 黄 → 橙 → 橙红 → 红 → 深红
function scoreColor(pts) {
  if (pts < 40) return '#7bd88a';
  if (pts < 80) return '#ffd54a';
  if (pts < 120) return '#ffb300';
  if (pts < 160) return '#ff7043';
  if (pts < 200) return '#ff5252';
  return '#ff1744';
}

// 牌堆区正中的小牌子：本局当前得分 + 双方级别（看上一圈时再带上上圈结果）
function makePileInfo(showLast) {
  const d = document.createElement('div');
  d.className = 'pile-info';
  const big = document.createElement('span');
  big.className = 'big';
  // 过关线跟着得分走：每破一个升级节点（80/120/160/200…），分数线就跳到下一档
  const pts = game.roundPoints;
  big.textContent = '闲家 ' + pts + ' / ' + game.scoreTarget(pts);
  big.style.color = scoreColor(pts);
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = '你方 ' + levelName(game.levels[0]) + ' · 对方 ' + levelName(game.levels[1]);
  d.appendChild(big);
  d.appendChild(sub);

  // 发牌期间谁亮了主：把那张（或那两张）牌**摆在牌桌正中**，
  // 让全场一眼看得见现在定的是什么主。开始扣底就收起来
  // ——那会儿牌桌要压矮给你的 33 张牌腾地方，这儿没位置了。
  const badge = makeBidBadge(showLast);
  if (badge) d.appendChild(badge);

  let tail = null;
  if (showLast) {
    tail = '上圈：' + game.pname(game.lastTrick.winner) + ' 赢'
      + (game.lastTrick.points ? '（+' + game.lastTrick.points + ' 分）' : '');
  } else if (game.phase === 'dealing' && !badge) tail = '发牌中…';
  else if (game.phase === 'discard') tail = '扣底中';
  if (tail) {
    const l = document.createElement('span');
    l.className = 'last';
    l.textContent = tail;
    d.appendChild(l);
  }
  return d;
}

// 当前亮的主，画成牌摆在牌堆区正中。没主可亮（或者在翻上一圈）时返回 null。
function makeBidBadge(showLast) {
  if (showLast || game.phase !== 'dealing' || !game.bid) return null;
  const b = game.bid;
  const card = b.kind === 'jokers'
    ? { suit: 4, rank: b.jrank }
    : { suit: b.suit, rank: game.levelRank };
  const wrap = document.createElement('div');
  wrap.className = 'bid-badge';
  const row = document.createElement('div');
  row.className = 'bid-cards';
  row.appendChild(makeCardEl(card, { small: true }));
  if (b.kind !== 'single') row.appendChild(makeCardEl(card, { small: true }));
  wrap.appendChild(row);
  const who = document.createElement('div');
  who.className = 'bid-who';
  who.textContent = game.pname(b.seat) + ' ' + bidVerb(b);
  wrap.appendChild(who);
  return wrap;
}

// 这一手牌值不值得亮个招牌？只有「有故事」的那几手才配：
//   领出甩牌  → 「甩 N 张！」
//   领出拖拉机 → 「拖拉机！」
//   把桌上的牌压过去了：
//     大王/小王  → 「金墩布！」「银墩布！」（大小王画的就是家里那只猫）
//     主牌毙副牌 → 「大过你！」
// **主牌压主牌不喊**：你出 ♥5、人家出 ♥K，一巡能弹三下，满屏都是，
// 而且主牌谁大谁赢本来就是常事，喊了反倒显得咋咋呼呼。
// 跟牌（被别人甩牌逼着凑同样张数的那些）**也不亮招牌**——
// 以前只看张数，一出甩牌四家全弹「甩 8 张！」，被迫跟牌的人凭什么喊甩牌。
// plays 是这一圈已经出的牌，i 是这一手在里面的位置。
function handFlourish(plays, i) {
  const cards = plays[i].cards;
  if (!cards || !cards.length) return null;
  let mine = null, lead = null;
  try {
    lead = classifyLead(plays[0].cards, game.trumpSuit, game.levelRank);
    mine = classifyLead(cards, game.trumpSuit, game.levelRank);
  } catch (e) { return null; }
  if (!mine || !lead) return null;

  // 领出的那手才叫得出「甩牌」「拖拉机」
  if (i === 0) {
    if (mine.type === 'tractor') {
      return { label: cards.length > 6 ? '大拖拉机 ' + cards.length + ' 张！' : '拖拉机！' };
    }
    if (mine.type === 'throw') return { label: '甩 ' + cards.length + ' 张！' };
    return null;
  }

  // 跟牌：得真把场上的牌压下去了才喊。用引擎现算一遍——
  // 前面几家算一次、把自己加进去再算一次，赢家换成自己才说明压住了。
  let now = null;
  try { now = resolveTrick(plays.slice(0, i + 1), game.trumpSuit, game.levelRank); }
  catch (e) { return null; }
  if (now !== i) return null;

  // 王盖过前面的人，单独喊一声。放在最前面判：不管领出的是主是副，
  // 用王压住都算这一手的高光。
  if (cards.some(c => isJoker(c) && c.rank === 17)) return { label: '金墩布！' };
  if (cards.some(c => isJoker(c) && c.rank === 16)) return { label: '银墩布！' };

  // 主牌压主牌：不喊（见上面那段注释）
  if (lead.isTrump) return null;

  // 只有**领出副牌、被主牌毙掉**才喊一声「大过你！」
  // 副牌之间同门压过（红桃10 压红桃9 那种）不喊——
  // 跟牌本来就该尽量管住，两家副牌你来我往是家常便饭，喊了反倒像在咋呼。
  const ruff = cards.every(c => isTrump(c, game.trumpSuit, game.levelRank));
  return ruff ? { label: '大过你！' } : null;
}

// 牌桌右上角闪一下标题（拖拉机 / 甩牌）—— 放角上，不挡中间的牌面
function showFlourish(label) {
  const el = $('flourish');
  if (!el) return;
  el.textContent = label;
  el.classList.remove('on');
  void el.offsetWidth;          // 逼浏览器重排，动画才能重新播
  el.classList.add('on');
  if (flourishTimer) clearTimeout(flourishTimer);
  flourishTimer = setTimeout(() => el.classList.remove('on'), 1500);
}

function renderTrickPlays(box, plays, leader, animate) {
  // 按座位方位摆放：对家在上、下家在右、上家在上左、你在下
  for (let i = 0; i < plays.length; i++) {
    const p = plays[i];
    const wrap = document.createElement('div');
    // 只有桌上不止一手牌时，「最大」才值得标出来
    const isTop = leader != null && p.seat === leader && plays.length > 1;
    wrap.className = 'trick-play' + (isTop ? ' winner' : '');
    wrap.dataset.seat = p.seat;
    // 对家（顶部那家）甩的牌特别多时，从居中往右伸半截（见 css .right-col）
    if (p.seat === 2 && trickCol(p) === 2) wrap.classList.add('right-col');

    // 出的牌**不写名字**——谁出的看方位就一清二楚
    // （上=对家、左=上家、右=下家、下=你自己），名字写在这儿只会把牌挤小。
    // 只有「最大」还值得挂个牌子：那是这一圈谁赢的信息，不是身份信息。
    if (isTop) {
      const tag = document.createElement('div');
      tag.className = 'tag-top';
      tag.textContent = '最大';
      wrap.appendChild(tag);
    }

    const row = document.createElement('div');
    row.className = 'trick-cards';

    const key = p.seat + '|' + p.cards.map(c => c.uid).join(',');

    // 该亮招牌的那一手（领出甩牌/拖拉机、或者把桌上的压过去了）：牌镶个金边。
    // 金边要一直挂着——每次有人出牌整圈都会重画一遍，
    // 条件里带上 flourishShown 的话，下一家一出牌金边就没了。
    const fx = animate ? handFlourish(plays, i) : null;
    if (fx) {
      wrap.classList.add('flourish');
      // 招牌动画一手只弹一次，重画不重播
      if (!flourishShown.has(key)) { flourishShown.add(key); showFlourish(fx.label); }
    }

    // 每一手牌都一张接一张蹦出来，看得清是谁出的什么（重画时不重播）
    const pop = !!(animate && !popShown.has(key));
    if (pop) { popShown.add(key); wrap.classList.add('pop'); }

    for (let i = 0; i < p.cards.length; i++) {
      const el = makeCardEl(p.cards[i], { small: true });
      if (pop && el.style) el.style.animationDelay = (i * 70) + 'ms';
      row.appendChild(el);
    }
    wrap.appendChild(row);
    box.appendChild(wrap);
  }
}

// 眼下桌上这一手谁最大（用来提示玩家）
function trickLeader(plays) {
  if (!plays || !plays.length) return null;
  if (plays.length === 1) return plays[0].seat;
  try { return plays[resolveTrick(plays, game.trumpSuit, game.levelRank)].seat; }
  catch (e) { return null; }
}

function renderStatus() {
  const box = $('status');
  // 这一圈已经打完了，牌桌上停着不动，等玩家点「下一轮」
  if (waitingNext) {
    box.textContent = '这一圈打完了，点「下一轮 ▶」';
    return;
  }
  if (game.phase === 'dealing') {
    const b = game.bid;
    const can = playableBids();
    // 这条提示只占左上角一小块，写长了会顶到对家的头像上，
    // 所以按钮名一律省掉——按钮就摆在下面，本来就看得见
    if (!dealTimer) {
      const own = !!(b && b.seat === game.humanSeat);
      box.textContent = !can.length ? (b ? '手上这点叫不过现在的主' : '手上还没级牌，先亮不了')
        : (b ? (own ? '能加保了，点亮起来的那个' : '能反主了，点亮起来的那个')
             : '轮到你亮主了，点亮起来的那个');
    } else if (b) {
      box.textContent = '发牌中…当前主：' + (b.kind === 'jokers' ? '无主' : SUIT_CN[b.suit])
        + '（' + game.pname(b.seat) + '）';
    } else {
      box.textContent = '发牌中…（想反主得有更大的组合）';
    }
  } else if (game.phase === 'discard') {
    box.textContent = game.pname(game.dealerSeat) + ' 扣底：请选 8 张牌';
  } else if (game.phase === 'playing') {
    box.textContent = '轮到 ' + game.pname(game.currentSeat()) + ' 出牌';
  } else if (game.phase === 'roundEnd') {
    // 结算文字挪到玩家上方的 #round-result 了，这里不再重复显示
    box.textContent = '';
  }
}

function renderActions() {
  const box = $('actions');
  box.innerHTML = '';

  // 联网：按钮走服务器节奏，不显示本地「速度/继续发牌/提示/重开」
  if (mode === 'net') {
    renderNetActions(box);
    return;
  }

  // 一圈打完了：把这一圈摆着不动，等他看清楚了再点「下一轮」
  if (waitingNext) {
    const lt = game.lastTrick;
    const b = document.createElement('button');
    b.className = 'next-trick';
    b.textContent = '下一轮 ▶';
    b.addEventListener('click', nextTrick);
    box.appendChild(b);

    const who = document.createElement('div');
    who.className = 'trick-summary';
    who.textContent = '这一圈 ' + game.pname(lt.winner) + ' 最大'
      + (lt.points ? '，拿下 ' + lt.points + ' 分' : '');
    box.appendChild(who);
    return;
  }

  const humanTurn = (game.phase === 'discard' && game.dealerSeat === game.humanSeat)
    || (game.phase === 'playing' && game.currentSeat() === game.humanSeat);

  if (game.phase === 'dealing') {
    // 亮牌阶段摆一排**位置永远固定**的按钮（四个花色 + 大小王），
    // 就跟原版一样：哪里亮了点哪里。不用玩家自己去手牌里点牌，
    // 也不用在一排会变来变去的文字里找——记住「第几个」就行。
    box.appendChild(makeSuitButtons());
    box.appendChild(speedBtn('慢', 1400));
    box.appendChild(speedBtn('中', 850));
    box.appendChild(speedBtn('快', 400));
    if (!dealTimer) box.appendChild(mkBtn('继续发牌', () => { resumeDealing(); render(); }));
  } else if (game.phase === 'discard' && humanTurn) {
    box.appendChild(mkBtn('扣底(8张)', selected.size === 8 ? doDiscard : null, selected.size === 8 ? '' : '请选 8 张'));
    box.appendChild(mkBtn('自动扣底', () => { selected.clear(); const d = game.aiDiscard(game.humanSeat); for (const c of d) selected.add(c.uid); render(); }));
  } else if (game.phase === 'playing' && humanTurn) {
    const cards = selectedCards();
    const lead = game.currentTrick.length
      ? classifyLead(game.currentTrick[0].cards, game.trumpSuit, game.levelRank)
      : null;
    const v = cards.length ? validatePlay(game.hands[game.humanSeat], cards, lead, game.trumpSuit, game.levelRank) : { ok: false, reason: '请选牌' };
    // 甩牌**不事前提示**：能不能甩得出去，甩完才知道（否则失败惩罚就没意义了）
    const hint = v.ok ? '' : v.reason;
    box.appendChild(mkBtn('出牌', v.ok ? doPlay : null, hint));
    if (hint) {
      const h = document.createElement('div');
      h.className = 'play-hint' + (v.ok ? '' : ' bad');
      h.textContent = hint;
      box.appendChild(h);
    }
    box.appendChild(mkBtn('提示', () => { const h = game.aiPlay(game.humanSeat); selected = new Set(h.map(c => c.uid)); render(); }));
    box.appendChild(mkBtn('重选', () => { selected.clear(); render(); }));
    if (game.lastTrick) box.appendChild(mkBtn(viewLast ? '看当前' : '看上轮', () => { viewLast = !viewLast; render(); }));
  } else if (game.phase === 'roundEnd') {
    // 无限循环打下去，没有终局；不想玩了随时「重开」
    box.appendChild(mkBtn('下一轮', () => { selected.clear(); game.nextRound(); beginRound(); }));
    box.appendChild(mkBtn('重开一局', () => { selected.clear(); clearTaunts(); game.newGame(); beginRound(); }));
  } else {
    box.innerHTML = '<div class="wait">等待…</div>';
  }
}

// 联网模式的动作栏：只在「轮到自己」时给按钮，其余都是等待提示。
// 服务器算好 yourTurn / bidOptions，本地只负责摆出来。
function renderNetActions(box) {
  if (game.phase === 'dealing') {
    // 亮主窗口：能亮就摆按钮，不能亮就纯等待（服务器会暂停发牌 1.5s 给机会）
    box.appendChild(makeSuitButtons());
    if (!bidOptions.length) box.appendChild(netWait('发牌中…'));
  } else if (game.phase === 'discard' && yourTurn) {
    box.appendChild(mkBtn('扣底(8张)', selected.size === 8 ? doDiscard : null, selected.size === 8 ? '' : '请选 8 张'));
    box.appendChild(mkBtn('自动扣底', () => { selected.clear(); const d = game.aiDiscard(game.humanSeat); for (const c of d) selected.add(c.uid); render(); }));
  } else if (game.phase === 'playing' && yourTurn) {
    const cards = selectedCards();
    const lead = game.currentTrick.length
      ? classifyLead(game.currentTrick[0].cards, game.trumpSuit, game.levelRank)
      : null;
    const v = cards.length ? validatePlay(game.hands[game.humanSeat], cards, lead, game.trumpSuit, game.levelRank) : { ok: false, reason: '请选牌' };
    const hint = v.ok ? '' : v.reason;
    box.appendChild(mkBtn('出牌', v.ok ? doPlay : null, hint));
    if (hint) {
      const h = document.createElement('div');
      h.className = 'play-hint' + (v.ok ? '' : ' bad');
      h.textContent = hint;
      box.appendChild(h);
    }
    box.appendChild(mkBtn('重选', () => { selected.clear(); render(); }));
    if (game.lastTrick) box.appendChild(mkBtn(viewLast ? '看当前' : '看上轮', () => { viewLast = !viewLast; render(); }));
  } else if (game.phase === 'roundEnd') {
    box.appendChild(netWait('本局结束，稍后自动开下一局…'));
  } else {
    box.appendChild(netWait('等待…'));
  }
}

function netWait(text) {
  const d = document.createElement('div');
  d.className = 'wait';
  if (text) d.textContent = text;
  return d;
}

function mkBtn(text, fn, hint) {
  const b = document.createElement('button');
  b.textContent = text;
  b.disabled = !fn;
  if (hint) b.title = hint;
  if (fn) b.addEventListener('click', fn);
  return b;
}

function speedBtn(text, ms) {
  const b = document.createElement('button');
  b.textContent = text;
  // 当前这一档挂 .on 亮出来，让人一眼看清现在用哪个速度（默认中速）
  b.className = 'speed' + (ms === dealDelay ? ' on' : '');
  b.addEventListener('click', () => setSpeed(ms));
  return b;
}

function setSpeed(ms) {
  dealDelay = ms;
  if (game.phase === 'dealing' && dealTimer) {
    clearInterval(dealTimer);
    dealTimer = setInterval(dealStep, dealDelay);
  }
  render();
}

function selectedCards() {
  const h = game.hands[game.humanSeat];
  return h.filter(c => selected.has(c.uid));
}

function doBid(bid) {
  if (mode === 'net') { Net.send({ type: 'placeBid', bid }); return; }
  game.placeBid(game.humanSeat, bid);
  if (game.phase === 'dealing' && !dealTimer) resumeDealing();
  render();
}

function doDiscard() {
  const cards = selectedCards();
  if (cards.length !== 8) return;
  selected.clear();
  if (mode === 'net') { Net.send({ type: 'doDiscard', cards }); return; }
  game.doDiscard(game.humanSeat, cards);
  afterHuman();
}

function doPlay() {
  const cards = selectedCards();
  if (mode === 'net') {
    Net.send({ type: 'playCards', cards });
    selected.clear();
    viewLast = false;
    return;
  }
  const before = game.lastThrowFail;
  if (!game.playCards(game.humanSeat, cards)) {
    // 出的牌本身就不合法（最常撞上的就是「本门有对子没舍得下」）。
    // 得当面说清楚，不然点了「出牌」没反应，只会以为游戏卡住了。
    if (game.lastPlayFail) showBanner('这么出不行：' + game.lastPlayFail, 3600, true);
    render();
    return;
  }
  selected.clear();
  viewLast = false;
  // 甩牌失败**等甩出去之后**才提示：告诉他刚才哪儿被压了、本可以甩哪几张
  const f = game.lastThrowFail;
  if (f && f !== before && f.seat === game.humanSeat) {
    // 贴在牌桌右上角那个框里（见 #corner）。字短一点、挂的时间也别太长——
    // 这块是浮在牌桌上面的，往下压久了会盖住下家出的牌。
    // 4.2 秒够看清楚三行字了，看不全的还能去战报里翻。
    showBanner('甩牌失败：' + f.why + '\n改出 ' + f.reduced.map(cardText).join(' ')
      + (f.safe ? '\n本可以甩：' + f.safe.map(cardText).join(' ') : ''), 4200, true);
  }
  afterHuman();
}

function afterHuman() {
  if (mode === 'net') return;
  render();
  if (aiTimer) clearTimeout(aiTimer);
  aiTimer = setTimeout(scheduleAi, trickJustEnded() ? 0 : HUMAN_GAP);
}

// 一圈刚打完（4 家都出完了）→ 把这一圈停在桌上，等玩家自己点「下一轮」
function trickJustEnded() {
  return game.phase === 'playing'
    && game.currentTrick.length === 0
    && !!game.lastTrick
    && game.lastTrick !== shownTrick;
}

function holdTrick() {
  shownTrick = game.lastTrick;
  viewLast = true;               // 把刚打完的这一圈摆出来给大家看
  waitingNext = true;            // 停住，不再自动往下走
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  render();
}

// 玩家看清楚了，点「下一轮」才继续
function nextTrick() {
  waitingNext = false;
  viewLast = false;
  popShown.clear();      // 上一圈的牌已经收走了，新一圈的牌重新蹦
  render();
  scheduleAi();
}

// 逐步推进 AI（每手之间都停一下，便于观看）
function scheduleAi() {
  if (mode === 'net') { render(); return; }
  if (aiTimer) clearTimeout(aiTimer);
  if (waitingNext) { render(); return; }   // 等玩家点「下一轮」，谁来都不走
  if (trickJustEnded()) { holdTrick(); return; }
  if (game.phase !== 'discard' && game.phase !== 'playing') { render(); return; }
  if (game.aiStep()) {
    if (trickJustEnded()) { holdTrick(); return; }   // 这一圈满了，停下来等他点
    render();
    aiTimer = setTimeout(scheduleAi, PLAY_GAP);
  } else {
    render();
  }
}

// ---------- 发牌 ----------
// AI 的牌瞬间发完；只在「轮到自己拿牌」或「有人叫了主」时停一拍
function dealStep() {
  if (mode === 'net') return;
  let last = null;
  for (let guard = 0; guard < 400; guard++) {
    if (game.phase !== 'dealing') break;
    last = game.dealNext();
    if (!last || last.done) { last = null; break; }
    if (last.seat === game.humanSeat) break;   // 轮到自己拿牌 → 停下来让自己看清
    if (last.aiBid) break;                     // 有人亮主/反主 → 停一拍让自己考虑要不要反
  }
  if (game.phase !== 'dealing') {
    stopDealing();
    render();
    onDealFinished();
    return;
  }
  // 只要玩家手上**新**出现了一个压得过桌上主牌的叫牌——第一次能亮主、
  // 抓到第二张同花色的级牌能加保、或者凑齐两张同样的王能反无主——
  // 就停下来让他自己拿主意。
  // 不停的话，AI 会在下一张牌就先把主定死，玩家连加保的机会都没有。
  const sig = humanBidSignature();
  if (sig && sig !== bidSigShown) { bidSigShown = sig; stopDealing(); }
  render();
}

// 玩家现在能做出的、而且压得过桌上主牌的叫牌（强的排在前面）。
// 亮牌阶段就把这几个摆成按钮：能亮几门摆几个，不用玩家自己去点牌。
function playableBids() {
  if (mode === 'net') return bidOptions;
  return game.allBids(game.humanSeat).filter(b => game.bidBeats(game.bid, b));
}

// 玩家现在有没有「压得过桌上这个主」的叫牌？有就返回一个能区分的代号。
// 代号**只按档位算**（亮主 / 加保或反主 / 反无主），不带上花色——
// 带上花色的话，手上最长的花色一变就再停一次，一副牌能停七八回，太烦。
// 同一个档位只停一次，档次升上去了才再停，一副牌最多停三回。
function humanBidSignature() {
  const rank = { single: 1, pair: 2, jokers: 3 };
  let top = null;
  for (const b of playableBids()) if (!top || rank[b.kind] > rank[top]) top = b.kind;
  return top;
}

// 叫牌怎么称呼。三种情况分开说清楚：
//   桌上还没主              → 亮主
//   把自己刚亮的主加码成两张 → 加保（加完别人就反不动了，只剩两张同样的王能翻）
//   反别人的主              → 反主 / 反无主
// 亮牌阶段可能一排摆好几个花色按钮，所以字要短；
// 按钮上写明是哪一门，玩家点哪个就是哪个，不用再去手牌里点牌。
function bidLabel(b, isOwn) {
  if (b.kind === 'jokers') return (isOwn ? '加保' : '反无主') + '·两张' + rankName(b.jrank);
  if (b.kind === 'pair') return (isOwn ? '加保' : '反主') + '·两张' + SUIT_CN[b.suit];
  return '亮主·' + SUIT_CN[b.suit];
}

// 亮牌阶段那一排按钮：四个花色 + 小王 + 大王，**位置永远固定**。
// 亮着的＝现在点得动（哪里亮了点哪里），灰的＝这门现在亮不了。
// 手里攥着同一门两张级牌时，那个按钮角上挂个「×2」——再点一次就是加保/反主，
// 这就是「自保时再复亮一次」。
// 只有**亮**这一个信号：不再另标「当前主是哪门」——牌堆正中已经把主牌
// 连牌带人摆着了，再给个金圈只会让灰按钮看着也像能点，把人绕晕。
function makeSuitButtons() {
  const wrap = document.createElement('div');
  wrap.className = 'suit-btns';
  const usable = playableBids();
  const pick = pred => usable.find(pred) || null;
  // 是不是「给自己那门加码」——引擎那边判，跟战报里写的保持一致
  const hint = (bid, fallback) => bid ? bidLabel(bid, game.bidIsOwn(bid)) : fallback;

  for (let s = 0; s < 4; s++) {
    const bid = pick(b => b.kind !== 'jokers' && b.suit === s);
    wrap.appendChild(suitBtn(SUITS[s], bid, {
      red: s === 1 || s === 3,
      hint: hint(bid, SUIT_CN[s] + '：现在点不动'),
    }));
  }
  for (const jr of [16, 17]) {
    const bid = pick(b => b.kind === 'jokers' && b.jrank === jr);
    wrap.appendChild(suitBtn(rankName(jr), bid, {
      joker: true,
      hint: hint(bid, rankName(jr) + '：得攒够两张一样的'),
    }));
  }
  return wrap;
}

// 一个叫牌按钮。face 是画在上面的字（花色符号或「大王」「小王」）。
function suitBtn(face, bid, opts) {
  const b = document.createElement('button');
  b.className = 'suit-btn' + (opts.joker ? ' joker-btn' : '') + (opts.red ? ' red' : '');
  const f = document.createElement('span');
  f.className = 'sb-face';
  f.textContent = face;
  b.appendChild(f);
  // 两张的那一档挂个「×2」，一眼看出点了是加保/反主，不是单纯亮个主
  if (bid && bid.kind !== 'single') {
    const t = document.createElement('span');
    t.className = 'sb-tag';
    t.textContent = '×2';
    b.appendChild(t);
  }
  b.disabled = !bid;
  b.title = opts.hint;
  if (bid) b.addEventListener('click', () => doBid(bid));
  return b;
}

function bidVerb(b) {
  if (b.kind === 'jokers') return b.own ? '加保无主' : '反无主';
  if (b.kind === 'pair') return b.own ? '加保' : '反主';
  return '亮主';
}

function startDealing() {
  stopDealing();
  dealTimer = setInterval(dealStep, dealDelay);
}

function stopDealing() {
  if (dealTimer) { clearInterval(dealTimer); dealTimer = null; }
}

function resumeDealing() {
  if (!dealTimer) dealTimer = setInterval(dealStep, dealDelay);
}

function onDealFinished() {
  viewLast = false;
  shownTrick = null;
  scheduleAi();
}

function beginRound() {
  if (mode === 'net') return;
  viewLast = false;
  shownTrick = null;
  waitingNext = false;
  bidSigShown = null;      // 新一局，叫牌提示重新算
  clearTaunts();
  selected.clear();
  // 新的一局，动画重新算
  flourishShown.clear();
  popShown.clear();
  const fx = $('flourish');
  if (fx && fx.classList) fx.classList.remove('on');
  if (aiTimer) clearTimeout(aiTimer);
  startDealing();
  render();
}

function renderLog() {
  const box = $('log');
  box.innerHTML = '';
  const items = game.log.slice(-60);
  for (const s of items) {
    const d = document.createElement('div');
    const isTalk = s.indexOf('：') >= 0 && game.taunts && Object.values(game.taunts).some(t => s.endsWith(t));
    d.className = 'log-line' + (isTalk ? ' hi' : '');
    d.textContent = s;
    box.appendChild(d);
  }
  box.scrollTop = box.scrollHeight;
}

// ================= 模式入口（单机 / 联网） =================

function showEntry() {
  mode = 'menu';
  setExitVisible(false);
  const el = $('entry');
  if (el) el.classList.add('on');
  try {
    const ip = localStorage.getItem('net_ip');
    const nm = localStorage.getItem('net_name');
    if (ip && $('net-ip')) $('net-ip').value = ip;
    if (nm && $('net-name')) $('net-name').value = nm;
    compactMode = (localStorage.getItem('compact_mode') === '1');
    const ck = $('compact-check');
    if (ck) ck.checked = compactMode;
  } catch (e) {}
  if ($('net-name') && !$('net-name').value) $('net-name').value = '你';
}

function hideEntry() {
  const el = $('entry');
  if (el) el.classList.remove('on');
}

function entryHint(t) {
  const el = $('entry-hint');
  if (el) el.textContent = t || '';
}

function startSolo() {
  mode = 'solo';
  setExitVisible(false);
  hideEntry();
  // 恢复单机：一个真人坐 0 号，其余三家 AI（含墩布对家）
  game.humanSeats = new Set([0]);
  game.humanNames = {};
  game.assignNames();
  game.newGame();
  beginRound();
}

function startNet(ip, name) {
  ip = (ip || '').trim();
  name = (name || '').trim();
  if (!name) name = '你';
  if (!ip) { entryHint('先填上电脑的 IP 地址'); return; }
  try { localStorage.setItem('net_ip', ip); localStorage.setItem('net_name', name); } catch (e) {}
  mode = 'net';
  setExitVisible(true);
  hideEntry();
  entryHint('');
  selected.clear();
  showBanner('正在连接 ' + ip + ' …', 4000, false);
  Net.connect(ip, name, {
    onOpen() {},
    onMessage(msg) {
      switch (msg.type) {
        case 'welcome': netSeat = msg.seat; break;
        case 'state': applySnapshot(msg); break;
        case 'error': showBanner(msg.msg || '操作被拒', 3000, true); break;
        case 'toast': showBanner(msg.text, 4000, false); break;
        case 'players': break;   // 等人状态由快照里的等待提示体现
      }
    },
    onDisconnect() {
      showBanner('连不上电脑，正在重连…', 4000, true);
    },
  });
}

function backToMenu() {
  Net.close();
  mode = 'menu';
  selected.clear();
  if (aiTimer) clearTimeout(aiTimer);
  stopDealing();
  showEntry();
}

// 把服务器下发的「绝对座位」快照旋转成「我自己永远坐 0 号（屏幕下方）」的视角。
// 两个真人固定坐 0 号和 2 号（都是队 0），旋转量是偶数，所以 teamOf 的队关系
// 天然不变——只需旋转座位号和按座位索引的数组，队/等级/得分/牌内容都照原样。
function rotateSnapshot(snap, mySeat) {
  const rel = abs => (abs == null ? null : (abs - mySeat + 4) % 4);
  const s = { ...snap };
  s.you = { ...snap.you, seat: 0 };
  s.names = [0, 1, 2, 3].map(i => snap.names[(i + mySeat) % 4]);
  s.handCounts = [0, 1, 2, 3].map(i => snap.handCounts[(i + mySeat) % 4]);
  s.dealerSeat = rel(snap.dealerSeat);
  s.firstBidSeat = rel(snap.firstBidSeat);
  s.leadSeat = rel(snap.leadSeat);
  if (snap.bid) s.bid = { ...snap.bid, seat: rel(snap.bid.seat) };
  // 可选叫牌都是「我」能亮的，seat 一律是我的绝对座位 → 转成相对 0，
  // 否则 bidIsOwn（判「加保还是反主」）拿它和旋转后的 game.bid.seat 对不上。
  if (snap.bidOptions) s.bidOptions = snap.bidOptions.map(b => ({ ...b, seat: 0 }));
  s.currentTrick = snap.currentTrick.map(p => ({ seat: rel(p.seat), cards: p.cards }));
  if (snap.lastTrick) s.lastTrick = {
    plays: snap.lastTrick.plays.map(p => ({ seat: rel(p.seat), cards: p.cards })),
    winner: rel(snap.lastTrick.winner),
    points: snap.lastTrick.points,
  };
  if (snap.result) s.result = { ...snap.result, dealerSeat: rel(snap.result.dealerSeat) };
  if (snap.taunts) {
    s.taunts = {};
    for (const k in snap.taunts) s.taunts[rel(+k)] = snap.taunts[k];
  }
  return s;
}

// 把服务器下发的状态快照写进本地 game 视图模型，然后整屏重画。
// 本地 game 在联网下不跑任何规则，只当数据容器 + 给 render* 系列读。
function applySnapshot(snap) {
  const mySeat = snap.you.seat;
  netSeat = mySeat;
  const s = rotateSnapshot(snap, mySeat);
  // 一圈打完（当前圈空、有上一圈）：自动把上一圈的牌摆出来展示，
  // 等下一圈第一张牌落地再切回当前圈（见 renderTrick）。
  showingLast = !!(s.phase === 'playing' && s.currentTrick.length === 0 && s.lastTrick);

  game.humanSeats = new Set([0]);
  game.humanNames = { 0: s.you.name };
  game.names = s.names;
  game.phase = s.phase;
  game.levelRank = s.levelRank;
  game.levels = s.levels;
  game.trumpSuit = s.trumpSuit;
  game.dealerSeat = s.dealerSeat;
  game.dealerTeam = s.dealerTeam;
  game.bidDecidesDealer = s.bidDecidesDealer;
  game.firstBidSeat = s.firstBidSeat;
  game.mustPlayHurdles = s.mustPlayHurdles;
  game.bid = s.bid;
  game.leadSeat = s.leadSeat;
  // 手牌：只摆自己的（相对 0 号），其他三家只留张数（renderSeats 只读 .length）
  game.hands = s.handCounts.map(n => new Array(n));
  game.hands[0] = s.hand;
  game.currentTrick = s.currentTrick;
  game.lastTrick = s.lastTrick;
  game.roundPoints = s.roundPoints;
  game.result = s.result;
  game.cycleDone = s.cycleDone;
  game.taunts = s.taunts;
  game.lastThrowFail = s.lastThrowFail;
  game.log = s.logTail || [];
  bidOptions = s.bidOptions || [];
  yourTurn = !!s.yourTurn;
  render();
}

// 5/10/K 必打开关（随时可切，下一轮结算生效）
$('hurdle-info').addEventListener('click', () => {
  if (mode === 'net') return;
  game.mustPlayHurdles = !game.mustPlayHurdles;
  render();
});

// 战报栏的展开 / 收起
$('side-toggle').addEventListener('click', () => {
  sideFolded = !sideFolded;
  applySideFold();
});

// 顶栏右上角的「重开」：单机＝重新洗牌开局；联网＝请求重新开局（两人都同意才开）
$('restart').addEventListener('click', () => {
  if (mode === 'net') { Net.send({ type: 'restart' }); return; }
  selected.clear();
  clearTaunts();
  game.newGame();
  beginRound();
});

// 联网时的「退出」：退回主界面（断开连接）。单机不显示这个按钮。
const exitBtn = $('exit');
if (exitBtn) exitBtn.addEventListener('click', backToMenu);

// 联网才显示「退出」按钮
function setExitVisible(on) {
  const b = $('exit');
  if (b) b.classList.toggle('hidden', !on);
}

// 入口按钮：单机 / 联网（测试环境可能没有这些 DOM，判空再绑）
const btnSolo = $('btn-solo');
if (btnSolo) btnSolo.addEventListener('click', startSolo);
const btnNet = $('btn-net');
if (btnNet) btnNet.addEventListener('click', () => startNet($('net-ip').value, $('net-name').value));
const ckCompact = $('compact-check');
if (ckCompact) ckCompact.addEventListener('change', () => {
  compactMode = ckCompact.checked;
  try { localStorage.setItem('compact_mode', compactMode ? '1' : '0'); } catch (e) {}
});

// 启动：先到菜单选单机/联网
showEntry();
