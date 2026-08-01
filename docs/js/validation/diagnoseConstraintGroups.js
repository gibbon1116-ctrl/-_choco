import { buildModel } from "../solver/buildModel.js";
import {
  createSolverWorker,
  loadSolverData,
  solveModel,
} from "../solver/runSolver.js";

export const CONSTRAINT_GROUP_CATALOGUE = Object.freeze([
  Object.freeze({
    key: "H3",
    label: "日付ごとの必要人数",
    hint: "必要人数画面で必要人数を見直してください。",
  }),
  Object.freeze({
    key: "H4",
    label: "職員ごとの月間勤務日数の上下限",
    hint: "職員マスタの最低・最大勤務日数を見直してください。",
  }),
  Object.freeze({
    key: "H5",
    label: "最大連続勤務日数",
    hint: "職員マスタの最大連続勤務日数を見直してください。",
  }),
  Object.freeze({
    key: "H6",
    label: "夜勤翌日の休み",
    hint: "勤務区分の設定を見直してください。",
  }),
  Object.freeze({
    key: "H7",
    label: "必須の希望休",
    hint: "希望休・勤務希望を見直してください。",
  }),
  Object.freeze({
    key: "H8",
    label: "必須の勤務指定・希望勤務・避けたい勤務",
    hint: "希望休・勤務希望を見直してください。",
  }),
  Object.freeze({
    key: "H2",
    label: "夜勤の可否",
    hint: "職員マスタの夜勤可否を見直してください。",
  }),
  Object.freeze({
    key: "H9",
    label: "早番の開店作業対応",
    hint: "職員マスタのスキル、または必要人数を見直してください。",
  }),
  Object.freeze({
    key: "H10",
    label: "遅番の閉店作業対応",
    hint: "職員マスタのスキル、または必要人数を見直してください。",
  }),
  Object.freeze({
    key: "H11",
    label: "必須のスタッフ配置条件",
    hint: "スタッフ配置相性設定を見直してください。",
  }),
  Object.freeze({
    key: "H12",
    label: "新人スタッフの配置・必須の教育係",
    hint: "職員マスタ、スタッフ配置相性設定を見直してください。",
  }),
  Object.freeze({
    key: "SKILL",
    label: "店舗設定の必須スキル人数",
    hint: "店舗設定を見直してください。",
  }),
  Object.freeze({
    key: "ROLE",
    label: "役割別必要人数（必須）",
    hint: "役割別必要人数画面を見直してください。",
  }),
]);

function feasibilityStatus(result) {
  if (result.status === "success") return "feasible";
  if (result.status === "infeasible") return "infeasible";
  return "unknown";
}

export async function diagnoseConstraintGroups(targetMonth, {
  data = null,
  buildOptions = {},
  workerFactory = createSolverWorker,
  timeLimitSeconds = 8,
  budgetMs = 60_000,
  onProgress = null,
} = {}) {
  const startedAt = Date.now();
  const solverData = data ?? await loadSolverData(targetMonth);
  const isFeasible = async (relaxGroups) => {
    const model = buildModel(targetMonth, solverData, {
      ...buildOptions,
      relaxGroups,
      feasibilityOnly: true,
    });
    const result = await solveModel(model, { timeLimitSeconds, workerFactory });
    return feasibilityStatus(result);
  };

  const baseline = await isFeasible(new Set());
  if (baseline === "feasible") {
    return {
      status: "not_reproduced",
      groups: [],
      truncated: false,
      testedCount: 0,
    };
  }
  if (baseline === "unknown") {
    return {
      status: "unknown",
      groups: [],
      truncated: false,
      testedCount: 0,
    };
  }

  const removed = new Set();
  const essential = [];
  let testedCount = 0;
  let truncated = false;
  let status = "ok";

  for (let index = 0; index < CONSTRAINT_GROUP_CATALOGUE.length; index += 1) {
    if (Date.now() - startedAt >= budgetMs) {
      truncated = true;
      break;
    }
    const group = CONSTRAINT_GROUP_CATALOGUE[index];
    onProgress?.({ index, total: CONSTRAINT_GROUP_CATALOGUE.length, group });
    const result = await isFeasible(new Set([...removed, group.key]));
    testedCount += 1;
    if (result === "feasible") {
      essential.push(group);
    } else if (result === "infeasible") {
      removed.add(group.key);
    } else {
      status = "unknown";
      truncated = true;
      break;
    }
  }

  return {
    status,
    groups: essential,
    truncated,
    testedCount,
  };
}
