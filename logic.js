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
