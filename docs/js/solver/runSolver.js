import {
  getActiveEmployees,
  getAllShiftTypes,
  getRequirements,
  getRequests,
  getSettings,
  getAllStaffRelations,
  saveSchedule,
} from "../db/index.js";
import { diagnoseInfeasibility } from "../validation/diagnoseInfeasibility.js";
import { buildModel } from "./buildModel.js";

const DEFAULT_TIME_LIMIT_SECONDS = 60;
const WORKER_GRACE_PERIOD_MS = 30_000;

function timeLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_TIME_LIMIT_SECONDS;
}

function requestId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `solver-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createSolverWorker() {
  return new Worker(new URL("./solver.worker.js", import.meta.url));
}

export async function loadSolverData(targetMonth) {
  const [employees, shiftTypes, requirements, requests, settings, staffRelations] = await Promise.all([
    getActiveEmployees(),
    getAllShiftTypes(),
    getRequirements(targetMonth),
    getRequests(targetMonth),
    getSettings(),
    getAllStaffRelations(),
  ]);
  return {
    employees,
    shiftTypes,
    requirements,
    requests,
    settings,
    staffRelations,
  };
}

function normalizeWorkerResult(message) {
  if (!message.ok) {
    return {
      status: "error",
      message: message.error || "HiGHSの実行に失敗しました。",
      assignments: [],
      diagnostics: [],
      objectiveValue: null,
      wallTimeMs: 0,
      solverStatus: "Error",
    };
  }

  const solverStatus = String(message.rawStatus ?? "Unknown");
  if (/infeasible/i.test(solverStatus)) {
    return {
      status: "infeasible",
      assignments: [],
      diagnostics: [],
      objectiveValue: null,
      values: {},
      wallTimeMs: Number(message.wallTimeMs ?? 0),
      solverStatus,
    };
  }

  if (solverStatus === "Optimal" || message.hasFeasibleSolution) {
    return {
      status: "success",
      assignments: [],
      diagnostics: [],
      objectiveValue: Number(message.objectiveValue ?? 0),
      values: message.values ?? {},
      wallTimeMs: Number(message.wallTimeMs ?? 0),
      solverStatus,
    };
  }

  return {
    status: "error",
    message: `HiGHSが実行可能解を返しませんでした（${solverStatus}）。`,
    assignments: [],
    diagnostics: [],
    objectiveValue: null,
    values: {},
    wallTimeMs: Number(message.wallTimeMs ?? 0),
    solverStatus,
  };
}

/**
 * 構築済みモデルをクラシックWorkerで解く。IndexedDBには触れない。
 */
export function solveModel(model, {
  timeLimitSeconds = DEFAULT_TIME_LIMIT_SECONDS,
  workerFactory = createSolverWorker,
} = {}) {
  const seconds = timeLimit(timeLimitSeconds);
  const worker = workerFactory();
  const id = requestId();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      worker.terminate();
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      finish({
        status: "error",
        message: "HiGHSの応答が制限時間内に返りませんでした。",
        assignments: [],
        diagnostics: [],
        objectiveValue: null,
        wallTimeMs: 0,
        solverStatus: "Worker timeout",
      });
    }, seconds * 1_000 + WORKER_GRACE_PERIOD_MS);

    worker.addEventListener("message", (event) => {
      if (event.data?.id !== id) return;
      finish(normalizeWorkerResult(event.data));
    });
    worker.addEventListener("error", (event) => {
      finish({
        status: "error",
        message: event.message || "ソルバーWorkerでエラーが発生しました。",
        assignments: [],
        diagnostics: [],
        objectiveValue: null,
        wallTimeMs: 0,
        solverStatus: "Worker error",
      });
    });

    worker.postMessage({
      id,
      lpString: model.lpString,
      variableNames: model.variables.map(({ name }) => name),
      options: { time_limit: seconds },
    });
  });
}

function decodeAssignments(model, values) {
  const selected = new Map();
  for (const variable of model.variables) {
    if (Number(values[variable.name]) < 0.5) continue;
    selected.set(
      `${variable.employee_id}\u0000${variable.date}`,
      variable.shift_code,
    );
  }

  return model.employeeIds.flatMap((employeeId) => model.days.map((date) => ({
    employee_id: employeeId,
    date,
    shift_code: selected.get(`${employeeId}\u0000${date}`) ?? "O",
  })));
}

/**
 * IndexedDBから対象月のデータを読み込み、求解・保存・解なし診断まで行う。
 * data/workerFactory等の差し替えは、ブラウザDBを使わない独立テスト用。
 */
export async function runSolver(targetMonth, {
  timeLimitSeconds = DEFAULT_TIME_LIMIT_SECONDS,
  data = null,
  workerFactory = createSolverWorker,
  diagnose = diagnoseInfeasibility,
  persistSchedule = saveSchedule,
} = {}) {
  try {
    const solverData = data ?? await loadSolverData(targetMonth);
    const model = buildModel(targetMonth, solverData);
    const result = await solveModel(model, { timeLimitSeconds, workerFactory });

    if (result.status === "success") {
      const assignments = decodeAssignments(model, result.values);
      const scheduleId = await persistSchedule(
        targetMonth,
        "success",
        assignments,
        0,
        result.wallTimeMs,
        "",
      );
      return {
        ...result,
        assignments,
        diagnostics: [],
        objectiveValue: 0,
        scheduleId,
        modelStats: model.stats,
      };
    }

    if (result.status === "infeasible") {
      let diagnostics;
      try {
        diagnostics = await diagnose(targetMonth);
      } catch (error) {
        diagnostics = [{
          severity: "error",
          date: null,
          condition: "診断エラー",
          message: error instanceof Error ? error.message : String(error),
        }];
      }
      return {
        ...result,
        diagnostics,
        modelStats: model.stats,
      };
    }

    return { ...result, modelStats: model.stats };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: "error",
      message: `処理中にエラーが発生しました: ${message}`,
      assignments: [],
      diagnostics: [{
        severity: "error",
        date: null,
        condition: "処理エラー",
        message: `処理中にエラーが発生しました: ${message}`,
      }],
      objectiveValue: null,
      wallTimeMs: 0,
      solverStatus: "Error",
    };
  }
}
