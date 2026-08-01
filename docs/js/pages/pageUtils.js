let controlSequence = 0;

export function element(tagName, className = "", textContent = "") {
  const node = document.createElement(tagName);
  if (className) {
    node.className = className;
  }
  if (textContent) {
    node.textContent = textContent;
  }
  return node;
}

export function createButton(label, { variant = "secondary", className = "" } = {}) {
  const button = element(
    "button",
    `app-button app-button--${variant}${className ? ` ${className}` : ""}`,
    label,
  );
  button.type = "button";
  return button;
}

function applyControlOptions(control, options) {
  const {
    name,
    value = "",
    placeholder = "",
    readOnly = false,
    min,
    max,
    maxLength,
    inputMode,
  } = options;
  control.name = name;
  control.value = value ?? "";
  control.placeholder = placeholder;
  control.readOnly = readOnly;
  if (min !== undefined) control.min = String(min);
  if (max !== undefined) control.max = String(max);
  if (maxLength !== undefined) control.maxLength = maxLength;
  if (inputMode) control.inputMode = inputMode;
}

export function createField(options) {
  const wrapper = element("label", `form-field${options.wide ? " form-field--wide" : ""}`);
  const label = element("span", "form-field__label", options.label);
  const input = element("input", "app-input");
  input.type = options.type ?? "text";
  input.id = `${options.name}-${++controlSequence}`;
  applyControlOptions(input, options);
  wrapper.htmlFor = input.id;
  wrapper.append(label, input);
  if (options.help) {
    wrapper.append(element("span", "form-field__help", options.help));
  }
  return { wrapper, input };
}

export function createTextArea(options) {
  const wrapper = element("label", `form-field${options.wide ? " form-field--wide" : ""}`);
  const label = element("span", "form-field__label", options.label);
  const textarea = element("textarea", "app-textarea");
  textarea.id = `${options.name}-${++controlSequence}`;
  textarea.rows = options.rows ?? 3;
  applyControlOptions(textarea, options);
  wrapper.htmlFor = textarea.id;
  wrapper.append(label, textarea);
  return { wrapper, input: textarea };
}

export function createSelect(options) {
  const wrapper = element("label", `form-field${options.wide ? " form-field--wide" : ""}`);
  const label = element("span", "form-field__label", options.label);
  const select = element("select", "app-select");
  select.id = `${options.name}-${++controlSequence}`;
  select.name = options.name;
  for (const item of options.options) {
    const option = element("option", "", item.label);
    option.value = String(item.value);
    select.append(option);
  }
  select.value = String(options.value ?? "");
  wrapper.htmlFor = select.id;
  wrapper.append(label, select);
  if (options.help) {
    wrapper.append(element("span", "form-field__help", options.help));
  }
  return { wrapper, input: select };
}

export function createCheckbox({ label, name, checked = false }) {
  const wrapper = element("label", "check-field");
  const input = element("input", "check-field__input");
  input.type = "checkbox";
  input.name = name;
  input.checked = Boolean(checked);
  wrapper.append(input, element("span", "check-field__label", label));
  return { wrapper, input };
}

export function createAlert(messages, type = "error") {
  const alert = element("div", `app-alert app-alert--${type}`);
  alert.setAttribute("role", type === "error" ? "alert" : "status");
  const values = Array.isArray(messages) ? messages : [messages];
  if (values.length === 1) {
    alert.textContent = values[0];
    return alert;
  }
  const list = element("ul", "app-alert__list");
  for (const message of values) {
    list.append(element("li", "", message));
  }
  alert.append(list);
  return alert;
}

export function showAlert(region, messages, type = "error") {
  region.replaceChildren(createAlert(messages, type));
}

export function createPageHeading(title, description, action) {
  const header = element("div", "crud-page__heading");
  const copy = element("div");
  copy.append(
    element("h1", "page-heading", title),
    element("p", "page-caption", description),
  );
  header.append(copy);
  if (action) header.append(action);
  return header;
}

export function createLoading(message = "読み込み中…") {
  const loading = element("div", "page-loading", message);
  loading.setAttribute("role", "status");
  return loading;
}

export function yesNo(value) {
  return value ? "はい" : "いいえ";
}
