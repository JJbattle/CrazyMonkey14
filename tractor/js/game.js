'use strict';
// 《拖拉机》(升级) —— 游戏引擎 + 电脑 AI

const SEAT_CN = ['你', '下家', '对家', '上家'];
// 等级：2..10 = 2..10，11=J，12=Q，13=K，14=A，15=王；打完王再往上回到 2
const LEVEL_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '王' };
const MAX_LEVEL = 15;
function levelName(l) { return LEVEL_NAMES[l] || String(l); }
function nextLevel(l) { return l >= MAX_LEVEL ? 2 : l + 1; }

// ---------- 玩家 ----------
// 你自己：固定名字，**不参与随机**。想改成别的（比如「妈妈」）就改这一行。
const HUMAN_NAME = '你';

const CAT_NAME = '墩布';            // 家里的猫：单机永远坐对家，联网也进 AI 池当陪玩；只会喵喵叫
// 陪玩名册：每局随机抽两个坐上 AI 位（单机/联网），一局一换。这里全都是电脑。
const PLAYER_POOL = ['尹天乱', '李淑静', '张文霞', '卢志鸿', '蒋学清'];

// ---------- AI 打法档案 ----------
// 每个陪玩一种打法；墩布（对家）固定用最稳最强的 steady。
// 参数都是「阈值 / 开关」，AI 各决策点读它替代原来的硬编码，打法差异就是这么来的。
//   思路取自双升常见打法：记牌、稳大优先、控牌调主、将吃时机、甩牌保守等（见需求总纲）。
const AI_PROFILES = {
  steady: {             // 墩布：最稳最强 —— 敢出对子抢分、将吃有分寸、主特别长才钓光
    suitPairUnseen: 5,  // 副牌对子/拖拉机：外面至多两对半更大就领出（敢抢分）
    trumpPairUnseen: 6, // 主牌对子：至多三对更大就领出
    longTrumpMin: 11,   // 主牌 ≥ 11 张（比较长）就主动打主钓光；否则主牌留着将吃副牌
    ruffWithPoints: false, // 没分也能用主将吃抢牌权（主牌留着就是将吃的，充分利用）
    throwMin: 3,        // 甩牌至少 3 张
  },
  sharp: {              // 激进：爱抢分、敢搏大对子、没分也能将吃抢牌权
    suitPairUnseen: 4,
    trumpPairUnseen: 6,
    longTrumpMin: 11,
    ruffWithPoints: false,
    throwMin: 3,
  },
  balanced: {           // 均衡：介于稳健与激进之间
    suitPairUnseen: 3,
    trumpPairUnseen: 5,
    longTrumpMin: 12,
    ruffWithPoints: true,
    throwMin: 3,
  },
  cautious: {           // 保守：只出绝对稳的牌，少冒险，将吃也最谨慎
    suitPairUnseen: 1,
    trumpPairUnseen: 2,
    longTrumpMin: 13,
    ruffWithPoints: true,
    throwMin: 4,
  },
};

// 陪玩名册 → 打法（墩布固定 steady，单独特判，不在这表里）
const NAME_PROFILE = {
  '尹天乱': 'sharp',
  '李淑静': 'balanced',
  '张文霞': 'cautious',
  '卢志鸿': 'balanced',
  '蒋学清': 'cautious',
};

// 每局结束的几句话：
//   墩布 —— 只会喵喵叫，小概率喊一声「妈妈」
//   其他人 —— 一律温和鼓励（赢了轻轻夸，输了轻轻安慰），不嘲讽
const CAT_LINES = ['喵～', '喵喵！', '喵呜～', '喵？', '喵喵喵～', '（舔爪子）喵～', '喵——'];
const CAT_MAMA = '妈妈～';
const CAT_MAMA_CHANCE = 0.12;
const GENTLE_WIN = [
  '这局打得真好，佩服！',
  '配合得漂亮，下局再来。',
  '牌好手也稳，厉害厉害。',
  '又学了一手，谢谢指教。',
  '打得真好，我服气。',
];
const GENTLE_LOSE = [
  '没事儿，下局肯定赢回来。',
  '别急，慢慢打，我们陪你。',
  '手气这东西，一会儿就回来了。',
  '输赢常事，开心最重要。',
  '再来一局，我看好你。',
];

class Game {
  constructor() {
    this.humanSeats = new Set([0]);   // 真人座位（单机=0；联网=0 和 2 两个对家）
    this.humanNames = {};             // 真人座位 → 名字（联网时用）
    this.levels = [2, 2];           // 队伍等级：队0(座位0/2)，队1(座位1/3)
    this.dealerTeam = 0;            // 庄家队伍
    this.dealerSeat = 0;            // 庄家座位
    this.levelRank = 2;             // 本轮级牌点数
    this.phase = 'idle';
    this.firstRound = true;
    this.bidDecidesDealer = true;    // 只有第一局由亮主定庄；之后由轮转定庄（见 startRound）
    this.result = null;             // 回合结算信息
    this.cycleDone = null;          // 刚绕完一整圈（从 2 打到王）的队伍，否则 null
    this.lastThrowFail = null;      // 最近一次甩牌失败（甩出去之后才提示用）
    this.winner = null;             // 已废弃：现在是无限循环，不再有终局
    this.lastTrick = null;          // 上一圈出牌（用于展示）
    this.log = [];
    this.deck = [];
    this.dealPos = 0;
    this.bottom = [];               // 底牌（8张）
    this.bid = null;                // 当前最高叫牌
    this.trumpSuit = null;
    this.hands = [[], [], [], []];
    this.playedCards = [];          // 本局已出的牌（AI 记牌用）
    this.mustPlayHurdles = true;    // 5/10/K 必打，不能跳级（可选）
    this.taunts = {};               // 本局结束时的几句话
    this.names = [];                // 四个座位的名字（见 assignNames）
    this.assignNames();
  }

  teamOf(seat) { return seat % 2; }

  isHuman(seat) { return this.humanSeats.has(seat); }

  // humanSeat 保留成兼容入口：旧代码/旧测试直接赋 0/-1 仍然生效；
  // 联网时它取第一个真人座位（0），仅用于「无人亮主默认谁坐庄」这类兜底。
  get humanSeat() {
    for (const s of [0, 1, 2, 3]) if (this.humanSeats.has(s)) return s;
    return -1;
  }
  set humanSeat(v) { this.humanSeats = new Set(v >= 0 ? [v] : []); }

  // 闲家得分的下一个升级节点：80 / 120 / 160 / 200 …（每 40 分一档）
  // 界面过关线、AI 破节点抢分都用它，好让两边对得上。
  scoreTarget(pts) {
    if (pts < 80) return 80;
    return 80 + Math.ceil((pts - 79) / 40) * 40;
  }

  // 该座位的 AI 打法档案（墩布固定最稳最强，陪玩按名册对号入座）
  profileOf(seat) {
    const name = this.pname(seat);
    if (name === CAT_NAME) return AI_PROFILES.steady;
    return AI_PROFILES[NAME_PROFILE[name] || 'balanced'];
  }

  // 起名：
  //   你自己   —— 永远是 HUMAN_NAME，不随机（它是真人，不是陪玩）
  //   对家     —— 永远是墩布（家里的猫）
  //   另外两家 —— 从陪玩名册里随机抽两个，一局一换
  assignNames() {
    const single = this.humanSeats.size === 1;
    // 单机：对家固定是猫墩布，陪玩池不含它（免得 1/3 号也出猫）；
    // 联网：墩布也进池，能当 AI 坐 1/3 号那两个空位。
    const base = single ? PLAYER_POOL : [CAT_NAME].concat(PLAYER_POOL);
    const pool = shuffle(base.slice());
    const partner = (this.humanSeat + 2) % 4;      // 单机时对家 = 墩布（隔两个座位）
    this.names = [];
    for (const s of [0, 1, 2, 3]) {
      if (this.isHuman(s)) this.names[s] = this.humanNames[s] || HUMAN_NAME;
      else if (single && s === partner) this.names[s] = CAT_NAME;
      else this.names[s] = pool.pop() || SEAT_CN[s];
    }
    return this.names;
  }

  // 座位上的名字；没起名时退回「你/下家/对家/上家」
  pname(seat) {
    return (this.names && this.names[seat]) || SEAT_CN[seat] || ('座位' + seat);
  }

  newGame() {
    this.levels = [2, 2];
    this.dealerTeam = 0;
    this.dealerSeat = 0;
    this.firstRound = true;
    this.winner = null;
    this.assignNames();
    this.startRound();
  }

  startRound() {
    // 只有第一局由「亮主」决定谁坐庄；之后坐庄由上一局轮转决定，亮主只定主牌花色
    this.bidDecidesDealer = this.firstRound;
    if (this.firstRound) {
      this.dealerTeam = 0;
      this.dealerSeat = 0;
      this.firstRound = false;
    }
    this.levelRank = this.levels[this.dealerTeam];

    this.deck = shuffle(buildDeck());
    this.hands = [[], [], [], []];
    this.dealPos = 0;
    this.bottom = this.deck.slice(100); // 剩余 8 张 = 底牌

    this.trumpSuit = null;           // null=未定, -1=无主, 0..3=花色
    this.bid = null;
    this.firstBidSeat = null;        // 本局首个亮主者（第一局他坐庄；之后只记谁先亮）
    this.currentTrick = [];
    this.leadSeat = null;
    this.lastThrowFail = null;
    this.roundPoints = 0;            // 闲家得分
    this.tricksWon = [0, 0, 0, 0];
    this.bottomCards = null;         // 庄家扣的底
    this.phase = 'dealing';
    this.result = null;
    this.lastTrick = null;
    this.taunts = {};
    this.log = [];
    this.playedCards = [];
    this.addLog('第 ' + levelName(this.levelRank) + ' 级，开始发牌。');
  }

  addLog(s) { this.log.push(s); if (this.log.length > 200) this.log.shift(); }

  // ---------- 发牌 + 亮主（发牌过程中随时可叫/改主/抢庄） ----------
  // 这个座位手上能做出的**所有**叫牌，强的排在前面。
  // 没滤「压不压得过桌面上的主牌」——那个由 bidBeats 现算。
  // 每个花色只给最强的那一档：手里有两张就给「反主/加保」，
  // 不用再列一遍单张，摆两个按钮玩家反而犯迷糊。
  // 顺序：两张同样的王 ＞ 一对级牌 ＞ 单张级牌；同档里这门越长越靠前。
  allBids(seat) {
    const h = this.hands[seat];
    const len = s => h.filter(c => c.suit === s && c.rank < 16).length;
    const out = [];
    // 反无主：必须「两张同样的王牌」（大王大王 / 小王小王），大小各一张不算
    for (const jr of [17, 16]) {
      if (h.filter(c => c.rank === jr).length >= 2) out.push({ seat, suit: -1, kind: 'jokers', jrank: jr });
    }
    const pair = [], single = [];
    for (let s = 0; s < 4; s++) {
      const n = h.filter(c => c.rank === this.levelRank && c.suit === s).length;
      if (!n) continue;
      (n >= 2 ? pair : single).push({ seat, suit: s, kind: n >= 2 ? 'pair' : 'single', cnt: len(s) });
    }
    const byLen = (a, b) => b.cnt - a.cnt;
    return out.concat(pair.sort(byLen), single.sort(byLen));
  }

  // 座位当前能做出的最强叫牌（或 null）
  bestBid(seat) {
    const all = this.allBids(seat);
    return all.length ? all[0] : null;
  }

  // 这一门我自己手上有几张（王不算——王的花色是 4，天然不在这四门里）
  suitLen(seat, suit) {
    return this.hands[seat].filter(c => c.suit === suit).length;
  }

  // 以 suit 为主牌时我手上有几张主（suit = -1 表示无主，那就只有王 + 级牌）
  trumpCount(seat, suit) {
    return this.hands[seat].filter(c => isTrump(c, suit, this.levelRank)).length;
  }

  // 是不是玩家的对家（搭档）。注：不能叫 isPartner——类里已有一个
  // isPartner(a, b) 是「同队」判断，同名会把它盖掉。
  // humanSeat < 0 表示纯 AI 对打（测试/模拟），没有「玩家」可帮，一律不是。
  isMate(seat) {
    return this.humanSeat >= 0 && seat === (this.humanSeat + 2) % 4;
  }

  // 玩家（队友）这一门牌够不够多，值得帮亮
  mateSuitRich(suit) {
    return this.humanSeat >= 0 && this.suitLen(this.humanSeat, suit) >= 6;
  }

  // 该不该拿两张王翻无主？
  // 玩家原话：不能无脑翻，翻之前得掂量掂量。
  // 看的是「亮出来的这一门对我方是不是太薄了」——太薄就是白送给人家打。
  worthNoTrump(seat) {
    // 桌上本来就还没定主：不翻。两张王留在手里本身就是两张最大的主牌，
    // 或者留着亮主也行，没必要先把局面搅成无主。
    if (!this.bid || this.bid.kind === 'jokers') return false;
    const cur = this.bid.suit;
    const par = (seat + 2) % 4;                  // 对家就是队友
    const mine = this.suitLen(seat, cur), mate = this.suitLen(par, cur);
    // 自己坐庄、可这一门自己手上就剩这么两张：守着也是挨打，不如自己翻无主。
    // 第一局「坐庄」看谁先亮；之后看上一局轮转定的庄家。
    const iAmDealer = this.bidDecidesDealer ? (this.firstBidSeat === seat) : (this.dealerSeat === seat);
    if (iAmDealer && mine <= 3) return true;
    // 自己和队友在这门主上都薄（两人加起来不到 8 张），
    // 而自己手上还攒着 4 张以上的王/级牌——打无主这几张全是主，反而稳
    return mine + mate <= 7 && this.trumpCount(seat, -1) >= 4;
  }

  // 该不该拿另一门的一对级牌反主？
  worthReverse(seat, suit) {
    // 桌上还没定主 → 有对就亮，别客气
    if (!this.bid || this.bid.kind === 'jokers') return true;
    const cur = this.bid.suit;
    if (suit === cur) return true;               // 给自己那门加保，当然值
    const par = (seat + 2) % 4;
    const mine = this.suitLen(seat, suit), mate = this.suitLen(par, suit);
    const their = this.suitLen(seat, cur), theirs = this.suitLen(par, cur);
    // 换过的这门得比我方原来那门**明显厚**才值得翻，不然纯属瞎折腾
    return mine + mate >= their + theirs + 2;
  }

  // 出主顺序：单张级牌亮主 ＜ 两张同花色级牌反 ＜ 两张同样的王牌反无主
  // 同一档不能互相反（亮主后只能加码到「两张」，之后只能加码到「两张同样的王」）
  bidBeats(current, bid) {
    if (!current) return true;
    const rank = { single: 1, pair: 2, jokers: 3 };
    if (rank[bid.kind] !== rank[current.kind]) return rank[bid.kind] > rank[current.kind];
    if (bid.kind === 'jokers') return (bid.jrank || 0) > (current.jrank || 0);
    return false;
  }

  // AI 是否现在叫牌（返回叫牌对象或 null）
  // 玩家原话：不要让 AI 无脑反——不管反的是花色还是无主。
  // 所以这里从「最强的那一个」改成「从强到弱挨个掂量，第一个划算的才叫」。
  aiBidNow(seat) {
    for (const b of this.allBids(seat)) {
      if (!this.bidBeats(this.bid, b)) continue;   // 这一档压不过桌上的
      if (this.aiWantsBid(seat, b)) return b;
    }
    return null;
  }

  // 这一手叫牌划不划算
  aiWantsBid(seat, b) {
    // 两张同样的王 → 翻无主
    if (b.kind === 'jokers') return this.worthNoTrump(seat);
    // 一对同花色级牌 → 反主 / 加保
    if (b.kind === 'pair') return this.worthReverse(seat, b.suit);
    // 单张级牌 → 亮主 / 反主
    const cnt = this.suitLen(seat, b.suit);
    if (!this.bid) {
      // 对家（队友）发牌时适当作弊：玩家手上一门牌明显多，就帮玩家亮那门当主。
      // 主花色对玩家有利，抢庄/守庄都更顺。
      if (this.isMate(seat) && this.mateSuitRich(b.suit)) return true;
      // 无人亮主：这门够长就亮，否则拖到临近尾声
      return cnt >= 7 || this.dealPos >= 80;
    }
    // 反主：这门明显长才值得反
    return this.bid.kind === 'single' && cnt >= 5;
  }

  // 这一手叫牌算不算「加保」——必须是**同一门**再补一张。
  // 自己原先亮黑桃、现在改亮梅花，那是换门不是加码；
  // 只看座位号的话会误写成「加保·两张梅花」，看着别扭。
  bidIsOwn(bid) {
    const cur = this.bid;
    if (!cur || !bid || cur.seat !== bid.seat) return false;
    if (bid.kind === 'jokers') return cur.kind === 'jokers';
    return cur.kind !== 'jokers' && cur.suit === bid.suit;
  }

  // 应用叫牌（发牌过程中随时可叫/改主）
  placeBid(seat, bid) {
    if (this.phase !== 'dealing') return false;
    if (!bid || !this.bidBeats(this.bid, bid)) { this.addLog('叫牌未生效'); return false; }
    // 自己给自己加码（单张 → 两张）＝ 加保：亮出去的两张锁死了这一门，
    // 别人就再也不能拿别的花色的一对级牌来反，只剩两张同样的王还能翻无主。
    const own = this.bidIsOwn(bid);
    // 记下首个亮主者；被反主不换人（第一局他坐庄，之后这记录只用于判断「谁先亮」）
    if (this.firstBidSeat === null) this.firstBidSeat = seat;
    bid.own = own;
    this.bid = bid;
    this.addLog(this.pname(seat) + (bid.kind === 'jokers'
      ? (own ? ' 加保无主（两张' : ' 反无主（两张') + rankName(bid.jrank) + '）'
      : (bid.kind === 'pair'
        ? (own ? ' 加保（两张' : ' 反主（两张') + SUIT_CN[bid.suit] + '级牌）'
        : ' 亮主 ' + SUIT_CN[bid.suit])));
    return true;
  }

  // 逐张发牌；返回 { seat, card, aiBid, done }
  // 什么时候该停下来等玩家拿主意（第一次能亮主 / 抓到第二张能加保 / 能反主），
  // 由界面那边按「玩家手上有什么叫牌」自己判断，引擎不掺和。
  dealNext() {
    if (this.phase !== 'dealing') return null;
    if (this.dealPos >= 100) { this.finishDeal(); return { done: true }; }
    const seat = this.dealPos % 4;
    const card = this.deck[this.dealPos];
    this.hands[seat].push(card);
    this.dealPos++;
    let aiBid = null;
    if (!this.isHuman(seat)) {
      aiBid = this.aiBidNow(seat);
      if (aiBid) this.placeBid(seat, aiBid);
    }
    if (this.dealPos >= 100) { this.finishDeal(); return { done: true }; }
    return { seat, card, aiBid, done: false };
  }

  finishDeal() {
    if (!this.bid) {
      // 无人亮主：打无主（只有 4 张王 + 8 张级牌是主）。
      // 第一局没人亮 → 默认玩家坐庄；之后坐庄早已由轮转定好，只定无主。
      if (this.bidDecidesDealer) {
        const seat = this.humanSeat >= 0 ? this.humanSeat : 0;
        this.dealerSeat = seat;
        this.dealerTeam = this.teamOf(seat);
        this.firstBidSeat = seat;
      }
      this.trumpSuit = -1;
      this.addLog('无人亮主 → ' + this.pname(this.dealerSeat) + ' 坐庄，本局打无主（只有王和级牌是主）。');
      this.hands[this.dealerSeat] = this.hands[this.dealerSeat].concat(this.bottom);
      this.bottom = [];
      this.phase = 'discard';
      this.addLog(this.pname(this.dealerSeat) + ' 拿底牌，需扣 8 张。');
      return;
    }
    // 第一局：首亮者坐庄（被反主也不换庄）。之后：坐庄已由上一局轮转定好，
    // 亮主/反主只决定主牌花色，不再决定谁坐庄。
    if (this.bidDecidesDealer) {
      this.dealerSeat = this.firstBidSeat;
      this.dealerTeam = this.teamOf(this.dealerSeat);
    }
    this.trumpSuit = this.bid.kind === 'jokers' ? -1 : this.bid.suit;
    this.addLog('主牌定为：' + (this.trumpSuit === -1 ? '无主' : SUIT_CN[this.trumpSuit]) + '，' + this.pname(this.dealerSeat) + ' 坐庄。');
    this.hands[this.dealerSeat] = this.hands[this.dealerSeat].concat(this.bottom);
    this.bottom = [];
    this.phase = 'discard';
    this.addLog(this.pname(this.dealerSeat) + ' 拿底牌，需扣 8 张。');
  }

  // ---------- 扣底 ----------
  aiDiscard(seat) {
    const hand = this.hands[seat].slice();
    const ts = this.trumpSuit, lr = this.levelRank;
    // 扣底优先级：副牌非分、低、且出自短门（造空门）优先扣；主牌/王/级牌/分牌尽量留
    const cut = c => {
      let s = 0;
      if (isTrump(c, ts, lr)) s -= 1000;
      if (pointValue(c) > 0) s -= 200;
      s -= power(c, ts, lr) / 5;
      const len = hand.filter(x => catOf(x, ts, lr) === catOf(c, ts, lr)).length;
      s += (14 - len) * 10;
      return s;
    };
    hand.sort((a, b) => cut(b) - cut(a));
    return hand.slice(0, 8);
  }

  doDiscard(seat, cards) {
    if (seat !== this.dealerSeat || cards.length !== 8) return false;
    const h = this.hands[seat];
    const ok = cards.every(c => h.some(x => x.uid === c.uid));
    if (!ok) return false;
    for (const c of cards) h.splice(h.findIndex(x => x.uid === c.uid), 1);
    this.bottomCards = cards;
    this.addLog(this.pname(seat) + ' 扣底完成，开始出牌。');
    this.phase = 'playing';
    this.leadSeat = this.dealerSeat;
    this.currentTrick = [];
    return true;
  }

  // ---------- 出牌 ----------
  currentSeat() {
    return (this.leadSeat + this.currentTrick.length) % 4;
  }

  // ---------- AI 判断基础 ----------
  isPartner(a, b) { return this.teamOf(a) === this.teamOf(b); }

  // 当前圈的领先座位（用现成的 resolveTrick 当裁判）
  currentLeader() {
    if (!this.currentTrick.length) return null;
    const idx = resolveTrick(this.currentTrick, this.trumpSuit, this.levelRank);
    return this.currentTrick[idx].seat;
  }

  trickPoints() {
    return this.currentTrick.reduce((s, p) => s + p.cards.reduce((a, c) => a + pointValue(c), 0), 0);
  }

  // 我出这组牌能否赢下当前圈
  wouldWin(seat, cards) {
    const probe = this.currentTrick.concat([{ seat, cards }]);
    const idx = resolveTrick(probe, this.trumpSuit, this.levelRank);
    return probe[idx].seat === seat;
  }

  comboPower(cards) {
    return Math.max(...cards.map(c => power(c, this.trumpSuit, this.levelRank)));
  }

  // 对本座位而言，cat 门里还有多少张「没见过且比我这张强」的牌（两副各 2 张）
  unseenStronger(card, cat, seat) {
    const known = {};
    const mark = c => { const k = c.suit + '-' + c.rank; known[k] = (known[k] || 0) + 1; };
    for (const c of this.hands[seat]) mark(c);
    for (const c of this.playedCards) mark(c);
    // AI 是完美信息：其他三家的手牌也当「已见」。以前这里只统计自己的牌+已出牌，
    // 把对手手里的强牌也算成「没见」，导致 AI 判断「稳大」时过度保守——明明
    // 外面已经没更大的牌了，还不敢出大对子/大单张抢分，白白把牌权让出去。
    for (const s of [0, 1, 2, 3]) if (s !== seat && this.hands[s]) for (const c of this.hands[s]) mark(c);
    const ts = this.trumpSuit, lr = this.levelRank;
    let n = 0;
    for (const c of UNIQUE_DECK) {
      if (catOf(c, ts, lr) !== cat) continue;
      if (power(c, ts, lr) > power(card, ts, lr)) n += 2 - (known[c.suit + '-' + c.rank] || 0);
    }
    return n;
  }

  // 从 catCards 里生成符合 lead 形状的候选组合，按强度升序
  catCandidates(catCards, lead) {
    const ts = this.trumpSuit, lr = this.levelRank;
    if (lead.type === 'single') {
      return catCards.slice().sort((a, b) => power(a, ts, lr) - power(b, ts, lr)).map(c => [c]);
    }
    // 跟甩牌只有一条路：本门「最好的结构」。下面那段是照 lead.len 当
    // 拖拉机对数用的，甩牌的 len 却是张数，套进去会算出个牛头不对马嘴的组合。
    if (lead.type === 'throw') {
      const b = bestShapePick(catCards, lead.len, ts, lr);
      return b ? [b.picks] : [];
    }
    const groups = {};
    for (const c of catCards) { const k = c.suit + '-' + c.rank; (groups[k] = groups[k] || []).push(c); }

    if (lead.type === 'pair') {
      const out = [];
      for (const k in groups) if (groups[k].length >= 2) out.push(groups[k].slice(0, 2));
      return out.sort((a, b) => this.comboPower(a) - this.comboPower(b));
    }

    // 拖拉机：同花色、连续点数的对子窗口（排除王与级牌）
    const pr = [];
    for (const k in groups) {
      const c = groups[k][0];
      if (groups[k].length >= 2 && !isJoker(c) && c.rank !== lr) {
        pr.push({ rank: c.rank, suit: c.suit, cards: groups[k].slice(0, 2) });
      }
    }
    pr.sort((a, b) => a.suit - b.suit || a.rank - b.rank);
    const out = [];
    for (let i = 0; i + lead.len <= pr.length; i++) {
      let ok = true;
      for (let j = 1; j < lead.len; j++) {
        if (pr[i + j].suit !== pr[i + j - 1].suit || pr[i + j].rank - pr[i + j - 1].rank !== 1) { ok = false; break; }
      }
      if (ok) {
        const cards = [];
        for (let j = 0; j < lead.len; j++) cards.push(...pr[i + j].cards);
        out.push(cards);
      }
    }
    return out.sort((a, b) => this.comboPower(a) - this.comboPower(b));
  }

  // 保证合法的跟牌（本门不够时全出再垫；有对必对、有拖拉机必出）
  legalFollow(hand, catCards, lead, need) {
    const ts = this.trumpSuit, lr = this.levelRank;
    if (catCards.length < need) {
      const rest = hand.filter(c => !catCards.some(u => u.uid === c.uid));
      return catCards.slice().concat(this.lowJunkFill(rest, need - catCards.length));
    }
    if (lead.type === 'single') return [this.lowestCard(catCards, ts, lr)];
    // 跟甩牌：没有「更大就赢」这一说（只有整手主牌同牌型才毙得掉），
    // 那就照本门最好的结构出最低的那几张。**不能随手抓最低的 need 张**——
    // 手里有对子却拆成两张单出，是犯规的。
    if (lead.type === 'throw') {
      const b = bestShapePick(catCards, need, ts, lr);
      return b ? b.picks : catCards.slice(0, need);
    }
    const cands = this.catCandidates(catCards, lead);
    if (cands.length) return cands[0];
    // 本门摆不出这个牌型：按「最好结构」出。张数、门数、结构三样都对得上，
    // validatePlay 一定放行（以前这里是拆开对子凑数，现在不行了）。
    const b = bestShapePick(catCards, need, ts, lr);
    return b ? b.picks : catCards.slice(0, need);
  }

  // 跟主接不住时垫牌：别垫小主/分主送分，垫「非分、非王、非级牌」里最大的主牌
  // （J/Q/A 优先，即「10 以上」），抬高后面出牌者压过的门槛，不让对手轻松用 K/10 收分
  losingTrumpFollow(catCards) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const safe = catCards.filter(c => !isJoker(c) && c.rank !== lr && pointValue(c) === 0);
    if (safe.length) return [safe.slice().sort((a, b) => power(b, ts, lr) - power(a, ts, lr))[0]];
    const pts = catCards.filter(c => pointValue(c) > 0);
    if (pts.length) return [pts.slice().sort((a, b) => power(a, ts, lr) - power(b, ts, lr))[0]];
    return [this.lowestCard(catCards, ts, lr)];
  }

  // 抢不过当前圈时的垫牌：主牌垫非分大牌（别送分/别让对手轻松收分），副牌照常垫最小
  losingFollow(hand, catCards, lead, need, leadCat) {
    if (leadCat === 'trump' && lead.type === 'single') return this.losingTrumpFollow(catCards);
    return this.legalFollow(hand, catCards, lead, need);
  }

  // 能赢当前圈的同门组合（按强度升序）
  winningFollows(seat, catCards, lead) {
    return this.catCandidates(catCards, lead).filter(c => this.wouldWin(seat, c));
  }

  // 从若干组合里挑「分最多」的（用于稳赢时甩分），同分取最弱的
  mostPoints(combos) {
    let best = combos[0], bp = -1;
    for (const w of combos) {
      const p = w.reduce((s, c) => s + pointValue(c), 0);
      if (p > bp) { bp = p; best = w; }
    }
    return best;
  }

  // 垫牌：优先非主、非分、低、且出自短门
  lowJunkFill(cards, need) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const scored = cards.map(c => {
      let s = 0;
      if (isTrump(c, ts, lr)) s += 500;
      if (pointValue(c) > 0) s += 1000;
      s += power(c, ts, lr) / 10;
      const len = cards.filter(x => catOf(x, ts, lr) === catOf(c, ts, lr)).length;
      s -= (10 - len) * 2;
      return { c, s };
    });
    scored.sort((a, b) => a.s - b.s);
    return scored.slice(0, need).map(o => o.c);
  }

  // 喂分：队友赢着时，尽量把同门的分牌塞出去
  feedCards(catCards, lead) {
    const ts = this.trumpSuit, lr = this.levelRank;
    if (lead.type === 'single') {
      const pt = catCards.filter(c => pointValue(c) > 0).sort((a, b) => power(a, ts, lr) - power(b, ts, lr));
      return pt.length ? [pt[0]] : null;
    }
    if (lead.type === 'throw') {
      if (catCards.length < lead.len) return null;
      const pick = this.takePointsThenFill(catCards, lead.len);
      // 喂分也得按牌型来：结构对不上（手里有对子却拆开塞分）就别喂了，
      // 让调用方走 legalFollow
      return shapeMatches(catCards, pick, lead.len, ts, lr) ? pick : null;
    }
    let best = null;
    for (const combo of this.catCandidates(catCards, lead)) {
      const v = combo.reduce((s, c) => s + pointValue(c), 0);
      if (v > 0 && (!best || v > best.v)) best = { combo, v };
    }
    return best ? best.combo : null;
  }

  // ---------- 甩牌 ----------
  // 判定用的「同门牌池」：其他三家的手牌 + 自己手里这一门**还没出**的牌。
  // （玩家原话：某门出的所有牌，只要不被其他人或者自己手里同门的牌压制，就能一把全出）
  throwPools(seat, thrownCards) {
    const mineUids = new Set((thrownCards || []).map(c => c.uid));
    const pools = [];
    for (const s of [0, 1, 2, 3]) if (s !== seat && this.hands[s]) pools.push(this.hands[s]);
    if (this.hands[seat]) pools.push(this.hands[seat].filter(c => !mineUids.has(c.uid)));
    return pools;
  }

  // 甩牌是否失败：只比「同门」。主门就是主牌那一大队（含大小王与当前级牌）。
  // 返回 null 表示可甩；否则返回 { why, reduced }，reduced = 默认改出的「被压住的最小组」
  throwFailReason(seat, info) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const pools = this.throwPools(seat, info.comps.flat());
    const beaten = [];
    for (const comp of info.comps) {
      for (const pool of pools) {
        const b = compBeaten(comp, info.cat, pool, ts, lr);
        if (b) { beaten.push({ comp, by: b }); break; }
      }
    }
    if (!beaten.length) return null;

    const pw = c => power(c, ts, lr);
    let pick = beaten[0].comp, pickP = Math.max(...beaten[0].comp.map(pw));
    for (const b of beaten) {
      const p = Math.max(...b.comp.map(pw));
      if (p < pickP) { pickP = p; pick = b.comp; }
    }
    return { why: '被 ' + cardText(beaten[0].by) + ' 压住', reduced: pick };
  }

  // 一手同门牌里「肯定压得住」的那部分（甩出去不会失败）。没有可甩的返回 null
  safeThrowSubset(seat, cards) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const info = classifyThrow(cards, ts, lr);
    if (!info) return null;
    const pools = this.throwPools(seat, cards);
    const keep = [];
    for (const comp of info.comps) {
      if (!pools.some(p => compBeaten(comp, info.cat, p, ts, lr))) keep.push(...comp);
    }
    if (keep.length < this.profileOf(seat).throwMin) return null;
    const sub = classifyThrow(keep, ts, lr);
    return sub && sub.comps.length >= 2 ? keep : null;
  }

  // AI 甩牌：用完美信息（作弊），只甩「绝对压得住」的组，永远不会甩错。
  // 主牌一律不甩：对王带小王这种甩主会白白浪费将吃资源；主特别长要钓光走吊主（见 aiLead）。
  aiThrow(seat, hand) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const byCat = {};
    for (const c of hand) { const k = catOf(c, ts, lr); (byCat[k] = byCat[k] || []).push(c); }
    let best = null, bestScore = -1;
    for (const cat in byCat) {
      if (cat === 'trump') continue;
      const info = classifyThrow(byCat[cat], ts, lr);
      if (!info) continue;
      const keep = this.safeThrowSubset(seat, byCat[cat]);
      if (!keep) continue;
      // 战术判断（不是规则）：副门有人空门、手里的主牌又刚好凑得出同样的牌型，
      // 甩出去就会被将吃，划不来
      if (cat !== 'trump' && [0, 1, 2, 3].some(s =>
          s !== seat &&
          !this.hands[s].some(c => catOf(c, ts, lr) === cat) &&
          canTakeShape(this.hands[s].filter(c => isTrump(c, ts, lr)),
                       info.comps.map(c => c.length).sort((a, b) => b - a), ts, lr))) continue;
      const pts = keep.reduce((s, c) => s + pointValue(c), 0);
      const score = pts * 3 + keep.length;
      if (score > bestScore) { bestScore = score; best = keep; }
    }
    return best;
  }

  // 先拾分牌再补小牌，凑够 need 张（用于队友赢着时喂分）
  takePointsThenFill(cards, need) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const out = [];
    const pt = cards.filter(c => pointValue(c) > 0).sort((a, b) => power(a, ts, lr) - power(b, ts, lr));
    for (const c of pt) { if (out.length >= need) break; out.push(c); }
    const used = new Set(out.map(c => c.uid));
    const rest = cards.filter(c => !used.has(c.uid)).sort((a, b) => power(a, ts, lr) - power(b, ts, lr));
    for (const c of rest) { if (out.length >= need) break; out.push(c); }
    return out.slice(0, need);
  }

  // ---------- AI 出牌 ----------
  aiPlay(seat) {
    const hand = this.hands[seat];
    const ts = this.trumpSuit, lr = this.levelRank;
    if (this.currentTrick.length === 0) return this.aiLead(seat);

    const lead = classifyLead(this.currentTrick[0].cards, ts, lr);
    const leadCat = lead.isTrump ? 'trump' : 'suit:' + lead.suit;
    const need = needOf(lead);
    const catCards = hand.filter(c => catOf(c, ts, lr) === leadCat);

    const leader = this.currentLeader();
    const partnerWinning = leader != null && this.isPartner(seat, leader);
    const lastToPlay = this.currentTrick.length === 3;
    const pts = this.trickPoints();
    const amDealer = this.teamOf(seat) === this.dealerTeam;

    // 对手赢着、闲家得分马上破节点时：果断下大王抢牌权（跟主牌下王 / 将吃下王）
    if (!partnerWinning) {
      const grab = this.clutchGrab(seat, hand, lead, leadCat);
      if (grab) return grab;
    }

    if (catCards.length > 0) {
      // 有本门，必须跟
      if (partnerWinning) {
        // 队友赢着：垫分喂队友（稳的时候），否则垫小牌
        if (lastToPlay) {
          const feed = this.feedCards(catCards, lead);
          if (feed) return feed;
        }
        return this.legalFollow(hand, catCards, lead, need);
      }
      // 对手赢着：尽量管住；自己是最后一家时顺手甩分，否则用最低的赢
      const wins = this.winningFollows(seat, catCards, lead);
      if (wins.length) {
        if (lastToPlay) return this.mostPoints(wins);
        // 不是最后一家：先权衡后面（尤其第四名）还有没有更大的牌再决定抢不抢。
        // 只剩一家没出时，「更大的牌」至多一张没见才值得搏；两家没出就只认绝对稳赢。
        // 否则垫掉，别把中牌白白扔进会被后面压住的圈（第三名出牌要权衡第四名）。
        const behind = 4 - this.currentTrick.length - 1;
        const tol = behind <= 1 ? 1 : 0;
        const safe = wins.filter(w => this.unseenStronger(w[0], leadCat, seat) <= tol);
        if (safe.length) return safe[0];
      }
      return this.losingFollow(hand, catCards, lead, need, leadCat);
    }

    // 无本门：将吃或垫牌
    return this.voidPlay(seat, lead, leadCat, need, { partnerWinning, lastToPlay, pts, amDealer });
  }

  // 破节点抢分：闲家得分马上要过升级节点（80/120/160/200）时，果断下最大主牌
  // （大王，甚至拆对王）抢这一圈牌权——抢下来就能领分、让队友垫分凑过节点。
  // 玩家原话：75 分时东家钓小主，南家直接大王压（不是出「最低能赢」的小王）。
  clutchGrab(seat, hand, lead, leadCat) {
    if (this.teamOf(seat) === this.dealerTeam) return null;  // 庄家方守分，不抢
    const target = this.scoreTarget(this.roundPoints);
    if (target - this.roundPoints > 8) return null;          // 离节点还远，别拆对
    if (lead.type !== 'single') return null;                 // 只抢单张（对子/拖拉机拆王太亏）
    const ts = this.trumpSuit, lr = this.levelRank;
    // 有副牌本门必须跟副牌，王派不上；只有「跟主牌」或「没本门将吃」才轮得到王
    const haveLeadCat = hand.some(c => catOf(c, ts, lr) === leadCat);
    if (leadCat !== 'trump' && haveLeadCat) return null;
    const trumps = hand.filter(c => isTrump(c, ts, lr));
    const big = trumps.filter(c => c.rank === 17)[0] || trumps.filter(c => c.rank === 16)[0];
    if (!big) return null;
    if (!this.wouldWin(seat, [big])) return null;            // 压不住就别硬上
    return [big];
  }

  // 无本门时的选择
  voidPlay(seat, lead, leadCat, need, ctx) {
    const hand = this.hands[seat];
    const ts = this.trumpSuit, lr = this.levelRank;
    const rest = hand.filter(c => catOf(c, ts, lr) !== leadCat);
    const offSuit = rest.filter(c => !isTrump(c, ts, lr));

    if (ctx.partnerWinning) {
      // 队友赢着：不将吃，能喂分就喂分，否则垫最没用的
      if (ctx.lastToPlay) {
        const pt = offSuit.filter(c => pointValue(c) > 0).sort((a, b) => power(a, ts, lr) - power(b, ts, lr));
        if (pt.length >= need) return pt.slice(0, need);
        if (pt.length) {
          const used = new Set(pt.map(c => c.uid));
          return pt.concat(this.lowJunkFill(rest.filter(c => !used.has(c.uid)), need - pt.length));
        }
      }
      return this.lowJunkFill(rest, need);
    }

    // 对手赢着时尝试将吃：圈里有分、或对方出对子/拖拉机、或（激进打法）单纯抢牌权
    const wantRuff = ctx.pts > 0 || lead.type !== 'single' || !this.profileOf(seat).ruffWithPoints;
    if (wantRuff) {
      const trumps = hand.filter(c => isTrump(c, ts, lr));
      const wins = this.winningFollows(seat, trumps, lead);
      if (wins.length) return ctx.lastToPlay ? this.mostPoints(wins) : wins[0];
    }
    // 垫牌：lowJunkFill 内部已优先非主、非分，主牌只会作为最后手段
    return this.lowJunkFill(rest, need);
  }

  // ---------- AI 领出 ----------
  aiLead(seat) {
    const hand = this.hands[seat];
    const ts = this.trumpSuit, lr = this.levelRank;
    const trumps = hand.filter(c => isTrump(c, ts, lr));
    const p = this.profileOf(seat);
    // 主特别长（能把对手的主一波钓光）才主动打主；否则主牌留着将吃副牌
    const longTrump = trumps.length >= p.longTrumpMin;

    // 甩牌：同门有多组绝对压得住的牌 → 一把甩出去。主牌不甩（留着将吃副牌）
    const thr = this.aiThrow(seat, hand);
    if (thr) return thr;

    // 小心眼儿①：无主（无将）打 5/10/K 这种「级牌就是分牌」的局，
    // 上手就对王钓主——逼对手把级牌（5/10/K）跟出来，一把吃分。
    if (ts === -1 && pointValue({ rank: lr, suit: 0 }) > 0) {
      const jp = this.jokerPairLead(seat, hand);
      if (jp) return jp;
    }

    // 副牌「稳大」的对子/拖拉机 → 出它抢分
    const win = this.leadSuitCombo(seat, hand);
    if (win) return win;

    // 副牌顶牌单张（A）→ 领出抢分：同门副牌没有更大的，
    // 别人只有空门将吃才抢得走，白赚一圈出牌权，还能逼出同门的分牌
    const top = this.leadTopSingle(seat, hand);
    if (top) return top;

    // 小心眼儿②：对手手里攥着对主级牌（双主2）时，用我手上一对较弱的主对子
    // （破主对）领出去钓——逼它把双主2 拆出来跟、消耗掉，往后它就没法拿
    // 双主2 将吃 / 抢关键牌权了。
    const hook = this.hookTrumpPair(seat, hand);
    if (hook) return hook;

    // 主牌长、手里又还有副牌时：别急着打主。对王、吊主这种「有副牌还硬打主」
    // 会把主牌大牌白白浪费，副牌没人管，牌权一丢就收不回来（玩家专门点过这毛病）。
    // 主牌不长（对王抢牌权是合理的）、或副牌全打空之后，才照常打主对子 / 吊主钓光。
    const hasOffSuit = hand.some(c => !isTrump(c, ts, lr));
    if (!(longTrump && hasOffSuit)) {
      // 副牌没大牌了，打主对子抢牌权（对王/对级牌/对主 A）——这是「抢牌权」不是「钓主」，
      // 对王这种顶级对子出了稳赢、留着将吃的机会反而少，主动出更值
      const tp = this.leadTrumpCombo(seat, hand);
      if (tp) return tp;

      // 主特别长 → 吊最大主牌钓光：逼对手跟主消耗，把对手的主耗光、让它没法将吃
      if (longTrump) {
        const single = trumps.filter(c => !trumps.some(d => d !== c && isSame(d, c)));
        const big = (single.length ? single : trumps).slice()
                       .sort((a, b) => power(b, ts, lr) - power(a, ts, lr))[0];
        if (big) return [big];
      }
    }

    // 主不长、副牌又没大牌：优先把牌权交给对家（适当「作弊」看对家手牌），
    // 让对家用对手压不住的牌接手；喂不了对家再跑副牌造空门
    const feed = this.leadForPartner(seat, hand);
    if (feed) return feed;

    // 兜底：从短门里出最低的非分副牌单张，造空门，以后好将吃
    const nonTrump = hand.filter(c => !isTrump(c, ts, lr));
    const pool = nonTrump.length ? nonTrump : hand;
    const junk = pool.filter(c => pointValue(c) === 0);
    const cand = junk.length ? junk : pool;
    const byLen = cand.slice().sort((a, b) => {
      const la = hand.filter(x => catOf(x, ts, lr) === catOf(a, ts, lr)).length;
      const lb = hand.filter(x => catOf(x, ts, lr) === catOf(b, ts, lr)).length;
      if (la !== lb) return la - lb;
      return power(a, ts, lr) - power(b, ts, lr);
    });
    return [byLen[0]];
  }

  // 无主打 5/10/K（级牌全是分）时上手对王钓主。
  // 对大王绝对最大，直接领出；对小王只在对手没有对大王时才出（否则被反压）。
  jokerPairLead(seat, hand) {
    const big = hand.filter(c => c.rank === 17);
    if (big.length >= 2) return big.slice(0, 2);
    const small = hand.filter(c => c.rank === 16);
    if (small.length >= 2 && this.unseenStronger({ suit: 4, rank: 16 }, 'trump', seat) === 0) {
      return small.slice(0, 2);
    }
    return null;
  }

  // 对手手里有对主级牌（双主2）时，用我手里最破的一对主对子领出去钓，
  // 逼它把双主2 拆出来跟、消耗掉。只钓「破主对」——比主级牌弱的那种；
  // 强主对（对王/对级牌）留着自己抢牌权，不拿来做这种赔本买卖。
  // 得手里还有副牌才钓：钓掉双主2 就是为了保护副牌大牌不被它将吃。
  hookTrumpPair(seat, hand) {
    const ts = this.trumpSuit, lr = this.levelRank;
    if (ts == null || ts < 0) return null;               // 无主没有「双主2」
    if (!hand.some(c => !isTrump(c, ts, lr))) return null; // 没副牌可保护，不钓
    const opps = [0, 1, 2, 3].filter(s => s !== seat && !this.isPartner(seat, s));
    const oppHasPairLr = opps.some(s => (this.hands[s] || [])
      .filter(c => c.rank === lr && c.suit === ts).length >= 2);
    if (!oppHasPairLr) return null;
    const trumps = hand.filter(c => isTrump(c, ts, lr));
    const g = {};
    for (const c of trumps) { const k = c.suit + '-' + c.rank; (g[k] = g[k] || []).push(c); }
    let best = null;
    for (const k in g) {
      if (g[k].length < 2) continue;
      const c = g[k][0];
      if (power(c, ts, lr) >= 980) continue;              // 只钓比主级牌弱的破主对
      if (!best || power(c, ts, lr) < power(best[0], ts, lr)) best = g[k].slice(0, 2);
    }
    return best;
  }

  // 没大牌领出时，把牌权喂给对家（队友）：对家哪门有「对手压不住」的顶牌，
  // 就出那门让对家接手。这里用完美信息看对家与对手的手牌，算「作弊」，
  // 但只在领出兜底这一下用，克制着来，不是每手都算。
  leadForPartner(seat, hand) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const partner = (seat + 2) % 4;
    const ph = this.hands[partner];
    if (!ph || !ph.length) return null;
    const opps = [0, 1, 2, 3].filter(s => s !== seat && s !== partner);
    // 对手手里有没有比 card 更强的同门牌（完美信息）
    const oppCanBeat = (cat, card) => {
      for (const s of opps) for (const c of (this.hands[s] || []))
        if (catOf(c, ts, lr) === cat && power(c, ts, lr) > power(card, ts, lr)) return true;
      return false;
    };

    // 1) 副牌：对家某门有稳赢顶牌，我这门有牌就出这门的低牌，让对家接手
    const suits = [0, 1, 2, 3].filter(s => ts == null || ts < 0 || s !== ts);
    for (const s of suits) {
      const mine = hand.filter(c => c.suit === s && !isTrump(c, ts, lr));
      if (!mine.length) continue;
      const theirs = ph.filter(c => c.suit === s && !isTrump(c, ts, lr));
      if (!theirs.length) continue;
      const top = theirs.slice().sort((a, b) => power(b, ts, lr) - power(a, ts, lr))[0];
      if (!oppCanBeat('suit:' + s, top)) return [this.lowestCard(mine, ts, lr)];
    }

    // 2) 主：对家有大主（级牌/王），我吊最小主让对家用大主压
    const myTr = hand.filter(c => isTrump(c, ts, lr));
    const theirTr = ph.filter(c => isTrump(c, ts, lr));
    if (myTr.length && theirTr.length) {
      const big = theirTr.slice().sort((a, b) => power(b, ts, lr) - power(a, ts, lr))[0];
      if (power(big, ts, lr) >= 970 && !oppCanBeat('trump', big)) {
        const small = myTr.filter(c => !isJoker(c) && c.rank !== lr);
        const pick = (small.length ? small : myTr).slice()
                       .sort((a, b) => power(a, ts, lr) - power(b, ts, lr))[0];
        return [pick];
      }
    }
    return null;
  }

  // 领出副牌顶牌单张（A，或该门更大的牌都已出完时的最大单张）。
  // 只挑「外面没有更大的牌了」的门，绝不出会被同门压住的单张送分。
  leadTopSingle(seat, hand) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const suits = [0, 1, 2, 3].filter(s => ts == null || ts < 0 || s !== ts);
    let best = null;
    for (const s of suits) {
      const cs = hand.filter(c => c.suit === s && !isTrump(c, ts, lr));
      if (!cs.length) continue;
      const top = cs.filter(c => this.unseenStronger(c, 'suit:' + s, seat) === 0)
                    .sort((a, b) => power(b, ts, lr) - power(a, ts, lr))[0];
      if (top && (!best || power(top, ts, lr) > power(best, ts, lr))) best = top;
    }
    return best ? [best] : null;
  }

  // 副牌门里「已经稳大」的对子/拖拉机（无人能压）——领出抢分的首选。
  // 用户定的原则：先出副牌的靠谱大牌（拖拉机、甩牌、大对子、单 A），
  // 副牌没得出了才打主；所以主牌对子单独放 leadTrumpCombo，别跟副牌抢顺序。
  leadSuitCombo(seat, hand) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const p = this.profileOf(seat);
    const suits = [0, 1, 2, 3].filter(s => ts == null || ts < 0 || s !== ts);
    let bestTractor = null, bestPair = null;
    for (const s of suits) {
      const cat = 'suit:' + s;
      const cs = hand.filter(c => c.suit === s && !isTrump(c, ts, lr));
      if (cs.length < 2) continue;
      const g = {};
      for (const c of cs) (g[c.rank] = g[c.rank] || []).push(c);
      const ranks = Object.keys(g).map(Number).filter(r => g[r].length >= 2).sort((a, b) => a - b);

      let run = [], bestRun = [];
      for (let i = 0; i < ranks.length; i++) {
        if (i > 0 && ranks[i] - ranks[i - 1] === 1) run.push(ranks[i]); else run = [ranks[i]];
        if (run.length > bestRun.length) bestRun = run.slice();
      }
      if (bestRun.length >= 2) {
        const top = g[bestRun[bestRun.length - 1]][0];
        // 外面至多「一对」更大的牌没见过 → 值得一搏（阈值看打法）
        if (this.unseenStronger(top, cat, seat) <= p.suitPairUnseen) {
          const cards = [];
          for (const r of bestRun) cards.push(...g[r].slice(0, 2));
          if (!bestTractor || cards.length > bestTractor.length) bestTractor = cards;
        }
      }
      for (let i = ranks.length - 1; i >= 0; i--) {
        const pc = g[ranks[i]][0];
        if (this.unseenStronger(pc, cat, seat) <= p.suitPairUnseen) {
          if (!bestPair || power(pc, ts, lr) > power(bestPair[0], ts, lr)) bestPair = g[ranks[i]].slice(0, 2);
          break;
        }
      }
    }
    return bestTractor || bestPair;
  }

  // 主牌对子（对王、对级牌、对主 A）——副牌没大牌时打主抢牌权。
  // 主牌拖拉机规则绕（王/级牌连法特殊），这里只挑对子；
  // 主牌门里「更大的牌」散在王、级牌、主花色好几个 rank，阈值看打法 trumpPairUnseen，
  // 这样对王、对级牌、对主 A 这种接近顶的主对子才会主动领出，主小对子留作跟牌用。
  leadTrumpCombo(seat, hand) {
    const ts = this.trumpSuit, lr = this.levelRank;
    const p = this.profileOf(seat);
    const trumpCards = hand.filter(c => isTrump(c, ts, lr));
    const tg = {};
    for (const c of trumpCards) { const k = c.suit + '-' + c.rank; (tg[k] = tg[k] || []).push(c); }
    let best = null;
    for (const k in tg) {
      if (tg[k].length < 2) continue;
      const c = tg[k][0];
      if (this.unseenStronger(c, 'trump', seat) > p.trumpPairUnseen) continue;
      if (!best || power(c, ts, lr) > power(best[0], ts, lr)) best = tg[k].slice(0, 2);
    }
    return best;
  }

  lowestCard(cards, ts, lr) { return cards.slice().sort((a, b) => power(a, ts, lr) - power(b, ts, lr))[0]; }

  // 出牌（人类或 AI 都会调用）
  playCards(seat, cards) {
    // 出的牌不合法时的原因，留给界面当场显示——不然玩家点了「出牌」没反应，
    // 只会以为游戏卡住了
    this.lastPlayFail = null;
    if (this.phase !== 'playing') return false;
    if (seat !== this.currentSeat()) return false;
    const hand = this.hands[seat];
    const isLead = this.currentTrick.length === 0;
    let threw = false;
    if (isLead) {
      // 甩牌：被压住就按「默认最小」改出
      const info = classifyThrow(cards, this.trumpSuit, this.levelRank);
      if (info) {
        const bad = this.throwFailReason(seat, info);
        if (bad) {
          // 甩牌失败：改出被压住的最小组。**提示只在甩出去之后给**，
          // 事前不告诉玩家能甩什么，否则失败惩罚就没意义了。
          const safe = this.safeThrowSubset(seat, info.comps.flat());
          const note = {
            seat,
            why: bad.why,
            reduced: bad.reduced.slice(),
            safe: safe ? safe.slice() : null,
          };
          this.lastThrowFail = note;
          this.addLog(this.pname(seat) + ' 甩牌失败（' + bad.why + '），改出 ' + bad.reduced.map(cardText).join(' ')
            + (safe ? '；本可以甩 ' + safe.map(cardText).join(' ') : ''));
          cards = bad.reduced;
        } else threw = true;
      }
    }
    const lead = isLead ? null : classifyLead(this.currentTrick[0].cards, this.trumpSuit, this.levelRank);
    const v = validatePlay(hand, cards, lead, this.trumpSuit, this.levelRank);
    if (!v.ok) { this.lastPlayFail = v.reason; this.addLog('出牌无效：' + v.reason); return false; }
    // 从手牌移除
    for (const c of cards) hand.splice(hand.findIndex(x => x.uid === c.uid), 1);
    this.playedCards.push(...cards);
    this.currentTrick.push({ seat, cards });
    this.addLog(this.pname(seat) + (threw ? ' 甩牌 ' : ' 出 ') + cards.map(cardText).join(' '));
    if (this.currentTrick.length === 4) this.resolveTrick();
    return true;
  }

  resolveTrick() {
    const winner = resolveTrick(this.currentTrick, this.trumpSuit, this.levelRank);
    const wseat = this.currentTrick[winner].seat;
    this.tricksWon[wseat]++;
    const pts = this.currentTrick.reduce((s, p) => s + p.cards.reduce((a, c) => a + pointValue(c), 0), 0);
    const wteam = this.teamOf(wseat);
    if (wteam !== this.dealerTeam) this.roundPoints += pts; // 闲家得分
    this.lastTrick = { plays: this.currentTrick.slice(), winner: wseat, points: pts };
    this.addLog(this.pname(wseat) + ' 赢此圈' + (pts ? '（+' + pts + ' 分）' : '') + '。');
    this.currentTrick = [];
    this.leadSeat = wseat;

    const totalPlayed = this.hands.reduce((s, h) => s + h.length, 0);
    if (totalPlayed === 0) this.finishRound();
  }

  finishRound() {
    // 抠底：最后一圈赢家拿底牌分。最后一圈出了几张牌，底分就翻 (张数 + 1) 倍
    // 例：最后一圈用「双 K」抠底（2 张），圈内共 25 分、底牌 10 分 → 25 + 10 × 3
    const bottomPts = this.bottomCards ? this.bottomCards.reduce((a, c) => a + pointValue(c), 0) : 0;
    const lastWinnerTeam = this.teamOf(this.leadSeat); // leadSeat 是最后一圈赢家
    const winPlay = this.lastTrick ? this.lastTrick.plays.find(p => p.seat === this.lastTrick.winner) : null;
    const bottomMult = (winPlay ? winPlay.cards.length : 1) + 1;

    const bottomWon = lastWinnerTeam !== this.dealerTeam;   // 闲家抠底成功
    const bottomScore = bottomWon ? bottomPts * bottomMult : 0;
    let attackerPts = this.roundPoints;
    if (bottomWon) attackerPts += bottomScore; // 闲家抠底：翻 (张数+1) 倍

    const dealerTeam = this.dealerTeam;
    const otherTeam = 1 - dealerTeam;
    let msg = '';
    let winnerTeam, levelUp = 0;

    if (attackerPts >= 80) {
      winnerTeam = otherTeam;
      levelUp = 1 + Math.floor((attackerPts - 80) / 40); // 闲家每多 40 分多升一级
      msg = '闲家得 ' + attackerPts + ' 分（≥80），上台！';
    } else if (attackerPts === 0) {
      winnerTeam = dealerTeam;
      levelUp = 3;
      msg = '庄家大光（闲家 0 分），升 3 级！';
    } else if (attackerPts < 40) {
      winnerTeam = dealerTeam;
      levelUp = 2;
      msg = '庄家小光（闲家 ' + attackerPts + ' 分 <40），升 2 级！';
    } else {
      winnerTeam = dealerTeam;
      levelUp = 1;
      msg = '庄家守庄（闲家 ' + attackerPts + ' 分），升 1 级！';
    }
    if (bottomPts > 0 && lastWinnerTeam !== dealerTeam) {
      msg += '（抠底 ' + bottomPts + ' 分 × ' + bottomMult + '）';
    }

    const wasTop = this.levels[winnerTeam] === MAX_LEVEL;
    const before = this.levels[winnerTeam];
    let after = before;
    for (let i = 0; i < levelUp && after < MAX_LEVEL; i++) after = nextLevel(after);
    // 5 / 10 / K 是必打的坎，不能靠跳级越过
    if (this.mustPlayHurdles) {
      for (const h of [5, 10, 13]) {
        if (before < h && after > h) { after = h; break; }
      }
      if (after < before + levelUp) msg += '（' + levelName(after) + ' 必打，不能跳过）';
    }
    this.levels[winnerTeam] = after;
    msg += ' ' + (winnerTeam === 0 ? '你方' : '对方') + '升到 ' + levelName(after) + ' 级。';

    this.result = {
      attackerPts, bottomPts, bottomMult, bottomWon, bottomScore,
      bottomCards: this.bottomCards, winnerTeam, levelUp,
      dealerTeam, dealerSeat: this.dealerSeat,
      summary: msg,
    };
    this.phase = 'roundEnd';

    // 「王」级守庄成功 = 绕完一整圈：等级回到 2，接着打下一圈。
    // 游戏**无限循环**打下去，打到不想玩为止，所以这里不判胜负，只给个表扬。
    this.cycleDone = null;
    if (winnerTeam === dealerTeam && wasTop) {
      this.levels[winnerTeam] = 2;
      this.cycleDone = winnerTeam;
      this.result.cycle = winnerTeam;
      this.result.summary += this.cyclePraise(winnerTeam);
      this.addLog(this.cyclePraise(winnerTeam));
    }

    this.sayTaunts(winnerTeam);

    // 坐庄在**胜利者之间**轮转：
    //   庄家队守住了 → 交给搭档（坐庄位 +2）
    //   庄家队被打下来 → 交给赢的那队的下一家（+1，也就是出牌顺序的下一位）
    // 例：东家坐庄，赢了换西家（搭档）；输了换北家。
    if (winnerTeam === dealerTeam) {
      this.dealerSeat = (this.dealerSeat + 2) % 4;
    } else {
      this.dealerTeam = winnerTeam;
      this.dealerSeat = (this.dealerSeat + 1) % 4;
    }
    this.addLog(this.result.summary);
    this.addLog('下一局：' + this.pname(this.dealerSeat) + ' 坐庄。');
  }

  // 绕完一整圈（从 2 打到王）时的表扬
  cyclePraise(team) {
    if (team === 0) {
      return ' 🎉 你方从 2 一路打到「王」，绕完一整圈！这水平是真厉害，接着再绕一圈！';
    }
    return ' 对方从 2 打到「王」绕完整圈了，牌打得不错——不过还没完，咱们再来一圈！';
  }

  // 本局结束的对话：墩布喵喵叫，其他人一律温和鼓励（不嘲讽）
  sayTaunts(winnerTeam) {
    this.taunts = {};
    if (this.humanSeats.size !== 1) return;   // 联网（两个真人）不播单机猫梗
    if (this.humanSeat < 0) return;
    const pick = a => a[Math.floor(Math.random() * a.length)];
    const mine = this.teamOf(this.humanSeat);
    const weWon = winnerTeam === mine;
    const partner = (this.humanSeat + 2) % 4;         // 对家 = 墩布
    this.taunts[partner] = Math.random() < CAT_MAMA_CHANCE ? CAT_MAMA : pick(CAT_LINES);
    for (const s of [0, 1, 2, 3]) {
      if (s === partner || s === this.humanSeat) continue;
      this.taunts[s] = pick(weWon ? GENTLE_WIN : GENTLE_LOSE);
    }
    for (const s in this.taunts) this.addLog(this.pname(s) + '：' + this.taunts[s]);
  }

  // 下一轮
  nextRound() {
    if (this.phase === 'gameEnd') return;
    this.startRound();
  }

  // 执行一步 AI 行动（供 UI 带延迟调用）；返回 true 表示还可能有后续 AI 行动
  aiStep() {
    if (this.phase === 'discard') {
      if (this.isHuman(this.dealerSeat)) return false;
      this.doDiscard(this.dealerSeat, this.aiDiscard(this.dealerSeat));
      return true;
    } else if (this.phase === 'playing') {
      const seat = this.currentSeat();
      if (this.isHuman(seat)) return false;
      let cards = this.aiPlay(seat);
      if (!this.playCards(seat, cards)) {
        cards = this.fallbackPlay(seat);
        if (!this.playCards(seat, cards)) { this.addLog('AI 出牌失败'); return false; }
      }
      return true;
    }
    return false;
  }

  // 兜底出牌：走与 legalFollow 相同的合法路径，保证一定能出
  fallbackPlay(seat) {
    const hand = this.hands[seat];
    const ts = this.trumpSuit, lr = this.levelRank;
    if (this.currentTrick.length === 0) return [this.lowestCard(hand, ts, lr)];
    const lead = classifyLead(this.currentTrick[0].cards, ts, lr);
    const leadCat = lead.isTrump ? 'trump' : 'suit:' + lead.suit;
    const need = needOf(lead);
    const catCards = hand.filter(c => catOf(c, ts, lr) === leadCat);
    if (catCards.length === 0) return this.lowJunkFill(hand, need);
    return this.legalFollow(hand, catCards, lead, need);
  }
}

