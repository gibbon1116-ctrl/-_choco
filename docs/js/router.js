import { setState } from "./state.js";

export const ROUTES = Object.freeze([
  { id: "home", hash: "#/home", label: "ホーム" },
  { id: "dashboard", hash: "#/dashboard", label: "勤務表" },
  { id: "employees", hash: "#/employees", label: "職員マスタ" },
  { id: "shifts", hash: "#/shifts", label: "勤務区分" },
  { id: "requirements", hash: "#/requirements", label: "必要人数" },
  { id: "requests", hash: "#/requests", label: "希望休・勤務希望" },
  { id: "settings", hash: "#/settings", label: "店舗設定" },
  { id: "relations", hash: "#/relations", label: "スタッフ配置相性設定" },
  { id: "campaigns", hash: "#/campaigns", label: "新商品・イベント" },
  { id: "roles", hash: "#/roles", label: "役割別必要人数" },
]);

export const DEFAULT_ROUTE = ROUTES[0];

export function routeFromHash(hash = location.hash) {
  return ROUTES.find((route) => route.hash === hash) ?? null;
}

function replaceWithDefaultRoute() {
  const url = `${location.pathname}${location.search}${DEFAULT_ROUTE.hash}`;
  history.replaceState(null, "", url);
}

export function startRouter(onRouteChange) {
  if (typeof onRouteChange !== "function") {
    throw new TypeError("ルート変更処理には関数を指定してください。");
  }

  const handleRoute = () => {
    let route = routeFromHash();
    if (!route) {
      replaceWithDefaultRoute();
      route = DEFAULT_ROUTE;
    }
    setState({ currentPage: route.id });
    onRouteChange(route);
  };

  window.addEventListener("hashchange", handleRoute);
  handleRoute();
  return () => window.removeEventListener("hashchange", handleRoute);
}

export function navigate(routeId) {
  const route = ROUTES.find(
    (candidate) => candidate.id === routeId || candidate.hash === routeId,
  );
  if (!route) {
    throw new Error(`不明な画面です: ${routeId}`);
  }
  location.hash = route.hash;
}
