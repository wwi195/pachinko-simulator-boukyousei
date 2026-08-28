# pachinko-simulator-boukyousei Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pachinko-simulator-boukyousei`, a pachinko simulator for "e 北斗の拳11 暴凶星", reusing `pachinko-simulator-ghoul`'s architecture and UI shell but with a probability model reconstructed from public spec data and a new daily-limit/next-day-continuation flow, per `docs/superpowers/specs/2026-08-28-boukyousei-spec-design.md`.

**Architecture:** Same 3-file static layout as ghoul (`index.html` / `style.css` / `script.js`), plus a DOM-free `logic.js` holding all pure probability/state-transition logic, unit-tested with Node's built-in `node:test`. Black×red visual theme (Hokuto no Ken imagery). No images, no Supabase.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step, no npm dependencies. Tests run via `node --test "test/**/*.test.js"` (the glob form — `node --test test/` is known to fail with MODULE_NOT_FOUND on this machine's Node version).

---

## Key design decisions carried over from the spec (re-affirmed here for a fresh implementer with no prior context)

- `logic.js` is loaded via a plain `<script src="logic.js">` tag before `script.js`, both non-module classic scripts sharing one global lexical scope — no bundler, no `window.` prefixing, no ES modules.
- `logic.js` is dual-mode: a `if (typeof module !== 'undefined' && module.exports) { module.exports = {...}; }` guard at the bottom exports for Node's `require` (tests) while staying inert in the browser.
- Random-number-driven functions must be deterministically testable: always call `Math.random()` directly (never wrap it), so tests can monkey-patch `Math.random` via a `withMockRandom(values, fn)` helper.
- Multi-way weighted distributions (zugar-type split, RUSH hit-type split) use a **single** `Math.random()` draw compared against **cumulative** thresholds, not independent per-branch draws.
- **Probability model (from the spec, do not re-derive):**
  - `P_ZUGAR = 0.96 / 399.8` (図柄揃い単体)
  - `P_CHARGE = 1 / 2723.4` (チャージ発生、単発)
  - `CHARGE_UPGRADE_RATE = (0.04 / 399.8) / P_CHARGE` (チャージ発生時に2R+10R昇格する条件付き確率、≈27.25%)
  - Zugar internal split (of a zugar hit): `rushBig` weight `5/96` (4500球, RUSH突入), `rushSmall` weight `52/96` (1500球, RUSH突入), `normal` weight `39/96` (1500球, 通常へ)
  - RUSH per-chance hit probability: `P_RUSH_CHANCE = 1/10.7`, one cycle = `RUSH_ST_COUNT=10` regular chances + `RUSH_RESERVE_COUNT=4` reserved-ball chances (14 total). Any hit within the 14 resets both counters to fresh (10/4) and the RUSH continues; exhausting all 14 without a hit ends RUSH.
  - RUSH hit-type split (of a RUSH chance hit): `big` weight `0.10` (6000球), `mid` weight `0.40` (4500球), `small` weight `0.30` (1500球), `none` weight `0.20` (0球、それでもヒット扱いでST/残保留はリセットされ継続)
- **Daily-limit / next-day flow (new for this project, no ghoul/lycoris precedent — modeled after `pachinko-simulator-ghoul-idle`'s `continueNextDay()`):** a `todaySpins` counter (separate from the lifetime `totalSpins`) triggers the closing-time alert at `DAILY_SPIN_LIMIT = 2000`. Choosing to continue banks the current `mochiDama` into a cumulative `bankedYen` field (at 4 yen/ball), resets `mochiDama` to 0 and `todaySpins` to 0, increments `dayNumber`, and forces `mode` back to `'normal'` (any in-progress RUSH is abandoned, matching a real "leaving the store" boundary). Final settlement (退店) sums `bankedYen + mochiDama*4 - toushi`.

---

## Task 1: Project scaffold

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-boukyousei\package.json`
- Create: `C:\Users\ab_99\pachinko-simulator-boukyousei\.gitignore`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "pachinko-simulator-boukyousei",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "test": "node --test \"test/**/*.test.js\""
  }
}
```

- [ ] **Step 2: Create .gitignore**

```
node_modules/
```

- [ ] **Step 3: Commit**

```bash
cd /c/Users/ab_99/pachinko-simulator-boukyousei
git add package.json .gitignore
git commit -m "chore: scaffold project"
```

---

## Task 2: logic.js — spin-rate constants and normal-mode (zugar/charge) rolls

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-boukyousei\logic.js`
- Test: `C:\Users\ab_99\pachinko-simulator-boukyousei\test\logic.test.js`

- [ ] **Step 1: Write the failing tests**

Create `test/logic.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../logic.js');

function withMockRandom(values, fn) {
  const original = Math.random;
  let i = 0;
  Math.random = () => values[Math.min(i++, values.length - 1)];
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test('SPIN_RATE_OPTIONS lists the four selectable rates with 16 as default', () => {
  assert.deepEqual(logic.SPIN_RATE_OPTIONS, [14, 16, 18, 20]);
  assert.equal(logic.DEFAULT_SPIN_RATE, 16);
});

test('calcSpinCost returns balls-per-spin for a given spins-per-1000-yen rate', () => {
  assert.equal(logic.calcSpinCost(16), 250 / 16);
  assert.equal(logic.calcSpinCost(14), 250 / 14);
  assert.equal(logic.calcSpinCost(18), 250 / 18);
  assert.equal(logic.calcSpinCost(20), 250 / 20);
});

test('probability constants match the spec derivation', () => {
  assert.equal(logic.P_ZUGAR, 0.96 / 399.8);
  assert.equal(logic.P_CHARGE, 1 / 2723.4);
  assert.equal(logic.CHARGE_UPGRADE_RATE, (0.04 / 399.8) / (1 / 2723.4));
});

test('spinNormal returns zugar/charge/miss by cumulative threshold', () => {
  assert.equal(withMockRandom([0], () => logic.spinNormal()), 'zugar');
  const midCharge = logic.P_ZUGAR + logic.P_CHARGE / 2;
  assert.equal(withMockRandom([midCharge], () => logic.spinNormal()), 'charge');
  assert.equal(withMockRandom([0.5], () => logic.spinNormal()), 'miss');
});

test('ZUGAR_TYPES lists the 3 zugar outcomes with correct weight/balls/entersRush', () => {
  assert.deepEqual(logic.ZUGAR_TYPE_ORDER, ['rushBig', 'rushSmall', 'normal']);
  assert.deepEqual(logic.ZUGAR_TYPES.rushBig,   { weight: 5 / 96,  balls: 4500, entersRush: true });
  assert.deepEqual(logic.ZUGAR_TYPES.rushSmall, { weight: 52 / 96, balls: 1500, entersRush: true });
  assert.deepEqual(logic.ZUGAR_TYPES.normal,    { weight: 39 / 96, balls: 1500, entersRush: false });
});

test('rollZugarType picks the type whose cumulative range contains the draw', () => {
  // cumulative: rushBig<5/96(~0.0521), rushSmall<57/96(~0.5938), normal<1.0
  assert.equal(withMockRandom([0],    () => logic.rollZugarType()), 'rushBig');
  assert.equal(withMockRandom([0.3],  () => logic.rollZugarType()), 'rushSmall');
  assert.equal(withMockRandom([0.9],  () => logic.rollZugarType()), 'normal');
});

test('rollChargeUpgrade is true under CHARGE_UPGRADE_RATE, false otherwise', () => {
  assert.equal(withMockRandom([0], () => logic.rollChargeUpgrade()), true);
  assert.equal(withMockRandom([0.9], () => logic.rollChargeUpgrade()), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/ab_99/pachinko-simulator-boukyousei && node --test "test/**/*.test.js"`
Expected: FAIL — `Cannot find module '../logic.js'`

- [ ] **Step 3: Write minimal implementation**

Create `logic.js`:

```js
'use strict';

const SPIN_RATE_OPTIONS = [14, 16, 18, 20];
const DEFAULT_SPIN_RATE = 16;

function calcSpinCost(spinRate) {
  return 250 / spinRate;
}

// ---- 通常時: 図柄揃い・チャージ ----
// 導出過程は docs/superpowers/specs/2026-08-28-boukyousei-spec-design.md を参照。

const P_TOTAL_HIT = 1 / 399.8;
const P_CHARGE = 1 / 2723.4;
const P_ZUGAR = 0.96 / 399.8;
const CHARGE_UPGRADE_RATE = (0.04 / 399.8) / P_CHARGE;

function spinNormal() {
  const r = Math.random();
  if (r < P_ZUGAR) return 'zugar';
  if (r < P_ZUGAR + P_CHARGE) return 'charge';
  return 'miss';
}

const ZUGAR_TYPES = {
  rushBig:   { weight: 5 / 96,  balls: 4500, entersRush: true },
  rushSmall: { weight: 52 / 96, balls: 1500, entersRush: true },
  normal:    { weight: 39 / 96, balls: 1500, entersRush: false },
};
const ZUGAR_TYPE_ORDER = ['rushBig', 'rushSmall', 'normal'];

function rollZugarType() {
  const r = Math.random();
  let cumulative = 0;
  for (const key of ZUGAR_TYPE_ORDER) {
    cumulative += ZUGAR_TYPES[key].weight;
    if (r < cumulative) return key;
  }
  return ZUGAR_TYPE_ORDER[ZUGAR_TYPE_ORDER.length - 1];
}

function rollChargeUpgrade() {
  return Math.random() < CHARGE_UPGRADE_RATE;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPIN_RATE_OPTIONS,
    DEFAULT_SPIN_RATE,
    calcSpinCost,
    P_TOTAL_HIT,
    P_CHARGE,
    P_ZUGAR,
    CHARGE_UPGRADE_RATE,
    spinNormal,
    ZUGAR_TYPES,
    ZUGAR_TYPE_ORDER,
    rollZugarType,
    rollChargeUpgrade,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/ab_99/pachinko-simulator-boukyousei && node --test "test/**/*.test.js"`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "feat: add spin-rate constants and normal-mode zugar/charge rolls"
```

---

## Task 3: logic.js — 拳王RUSH chance roll and cycle state reducer

**Files:**
- Modify: `logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/logic.test.js`:

```js
test('P_RUSH_CHANCE is 1/10.7, RUSH_ST_COUNT is 10, RUSH_RESERVE_COUNT is 4', () => {
  assert.equal(logic.P_RUSH_CHANCE, 1 / 10.7);
  assert.equal(logic.RUSH_ST_COUNT, 10);
  assert.equal(logic.RUSH_RESERVE_COUNT, 4);
});

test('spinRushChance returns hit when the draw beats P_RUSH_CHANCE, miss otherwise', () => {
  assert.equal(withMockRandom([0], () => logic.spinRushChance()), 'hit');
  assert.equal(withMockRandom([0.5], () => logic.spinRushChance()), 'miss');
});

test('RUSH_HIT_TYPES lists the 4 outcomes with correct weight/balls', () => {
  assert.deepEqual(logic.RUSH_HIT_TYPE_ORDER, ['big', 'mid', 'small', 'none']);
  assert.deepEqual(logic.RUSH_HIT_TYPES.big,   { weight: 0.10, balls: 6000 });
  assert.deepEqual(logic.RUSH_HIT_TYPES.mid,   { weight: 0.40, balls: 4500 });
  assert.deepEqual(logic.RUSH_HIT_TYPES.small, { weight: 0.30, balls: 1500 });
  assert.deepEqual(logic.RUSH_HIT_TYPES.none,  { weight: 0.20, balls: 0 });
});

test('rollRushHitType picks the type whose cumulative range contains the draw', () => {
  // cumulative: big<0.10, mid<0.50, small<0.80, none<1.0
  assert.equal(withMockRandom([0],    () => logic.rollRushHitType()), 'big');
  assert.equal(withMockRandom([0.3],  () => logic.rollRushHitType()), 'mid');
  assert.equal(withMockRandom([0.7],  () => logic.rollRushHitType()), 'small');
  assert.equal(withMockRandom([0.95], () => logic.rollRushHitType()), 'none');
});

test('createRushState starts with a fresh 10/4 cycle and zeroed counters', () => {
  assert.deepEqual(logic.createRushState(), {
    stRemaining: 10,
    reserveRemaining: 4,
    totalHits: 0,
    actualBalls: 0,
  });
});

test('applyRushChance: a miss with ST remaining decrements stRemaining only', () => {
  const state = logic.createRushState();
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushChance(state));
  assert.equal(outcome, 'miss');
  assert.deepEqual(rushState, { stRemaining: 9, reserveRemaining: 4, totalHits: 0, actualBalls: 0 });
});

test('applyRushChance: once ST is exhausted, a miss decrements reserveRemaining instead', () => {
  const state = { stRemaining: 0, reserveRemaining: 4, totalHits: 0, actualBalls: 0 };
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushChance(state));
  assert.equal(outcome, 'miss');
  assert.deepEqual(rushState, { stRemaining: 0, reserveRemaining: 3, totalHits: 0, actualBalls: 0 });
});

test('applyRushChance: a miss on the very last reserved chance ends the RUSH', () => {
  const state = { stRemaining: 0, reserveRemaining: 1, totalHits: 0, actualBalls: 0 };
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushChance(state));
  assert.equal(outcome, 'rush_end');
  assert.equal(rushState.reserveRemaining, 0);
});

test('applyRushChance: a hit rolls a bonus type, adds balls, and resets the cycle to fresh 10/4', () => {
  const state = { stRemaining: 3, reserveRemaining: 4, totalHits: 2, actualBalls: 9000 };
  // draws: [0]=spinRushChance hit, [0.3]=rollRushHitType->'mid' (4500)
  const { rushState, outcome, hitType, balls } =
    withMockRandom([0, 0.3], () => logic.applyRushChance(state));
  assert.equal(outcome, 'hit');
  assert.equal(hitType, 'mid');
  assert.equal(balls, 4500);
  assert.deepEqual(rushState, { stRemaining: 10, reserveRemaining: 4, totalHits: 3, actualBalls: 13500 });
});

test('applyRushChance: a "none" hit still resets the cycle and counts as a hit, with 0 balls', () => {
  const state = logic.createRushState();
  // draws: [0]=spinRushChance hit, [0.95]=rollRushHitType->'none' (0 balls)
  const { rushState, outcome, hitType, balls } =
    withMockRandom([0, 0.95], () => logic.applyRushChance(state));
  assert.equal(outcome, 'hit');
  assert.equal(hitType, 'none');
  assert.equal(balls, 0);
  assert.deepEqual(rushState, { stRemaining: 10, reserveRemaining: 4, totalHits: 1, actualBalls: 0 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/ab_99/pachinko-simulator-boukyousei && node --test "test/**/*.test.js"`
Expected: FAIL — `logic.P_RUSH_CHANCE` etc. are undefined

- [ ] **Step 3: Write minimal implementation**

Add to `logic.js` (before `module.exports`, after Task 2's additions):

```js
// ---- 拳王RUSH ----
// 1サイクル = 電サポ10回転 + 残保留4個 = 実質14回のチャンス。
// 最低1回当たればサイクルはヒットしてST/残保留が10/4にフルリセットされ継続する。
// 14回すべて外れたらRUSH終了。

const P_RUSH_CHANCE = 1 / 10.7;
const RUSH_ST_COUNT = 10;
const RUSH_RESERVE_COUNT = 4;

function spinRushChance() {
  return Math.random() < P_RUSH_CHANCE ? 'hit' : 'miss';
}

const RUSH_HIT_TYPES = {
  big:   { weight: 0.10, balls: 6000 },
  mid:   { weight: 0.40, balls: 4500 },
  small: { weight: 0.30, balls: 1500 },
  none:  { weight: 0.20, balls: 0 },
};
const RUSH_HIT_TYPE_ORDER = ['big', 'mid', 'small', 'none'];

function rollRushHitType() {
  const r = Math.random();
  let cumulative = 0;
  for (const key of RUSH_HIT_TYPE_ORDER) {
    cumulative += RUSH_HIT_TYPES[key].weight;
    if (r < cumulative) return key;
  }
  return RUSH_HIT_TYPE_ORDER[RUSH_HIT_TYPE_ORDER.length - 1];
}

function createRushState() {
  return {
    stRemaining: RUSH_ST_COUNT,
    reserveRemaining: RUSH_RESERVE_COUNT,
    totalHits: 0,
    actualBalls: 0,
  };
}

function applyRushChance(rushState) {
  const result = spinRushChance();

  if (result === 'hit') {
    const hitType = rollRushHitType();
    const balls = RUSH_HIT_TYPES[hitType].balls;
    const newState = {
      stRemaining: RUSH_ST_COUNT,
      reserveRemaining: RUSH_RESERVE_COUNT,
      totalHits: rushState.totalHits + 1,
      actualBalls: rushState.actualBalls + balls,
    };
    return { rushState: newState, outcome: 'hit', hitType, balls };
  }

  if (rushState.stRemaining > 0) {
    const newState = { ...rushState, stRemaining: rushState.stRemaining - 1 };
    if (newState.stRemaining === 0 && newState.reserveRemaining === 0) {
      return { rushState: newState, outcome: 'rush_end' };
    }
    return { rushState: newState, outcome: 'miss' };
  }

  const newState = { ...rushState, reserveRemaining: rushState.reserveRemaining - 1 };
  if (newState.reserveRemaining === 0) {
    return { rushState: newState, outcome: 'rush_end' };
  }
  return { rushState: newState, outcome: 'miss' };
}
```

Update `module.exports` to also include:
`P_RUSH_CHANCE, RUSH_ST_COUNT, RUSH_RESERVE_COUNT, spinRushChance, RUSH_HIT_TYPES, RUSH_HIT_TYPE_ORDER, rollRushHitType, createRushState, applyRushChance,`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/ab_99/pachinko-simulator-boukyousei && node --test "test/**/*.test.js"`
Expected: PASS (all tests so far — 17 total: 7 from Task 2 + 10 new)

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "feat: add rush chance roll and cycle state reducer"
```

---

## Task 4: logic.js — day-crossing helpers

**Files:**
- Modify: `logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/logic.test.js`:

```js
test('DAILY_SPIN_LIMIT is 2000 and BALL_TO_YEN is 4', () => {
  assert.equal(logic.DAILY_SPIN_LIMIT, 2000);
  assert.equal(logic.BALL_TO_YEN, 4);
});

test('ballsToYen floors fractional balls then converts at 4 yen/ball', () => {
  assert.equal(logic.ballsToYen(1000), 4000);
  assert.equal(logic.ballsToYen(250.7), 1000);
  assert.equal(logic.ballsToYen(0), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/ab_99/pachinko-simulator-boukyousei && node --test "test/**/*.test.js"`
Expected: FAIL — `logic.DAILY_SPIN_LIMIT` is undefined

- [ ] **Step 3: Write minimal implementation**

Add to `logic.js` (before `module.exports`, after Task 3's additions):

```js
// ---- 日またぎ ----

const DAILY_SPIN_LIMIT = 2000;
const BALL_TO_YEN = 4;

function ballsToYen(balls) {
  return Math.floor(balls) * BALL_TO_YEN;
}
```

Update `module.exports` to also include: `DAILY_SPIN_LIMIT, BALL_TO_YEN, ballsToYen,`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/ab_99/pachinko-simulator-boukyousei && node --test "test/**/*.test.js"`
Expected: PASS (all tests — 19 total)

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "feat: add day-crossing helpers"
```

---

## Task 5: index.html — page skeleton

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-boukyousei\index.html`

- [ ] **Step 1: Create index.html**

Mirrors `pachinko-simulator-ghoul`'s header/log structure and element IDs (so `script.js` can target them the same way), retitled for 暴凶星, with a day-badge added next to the total-spins display and no 先バレ-confidence dropdown (this spec has no such mechanic).

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>パチンコシミュレーター（e北斗の拳11 暴凶星）</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">

    <div id="title-bar">パチンコ　e北斗の拳11　暴凶星</div>

    <div id="header">

      <div class="hrow hrow1">
        <div class="spins-block">
          <span class="spins-current" id="current-spins">0</span>
          <span class="spins-unit">回</span>
          <span class="spins-sep">／累計</span>
          <span class="spins-total" id="total-spins-disp">0</span>
          <span class="spins-unit">回</span>
          <span class="day-badge" id="day-badge">1日目</span>
        </div>
        <div id="mode-badge">通常時</div>
        <div class="esup-block">
          <div class="esup-label">ST残り／保留</div>
          <div class="esup-value" id="rush-count">－</div>
        </div>
      </div>

      <div class="hrow hrow2">
        <div class="money-block">
          <span class="money-label">持ち球</span>
          <span class="money-value gold" id="mochi-dama">0</span>
          <span class="money-unit">球</span>
        </div>
        <div class="money-block">
          <span class="money-label">投資</span>
          <span class="money-value red" id="toushi-value">0</span>
          <span class="money-unit">円</span>
        </div>
        <div class="money-block">
          <span class="money-label">収支</span>
          <span class="money-value red" id="shuushi-value">0</span>
          <span class="money-unit">円</span>
        </div>
      </div>

      <div class="hrow hrow3">
        <div class="hrow3-header">
          <span class="hrow3-title">大当たり総回数</span>
          <span class="total-hit-block">
            <span class="total-hit-count" id="total-hit-count">0回</span>
          </span>
          <span class="fee-block" id="fee-block">16回転/千円</span>
        </div>
        <div class="hrow3-normal-line">
          <span class="hit-label2">通常時初当たり</span>
          <span class="hit-count" id="normal-first-hit">0回</span>
          <span class="hit-prob" id="normal-first-prob">1/―</span>
          <span class="rush-entry" id="rush-entry-info">(拳王RUSH突入0回)</span>
        </div>
      </div>

    </div><!-- /header -->

    <div id="main-screen"></div>

    <div id="rush-stats-bar">
      <div class="rsb-header">
        <span class="rsb-title">通算RUSH成績</span>
        <span class="rsb-item">
          <span class="rsb-label">RUSH中当たり</span>
          <span class="rsb-val" id="rs-hits">0回</span>
        </span>
        <span class="rsb-item">
          <span class="rsb-label">RUSH中回転</span>
          <span class="rsb-val" id="rs-spins">0回</span>
        </span>
      </div>
      <div class="rsb-row">
        <span class="rsb-item">
          <span class="rsb-label">6000個</span>
          <span class="rsb-val" id="rs-big">0回</span>
        </span>
        <span class="rsb-item">
          <span class="rsb-label">4500個</span>
          <span class="rsb-val" id="rs-mid">0回</span>
        </span>
        <span class="rsb-item">
          <span class="rsb-label">1500個</span>
          <span class="rsb-val" id="rs-small">0回</span>
        </span>
        <span class="rsb-item">
          <span class="rsb-label">出玉なし</span>
          <span class="rsb-val" id="rs-none">0回</span>
        </span>
      </div>
    </div>

    <div id="log-area">
      <div id="log-title">履歴</div>
      <div id="log-list"></div>
    </div>

  </div>
  <script src="logic.js"></script>
  <script src="script.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add page skeleton (index.html)"
```

---

## Task 6: style.css — black×red visual theme

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-boukyousei\style.css`

- [ ] **Step 1: Create style.css**

Structurally identical to `pachinko-simulator-ghoul`'s stylesheet (same class names, so `script.js`'s templates need no class-name changes), with the gold accent (`#f0c040` family) replaced by a Hokuto-red accent (`#e2231a` family) throughout, plus a small `.day-badge` addition.

```css
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

body {
  background: #0a0a0a;
  color: #fff;
  font-family: 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif;
  max-width: 390px;
  margin: 0 auto;
  min-height: 100vh;
  overflow-x: hidden;
}

#app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

/* タイトル */
#title-bar {
  background: linear-gradient(135deg, #1a0000, #2d0000);
  border-bottom: 2px solid #e2231a;
  text-align: center;
  padding: 8px 12px;
  font-size: 14px;
  font-weight: bold;
  color: #ff5b4d;
  letter-spacing: 1px;
  text-shadow: 0 0 10px rgba(226,35,26,0.6);
}

/* ========== ヘッダー ========== */
#header {
  background: #111;
  border-bottom: 2px solid #e2231a;
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 0;
}

.hrow {
  display: flex;
  align-items: center;
  padding: 6px 12px;
}

.hrow1 {
  justify-content: space-between;
  border-bottom: 1px solid #1e1e1e;
}

.spins-block { display: flex; align-items: baseline; gap: 2px; }
.spins-current { font-size: 20px; font-weight: bold; color: #ff5b4d; }
.spins-total   { font-size: 16px; font-weight: bold; color: #aaa; }
.spins-unit    { font-size: 11px; color: #666; }
.spins-sep     { font-size: 11px; color: #555; margin: 0 3px; }
.day-badge     { font-size: 10px; color: #999; margin-left: 8px; border: 1px solid #444; border-radius: 10px; padding: 2px 8px; }

#mode-badge {
  font-size: 12px;
  font-weight: bold;
  padding: 5px 12px;
  border-radius: 20px;
  background: #222;
  border: 1px solid #444;
  color: #aaa;
  transition: all 0.3s;
}
#mode-badge.rush { background: #3d0000; border-color: #ff3333; color: #ff5555; }

.esup-block { text-align: right; min-width: 70px; }
.esup-label { font-size: 10px; color: #666; }
.esup-value { font-size: 16px; font-weight: bold; color: #ff5b4d; }

.hrow2 {
  justify-content: space-around;
  border-bottom: 1px solid #1e1e1e;
  padding: 5px 12px;
}

.money-block { display: flex; align-items: baseline; gap: 4px; }
.money-label { font-size: 10px; color: #666; }
.money-value { font-size: 19px; font-weight: bold; }
.money-value.gold  { color: #ff5b4d; }
.money-value.red   { color: #cc6666; }
.money-value.green { color: #44cc88; }
.money-unit  { font-size: 11px; color: #666; }

.hrow3 {
  flex-direction: column;
  padding: 4px 12px 6px;
  gap: 3px;
}

.hrow3-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.hrow3-title {
  font-size: 11px;
  font-weight: bold;
  color: #999;
  letter-spacing: 0.5px;
}

.hrow3-normal-line {
  display: flex;
  align-items: baseline;
  gap: 4px;
  margin-bottom: 2px;
  flex-wrap: wrap;
}

.hit-label2 { font-size: 9px; color: #666; }
.hit-count  { font-size: 12px; font-weight: bold; color: #ccc; }
.hit-prob   { font-size: 9px; color: #555; }
.rush-entry { font-size: 9px; color: #ff8855; }

.total-hit-block { display: flex; align-items: baseline; gap: 3px; }
.total-hit-count { font-size: 12px; font-weight: bold; color: #ff5b4d; }

.fee-block {
  font-size: 9px;
  color: #555;
  white-space: nowrap;
}

/* ========== メイン画面 ========== */
#main-screen {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 20px;
  min-height: 380px;
}

.screen {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  animation: fadeIn 0.25s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* STARTボタン */
.btn-start {
  width: 148px;
  height: 148px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 35%, #ff5b4d, #8a0f08);
  border: 5px solid #ffd0cc;
  font-size: 26px;
  font-weight: bold;
  color: #fff;
  letter-spacing: 2px;
  cursor: pointer;
  box-shadow: 0 0 30px rgba(226,35,26,0.5), 0 4px 12px rgba(0,0,0,0.6);
  transition: transform 0.1s, box-shadow 0.1s;
  text-shadow: 0 1px 3px rgba(0,0,0,0.5);
}
.btn-start:active { transform: scale(0.94); box-shadow: 0 0 10px rgba(226,35,26,0.25); }

.btn-start.rush-btn {
  background: radial-gradient(circle at 35% 35%, #ff8844, #aa1100);
  border-color: #ffcccc;
  box-shadow: 0 0 30px rgba(255,80,50,0.5), 0 4px 12px rgba(0,0,0,0.6);
}

/* アクションボタン */
.btn-action {
  width: 100%;
  max-width: 300px;
  padding: 15px;
  border-radius: 12px;
  background: linear-gradient(135deg, #e2231a, #7a0f0a);
  border: 2px solid #ff9a90;
  font-size: 17px;
  font-weight: bold;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  transition: opacity 0.1s, transform 0.1s;
  text-shadow: 0 1px 2px rgba(0,0,0,0.4);
}
.btn-action:active { opacity: 0.75; transform: scale(0.97); }

.btn-action.secondary {
  background: linear-gradient(135deg, #555, #333) !important;
  border-color: #888 !important;
}

/* サブボタン */
.btn-sub {
  font-size: 14px;
  color: #888;
  background: none;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 8px 20px;
  cursor: pointer;
}
.btn-sub:active { opacity: 0.7; }

/* 確率表示 */
.prob-hint { font-size: 11px; color: #555; }

/* 結果テキスト */
.result-main {
  font-size: 38px;
  font-weight: bold;
  letter-spacing: 3px;
}
.result-main.win    { color: #ff5b4d; text-shadow: 0 0 20px rgba(226,35,26,0.7); }
.result-main.lose   { color: #555; }
.result-main.rush   { color: #ff4444; text-shadow: 0 0 20px rgba(255,68,68,0.7); }
.result-main.charge { color: #e0a030; }

.result-balls { font-size: 32px; font-weight: bold; color: #ff5b4d; }
.result-sub   { font-size: 14px; color: #888; }

/* RUSH */
.rush-title {
  font-size: 30px;
  font-weight: bold;
  letter-spacing: 2px;
  line-height: 1.2;
  text-align: center;
  color: #ff3b3b;
  text-shadow: 0 0 18px rgba(255,59,59,0.6);
}

.rush-sub { font-size: 16px; color: #ccc; }
.rush-sub span { font-size: 30px; font-weight: bold; color: #ff9900; }

.chain-label {
  font-size: 15px;
  font-weight: bold;
  color: #ff9900;
  letter-spacing: 1px;
}

/* 振り分けボックス */
.vibun-box {
  width: 100%;
  max-width: 300px;
  background: #1a1a1a;
  border-radius: 12px;
  border: 2px solid #333;
  padding: 18px;
  text-align: center;
}
.vibun-box.rush-box   { border-color: #ff4444; background: #2a0000; }
.vibun-box.normal-box { border-color: #555; }
.vibun-box.charge-box { border-color: #e0a030; background: #2a1c00; }

/* ボーナス表示 */
.bonus-main {
  font-size: 24px;
  font-weight: bold;
  letter-spacing: 1px;
  line-height: 1.2;
}
.bonus-main.premium  { color: #ff5b4d; text-shadow: 0 0 14px rgba(226,35,26,0.7); }
.bonus-main.standard { color: #ff6644; }
.bonus-main.charge   { color: #e0a030; }
.bonus-main.none     { color: #888; }

.bonus-sub { font-size: 13px; color: #999; margin-top: 5px; }

.rush-announce { font-size: 19px; font-weight: bold; color: #ff4444; margin-top: 8px; }

/* 一括回転 */
.auto-spin-btns { display: flex; gap: 12px; margin-top: 4px; }

.btn-auto {
  padding: 12px 24px;
  border-radius: 10px;
  background: #1a1a1a;
  border: 1px solid #444;
  font-size: 15px;
  font-weight: bold;
  color: #ccc;
  cursor: pointer;
  transition: background 0.1s, transform 0.1s;
}
.btn-auto:active { background: #2a2a2a; transform: scale(0.96); }

.auto-spin-wrap  { display: flex; flex-direction: column; align-items: center; gap: 3px; }
.spin-cost-hint  { font-size: 9px; color: #555; }

.btn-taiten {
  font-size: 12px;
  color: #666;
  background: none;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 6px 18px;
  cursor: pointer;
  margin-top: 4px;
}
.btn-taiten:active { opacity: 0.7; }

/* ========== スピンレート選択 ========== */
.spin-rate-block {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.spin-rate-label { font-size: 11px; color: #666; }

.spin-rate-select {
  background: #1a1a1a;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
}

/* ========== RUSH中の3種回転ボタン ========== */
.rush-spin-btns {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  width: 100%;
  max-width: 320px;
}

.btn-rush-spin {
  flex: 1;
  padding: 10px 0;
  border-radius: 10px;
  background: #1a1a1a;
  border: 1px solid #444;
  font-size: 13px;
  font-weight: bold;
  color: #ccc;
  cursor: pointer;
  transition: background 0.1s, transform 0.1s;
}
.btn-rush-spin:active { background: #2a2a2a; transform: scale(0.96); }

.btn-rush-spin.skip {
  background: linear-gradient(135deg, #aa1100, #550800);
  border-color: #ff6644;
  color: #fff;
}

/* ========== リザルト ========== */
.rush-result-title {
  font-size: 20px;
  font-weight: bold;
  color: #ff5b4d;
  letter-spacing: 2px;
  border-bottom: 1px solid #333;
  padding-bottom: 8px;
  width: 100%;
  max-width: 300px;
  text-align: center;
}

.rush-result-box {
  width: 100%;
  max-width: 300px;
  background: #141414;
  border: 1px solid #333;
  border-radius: 12px;
  padding: 14px 16px;
}

.result-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
}
.result-row.highlight { background: rgba(226,35,26,0.08); border-radius: 6px; padding: 6px 4px; }

.rr-label { font-size: 13px; color: #888; }
.rr-val   { font-size: 15px; font-weight: bold; color: #ccc; }
.rr-val.gold { color: #ff5b4d; font-size: 18px; }

.result-hr { border: none; border-top: 1px solid #2a2a2a; margin: 8px 0; }

.rr-section {
  font-size: 10px;
  color: #555;
  letter-spacing: 1px;
  margin-bottom: 4px;
}

/* ========== RUSH成績バー ========== */
#rush-stats-bar {
  background: #0f0f0f;
  border-top: 1px solid #1e1e1e;
  border-bottom: 1px solid #1e1e1e;
  padding: 5px 12px;
  flex-shrink: 0;
}

.rsb-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 3px;
}

.rsb-title {
  font-size: 10px;
  font-weight: bold;
  color: #ff5555;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.rsb-row {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.rsb-item {
  display: flex;
  align-items: baseline;
  gap: 3px;
}

.rsb-label { font-size: 9px; color: #555; }
.rsb-val   { font-size: 12px; font-weight: bold; color: #ccc; }

/* ========== ログ ========== */
#log-area {
  background: #0a0a0a;
  border-top: 1px solid #222;
  max-height: 140px;
  overflow-y: auto;
  flex-shrink: 0;
}

#log-title {
  font-size: 10px;
  color: #444;
  padding: 5px 12px 2px;
  letter-spacing: 1px;
}

.log-item {
  font-size: 12px;
  padding: 4px 12px;
  border-bottom: 1px solid #181818;
  color: #555;
}
.log-item.win    { color: #ff5b4d; }
.log-item.rush   { color: #ff5555; }
.log-item.charge { color: #e0a030; }
.log-item.add    { color: #999; }
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "feat: add black×red visual theme"
```

---

## Task 7: script.js — game state and normal-mode flow handlers

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-boukyousei\script.js`

- [ ] **Step 1: Write the game state object and normal-mode handlers**

```js
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
```

## Context for the implementer

This is Task 7 of an 11-task plan for `pachinko-simulator-boukyousei`. Tasks 1-6 (scaffold, `logic.js` fully built and tested, `index.html`, `style.css`) are done. `script.js` calls `setState`, `render`, `renderLog` — forward references resolved in Task 10, not this one. Don't stub them.

**Domain notes:**
- `game.pending.entersRush` is read from `ZUGAR_TYPES[typeKey].entersRush` for zugar hits, or directly from `upgraded` for charge hits — there is no additional random roll for RUSH entry beyond these.
- Per the original ghouldeka precedent this project is descended from, only 図柄揃い (`zugar`) resets `currentSpins`/`lastHitSpins` (the "回転数" since-last-big-hit counter) — チャージ (`charge`) never resets it, upgraded or not.
- Task 8 will add `handleRushSpin`/`handleRushSpin10`/`handleRushSkip` and the RUSH-result/eigyo/taiten handlers, plumbing into `handleHitContinue()`'s RUSH entry point above.

- [ ] **Step 2: Commit**

```bash
git add script.js
git commit -m "feat: add game state and normal-mode flow handlers"
```

---

## Task 8: script.js — 拳王RUSH flow handlers

**Files:**
- Modify: `script.js`

- [ ] **Step 1: Append RUSH-mode handlers**

Add to `script.js`, after `backToNormal()`:

```js
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
```

## Context for the implementer

`continueNextDay()` is the "翌日も打ちますか？→はい" path: it banks `mochiDama` into `bankedYen` at 4 yen/ball (via `ballsToYen`), resets the daily counters, and forces the player back to `'normal'` mode even if `eigyo_alert` interrupted them mid-RUSH — this matches `pachinko-simulator-ghoul-idle`'s `continueNextDay()` precedent of unconditionally clearing in-progress RUSH/LT state at a day boundary. `checkEigyoAlert()` (Task 7) only fires from normal-mode spin paths (`handleStart`/`autoSpin`), never from inside `runRushSpin` — same as `pachinko-simulator-ghoul`'s precedent, so a RUSH in progress when the 2000-spin threshold is crossed will show the alert the next time the player returns to a normal-mode spin.

- [ ] **Step 2: Commit**

```bash
git add script.js
git commit -m "feat: add rush-mode flow and day-crossing handlers"
```

---

## Task 9: script.js — header/log rendering

**Files:**
- Modify: `script.js`

- [ ] **Step 1: Append rendering helpers**

Add to `script.js`, after `resetGame()`:

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add script.js
git commit -m "feat: add header/log rendering helpers"
```

---

## Task 10: script.js — buildScreen (all game states)

**Files:**
- Modify: `script.js`

- [ ] **Step 1: Append the screen-building switch**

Add to `script.js`, after `tenThousandYenSpins()`:

```js
function buildScreen(state) {
  switch (state) {

    case 'normal_idle':
      return `<div class="screen">
        <button class="btn-start" onclick="handleStart()">START</button>
        <p class="prob-hint">図柄ぞろい 1/${(1 / P_ZUGAR).toFixed(1)}　チャージ 1/${(1 / P_CHARGE).toFixed(1)}</p>
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
        return `<div class="screen">
          <p class="result-main win">図柄揃い！</p>
          <div class="vibun-box ${p.entersRush ? 'rush-box' : 'normal-box'}">
            <p class="bonus-main ${p.entersRush ? 'premium' : 'standard'}">${titleMap[p.typeKey]}</p>
            <p class="bonus-sub">＋${p.balls.toLocaleString()}球獲得</p>
            ${p.entersRush ? '<p class="rush-announce">🔥 拳王RUSH突入！</p>' : ''}
          </div>
          <button class="btn-action" onclick="handleHitContinue()">▶ ${p.entersRush ? 'RUSHへ' : '通常へ'}</button>
        </div>`;
      }
      return `<div class="screen">
        <p class="result-main charge">チャージ！</p>
        <div class="vibun-box charge-box">
          <p class="bonus-main charge">${p.upgraded ? '2R+10R昇格' : 'チャージ'}</p>
          <p class="bonus-sub">＋${p.balls.toLocaleString()}球獲得</p>
          ${p.upgraded ? '<p class="rush-announce">🔥 拳王RUSH突入！</p>' : ''}
        </div>
        <button class="btn-action" onclick="handleHitContinue()">▶ ${p.entersRush ? 'RUSHへ' : '通常へ'}</button>
      </div>`;
    }

    case 'rush_idle':
      return `<div class="screen">
        <p class="rush-title">拳王RUSH</p>
        <p class="rush-sub">ST残り <span>${game.rush.stRemaining}</span> 回／保留<span>${game.rush.reserveRemaining}</span></p>
        <div class="rush-spin-btns">
          <button class="btn-rush-spin" onclick="handleRushSpin()">1回転</button>
          <button class="btn-rush-spin" onclick="handleRushSpin10()">10回転</button>
          <button class="btn-rush-spin skip" onclick="handleRushSkip()">スキップ</button>
        </div>
        <p class="prob-hint">当選確率 1/10.7</p>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;

    case 'rush_hit_result': {
      const p = game.pending;
      const labelMap = { big: '6000個', mid: '4500個', small: '1500個', none: '出玉なし' };
      return `<div class="screen">
        <div class="vibun-box rush-box">
          <p class="bonus-main ${p.hitType === 'none' ? 'none' : 'standard'}">${labelMap[p.hitType]}</p>
          <p class="bonus-sub">＋${p.balls.toLocaleString()}球獲得</p>
        </div>
        <button class="btn-action" onclick="handleRushHitContinue()">▶ RUSH継続へ</button>
      </div>`;
    }

    case 'rush_miss':
      return `<div class="screen">
        <p class="result-main lose">はずれ</p>
        <p style="color:#ff9900; font-size:15px; margin-top:4px;">
          ST残り${game.rush.stRemaining}回・残保留${game.rush.reserveRemaining}個
        </p>
        <button class="btn-sub" onclick="handleRushMissContinue()" style="margin-top:12px;">続ける</button>
      </div>`;

    case 'rush_result': {
      const h = game.rushHitCounts;
      const lines = [];
      if (h.big   > 0) lines.push(`<div class="result-row"><span class="rr-label">6000個</span><span class="rr-val">×${h.big}回</span></div>`);
      if (h.mid   > 0) lines.push(`<div class="result-row"><span class="rr-label">4500個</span><span class="rr-val">×${h.mid}回</span></div>`);
      if (h.small > 0) lines.push(`<div class="result-row"><span class="rr-label">1500個</span><span class="rr-val">×${h.small}回</span></div>`);
      if (h.none  > 0) lines.push(`<div class="result-row"><span class="rr-label">出玉なし</span><span class="rr-val">×${h.none}回</span></div>`);
      if (lines.length === 0) lines.push(`<p style="color:#555; font-size:13px;">大当たりなし</p>`);
      return `<div class="screen">
        <p class="rush-result-title">拳王RUSH リザルト</p>
        <div class="rush-result-box">
          <div class="result-row highlight">
            <span class="rr-label">当たり回数</span>
            <span class="rr-val gold">${game.rush.totalHits}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">獲得出玉</span>
            <span class="rr-val gold">${game.rush.actualBalls.toLocaleString()}球</span>
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
```

## Context for the implementer

This is the final `script.js` task — the file is now complete and self-running (the trailing `render()` call performs the initial paint, same as `pachinko-simulator-ghoul`). `hit_result` handles both `zugar` and `charge` sources from `game.pending.source`; note the charge branch's button label reads `p.entersRush`, not `p.upgraded` — both hold the same boolean but `entersRush` is the field name used everywhere else in this file, keep it consistent. `rush_idle`'s probability hint (`1/10.7`) is hardcoded text (not derived from `P_RUSH_CHANCE`) purely for display simplicity, matching how `pachinko-simulator-ghoul` hardcodes its probability-hint strings.

- [ ] **Step 2: Commit**

```bash
git add script.js
git commit -m "feat: add screen rendering for all game states"
```

---

## Task 11: Manual browser verification

**Files:** none (verification only)

- [ ] **Step 1: Serve the project locally**

Run: `cd /c/Users/ab_99/pachinko-simulator-boukyousei && python -m http.server 8000`

- [ ] **Step 2: Open in a browser and walk through the golden path**

Open `http://localhost:8000/` and verify manually:
- 通常時 STARTボタンで回転数・持ち球・投資が更新される
- レート変更で「◯回転回す」ボタンの表記（例: レート16→「160回転回す」）と下の「約10,000円消費」が正しく表示される
- `Math.random` をブラウザのdevtoolsコンソールから一時的に固定するか、`autoSpin(5000)` のような大きい回転数をコンソールから直接呼んで、図柄揃い（3種）・チャージ（昇格あり/なし）・拳王RUSH突入・RUSH中の4種類の当たり（6000/4500/1500/出玉なし）・RUSH終了リザルトの各画面がそれぞれ正しく表示されることを確認する
- `game.totalSpins`/`game.todaySpins` をコンソールから `1999` に書き換えて次の1回転で「本日の営業時間が終了しました」画面に到達することを確認し、「はい」で `2日目` バッジに切り替わり `bankedYen` に持ち球換算額が加算されることを確認する。「いいえ」を選ぶと最終リザルト（収支発表）に到達することを確認する
- 退店ボタン・最終リザルトの「最初の画面に戻る」で `resetGame()` が全カウンタを0/1日目に戻すことを確認する

- [ ] **Step 3: Report findings**

If any screen renders incorrectly or a handler throws (check the browser devtools console), fix it in the relevant task's file before considering the plan complete. No commit needed for this task unless a fix was required (in that case, commit the fix with a `fix:` message describing what broke).

---

## Self-review notes (for the plan author, not a task)

- **Spec coverage:** 通常時ロジック → Task 2. RUSH仕様 → Task 3. 日またぎ仕様 → Task 4 (helpers) + Task 8 (`continueNextDay`/`handleEigyoHai`/`handleEigyoIie`) + Task 10 (`eigyo_alert`/`taiten_result` screens). UI操作（◯回転回すボタン・スピンレート）→ Task 10's `normal_idle` case. アーキテクチャ/黒×赤配色 → Tasks 1, 5, 6. スコープ外（極闘・天狼星・画像・Supabase）→ intentionally absent from every task above, nothing left half-built.
- **Type consistency checked:** `game.pending.entersRush` (Task 7's `runNormalSpin`) is read consistently in `handleHitContinue` (Task 7) and `buildScreen`'s `hit_result` case (Task 10) — not `enters_lt` or any other spelling. `game.rush` fields (`stRemaining`, `reserveRemaining`, `totalHits`, `actualBalls`) match `createRushState`/`applyRushChance`'s return shape (Task 3) exactly in every place `script.js` reads them (Tasks 8-10).
