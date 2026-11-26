import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idleLock } from '../js/idle.js';

function fakeEnv() {
  const listeners = new Map();
  const target = () => ({
    addEventListener: (e, fn) => listeners.set(e, fn),
    removeEventListener: (e) => listeners.delete(e),
  });
  const env = { t: 0, tick: null, win: target(), doc: { ...target(), visibilityState: 'visible' } };
  env.now = () => env.t;
  env.every = (fn) => ((env.tick = fn), 1);
  env.cancel = () => (env.tick = null);
  env.listeners = listeners;
  return env;
}

test('locks after 5 idle minutes, activity resets the clock, stops cleanly', () => {
  const env = fakeEnv();
  let locked = 0;
  idleLock(300000, () => locked++, env);
  env.t = 299000;
  env.tick();
  assert.equal(locked, 0);
  env.listeners.get('keydown')();
  env.t = 500000;
  env.tick();
  assert.equal(locked, 0);
  env.t = 600000;
  env.tick();
  assert.equal(locked, 1);
  assert.equal(env.tick, null);
  assert.equal(env.listeners.size, 0);
});

test('returning to a hidden tab after the limit locks at once', () => {
  const env = fakeEnv();
  let locked = 0;
  idleLock(300000, () => locked++, env);
  env.t = 900000;
  env.listeners.get('visibilitychange')();
  assert.equal(locked, 1);
});
