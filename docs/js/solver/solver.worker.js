/* global Module */

const vendorBaseUrl = new URL("../../vendor/highs/", self.location.href);
importScripts(new URL("highs.js", vendorBaseUrl).href);

let highsPromise = null;

function loadHighs() {
  if (!highsPromise) {
    highsPromise = Module({
      locateFile: (file) => new URL(file, vendorBaseUrl).href,
      print: () => {},
      printErr: (message) => console.error(`[HiGHS] ${message}`),
    });
  }
  return highsPromise;
}

function satisfiesRows(rows, tolerance = 1e-6) {
  return Array.from(rows ?? []).every((row) => {
    const primal = Number(row.Primal);
    const lower = Number(row.Lower);
    const upper = Number(row.Upper);
    if (!Number.isFinite(primal)) return false;
    if (Number.isFinite(lower) && primal < lower - tolerance) return false;
    if (Number.isFinite(upper) && primal > upper + tolerance) return false;
    return true;
  });
}

function extractPrimal(solution, variableNames, tolerance = 1e-6) {
  const values = {};
  for (const variableName of variableNames) {
    const primal = Number(solution.Columns?.[variableName]?.Primal);
    if (!Number.isFinite(primal)) {
      return { values: {}, binary: false };
    }
    const rounded = Math.round(primal);
    if (Math.abs(primal - rounded) > tolerance || (rounded !== 0 && rounded !== 1)) {
      return { values: {}, binary: false };
    }
    values[variableName] = rounded;
  }
  return { values, binary: true };
}

self.addEventListener("message", async (event) => {
  const {
    id,
    lpString,
    variableNames = [],
    options = {},
  } = event.data ?? {};

  try {
    if (typeof lpString !== "string" || !lpString.trim()) {
      throw new Error("LPモデルが空です。");
    }

    const highs = await loadHighs();
    const startedAt = performance.now();
    const solution = highs.solve(lpString, options);
    const wallTimeMs = performance.now() - startedAt;
    const primal = extractPrimal(solution, variableNames);

    self.postMessage({
      id,
      ok: true,
      rawStatus: String(solution.Status ?? "Unknown"),
      objectiveValue: Number.isFinite(Number(solution.ObjectiveValue))
        ? Number(solution.ObjectiveValue)
        : null,
      values: primal.values,
      hasFeasibleSolution: primal.binary && satisfiesRows(solution.Rows),
      wallTimeMs,
    });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
