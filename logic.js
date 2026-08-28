'use strict';

const SPIN_RATE_OPTIONS = [14, 16, 18, 20];
const DEFAULT_SPIN_RATE = 16;

function calcSpinCost(spinRate) {
  return 250 / spinRate;
}

// ---- 通常時: 図柄揃い・チャージ ----
// 導出過程は docs/superpowers/specs/2026-08-28-boukyousei-spec-design.md を参照。

// 実機公表値そのもの（表示用の参考値）。図柄揃い+チャージ昇格を含む「初当たり」
// 全体の確率で、P_ZUGAR + P_CHARGE（チャージは昇格なしも含む単発発生率）とは
// 一致しない。スピン判定には使わない。
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
    // reserveRemaining は必ずstRemaining===0になってから消化されるため、
    // ここでreserveRemainingが同時に0になることは通常のプレイでは起こらない
    // （createRushState()からの遷移では常に成立する不変条件）。防御的な分岐として残す。
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

// ---- 日またぎ ----

const DAILY_SPIN_LIMIT = 2000;
const BALL_TO_YEN = 4;

function ballsToYen(balls) {
  return Math.floor(balls) * BALL_TO_YEN;
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
    P_RUSH_CHANCE,
    RUSH_ST_COUNT,
    RUSH_RESERVE_COUNT,
    spinRushChance,
    RUSH_HIT_TYPES,
    RUSH_HIT_TYPE_ORDER,
    rollRushHitType,
    createRushState,
    applyRushChance,
    DAILY_SPIN_LIMIT,
    BALL_TO_YEN,
    ballsToYen,
  };
}
