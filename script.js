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
  rushSessionHitCounts: { big: 0, mid: 0, small: 0, none: 0 },
  rushEntryBalls: 0, // RUSH突入契機（初当たり）の実質獲得出玉
  rushCycleSpins: 0, // 直近のRUSH突入/当選から何回転目か
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
    addBalls(info.actual); // 収支には実質獲得出玉を計上
    game.currentSpins = 0;
    game.lastHitSpins = game.totalSpins;
    game.pending = { source: 'zugar', typeKey, balls: info.balls, actual: info.actual, entersRush: info.entersRush };
    addLog(`図柄揃い！ ＋${info.balls}球`, 'win'); // 表示出玉は今まで通り
    setState('hit_result');
    return true;
  }

  if (result === 'charge') {
    const upgraded = rollChargeUpgrade();
    const balls  = upgraded ? CHARGE_BALLS_UPGRADED  : CHARGE_BALLS_PLAIN;
    const actual = upgraded ? CHARGE_ACTUAL_UPGRADED : CHARGE_ACTUAL_PLAIN;
    game.chargeCounts[upgraded ? 'upgraded' : 'plain']++;
    addBalls(actual); // 収支には実質獲得出玉を計上
    game.pending = { source: 'charge', upgraded, balls, actual, entersRush: upgraded };
    addLog(`チャージ！ ＋${balls}球${upgraded ? '（2R+10R昇格）' : ''}`, 'charge'); // 表示出玉は今まで通り
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
    game.rushSessionHitCounts = { big: 0, mid: 0, small: 0, none: 0 };
    game.rushEntryBalls = game.pending.actual; // 初当たりの実質獲得出玉をRUSH側の総獲得出玉に持ち越す
    game.rushCycleSpins = 0;
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

// 1チャンス消化。ヒット/RUSH終了など画面遷移が起きたら true を返す。
// 外れは無演出（ST/残保留が減るだけ）なので画面遷移させず false を返す。
function runRushSpin() {
  game.allRushStats.rushTotalSpins++;
  game.rushCycleSpins++;
  const wasReservePhase = game.rush.stRemaining === 0; // 保留消化中の当たりはsmallに固定される（logic.js側）
  const { rushState, outcome, hitType, balls, actual } = applyRushChance(game.rush);
  game.rush = rushState;

  if (outcome === 'miss') {
    return false;
  }

  if (outcome === 'rush_end') {
    addLog('拳王RUSH終了 → リザルトへ');
    setState('rush_result');
    return true;
  }

  game.totalRushHits++;
  game.rushHitCounts[hitType]++;
  game.rushSessionHitCounts[hitType]++;
  addBalls(actual); // 収支には実質獲得出玉を計上
  // 保留消化中は必ずsmallになる（振り分けではなく確定）ため100%表示
  const hitPercent = wasReservePhase ? 100 : Math.round(RUSH_HIT_TYPES[hitType].weight * 100);
  game.pending = { hitType, balls, spinsThisCycle: game.rushCycleSpins, hitPercent };
  addLog(hitType === 'none' ? 'STリセット！継続！' : `${balls}個！ ＋${balls}球`, 'rush'); // 表示出玉は今まで通り
  game.rushCycleSpins = 0;
  setState('rush_hit_result');
  return true;
}

function handleRushSpin() {
  if (!runRushSpin()) {
    setState('rush_idle'); // 外れ：ST/残保留の表示だけ更新して継続
  }
}

function handleRushSpin10() {
  for (let i = 0; i < 10; i++) {
    if (runRushSpin()) return;
  }
  setState('rush_idle');
}

// applyRushChance（logic.js）は最大 RUSH_ST_COUNT+RUSH_RESERVE_COUNT 回の外れで
// 必ずhitかrush_endに解決するため、この無限ループは有限回で終了する。
function runRushUntilTransition() {
  for (;;) {
    if (runRushSpin()) return;
  }
}

function handleRushSkip() {
  runRushUntilTransition();
}

// 保留4回消化ボタン。ST消化後（stRemaining===0）にのみ表示される画面から呼ばれる。
function handleRushConsumeReserve() {
  runRushUntilTransition();
}

function handleRushHitContinue() {
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
  game.rushSessionHitCounts = { big: 0, mid: 0, small: 0, none: 0 };
  game.rushEntryBalls  = 0;
  game.rushCycleSpins  = 0;
  game.allRushStats    = { rushTotalSpins: 0 };
  game.rush            = null;
  game.pending         = {};
  game.eigyoAlertShown = false;
  game.log             = [];
  render();
}

// ---- 状態セット & レンダリング ----

function setState(state) {
  game.state = state;
  render();
}

function render() {
  renderHeader();
  renderModeBadge();
  renderMainScreen();
  renderRushStats();
}

function renderHeader() {
  const mochiInt = Math.floor(game.mochiDama);
  document.getElementById('mochi-dama').textContent   = mochiInt.toLocaleString();
  document.getElementById('toushi-value').textContent = game.toushi.toLocaleString();

  const shuushi   = game.bankedYen + mochiInt * 4 - game.toushi;
  const shuushiEl = document.getElementById('shuushi-value');
  shuushiEl.textContent = (shuushi >= 0 ? '+' : '') + shuushi.toLocaleString();
  shuushiEl.className   = 'money-value ' + (shuushi >= 0 ? 'green' : 'red');

  document.getElementById('current-spins').textContent    = game.currentSpins.toLocaleString();
  document.getElementById('total-spins-disp').textContent = game.totalSpins.toLocaleString();
  document.getElementById('day-badge').textContent        = `${game.dayNumber}日目`;
  document.getElementById('fee-block').textContent        = `${game.spinRate}回転/千円`;

  const rushCountEl = document.getElementById('rush-count');
  rushCountEl.textContent = game.mode === 'rush'
    ? `${game.rush.stRemaining}／${game.rush.reserveRemaining}`
    : '－';

  const zugarTotal  = game.zugarCounts.rushBig + game.zugarCounts.rushSmall + game.zugarCounts.normal;
  const chargeTotal = game.chargeCounts.upgraded + game.chargeCounts.plain;
  const normalFirstHit = zugarTotal + chargeTotal;
  document.getElementById('normal-first-hit').textContent  = normalFirstHit + '回';
  document.getElementById('normal-first-prob').textContent = normalFirstHit > 0 && game.totalSpins > 0
    ? '1/' + Math.round(game.totalSpins / normalFirstHit).toLocaleString()
    : '1/―';

  const rushRate = normalFirstHit > 0
    ? Math.round(game.rushEntryCount / normalFirstHit * 100)
    : 0;
  document.getElementById('rush-entry-info').textContent =
    `(拳王RUSH突入${game.rushEntryCount}回・${rushRate}%)`;

  const totalHitCount = normalFirstHit + game.totalRushHits;
  document.getElementById('total-hit-count').textContent = totalHitCount + '回';
}

function renderModeBadge() {
  const el = document.getElementById('mode-badge');
  if (game.mode === 'rush') {
    el.textContent = '拳王RUSH中';
    el.className = 'rush';
  } else {
    el.textContent = '通常時';
    el.className = '';
  }
}

function renderMainScreen() {
  document.getElementById('main-screen').innerHTML = buildScreen(game.state);
}

function renderRushStats() {
  const a = game.allRushStats;
  const h = game.rushHitCounts;
  document.getElementById('rs-hits').textContent  = game.totalRushHits + '回';
  document.getElementById('rs-spins').textContent = a.rushTotalSpins + '回';
  document.getElementById('rs-big').textContent   = h.big + '回';
  document.getElementById('rs-mid').textContent   = h.mid + '回';
  document.getElementById('rs-small').textContent = h.small + '回';
  document.getElementById('rs-none').textContent  = h.none + '回';
}

function renderLog() {
  const el = document.getElementById('log-list');
  el.innerHTML = game.log.map(item =>
    `<div class="log-item ${item.type}">${item.text}</div>`
  ).join('');
}

function spinRateOptionsHtml() {
  return SPIN_RATE_OPTIONS.map(rate =>
    `<option value="${rate}" ${rate === game.spinRate ? 'selected' : ''}>${rate}回転</option>`
  ).join('');
}

function tenThousandYenSpins() {
  return game.spinRate * 10;
}

function buildScreen(state) {
  switch (state) {

    case 'normal_idle':
      return `<div class="screen">
        <button class="btn-start" onclick="handleStart()">START</button>
        <p class="prob-hint">初当たり確率 1/${(1 / P_TOTAL_HIT).toFixed(1)}（図柄揃い＋チャージ昇格）</p>
        <div class="spin-rate-block">
          <span class="spin-rate-label">1000円あたりの回転数</span>
          <select class="spin-rate-select" onchange="handleSpinRateChange(this.value)">
            ${spinRateOptionsHtml()}
          </select>
        </div>
        <div class="auto-spin-btns">
          <div class="auto-spin-wrap">
            <button class="btn-auto" onclick="autoSpin(${tenThousandYenSpins()})">${tenThousandYenSpins()}回転回す</button>
            <p class="spin-cost-hint">約10,000円消費</p>
          </div>
        </div>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;

    case 'lose_result':
      return `<div class="screen">
        <p class="result-main lose">はずれ</p>
        <button class="btn-sub" onclick="backToNormal()" style="margin-top:8px;">続ける</button>
      </div>`;

    case 'hit_result': {
      const p = game.pending;
      if (p.source === 'zugar') {
        const titleMap = { rushBig: '10R×3', rushSmall: '10R', normal: '10R' };
        const zugarPercent = ZUGAR_TYPES[p.typeKey].displayPercent;
        return `<div class="screen">
          <p class="result-main win">図柄揃い！</p>
          <p class="prob-hint">当選確率 1/${(1 / P_TOTAL_HIT).toFixed(1)}の${zugarPercent}%</p>
          <div class="vibun-box ${p.entersRush ? 'rush-box' : 'normal-box'}">
            <p class="bonus-main ${p.entersRush ? 'premium' : 'standard'}">${titleMap[p.typeKey]}</p>
            <p class="bonus-sub">＋${p.balls.toLocaleString()}球獲得</p>
            ${p.entersRush ? '<p class="rush-announce">🔥 拳王RUSH突入！</p>' : ''}
          </div>
          <button class="btn-action" onclick="handleHitContinue()">▶ ${p.entersRush ? 'RUSHへ' : '通常へ'}</button>
        </div>`;
      }
      const chargeProbHint = p.upgraded
        ? `当選確率 1/${(1 / P_TOTAL_HIT).toFixed(1)}の${CHARGE_UPGRADE_DISPLAY_PERCENT}%`
        : `当選確率 1/${(1 / P_CHARGE).toFixed(1)}`;
      return `<div class="screen">
        <p class="result-main charge">チャージ！</p>
        <p class="prob-hint">${chargeProbHint}</p>
        <div class="vibun-box charge-box">
          <p class="bonus-main charge">${p.upgraded ? '2R+10R昇格' : 'チャージ'}</p>
          <p class="bonus-sub">＋${p.balls.toLocaleString()}球獲得</p>
          ${p.upgraded ? '<p class="rush-announce">🔥 拳王RUSH突入！</p>' : ''}
        </div>
        <button class="btn-action" onclick="handleHitContinue()">▶ ${p.entersRush ? 'RUSHへ' : '通常へ'}</button>
      </div>`;
    }

    case 'rush_idle': {
      const chainCount = game.rush.totalHits + 1; // 初当たり含む連チャン数
      const totalBalls = game.rushEntryBalls + game.rush.actualBalls; // 初当たり含む総獲得出玉（実質）

      if (game.rush.stRemaining > 0) {
        return `<div class="screen">
        <p class="chain-label">${chainCount}連チャン中</p>
        <p class="rush-title">拳王RUSH</p>
        <p class="rush-total-balls">総獲得出玉 ${totalBalls.toLocaleString()}球</p>
        <p class="rush-sub">ST残り <span>${game.rush.stRemaining}</span> 回</p>
        <div class="rush-spin-btns">
          <button class="btn-rush-spin" onclick="handleRushSpin()">1回転</button>
          <button class="btn-rush-spin" onclick="handleRushSpin10()">10回転</button>
          <button class="btn-rush-spin skip" onclick="handleRushSkip()">スキップ</button>
        </div>
        <p class="prob-hint">当選確率 1/10.7</p>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;
      }

      return `<div class="screen">
        <p class="chain-label">${chainCount}連チャン中</p>
        <p class="rush-title">拳王RUSH</p>
        <p class="rush-total-balls">総獲得出玉 ${totalBalls.toLocaleString()}球</p>
        <p class="rush-sub">保留 <span>${game.rush.reserveRemaining}</span></p>
        <button class="btn-action" onclick="handleRushConsumeReserve()">消化する</button>
        <p class="prob-hint">当選確率 1/10.7</p>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;
    }

    case 'rush_hit_result': {
      const p = game.pending;
      const labelMap = { big: '6000個', mid: '4500個', small: '1500個', none: 'STリセット！' };
      return `<div class="screen">
        <p class="result-sub">${p.spinsThisCycle}回転で当選</p>
        <div class="vibun-box rush-box">
          <p class="bonus-main ${p.hitType === 'none' ? 'none' : 'standard'}">${labelMap[p.hitType]}</p>
          <p class="bonus-sub">＋${p.balls.toLocaleString()}球獲得</p>
          <p class="prob-hint">振り分け ${p.hitPercent}%</p>
        </div>
        <button class="btn-action" onclick="handleRushHitContinue()">▶ RUSH継続へ</button>
      </div>`;
    }

    case 'rush_result': {
      const h = game.rushSessionHitCounts;
      const chainCount = game.rush.totalHits + 1; // 初当たり含む連チャン数
      const totalBalls = game.rushEntryBalls + game.rush.actualBalls; // 初当たり含む総獲得出玉（実質）
      const lines = [];
      if (h.big   > 0) lines.push(`<div class="result-row"><span class="rr-label">6000個</span><span class="rr-val">×${h.big}回</span></div>`);
      if (h.mid   > 0) lines.push(`<div class="result-row"><span class="rr-label">4500個</span><span class="rr-val">×${h.mid}回</span></div>`);
      if (h.small > 0) lines.push(`<div class="result-row"><span class="rr-label">1500個</span><span class="rr-val">×${h.small}回</span></div>`);
      if (h.none  > 0) lines.push(`<div class="result-row"><span class="rr-label">STリセット</span><span class="rr-val">×${h.none}回</span></div>`);
      if (lines.length === 0) lines.push(`<p style="color:#555; font-size:13px;">大当たりなし</p>`);
      return `<div class="screen">
        <p class="rush-result-title">拳王RUSH リザルト</p>
        <div class="rush-result-box">
          <div class="result-row highlight">
            <span class="rr-label">連チャン数（初当たり含む）</span>
            <span class="rr-val gold">${chainCount}連</span>
          </div>
          <div class="result-row">
            <span class="rr-label">獲得出玉（初当たり含む）</span>
            <span class="rr-val gold">${totalBalls.toLocaleString()}球</span>
          </div>
          <hr class="result-hr">
          <p class="rr-section">ボーナス内訳</p>
          ${lines.join('')}
        </div>
        <button class="btn-action" onclick="handleRushResultEnd()" style="margin-top:16px;">▶ 通常へ戻る</button>
      </div>`;
    }

    case 'eigyo_alert':
      return `<div class="screen">
        <p style="font-size:22px; font-weight:bold; color:#ff5b4d; text-align:center; line-height:1.6;">
          本日の営業時間が終了しました
        </p>
        <p style="font-size:16px; color:#ccc; text-align:center;">翌日も打ちますか？</p>
        <div style="display:flex; gap:16px; margin-top:8px;">
          <button class="btn-action" style="flex:1;" onclick="handleEigyoHai()">はい</button>
          <button class="btn-action secondary" style="flex:1;" onclick="handleEigyoIie()">いいえ</button>
        </div>
      </div>`;

    case 'taiten_result': {
      const mochi    = Math.floor(game.mochiDama);
      const mochiYen = mochi * 4;
      const shuushi  = game.bankedYen + mochiYen - game.toushi;
      const shuushiColor = shuushi >= 0 ? '#44cc88' : '#cc6666';
      const shuushiSign  = shuushi >= 0 ? '＋' : '';
      const zugarTotal  = game.zugarCounts.rushBig + game.zugarCounts.rushSmall + game.zugarCounts.normal;
      const chargeTotal = game.chargeCounts.upgraded + game.chargeCounts.plain;
      return `<div class="screen">
        <p style="font-size:24px; font-weight:bold; color:#aaa;">退店します（${game.dayNumber}日目）</p>
        <div class="rush-result-box" style="max-width:320px;">
          <p class="rr-section" style="margin-bottom:8px;">収支発表</p>
          <div class="result-row">
            <span class="rr-label">総回転数</span>
            <span class="rr-val">${game.totalSpins.toLocaleString()}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">投資金額</span>
            <span class="rr-val" style="color:#cc6666;">${game.toushi.toLocaleString()}円</span>
          </div>
          <div class="result-row">
            <span class="rr-label">持ち球換算</span>
            <span class="rr-val">${mochiYen.toLocaleString()}円</span>
          </div>
          <div class="result-row">
            <span class="rr-label">繰越換金額</span>
            <span class="rr-val">${game.bankedYen.toLocaleString()}円</span>
          </div>
          <hr class="result-hr">
          <div class="result-row highlight">
            <span class="rr-label" style="font-weight:bold;">収支</span>
            <span class="rr-val" style="color:${shuushiColor}; font-size:22px;">
              ${shuushiSign}${shuushi.toLocaleString()}円
            </span>
          </div>
          <hr class="result-hr">
          <div class="result-row">
            <span class="rr-label">図柄揃い</span>
            <span class="rr-val">${zugarTotal}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">チャージ</span>
            <span class="rr-val">${chargeTotal}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">拳王RUSH中当たり</span>
            <span class="rr-val">${game.totalRushHits}回</span>
          </div>
        </div>
        <button class="btn-action" onclick="resetGame()" style="margin-top:8px;">▶ 最初の画面に戻る</button>
      </div>`;
    }

    default:
      return `<div class="screen"><p>...</p></div>`;
  }
}

render();
