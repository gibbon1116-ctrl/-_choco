import {
  getActiveEmployees,
  getAllProductCampaigns,
  getAllShiftTypes,
  getBusinessDays,
  getRequirements,
  getRequests,
  getRoleRequirements,
  getSettings,
  getAllStaffRelations,
  saveSchedule,
} from "../db/index.js";
import { diagnoseInfeasibility } from "../validation/diagnoseInfeasibility.js";
import { hardRuleViolations } from "../reports/ruleViolations.js";
import { buildModel } from "./buildModel.js";
import { SOLVER_CONFIG } from "./config.js";

const DEFAULT_TIME_LIMIT_SECONDS = SOLVER_CONFIG.solver_time_limit_seconds;
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
  const [
    employees,
    shiftTypes,
    requirements,
    requests,
    settings,
    staffRelations,
    businessDays,
    campaigns,
    roleRequirements,
  ] = await Promise.all([
    getActiveEmployees(),
    getAllShiftTypes(),
    getRequirements(targetMonth),
    getRequests(targetMonth),
    getSettings(),
    getAllStaffRelations(),
    getBusinessDays(targetMonth),
    getAllProductCampaigns(),
    getRoleRequirements(targetMonth),
  ]);
  return {
    employees,
    shiftTypes,
    requirements,
    requests,
    settings,
    staffRelations,
    businessDays,
    campaigns,
    roleRequirements,
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
      variableNames: model.binaryVariables,
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
  reportViolations = hardRuleViolations,
  buildOptions = {},
} = {}) {
  try {
    const solverData = data ?? await loadSolverData(targetMonth);
    let model = buildModel(targetMonth, solverData, buildOptions);
    let result = await solveModel(model, { timeLimitSeconds, workerFactory });

    if (result.status === "success") {
      const assignments = decodeAssignments(model, result.values);
      const scheduleId = await persistSchedule(
        targetMonth,
        "success",
        assignments,
        result.objectiveValue,
        result.wallTimeMs,
        "",
      );
      return {
        ...result,
        assignments,
        diagnostics: [],
        objectiveValue: result.objectiveValue,
        scheduleId,
        modelStats: model.stats,
      };
    }

    if (["infeasible", "error"].includes(result.status)) {
      const keptUserHardModel = buildModel(targetMonth, solverData, {
        ...buildOptions,
        softenHardConstraints: true,
        keepUserHardConstraints: true,
      });
      const keptUserHardResult = await solveModel(keptUserHardModel, {
        timeLimitSeconds,
        workerFactory,
      });
      if (keptUserHardResult.status === "success") {
        const assignments = decodeAssignments(keptUserHardModel, keptUserHardResult.values);
        const violations = await reportViolations(
          targetMonth,
          assignments,
          { data: solverData },
        );
        const note = `希望・相性の必須条件は満たしています。満たしていない条件が${violations.length}件あります。`;
        const scheduleId = await persistSchedule(
          targetMonth,
          "provisional",
          assignments,
          keptUserHardResult.objectiveValue,
          keptUserHardResult.wallTimeMs,
          note,
        );
        return {
          ...keptUserHardResult,
          status: "provisional",
          assignments,
          violations,
          diagnostics: [],
          objectiveValue: keptUserHardResult.objectiveValue,
          scheduleId,
          modelStats: keptUserHardModel.stats,
          keptUserHardConstraints: true,
        };
      }

      const provisionalModel = buildModel(targetMonth, solverData, {
        ...buildOptions,
        softenHardConstraints: true,
      });
      const provisionalResult = await solveModel(provisionalModel, {
        timeLimitSeconds,
        workerFactory,
      });
      if (provisionalResult.status === "success") {
        const assignments = decodeAssignments(provisionalModel, provisionalResult.values);
        const violations = await reportViolations(
          targetMonth,
          assignments,
          { data: solverData },
        );
        const note = `必須条件をすべて満たす仮の勤務表を作成できませんでした。満たしていない必須条件が${violations.length}件あります。`;
        const scheduleId = await persistSchedule(
          targetMonth,
          "provisional",
          assignments,
          provisionalResult.objectiveValue,
          provisionalResult.wallTimeMs,
          note,
        );
        return {
          ...provisionalResult,
          status: "provisional",
          assignments,
          violations,
          diagnostics: [],
          objectiveValue: provisionalResult.objectiveValue,
          scheduleId,
          modelStats: provisionalModel.stats,
          keptUserHardConstraints: false,
        };
      }
      model = provisionalModel;
      result = provisionalResult;
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
