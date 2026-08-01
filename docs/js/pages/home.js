import { counts, getSettings, latestSchedule } from "../db/index.js";
import { createScheduleTable, createShiftLegend } from "../components/scheduleTable.js";
import { monthLabel } from "../components/monthSelector.js";
import { buildScheduleViewModel } from "../reports/viewModel.js";
import { getState } from "../state.js";
import { loadSampleData } from "../excel/sampleData.js";
import {
  createAlert,
  createButton,
  createLoading,
  createPageHeading,
  element,
} from "./pageUtils.js";

const METRICS = Object.freeze([
  ["employees", "在籍職員", "人"],
  ["shifts", "勤務区分", "件"],
  ["requirements", "必要人数設定", "件"],
  ["requests", "希望登録", "件"],
]);

function createMetrics(values) {
  const grid = element("div", "home-metric-grid");
  for (const [key, label, unit] of METRICS) {
    const card = element("article", "home-metric-card");
    card.append(
      element("p", "home-metric-card__label", label),
      element("p", "home-metric-card__value", `${values[key] ?? 0}${unit}`),
    );
    grid.append(card);
  }
  return grid;
}

export async function renderHomePage(container, notice = "") {
  const targetMonth = getState().targetMonth;
  const renderToken = Symbol("home-render");
  container._homeRenderToken = renderToken;
  container.replaceChildren(createLoading("ホームを読み込み中…"));

  try {
    const [registeredCounts, schedule, settings] = await Promise.all([
      counts(targetMonth),
      latestSchedule(targetMonth),
      getSettings(),
    ]);
    if (container._homeRenderToken !== renderToken) return;

    const section = element("section", "home-page");
    const dashboardLink = element("a", "app-button app-button--primary", "勤務表を開く");
    dashboardLink.href = "#/dashboard";
    section.append(createPageHeading(
      "ホーム",
      `${monthLabel(targetMonth)}の登録状況と最新結果です。`,
      dashboardLink,
    ));
    if (notice) section.append(createAlert(notice, "success"));
    section.append(createMetrics(registeredCounts));

    const guide = element("section", "home-guide-card");
    const guideCopy = element("div");
    guideCopy.append(
      element("h2", "dashboard-section-title", "はじめに"),
      element("p", "small-note", "職員、必要人数、希望を登録したら、勤務表画面から自動作成できます。"),
    );
    const messageRegion = element("div", "home-sample-message");
    const sampleButton = createButton("サンプルデータを読み込む", { variant: "secondary" });
    sampleButton.addEventListener("click", async () => {
      const confirmed = globalThis.confirm(
        `${monthLabel(targetMonth)}へサンプルデータを読み込みます。対象月の必要人数・希望・役割設定と、配置相性・キャンペーンが置き換わります。実行しますか？`,
      );
      if (!confirmed) return;
      sampleButton.disabled = true;
      messageRegion.replaceChildren(createAlert("サンプルデータを読み込んでいます…", "success"));
      try {
        const loaded = await loadSampleData(targetMonth);
        await renderHomePage(
          container,
          `サンプルデータを読み込みました（職員${loaded.employees}人・必要人数${loaded.requirements}件・希望${loaded.requests}件）。`,
        );
      } catch (error) {
        sampleButton.disabled = false;
        messageRegion.replaceChildren(createAlert(
          error instanceof Error ? error.message : "サンプルデータを読み込めませんでした。",
          "error",
        ));
      }
    });
    guide.append(guideCopy, sampleButton);
    section.append(guide, messageRegion);

    const preview = element("section", "home-preview");
    preview.append(element("h2", "dashboard-section-title", "最新の勤務表"));
    if (schedule?.status !== "success" || !schedule?.assignments?.length) {
      preview.append(createAlert("この月の勤務表はまだ作成されていません。", "warning"));
    } else {
      const status = element("div", "schedule-metadata");
      status.append(
        element("span", "", `作成日時: ${schedule.created_at ?? "-"}`),
        element("span", "", `目的関数: ${schedule.objective_value ?? 0}`),
        element("span", "", `状態: ${schedule.status ?? "success"}`),
      );
      preview.append(status);
      const viewModel = await buildScheduleViewModel(targetMonth, schedule.assignments);
      preview.append(
        createScheduleTable(viewModel, {
          visibleDates: viewModel.dates.slice(0, 11),
          showRequests: true,
          showSkillBadges: Boolean(settings.restaurant_mode),
          ariaLabel: "最新勤務表の月初11日プレビュー",
        }),
        createShiftLegend(viewModel.shift_map),
      );
    }
    section.append(preview);
    if (container._homeRenderToken === renderToken) container.replaceChildren(section);
  } catch (error) {
    if (container._homeRenderToken !== renderToken) return;
    container.replaceChildren(createAlert(
      `ホームを読み込めませんでした: ${error instanceof Error ? error.message : String(error)}`,
      "error",
    ));
  }
}
