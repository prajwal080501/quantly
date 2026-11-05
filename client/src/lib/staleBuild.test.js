import { isStaleBuildError, reloadOnce } from './staleBuild.js';

const memory = () => {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
};

test('spots the error a phone shows after an update', () => {
  expect(isStaleBuildError(new TypeError('Failed to fetch dynamically imported module: http://localhost:5000/assets/Account-BTYbZrYb.js'))).toBe(true);
  expect(isStaleBuildError(new TypeError('Importing a module script failed.'))).toBe(true);
  expect(isStaleBuildError(new Error('Cannot read properties of undefined'))).toBe(false);
});

test('reloads once, then not again within 30 seconds', () => {
  const storage = memory();
  let reloads = 0;
  const reload = () => reloads++;
  expect(reloadOnce({ storage, reload, now: 1_000_000 })).toBe(true);
  expect(reloadOnce({ storage, reload, now: 1_010_000 })).toBe(false);
  expect(reloads).toBe(1);
  expect(reloadOnce({ storage, reload, now: 1_040_000 })).toBe(true);
  expect(reloads).toBe(2);
});
