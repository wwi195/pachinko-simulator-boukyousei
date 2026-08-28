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

test('ZUGAR_TYPES lists the 3 zugar outcomes with correct weight/balls/actual/entersRush', () => {
  assert.deepEqual(logic.ZUGAR_TYPE_ORDER, ['rushBig', 'rushSmall', 'normal']);
  assert.deepEqual(logic.ZUGAR_TYPES.rushBig,   { weight: 5 / 96,  balls: 4500, actual: 4200, entersRush: true });
  assert.deepEqual(logic.ZUGAR_TYPES.rushSmall, { weight: 52 / 96, balls: 1500, actual: 1400, entersRush: true });
  assert.deepEqual(logic.ZUGAR_TYPES.normal,    { weight: 39 / 96, balls: 1500, actual: 1400, entersRush: false });
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

test('charge balls/actual constants are the 14/15 表示/実質 pair', () => {
  assert.equal(logic.CHARGE_BALLS_PLAIN, 300);
  assert.equal(logic.CHARGE_ACTUAL_PLAIN, 280);
  assert.equal(logic.CHARGE_BALLS_UPGRADED, 1800);
  assert.equal(logic.CHARGE_ACTUAL_UPGRADED, 1680);
});

test('P_RUSH_CHANCE is 1/10.7, RUSH_ST_COUNT is 10, RUSH_RESERVE_COUNT is 4', () => {
  assert.equal(logic.P_RUSH_CHANCE, 1 / 10.7);
  assert.equal(logic.RUSH_ST_COUNT, 10);
  assert.equal(logic.RUSH_RESERVE_COUNT, 4);
});

test('spinRushChance returns hit when the draw beats P_RUSH_CHANCE, miss otherwise', () => {
  assert.equal(withMockRandom([0], () => logic.spinRushChance()), 'hit');
  assert.equal(withMockRandom([0.5], () => logic.spinRushChance()), 'miss');
});

test('RUSH_HIT_TYPES lists the 4 outcomes with correct weight/balls/actual', () => {
  assert.deepEqual(logic.RUSH_HIT_TYPE_ORDER, ['big', 'mid', 'small', 'none']);
  assert.deepEqual(logic.RUSH_HIT_TYPES.big,   { weight: 0.10, balls: 6000, actual: 5600 });
  assert.deepEqual(logic.RUSH_HIT_TYPES.mid,   { weight: 0.40, balls: 4500, actual: 4200 });
  assert.deepEqual(logic.RUSH_HIT_TYPES.small, { weight: 0.30, balls: 1500, actual: 1400 });
  assert.deepEqual(logic.RUSH_HIT_TYPES.none,  { weight: 0.20, balls: 0,    actual: 0 });
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

test('applyRushChance: a miss on the last regular spin (ST 1->0) is still just a miss while reserve remains', () => {
  const state = { stRemaining: 1, reserveRemaining: 4, totalHits: 0, actualBalls: 0 };
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushChance(state));
  assert.equal(outcome, 'miss');
  assert.deepEqual(rushState, { stRemaining: 0, reserveRemaining: 4, totalHits: 0, actualBalls: 0 });
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

test('applyRushChance: a hit rolls a bonus type, returns both balls(表示) and actual(実質), and accumulates actual into actualBalls', () => {
  const state = { stRemaining: 3, reserveRemaining: 4, totalHits: 2, actualBalls: 9000 };
  // draws: [0]=spinRushChance hit, [0.3]=rollRushHitType->'mid' (4500表示/4200実質)
  const { rushState, outcome, hitType, balls, actual } =
    withMockRandom([0, 0.3], () => logic.applyRushChance(state));
  assert.equal(outcome, 'hit');
  assert.equal(hitType, 'mid');
  assert.equal(balls, 4500);
  assert.equal(actual, 4200);
  assert.deepEqual(rushState, { stRemaining: 10, reserveRemaining: 4, totalHits: 3, actualBalls: 13200 });
});

test('applyRushChance: a "none" hit still resets the cycle and counts as a hit, with 0 balls/actual', () => {
  const state = logic.createRushState();
  // draws: [0]=spinRushChance hit, [0.95]=rollRushHitType->'none' (0 balls, 0 actual)
  const { rushState, outcome, hitType, balls, actual } =
    withMockRandom([0, 0.95], () => logic.applyRushChance(state));
  assert.equal(outcome, 'hit');
  assert.equal(hitType, 'none');
  assert.equal(balls, 0);
  assert.equal(actual, 0);
  assert.deepEqual(rushState, { stRemaining: 10, reserveRemaining: 4, totalHits: 1, actualBalls: 0 });
});

test('applyRushChance: a hit during the reserve phase (stRemaining===0) is always the "small" (10R/1500) type, regardless of the hit-type draw', () => {
  const state = { stRemaining: 0, reserveRemaining: 4, totalHits: 0, actualBalls: 0 };
  // draw [0] alone must resolve the whole call: only spinRushChance is rolled here,
  // rollRushHitType must NOT be consulted for a reserve-phase hit.
  const { rushState, outcome, hitType, balls, actual } =
    withMockRandom([0], () => logic.applyRushChance(state));
  assert.equal(outcome, 'hit');
  assert.equal(hitType, 'small');
  assert.equal(balls, 1500);
  assert.equal(actual, 1400);
  assert.deepEqual(rushState, { stRemaining: 10, reserveRemaining: 4, totalHits: 1, actualBalls: 1400 });
});

test('DAILY_SPIN_LIMIT is 2000 and BALL_TO_YEN is 4', () => {
  assert.equal(logic.DAILY_SPIN_LIMIT, 2000);
  assert.equal(logic.BALL_TO_YEN, 4);
});

test('ballsToYen floors fractional balls then converts at 4 yen/ball', () => {
  assert.equal(logic.ballsToYen(1000), 4000);
  assert.equal(logic.ballsToYen(250.7), 1000);
  assert.equal(logic.ballsToYen(0), 0);
});
