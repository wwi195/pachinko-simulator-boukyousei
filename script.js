'use strict';

const game = {
  state: 'normal_idle',
  mode: 'normal',
  spinRate: DEFAULT_SPIN_RATE,
  mochiDama: 0,
  toushi: 0,
  bankedYen: 0,
  dayNumber: 1,
  totalSpins: 0,
  todaySpins: 0,
  currentSpins: 0,
  lastHitSpins: 0,
  zugarCounts: { rushBig: 0, rushSmall: 0, normal: 0 },
  chargeCounts: { upgraded: 0, plain: 0 },
  rushEntryCount: 0,
  totalRushHits: 0,
  rushHitCounts: { big: 0, mid: 0, small: 0, none: 0 },
  allRushStats: { rushTotalSpins: 0 },
  rush: null,
  pending: {},
  eigyoAlertShown: false,
  log: [],
};

function addLog(text, type = '') {
  game.log.unshift({ text, type });
  if (game.log.length > 50) game.log.pop();
  renderLog();
}

// ---- 球数・投資 ----

function consumeSpinCost() {
  const cost = calcSpinCost(game.spinRate);
  if (game.mochiDama >= cost) {
    game.mochiDama -= cost;
  } else {
    const shortfall = cost - game.mochiDama;
    game.mochiDama = 0;
    const units = Math.ceil(shortfall / 250);
    game.toushi   += units * 1000;
    game.mochiDama = units * 250 - shortfall;
  }
}

function addBalls(n) {
  game.mochiDama += n;
}

function handleSpinRateChange(value) {
  game.spinRate = Number(value);
  render();
}

// ---- 通常時ハンドラ ----

function checkEigyoAlert() {
  if (!game.eigyoAlertShown && game.todaySpins >= DAILY_SPIN_LIMIT) {
    game.eigyoAlertShown = true;
    setState('eigyo_alert');
    return true;
  }
  return false;
}

// 1回転処理。演出発生など画面遷移が起きたら true を返す
function runNormalSpin() {
  game.totalSpins++;
  game.todaySpins++;
  game.currentSpins++;
  consumeSpinCost();
  const result = spinNormal();

  if (result === 'zugar') {
    const typeKey = rollZugarType();
    const info = ZUGAR_TYPES[typeKey];
    game.zugarCounts[typeKey]++;
    addBalls(info.balls);
    game.currentSpins = 0;
    game.lastHitSpins = game.totalSpins;
    game.pending = { source: 'zugar', typeKey, balls: info.balls, entersRush: info.entersRush };
    addLog(`図柄揃い！ ＋${info.balls}球`, 'win');
    setState('hit_result');
    return true;
  }

  if (result === 'charge') {
    const upgraded = rollChargeUpgrade();
    const balls = upgraded ? 1800 : 300;
    game.chargeCounts[upgraded ? 'upgraded' : 'plain']++;
    addBalls(balls);
    game.pending = { source: 'charge', upgraded, balls, entersRush: upgraded };
    addLog(`チャージ！ ＋${balls}球${upgraded ? '（2R+10R昇格）' : ''}`, 'charge');
    setState('hit_result');
    return true;
  }

  return false;
}

function handleStart() {
  if (checkEigyoAlert()) return;
  if (!runNormalSpin()) {
    setState('lose_result');
  }
}

function autoSpin(count) {
  for (let i = 0; i < count; i++) {
    if (checkEigyoAlert()) return;
    if (runNormalSpin()) return;
  }
  setState('normal_idle');
}

function handleHitContinue() {
  if (game.pending.entersRush) {
    game.rush = createRushState();
    game.mode = 'rush';
    game.rushEntryCount++;
    addLog('拳王RUSH突入！', 'rush');
    setState('rush_idle');
  } else {
    backToNormal();
  }
}

function backToNormal() {
  game.mode = 'normal';
  setState('normal_idle');
}

// ---- 拳王RUSH中ハンドラ ----

// 1チャンス消化。画面遷移が起きたら true を返す
function runRushSpin(opts = {}) {
  game.allRushStats.rushTotalSpins++;
  const { rushState, outcome, hitType, balls } = applyRushChance(game.rush);
  game.rush = rushState;

  if (outcome === 'miss') {
    if (!opts.silent) {
      addLog(`ST残り${rushState.stRemaining}回・残保留${rushState.reserveRemaining}個`);
      setState('rush_miss');
      return true;
    }
    return false;
  }

  if (outcome === 'rush_end') {
    addLog('拳王RUSH終了 → リザルトへ');
    setState('rush_result');
    return true;
  }

  game.totalRushHits++;
  game.rushHitCounts[hitType]++;
  addBalls(balls);
  game.pending = { hitType, balls };
  addLog(hitType === 'none' ? '当選（出玉なし）継続！' : `${balls}個！ ＋${balls}球`, 'rush');
  setState('rush_hit_result');
  return true;
}

function handleRushSpin() {
  runRushSpin();
}

function handleRushSpin10() {
  for (let i = 0; i < 10; i++) {
    if (runRushSpin({ silent: true })) return;
  }
  setState('rush_idle');
}

// applyRushChance（logic.js）は最大 RUSH_ST_COUNT+RUSH_RESERVE_COUNT 回の外れで
// 必ずhitかrush_endに解決するため、この無限ループは有限回で終了する。
function handleRushSkip() {
  for (;;) {
    if (runRushSpin({ silent: true })) return;
  }
}

function handleRushHitContinue() {
  setState('rush_idle');
}

function handleRushMissContinue() {
  setState('rush_idle');
}

function handleRushResultEnd() {
  addLog('拳王RUSH終了 → 通常時へ');
  game.mode = 'normal';
  game.rush = null;
  setState('normal_idle');
}

// ---- 営業終了・日またぎ・退店 ----

function continueNextDay() {
  game.bankedYen += ballsToYen(game.mochiDama);
  game.mochiDama = 0;
  game.dayNumber++;
  game.todaySpins = 0;
  game.eigyoAlertShown = false;
  game.mode = 'normal';
  game.rush = null;
  addLog(`${game.dayNumber}日目 開始`, 'add');
  setState('normal_idle');
}

function handleEigyoHai() {
  continueNextDay();
}

function handleEigyoIie() {
  setState('taiten_result');
}

function handleTaiten() {
  setState('taiten_result');
}

function resetGame() {
  game.state           = 'normal_idle';
  game.mode            = 'normal';
  game.spinRate        = DEFAULT_SPIN_RATE;
  game.mochiDama       = 0;
  game.toushi          = 0;
  game.bankedYen       = 0;
  game.dayNumber       = 1;
  game.totalSpins      = 0;
  game.todaySpins      = 0;
  game.currentSpins    = 0;
  game.lastHitSpins    = 0;
  game.zugarCounts     = { rushBig: 0, rushSmall: 0, normal: 0 };
  game.chargeCounts    = { upgraded: 0, plain: 0 };
  game.rushEntryCount  = 0;
  game.totalRushHits   = 0;
  game.rushHitCounts   = { big: 0, mid: 0, small: 0, none: 0 };
  game.allRushStats    = { rushTotalSpins: 0 };
  game.rush            = null;
  game.pending         = {};
  game.eigyoAlertShown = false;
  game.log             = [];
  render();
}
