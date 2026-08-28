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
