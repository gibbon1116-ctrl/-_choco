export const DEFAULT_STATE = Object.freeze({
  targetMonth: "2026-08",
  currentPage: "home",
});

const state = { ...DEFAULT_STATE };
const subscribers = new Set();

export function getState() {
  return { ...state };
}

export function setState(patch) {
  const previous = getState();
  const next = { ...state, ...patch };
  const changed = Object.keys(next).some((key) => next[key] !== state[key]);
  if (!changed) {
    return getState();
  }

  Object.assign(state, next);
  const snapshot = getState();
  for (const subscriber of subscribers) {
    subscriber(snapshot, previous);
  }
  return snapshot;
}

export function subscribe(subscriber, { emitImmediately = false } = {}) {
  if (typeof subscriber !== "function") {
    throw new TypeError("購読処理には関数を指定してください。");
  }
  subscribers.add(subscriber);
  if (emitImmediately) {
    subscriber(getState(), getState());
  }
  return () => subscribers.delete(subscriber);
}
