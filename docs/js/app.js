import * as databaseApi from "./db/index.js";
import * as calendarApi from "./utils/calendar.js";
import * as stateApi from "./state.js";
import * as routerApi from "./router.js";
import * as monthSelectorApi from "./components/monthSelector.js";
import * as restaurantSkillsApi from "./utils/restaurantSkills.js";
import * as precheckApi from "./validation/precheck.js";
import * as diagnosisApi from "./validation/diagnoseInfeasibility.js";
import * as solverModelApi from "./solver/buildModel.js";
import * as solverApi from "./solver/runSolver.js";
import { renderEmployeesPage } from "./pages/employees.js";
import { renderShiftTypesPage } from "./pages/shiftTypes.js";
import { renderRequirementsPage } from "./pages/requirements.js";
import { renderRequestsPage } from "./pages/requests.js";
import { renderStoreSettingsPage } from "./pages/storeSettings.js";
import { renderStaffRelationsPage } from "./pages/staffRelations.js";
import { renderCampaignsEventsPage } from "./pages/campaignsEvents.js";
import { renderRoleRequirementsPage } from "./pages/roleRequirements.js";

async function requestPersistentStorage() {
  if (!globalThis.navigator?.storage?.persist) {
    console.info("永続ストレージAPIは利用できません。");
    return false;
  }

  const persisted = await navigator.storage.persist();
  console.info("永続ストレージ:", persisted ? "許可済み" : "未許可");
  return persisted;
}

globalThis.shiftScheduler = Object.freeze({
  ...databaseApi,
  ...calendarApi,
  ...stateApi,
  ...routerApi,
  ...monthSelectorApi,
  ...restaurantSkillsApi,
  ...precheckApi,
  ...diagnosisApi,
  ...solverModelApi,
  ...solverApi,
});

function element(tagName, className, textContent = "") {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (textContent) {
    node.textContent = textContent;
  }
  return node;
}

function createNavigation(shell) {
  const navigation = element("nav", "sidebar-nav");
  navigation.setAttribute("aria-label", "メニュー");

  for (const route of routerApi.ROUTES) {
    const link = element("a", "sidebar-nav__link", route.label);
    link.href = route.hash;
    link.dataset.route = route.id;
    link.addEventListener("click", () => {
      shell.classList.remove("sidebar-open");
    });
    navigation.append(link);
  }
  return navigation;
}

function createApplicationShell() {
  const shell = element("div", "app-shell");

  const sidebar = element("aside", "sidebar");
  const brand = element("div", "sidebar-brand");
  const brandTitle = element("p", "sidebar-brand__title", "📅 勤務表メーカー");
  const brandCaption = element("p", "sidebar-brand__caption", "ブラウザ勤務表作成");
  brand.append(brandTitle, brandCaption);
  sidebar.append(
    brand,
    element("div", "sidebar-divider"),
    createNavigation(shell),
    element("p", "sidebar-footer", "データはこのブラウザ内に保存されます"),
  );

  const backdrop = element("button", "sidebar-backdrop");
  backdrop.type = "button";
  backdrop.setAttribute("aria-label", "メニューを閉じる");
  backdrop.addEventListener("click", () => shell.classList.remove("sidebar-open"));

  const main = element("div", "app-main");
  const header = element("header", "app-header");
  const menuButton = element("button", "mobile-menu-button", "☰");
  menuButton.type = "button";
  menuButton.setAttribute("aria-label", "メニューを開く");
  menuButton.setAttribute("aria-controls", "app-sidebar");
  menuButton.addEventListener("click", () => shell.classList.add("sidebar-open"));
  sidebar.id = "app-sidebar";

  const identity = element("div", "app-header__identity");
  identity.append(
    element("p", "app-header__eyebrow", "勤務表メーカー"),
    element("p", "app-header__page"),
  );
  const actions = element("div", "app-header__actions");
  actions.append(monthSelectorApi.createMonthSelector());
  header.append(menuButton, identity, actions);

  const content = element("main", "app-content");
  content.id = "page-content";
  content.tabIndex = -1;
  main.append(header, content);
  shell.append(sidebar, backdrop, main);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      shell.classList.remove("sidebar-open");
    }
  });

  return shell;
}

async function renderRoute(route, shell) {
  const content = shell.querySelector("#page-content");
  const headerTitle = shell.querySelector(".app-header__page");
  headerTitle.textContent = route.label;
  content.dataset.page = route.id;

  for (const link of shell.querySelectorAll(".sidebar-nav__link")) {
    const isActive = link.dataset.route === route.id;
    link.classList.toggle("is-active", isActive);
    if (isActive) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }

  document.title = `${route.label} | 勤務表メーカー`;
  if (route.id === "employees") {
    await renderEmployeesPage(content);
    return;
  }
  if (route.id === "shifts") {
    await renderShiftTypesPage(content);
    return;
  }
  if (route.id === "requirements") {
    await renderRequirementsPage(content);
    return;
  }
  if (route.id === "requests") {
    await renderRequestsPage(content);
    return;
  }
  if (route.id === "settings") {
    await renderStoreSettingsPage(content);
    return;
  }
  if (route.id === "relations") {
    await renderStaffRelationsPage(content);
    return;
  }
  if (route.id === "campaigns") {
    await renderCampaignsEventsPage(content);
    return;
  }
  if (route.id === "roles") {
    await renderRoleRequirementsPage(content);
    return;
  }

  const section = element("section", "placeholder-page");
  const heading = element("h1", "page-heading", route.label);
  const headingId = `page-heading-${route.id}`;
  heading.id = headingId;
  section.setAttribute("aria-labelledby", headingId);
  section.append(
    heading,
    element("p", "page-caption", "画面の基本機能は後続フェーズで実装します。"),
  );

  const card = element("div", "placeholder-card");
  card.append(
    element("p", "placeholder-card__status", "Phase 2"),
    element("h2", "placeholder-card__title", `${route.label} — 準備中`),
    element(
      "p",
      "placeholder-card__copy",
      "現在はアプリの枠組み、画面切り替え、対象年月の共有状態を準備しています。",
    ),
  );
  section.append(card);
  content.replaceChildren(section);
}

function mountApplication() {
  const app = document.querySelector("#app");
  if (!app) {
    throw new Error("アプリのマウント先が見つかりません。");
  }

  monthSelectorApi.initializeTargetMonth();
  const shell = createApplicationShell();
  app.replaceChildren(shell);
  let currentRoute = routerApi.ROUTES[0];
  routerApi.startRouter((route) => {
    currentRoute = route;
    void renderRoute(route, shell);
  });
  stateApi.subscribe((next, previous) => {
    if (
      next.targetMonth !== previous.targetMonth
      && ["requirements", "requests", "campaigns", "roles"].includes(currentRoute.id)
    ) {
      void renderRoute(currentRoute, shell);
    }
  });
}

async function initializeDataLayer() {
  try {
    await Promise.all([
      databaseApi.openDatabase(),
      requestPersistentStorage(),
    ]);
    console.info("勤務表メーカー Phase 7 を初期化しました。");
  } catch (error) {
    console.error("勤務表メーカーの初期化に失敗しました。", error);
  }
}

mountApplication();
void initializeDataLayer();
