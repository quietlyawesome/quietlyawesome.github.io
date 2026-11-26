const EVENTS = ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart', 'scroll'];

export function idleLock(ms, onIdle, env = {}) {
  const win = env.win || globalThis.window;
  const doc = env.doc || globalThis.document;
  const now = env.now || Date.now;
  const every = env.every || ((fn, t) => setInterval(fn, t));
  const cancel = env.cancel || clearInterval;
  let last = now();
  let done = false;
  const bump = () => {
    last = now();
  };
  const check = () => {
    if (!done && now() - last >= ms) {
      stop();
      onIdle();
    }
  };
  const vis = () => {
    if (doc.visibilityState === 'visible') check();
  };
  for (const e of EVENTS) win.addEventListener(e, bump, { passive: true, capture: true });
  doc.addEventListener('visibilitychange', vis);
  const timer = every(check, 15000);
  function stop() {
    if (done) return;
    done = true;
    cancel(timer);
    for (const e of EVENTS) win.removeEventListener(e, bump, { capture: true });
    doc.removeEventListener('visibilitychange', vis);
  }
  return { stop, check, bump };
}
