const today = new Date();
const dayMs = 24 * 60 * 60 * 1000;
const API_BASE = "https://jabloom362-kz.onrender.com";
const TEXT_FIELD_LIMIT = 1200;
const PASSWORD_HINT = "Пароль: минимум 10 символов, большая и маленькая буква, цифра и спецсимвол";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanText(value = "", limit = TEXT_FIELD_LIMIT) {
  return String(value ?? "")
    .replace(/[<>"'`\u0000-\u001f\u007f]/g, "")
    .slice(0, limit)
    .trim();
}

function cleanUrl(value = "") {
  const raw = cleanText(value, 600);
  if (!raw) return "";
  try {
    const url = new URL(raw, window.location.origin);
    if (["http:", "https:", "tel:", "mailto:"].includes(url.protocol)) return raw;
  } catch (error) {
    return "";
  }
  return "";
}

function sanitizeRecordStrings(record) {
  if (!record || typeof record !== "object") return record;
  Object.entries(record).forEach(([key, value]) => {
    if (typeof value === "string") {
      const lowerKey = key.toLowerCase();
      record[key] = lowerKey.includes("url") || lowerKey === "photo" ? cleanUrl(value) : cleanText(value);
    } else if (Array.isArray(value)) {
      value.forEach((item) => sanitizeRecordStrings(item));
    } else if (value && typeof value === "object") {
      sanitizeRecordStrings(value);
    }
  });
  return record;
}

function isStrongPassword(password) {
  return password.length >= 10
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

const demoData = {
  clients: [
    {
      id: 1,
      name: "Ерлан Ахметов",
      phone: "+7 777 123 45 67",
      instagram: "@erlan.flowers",
      address: "Актау, 14 микрорайон, 12",
      recipient: "Айгерим",
      relation: "Жена",
      flowers: "Пионы, белые розы",
      event: nextDate(34),
      budget: 25000,
      bonus: 3250,
      orders: 14,
      lastOrder: pastDate(12),
      channel: "WhatsApp",
      status: "VIP"
    },
    {
      id: 2,
      name: "Алия Нур",
      phone: "+7 701 555 22 11",
      instagram: "@aliya.nur",
      address: "Актау, 17 микрорайон, 6",
      recipient: "Мама",
      relation: "Мама",
      flowers: "Розы, эустома",
      event: nextDate(7),
      budget: 18000,
      bonus: 900,
      orders: 5,
      lastOrder: pastDate(19),
      channel: "Instagram",
      status: "Постоянный"
    },
    {
      id: 3,
      name: "Максим Ким",
      phone: "+7 705 888 44 21",
      instagram: "",
      address: "Актау, 5 микрорайон, 22",
      recipient: "Ольга",
      relation: "Девушка",
      flowers: "Тюльпаны",
      event: nextDate(52),
      budget: 15000,
      bonus: 750,
      orders: 2,
      lastOrder: pastDate(84),
      channel: "2GIS",
      status: "Спящий"
    },
    {
      id: 4,
      name: "Данияр С.",
      phone: "+7 707 221 09 09",
      instagram: "@office.flowers",
      address: "Актау, 29А микрорайон, 18",
      recipient: "Корпоратив",
      relation: "Офис",
      flowers: "Композиции",
      event: nextDate(14),
      budget: 45000,
      bonus: 4200,
      orders: 11,
      lastOrder: pastDate(3),
      channel: "WhatsApp",
      status: "VIP"
    }
  ],
  orders: [
    { id: 1, clientId: 1, date: pastDate(12), sum: 25000, reason: "Годовщина", bouquet: "Пионы Premium", channel: "WhatsApp" },
    { id: 2, clientId: 4, date: pastDate(3), sum: 42000, reason: "Офис", bouquet: "Композиция Lux", channel: "WhatsApp" },
    { id: 3, clientId: 2, date: pastDate(19), sum: 18000, reason: "День рождения", bouquet: "Розы Mix", channel: "Instagram" },
    { id: 4, clientId: 3, date: pastDate(84), sum: 15000, reason: "Свидание", bouquet: "Тюльпаны", channel: "2GIS" }
  ]
};

let currentUser = null;
let data = structuredClone(demoData);
let activeView = "dashboard";
let staffUsers = [];
let currentCalendarDate = new Date(today.getFullYear(), today.getMonth(), 1);
let appConfig = {
  appEnv: "development",
  isDevelopment: true,
  demoLoginEnabled: false,
  demoRegisterEnabled: true,
  betaInviteRequired: false
};

const leadStatuses = [
  ["new", "Новый"],
  ["wrote", "Написали"],
  ["negotiation", "Переговоры"],
  ["order", "Заказ"],
  ["lost", "Потерян"]
];

const viewMeta = {
  dashboard: ["Business OS", "Премиальная панель управления цветочным бизнесом в реальном времени."],
  clients: ["Клиенты", "VIP-профили, сегменты, Lifetime Value и история отношений."],
  orders: ["Заказы", "История продаж, кэшбек и источники заказов."],
  reminders: ["Напоминания", "Готовые сообщения для важных дат и возврата клиентов."],
  loyalty: ["Бонусы", "BloomCash, VIP-уровни и автоматические начисления."],
  channels: ["Каналы", "WhatsApp, Instagram и 2GIS в одной рабочей карточке."],
  returns: ["Возврат клиентов", "Автоматические задачи, сообщения и расчет денег, которые CRM возвращает в кассу."],
  leads: ["Потенциальные клиенты", "Воронка продаж от первого контакта до заказа."],
  finance: ["Финансы", "Выручка, прибыль, средний чек, cashflow и кассовые смены."],
  analytics: ["Аналитика", "Проценты продаж, позиции недели и визуальная картина спроса."],
  trash: ["Корзина", "Восстановление удаленных клиентов и заказов, плюс журнал важных действий."],
  calendar: ["Календарь событий", "Дни рождения, годовщины, свадьбы, доставки и поводы для продаж."],
  delivery: ["Доставка", "Маршруты, статусы заказов и онлайн-мониторинг курьеров."],
  inventory: ["Склад", "Остатки цветов, умные уведомления и прогноз закупок."],
  staff: ["Сотрудники", "Профили владельца, менеджера, флориста, курьера и оператора."],
  settings: ["Настройки", "Город, валюта, бонусы, безопасность, backup и экспорт."]
};

document.querySelector("#todayLabel").textContent = today.toLocaleDateString("ru-RU");
document.querySelector("#loginForm").addEventListener("submit", handleLogin);
document.querySelector("#registerForm").addEventListener("submit", handleRegister);
document.querySelector("#showRegister").addEventListener("click", () => setAuthMode("register"));
document.querySelector("#showLogin").addEventListener("click", () => setAuthMode("login"));
document.querySelector("#fillRegisterDemo").addEventListener("click", fillRegisterDemo);
document.querySelector("#quickRegisterDemo").addEventListener("click", quickRegisterDemo);
document.querySelectorAll("[data-demo-login]").forEach((button) => {
  button.addEventListener("click", async () => {
    const form = document.querySelector("#loginForm");
    setAuthMode("login");
    form.login.value = button.dataset.demoLogin;
    form.password.value = button.dataset.demoPassword;
    await loginWithCredentials(button.dataset.demoLogin, button.dataset.demoPassword, button);
  });
});
document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
document.querySelector("#addClient").addEventListener("click", openClientForm);
document.querySelector("#addOrder").addEventListener("click", openOrderForm);
document.querySelector("#bloomAiBtn").addEventListener("click", openBloomAI);
document.querySelector("#resetDemo").addEventListener("click", async () => {
  try {
    const response = await api("/api/reset", { method: "POST" });
    data = response.data;
    render();
  } catch (error) {
    alert(error.message);
  }
});
document.querySelector("#createStoreBtn").addEventListener("click", async () => {
  await logout();
  setAuthMode("register");
});
document.querySelector("#logoutBtn").addEventListener("click", logout);
document.querySelector("#closeModal").addEventListener("click", closeModal);
document.querySelector("#modal").addEventListener("click", (event) => {
  if (event.target.id === "modal") closeModal();
});
document.addEventListener("click", handleActionClick);

initApp();

async function handleActionClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  event.preventDefault();

  try {
    switch (button.dataset.action) {
      case "show-view":
        showView(button.dataset.view);
        break;
      case "copy-telegram":
        await copyTelegramDigest();
        break;
      case "open-passport":
        openPassport(Number(button.dataset.id));
        break;
      case "open-client":
        openClientForm(button.dataset.id ? Number(button.dataset.id) : undefined);
        break;
      case "delete-client":
        await deleteClient(Number(button.dataset.id));
        break;
      case "open-order":
        openOrderForm(button.dataset.id ? Number(button.dataset.id) : undefined);
        break;
      case "delete-order":
        await deleteOrder(Number(button.dataset.id));
        break;
      case "touch-return-tasks":
        touchAllReturnTasks();
        break;
      case "mark-return-task":
        markReturnTask(Number(button.dataset.id), button.dataset.status);
        break;
      case "complete-return-task":
        completeReturnTask(Number(button.dataset.id));
        break;
      case "open-lead":
        openLeadForm(button.dataset.id ? Number(button.dataset.id) : undefined);
        break;
      case "move-lead":
        await moveLead(Number(button.dataset.id), Number(button.dataset.direction || 0));
        break;
      case "convert-lead":
        await convertLeadToClient(Number(button.dataset.id));
        break;
      case "open-cash-shift":
        openCashShift();
        break;
      case "close-cash-shift":
        closeCashShift();
        break;
      case "open-finance-entry":
        openFinanceEntryForm();
        break;
      case "restore-client":
        await restoreClient(Number(button.dataset.id));
        break;
      case "restore-order":
        await restoreOrder(Number(button.dataset.id));
        break;
      case "download-export":
        downloadStoreExport();
        break;
      case "change-calendar-month":
        changeCalendarMonth(Number(button.dataset.offset || 0));
        break;
      case "mark-order-delivered":
        await markOrderDelivered(Number(button.dataset.id));
        break;
      case "update-order-status":
        await updateOrderStatus(Number(button.dataset.id), button.dataset.status, button.dataset.view || activeView);
        break;
      case "open-inventory-item":
        openInventoryItemForm();
        break;
      case "open-inventory-move":
        openInventoryMove(Number(button.dataset.id), button.dataset.type);
        break;
      case "open-staff":
        openStaffForm();
        break;
      case "create-backup":
        await createServerBackup();
        break;
      case "ask-bloom-ai":
        askBloomAI(button.dataset.question || "");
        break;
      default:
        break;
    }
  } catch (error) {
    showToast(error.message || "Не удалось выполнить действие.", "error");
  }
}

async function initApp() {
  try {
    appConfig = await loadConfig();
    applyAppConfig();
    const response = await api("/api/me");
    currentUser = response.user;
    data = await loadData();
  } catch (error) {
    currentUser = null;
    applyAppConfig();
  }
  renderAuthState();
  if (currentUser) render();
}

async function loadConfig() {
  try {
    return await api("/api/config");
  } catch (error) {
    return appConfig;
  }
}

function applyAppConfig() {
  document.querySelectorAll(".dev-only").forEach((node) => node.classList.toggle("hidden", !appConfig.demoRegisterEnabled));
  document.querySelector("#inviteCodeLabel")?.classList.toggle("hidden", !appConfig.betaInviteRequired);
  const hint = document.querySelector("#loginHint");
  if (hint) {
    hint.textContent = appConfig.isDevelopment
      ? "Для локальной проверки используйте адрес из README. Для production включите домен, HTTPS и beta invite code."
      : "Для доступа используйте выданный логин и пароль.";
  }
}

function showToast(message, type = "success") {
  const toast = document.querySelector("#appToast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `app-toast ${type}`;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 3600);
}

async function api(path, options = {}) {
  let response;
  const method = String(options.method || "GET").toUpperCase();
  const csrfToken = currentUser?.csrfToken || "";
  const headers = {
    "Content-Type": "application/json",
    ...(csrfToken && !["GET", "HEAD", "OPTIONS"].includes(method) ? { "X-CSRF-Token": csrfToken } : {}),
    ...(options.headers || {})
  };
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      mode: "cors",
      headers,
      ...options
    });
  } catch (error) {
    throw new Error("Backend недоступен. Проверьте, что сервер JA Bloom362 запущен.");
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error("Сервер вернул неожиданный ответ. Обновите страницу и проверьте backend.");
  }
  if (!response.ok) {
    throw new Error(payload.error || "Ошибка сервера");
  }
  return payload;
}

async function handleLogin(event) {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector("button[type='submit']");
  const formData = new FormData(event.currentTarget);
  const login = String(formData.get("login")).trim().toLowerCase();
  const password = String(formData.get("password"));

  if (!login || !password) {
    document.querySelector("#loginError").textContent = "Введите логин и пароль";
    document.querySelector("#loginSuccess").textContent = "";
    return;
  }

  await loginWithCredentials(login, password, submitButton);
}

async function loginWithCredentials(login, password, button) {
  const originalText = button.textContent;
  try {
    button.disabled = true;
    button.textContent = "Входим...";
    document.querySelector("#loginError").textContent = "";
    document.querySelector("#loginSuccess").textContent = "Проверяем логин и пароль...";
    const response = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ login, password })
    });
    document.querySelector("#loginError").textContent = "";
    document.querySelector("#loginSuccess").textContent = "Вход выполнен. Открываем CRM...";
    currentUser = response.user;
    data = await loadData();
    activeView = "dashboard";
    renderAuthState();
    render();
    showView("dashboard");
  } catch (error) {
    document.querySelector("#loginError").textContent = error.message;
    document.querySelector("#loginSuccess").textContent = "";
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const formData = new FormData(event.currentTarget);
  const storeName = String(formData.get("storeName")).trim();
  const owner = String(formData.get("owner")).trim();
  const city = String(formData.get("city")).trim();
  const login = String(formData.get("login")).trim().toLowerCase();
  const password = String(formData.get("password"));
  const passwordConfirm = String(formData.get("passwordConfirm"));
  const inviteCode = String(formData.get("inviteCode") || "").trim();

  if (!storeName || !owner || !city || !login || !password || !passwordConfirm) {
    document.querySelector("#registerError").textContent = "Заполните все поля";
    document.querySelector("#registerSuccess").textContent = "";
    return;
  }
  if (!login.includes("@") || !login.includes(".")) {
    document.querySelector("#registerError").textContent = "Введите email в формате name@example.com";
    document.querySelector("#registerSuccess").textContent = "";
    return;
  }
  if (!isStrongPassword(password)) {
    document.querySelector("#registerError").textContent = PASSWORD_HINT;
    document.querySelector("#registerSuccess").textContent = "";
    return;
  }
  if (password !== passwordConfirm) {
    document.querySelector("#registerError").textContent = "Пароли не совпадают";
    document.querySelector("#registerSuccess").textContent = "";
    return;
  }

  try {
    await registerStore({ storeName, owner, city, login, password, inviteCode }, submitButton);
  } catch (error) {
    document.querySelector("#registerError").textContent = error.message;
    document.querySelector("#registerSuccess").textContent = "";
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Создать профиль";
  }
}

function fillRegisterDemo() {
  const form = document.querySelector("#registerForm");
  const stamp = Date.now().toString().slice(-6);
  form.storeName.value = `Flower Lab ${stamp}`;
  form.owner.value = "Алия";
  form.city.value = "Актау";
  form.login.value = `aliya${stamp}@flowerlab.kz`;
  form.password.value = "FlowerLab362!";
  form.passwordConfirm.value = "FlowerLab362!";
  document.querySelector("#registerError").textContent = "";
  document.querySelector("#registerSuccess").textContent = "Пример заполнен. Нажмите “Создать профиль”.";
}

async function registerStore(payload, submitButton) {
  submitButton.disabled = true;
  submitButton.textContent = "Создаем профиль...";
  document.querySelector("#registerError").textContent = "";
  document.querySelector("#registerSuccess").textContent = "Отправляем регистрацию на сервер...";
  const response = await api("/api/register", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  currentUser = response.user;
  data = response.data || { clients: [], orders: [] };
  document.querySelector("#registerSuccess").textContent = "Профиль создан. Открываем CRM...";
  showToast("Профиль магазина создан", "success");
  activeView = "dashboard";
  renderAuthState();
  render();
  showView("dashboard");
}

async function quickRegisterDemo() {
  const button = document.querySelector("#quickRegisterDemo");
  const stamp = Date.now().toString().slice(-6);
  try {
    await registerStore({
      storeName: `Quick Flower ${stamp}`,
      owner: "Алия",
      city: "Актау",
      login: `quick${stamp}@flowerlab.kz`,
      password: "FlowerLab362!",
      inviteCode: document.querySelector("#registerForm").inviteCode?.value || "",
      demoRegister: true
    }, button);
  } catch (error) {
    document.querySelector("#registerError").textContent = error.message;
    document.querySelector("#registerSuccess").textContent = "";
  } finally {
    button.disabled = false;
    button.textContent = "Создать тестовый профиль автоматически";
  }
}

function setAuthMode(mode) {
  const isRegister = mode === "register";
  document.querySelector("#loginForm").classList.toggle("hidden", isRegister);
  document.querySelector("#registerForm").classList.toggle("hidden", !isRegister);
  document.querySelector("#showRegister").classList.toggle("hidden", isRegister);
  document.querySelector("#showLogin").classList.toggle("hidden", !isRegister);
  document.querySelector(".demo-logins").classList.toggle("hidden", isRegister);
  document.querySelector("#loginError").textContent = "";
  document.querySelector("#loginSuccess").textContent = "";
  document.querySelector("#registerError").textContent = "";
  document.querySelector("#registerSuccess").textContent = "";
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    console.warn(error);
  }
  currentUser = null;
  closeModal();
  renderAuthState();
}

function renderAuthState() {
  const isLoggedIn = Boolean(currentUser);
  document.querySelector("#loginScreen").classList.toggle("hidden", isLoggedIn);
  document.querySelector("#appShell").classList.toggle("hidden", !isLoggedIn);

  if (!isLoggedIn) {
    document.querySelector("#loginForm").reset();
    document.querySelector("#registerForm").reset();
    document.querySelectorAll(".owner-only").forEach((node) => node.classList.add("hidden"));
    setAuthMode("login");
    return;
  }

  document.querySelector("#storeName").textContent = currentUser.storeName;
  const roleText = roleLabel(currentUser.role);
  document.querySelector("#storeOwner").textContent = `${currentUser.name || currentUser.owner} · ${roleText} · ${currentUser.city}`;
  document.querySelectorAll(".owner-only").forEach((node) => node.classList.toggle("hidden", !isOwner()));
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("hidden", !canOpenView(button.dataset.view));
  });
  document.querySelector("#addClient").classList.toggle("hidden", !canManageClients());
  document.querySelector("#addOrder").classList.toggle("hidden", !canManageOrders());
  document.querySelector("#bloomAiBtn").classList.toggle("hidden", ["courier", "florist"].includes(currentUser.role));
  if (!canOpenView(activeView)) activeView = firstAllowedView();
  updateViewHeading(activeView);
}

async function loadData() {
  const response = await api("/api/data");
  return response.data;
}

async function saveData() {
  if (!currentUser || !isOwner()) return true;
  try {
    await api("/api/data", {
      method: "PUT",
      body: JSON.stringify({ data })
    });
    showToast("Сохранено", "success");
    return true;
  } catch (error) {
    console.warn(error);
    showToast(error.message, "error");
    return false;
  }
}

function commitData(view = activeView) {
  render();
  if (view) showView(view);
  saveData();
}

function applyServerData(response, view = activeView) {
  if (response?.data) {
    data = response.data;
  }
  render();
  if (view) showView(view);
  showToast("Сохранено", "success");
}

function nextDate(days) {
  return new Date(Date.now() + days * dayMs).toISOString().slice(0, 10);
}

function pastDate(days) {
  return new Date(Date.now() - days * dayMs).toISOString().slice(0, 10);
}

function settingNumber(key, fallback) {
  const value = Number(data.settings?.[key]);
  return Number.isFinite(value) ? value : fallback;
}

function money(value) {
  const currency = data.settings?.currency || "₸";
  return `${Number(value).toLocaleString("ru-RU")} ${currency}`;
}

function daysUntil(date) {
  return Math.ceil((new Date(date) - startOfDay(today)) / dayMs);
}

function daysSince(date) {
  return Math.floor((startOfDay(today) - new Date(date)) / dayMs);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function getClient(id) {
  return data.clients.find((client) => client.id === Number(id));
}

function getClientOrders(clientId) {
  return data.orders.filter((order) => order.clientId === Number(clientId));
}

function getStatus(client) {
  if (daysSince(client.lastOrder) > settingNumber("sleepyClientDays", 30)) return "Спящий";
  if (client.orders >= 10) return "VIP";
  if (client.orders >= 3) return "Постоянный";
  return "Новый";
}

function cashbackRate(client) {
  const baseRate = settingNumber("bonusBasePercent", 5) / 100;
  const vipRate = settingNumber("bonusVipPercent", 10) / 100;
  if (client.orders >= 10) return vipRate;
  if (client.orders >= 5) return (baseRate + vipRate) / 2;
  return baseRate;
}

function badge(status) {
  const classes = {
    VIP: "green",
    Постоянный: "blue",
    Спящий: "amber",
    Потерянный: "red",
    Новый: ""
  };
  return `<span class="badge ${classes[status] || ""}">${escapeHtml(status)}</span>`;
}

function showView(view) {
  if (!canOpenView(view)) {
    view = "dashboard";
  }
  activeView = view;
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === view));
  document.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.view === view));
  updateViewHeading(view);
  render();
  if (view === "staff") {
    loadStaffUsers().then(() => renderStaff());
  }
}

function updateViewHeading(view) {
  const title = view === "dashboard" && currentUser?.role === "manager" ? "Панель менеджера" : viewMeta[view][0];
  document.querySelector("#viewTitle").textContent = title;
  document.querySelector("#viewSubtitle").textContent = viewMeta[view][1];
}

function render() {
  ensureDataShape();
  data.clients.forEach((client) => {
    client.status = getStatus(client);
  });
  renderDashboard();
  renderClients();
  renderOrders();
  renderReminders();
  renderLoyalty();
  renderChannels();
  renderReturns();
  renderLeads();
  renderFinance();
  renderAnalytics();
  renderTrash();
  renderCalendar();
  renderDelivery();
  renderInventory();
  renderStaff();
  renderSettings();
  showOnlyActive();
}

function showOnlyActive() {
  document.querySelectorAll(".view").forEach((node) => node.classList.toggle("active", node.id === activeView));
}

function isOwner() {
  return currentUser?.role === "owner";
}

function isManagerLike() {
  return ["owner", "manager", "operator"].includes(currentUser?.role);
}

function canManageClients() {
  return isManagerLike();
}

function canManageOrders() {
  return isManagerLike();
}

function canManageLeads() {
  return isManagerLike();
}

function firstAllowedView() {
  const preferred = currentUser?.role === "courier" ? "delivery" : currentUser?.role === "florist" ? "orders" : "dashboard";
  if (canOpenView(preferred)) return preferred;
  return [...document.querySelectorAll(".nav-item")].map((button) => button.dataset.view).find(canOpenView) || "dashboard";
}

function roleLabel(role) {
  return {
    owner: "Владелец",
    manager: "Менеджер",
    florist: "Флорист",
    courier: "Курьер",
    operator: "Оператор"
  }[role] || "Сотрудник";
}

function canOpenView(view) {
  const viewsByRole = {
    owner: ["dashboard", "clients", "orders", "reminders", "loyalty", "channels", "returns", "leads", "finance", "analytics", "trash", "calendar", "delivery", "inventory", "staff", "settings"],
    manager: ["dashboard", "clients", "orders", "reminders", "loyalty", "channels", "returns", "leads", "calendar", "delivery"],
    operator: ["dashboard", "clients", "orders", "reminders", "loyalty", "channels", "returns", "leads", "calendar", "delivery"],
    florist: ["orders"],
    courier: ["delivery"]
  };
  return (viewsByRole[currentUser?.role] || []).includes(view);
}

function ensureDataShape() {
  data.clients ||= [];
  data.orders ||= [];
  data.deleted ||= { clients: [], orders: [] };
  data.deleted.clients ||= [];
  data.deleted.orders ||= [];
  data.auditLog ||= [];
  data.cashShifts ||= [];
  data.settings ||= {
    city: currentUser?.city || "Актау",
    currency: "₸",
    bonusBasePercent: 5,
    bonusVipPercent: 10,
    lowStockAlert: true,
    birthdayReminderDays: 7,
    sleepyClientDays: 30
  };
  data.settings = {
    city: currentUser?.city || "Актау",
    currency: "₸",
    bonusBasePercent: 5,
    bonusVipPercent: 10,
    lowStockAlert: true,
    birthdayReminderDays: 7,
    sleepyClientDays: 30,
    ...data.settings
  };
  data.leads ||= [];
  data.returnTasks ||= [];
  data.financeEntries ||= [];
  data.inventory ||= [];
  data.inventoryMoves ||= [];
  [
    data.clients,
    data.orders,
    data.leads,
    data.returnTasks,
    data.financeEntries,
    data.inventory,
    data.inventoryMoves,
    data.cashShifts,
    data.deleted.clients,
    data.deleted.orders,
    data.auditLog
  ].forEach((collection) => collection.forEach((item) => sanitizeRecordStrings(item)));
  data.clients.forEach((client) => {
    client.colors ||= client.status === "VIP" ? "Белый, розовый, пастель" : "По настроению";
    client.rating = clientTier(client);
  });
  data.orders.forEach((order) => {
    const client = getClient(order.clientId) || { orders: 0 };
    order.status ||= "new";
    order.deliveryDate ||= order.date || today.toISOString().slice(0, 10);
    order.deliveryTime ||= "";
    order.manager ||= currentUser?.name || currentUser?.owner || "";
    order.comment ||= "";
    order.photo ||= "";
    order.createdAt ||= `${order.date || today.toISOString().slice(0, 10)}T12:00:00.000`;
    order.cashShiftId ||= "";
    order.items ||= [];
    order.bonus = Number(order.bonus ?? Math.round(Number(order.sum || 0) * cashbackRate(client)));
  });
  syncReturnTasks();
}

function clientLifetimeValue(clientOrId) {
  const clientId = typeof clientOrId === "object" ? clientOrId.id : clientOrId;
  return data.orders
    .filter((order) => Number(order.clientId) === Number(clientId) && order.status !== "cancelled")
    .reduce((sum, order) => sum + Number(order.sum || 0), 0);
}

function premiumBars(days, valueGetter, labelGetter = formatDayLabel) {
  const values = days.map((day) => Number(valueGetter(day) || 0));
  const max = Math.max(...values, 1);
  return days.map((day, index) => {
    const value = values[index];
    const height = Math.max(8, Math.round(value / max * 100));
    return `
      <div class="premium-bar" title="${escapeHtml(labelGetter(day))}: ${money(value)}">
        <span style="height:${height}%"></span>
        <small>${escapeHtml(labelGetter(day).split(",")[0])}</small>
      </div>
    `;
  }).join("");
}

function clientSegmentRows() {
  return ["VIP", "Gold", "Silver", "Standard"].map((tier) => {
    const count = data.clients.filter((client) => clientTier(client).name === tier).length;
    const percent = data.clients.length ? Math.round(count / data.clients.length * 100) : 0;
    return `
      <div class="segment-row">
        <span>${tier}</span>
        <div class="bar-track"><span style="width:${percent}%"></span></div>
        <strong>${percent}%</strong>
      </div>
    `;
  }).join("");
}

function cashflowRows() {
  return lastNDays(7).map((day) => {
    const ordersRevenue = dayRevenue(day);
    const manualRevenue = data.financeEntries
      .filter((entry) => entry.date === day && entry.type === "revenue")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const expenses = data.financeEntries
      .filter((entry) => entry.date === day && entry.type === "expense")
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    return { day, revenue: ordersRevenue + manualRevenue, expenses, profit: ordersRevenue + manualRevenue - expenses };
  });
}

function inventoryForecastText(item) {
  const weeklyWriteoff = data.inventoryMoves
    .filter((move) => move.type === "writeoff" && Number(move.itemId) === Number(item.id))
    .reduce((sum, move) => sum + Number(move.qty || 0), 0);
  const dailyAvg = weeklyWriteoff ? weeklyWriteoff / 7 : Math.max(1, Number(item.minQty || 0) / 14);
  const daysLeft = Math.max(1, Math.round(Number(item.qty || 0) / dailyAvg));
  if (Number(item.qty || 0) <= Number(item.minQty || 0)) return "Срочно заказать сегодня";
  if (daysLeft <= 7) return `Заказать в течение ${daysLeft} дн.`;
  return `Запаса примерно на ${daysLeft} дн.`;
}

function renderDashboard() {
  const revenue = data.orders.reduce((sum, order) => sum + Number(order.sum), 0);
  const repeatClients = data.clients.filter((client) => client.orders > 1).length;
  const bonus = data.clients.reduce((sum, client) => sum + Number(client.bonus), 0);
  const sleepy = returnCandidates();
  const events = [...data.clients].sort((a, b) => daysUntil(a.event) - daysUntil(b.event));
  const returnStats = getReturnStats();
  const finance = getFinanceStats();
  const lost = lostMoneyStats();
  const days = lastNDays(7);
  const weekRevenue = days.reduce((sum, day) => sum + dayRevenue(day), 0);
  const avgCheck = data.orders.length ? Math.round(revenue / data.orders.length) : 0;
  const openShift = getOpenCashShift();

  document.querySelector("#dashboard").innerHTML = `
    <div class="hero-card dashboard-hero">
      <div>
        <span class="system-pill">JA Bloom362 Operating System</span>
        <h3>Цветочный бизнес под контролем</h3>
        <p>Продажи, клиенты, склад, касса, доставка и возврат денег собраны в одной премиальной панели владельца.</p>
      </div>
      <div class="hero-orbit">
        <small>Live revenue</small>
        <strong>${money(revenue)}</strong>
        <span>${openShift ? "Касса открыта" : "Касса ожидает открытия"}</span>
      </div>
    </div>
    <div class="grid stats-grid kpi-grid">
      ${metric("Выручка", money(revenue))}
      ${metric("Средний чек", money(avgCheck))}
      ${metric("Повторные клиенты", repeatClients)}
      ${metric("Активные бонусы", money(bonus))}
      ${metric("Сегодня: выручка", money(finance.todayRevenue))}
      ${metric("Сегодня: расходы", money(finance.todayExpenses))}
      ${metric("Сегодня: прибыль", money(finance.todayProfit))}
      ${metric("Вернулось клиентов", returnStats.returned)}
    </div>
    <div class="grid two-column">
      <div class="card executive-card">
        <div class="section-head">
          <h3>Revenue Intelligence</h3>
          <span class="badge green">${money(weekRevenue)} за 7 дней</span>
        </div>
        <div class="premium-chart">
          ${premiumBars(days, dayRevenue)}
        </div>
        <div class="signal-grid">
          <div><small>Пиковый день</small><strong>${formatDayLabel(days.reduce((best, day) => dayRevenue(day) > dayRevenue(best) ? day : best, days[0]))}</strong></div>
          <div><small>Заказов за неделю</small><strong>${days.reduce((sum, day) => sum + dayOrders(day).length, 0)}</strong></div>
          <div><small>Денежный поток</small><strong>${money(finance.monthProfit)}</strong></div>
        </div>
      </div>
      <div class="card executive-card">
        <div class="section-head">
          <h3>Client Capital</h3>
          <span class="badge blue">${data.clients.length} профилей</span>
        </div>
        <div class="segment-board">
          ${clientSegmentRows()}
        </div>
        <div class="message-box premium-message">VIP/Gold клиенты получают приоритет в напоминаниях, возврате и персональных предложениях.</div>
      </div>
    </div>
    <div class="grid two-column">
      <div class="card">
        <div class="section-head">
          <h3>Ближайшие продажи</h3>
          <span class="badge green">${events.length} событий</span>
        </div>
        <div class="list">
          ${events.slice(0, 6).map((client) => `
            <div class="row premium-row">
              <div>
                <strong>${escapeHtml(client.name)}</strong>
                <p>${escapeHtml(client.relation)}: ${escapeHtml(client.recipient)} · через ${daysUntil(client.event)} дней · ${escapeHtml(client.flowers)} · LTV ${money(clientLifetimeValue(client))}</p>
              </div>
              ${tierBadge(client)}
            </div>
          `).join("")}
        </div>
      </div>
      <div class="card lost-money-card">
        <div class="section-head">
          <h3>Lost Revenue Recovery</h3>
          <button class="primary-button" type="button" data-action="show-view" data-view="returns">Вернуть клиентов</button>
        </div>
        <div class="metric hero-metric"><small>Спящие клиенты</small><strong>${sleepy.length}</strong></div>
        <p>Потенциальная выручка: <b>${money(sleepy.reduce((sum, client) => sum + Number(client.budget), 0))}</b></p>
        <p>Уже вернулось: <b>${returnStats.returned}</b>. Заработано дополнительно: <b>${money(returnStats.earned)}</b></p>
        <div class="message-box premium-message">JA Bloom362 AI: ${escapeHtml(returnMessage(sleepy[0] || events[0]))}</div>
      </div>
    </div>
    <div class="grid two-column">
      <div class="card">
        <div class="section-head">
          <h3>Потерянные деньги</h3>
          <button class="danger-button" type="button" data-action="show-view" data-view="returns">Вернуть клиентов</button>
        </div>
        <div class="metric"><small>За последние 60 дней вы потеряли</small><strong>${lost.clients} клиентов</strong></div>
        <p>Потенциально потеряно: <b>${money(lost.amount)}</b></p>
        <div class="bar-track"><span style="width:${Math.min(100, lost.clients * 18)}%"></span></div>
      </div>
      <div class="card telegram-card">
        <div class="section-head">
          <h3>Telegram Analytics</h3>
          <button class="channel-button" type="button" data-action="copy-telegram">Скопировать</button>
        </div>
        <div class="telegram-preview">${escapeHtml(telegramDigest()).replaceAll("\n", "<br>")}</div>
      </div>
    </div>
  `;
}

function renderClients() {
  document.querySelector("#clients").innerHTML = `
    <div class="toolbar">
      <input class="search-input" id="clientSearch" placeholder="Поиск по имени, телефону или Instagram">
    </div>
    <div class="grid three-column" id="clientGrid"></div>
  `;
  const search = document.querySelector("#clientSearch");
  search.addEventListener("input", drawClients);
  drawClients();
}

function drawClients() {
  const search = document.querySelector("#clientSearch");
  const grid = document.querySelector("#clientGrid");
  if (!grid) return;
  const query = (search?.value || "").toLowerCase();
  const clients = data.clients.filter((client) => {
    return [client.name, client.phone, client.instagram, client.recipient].join(" ").toLowerCase().includes(query);
  });

  grid.innerHTML = clients.map((client) => {
    const orders = getClientOrders(client.id);
    const lastOrder = orders[0];
    return `
      <article class="card client-card premium-client">
        <div class="client-head">
          <div>
            <small class="system-pill">${clientTier(client).name} Client</small>
            <h3>${escapeHtml(client.name)}</h3>
            <p>${escapeHtml(client.phone)}</p>
          </div>
          <div class="badge-stack">${badge(client.status)}${tierBadge(client)}</div>
        </div>
        <div class="client-kpis">
          <div><small>LTV</small><strong>${money(clientLifetimeValue(client))}</strong></div>
          <div><small>Покупок</small><strong>${orders.length || client.orders || 0}</strong></div>
          <div><small>Средний чек</small><strong>${money(client.budget)}</strong></div>
        </div>
        <p><b>Получатель:</b> ${escapeHtml(client.recipient)} (${escapeHtml(client.relation)})</p>
        <p><b>Предпочтения:</b> ${escapeHtml(client.flowers)} · ${escapeHtml(client.colors || "По настроению")}</p>
        <div class="message-box premium-message">${lastOrder ? `Последний заказ: ${escapeHtml(lastOrder.bouquet)} · ${money(lastOrder.sum)} · ${escapeHtml(lastOrder.date)}` : "История покупок пока пустая."}</div>
        <div class="client-actions">
          <button class="channel-button" type="button" data-action="open-passport" data-id="${client.id}">Паспорт</button>
          <button class="channel-button" type="button" data-action="open-client" data-id="${client.id}">Редактировать</button>
          <button class="danger-button" type="button" data-action="delete-client" data-id="${client.id}">Удалить</button>
          ${clientLinks(client)}
        </div>
      </article>
    `;
  }).join("");
}

async function deleteClient(id) {
  if (!canManageClients()) {
    showToast("Недостаточно прав для удаления клиента.", "error");
    return;
  }
  const client = getClient(id);
  if (!client) return;
  const approved = confirm(`Переместить клиента ${client.name} и его заказы в корзину?`);
  if (!approved) return;
  try {
    const response = await api(`/api/clients/${Number(id)}`, { method: "DELETE" });
    closeModal();
    applyServerData(response, "clients");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderOrders() {
  document.querySelector("#orders").innerHTML = `
    <div class="card">
      <h3>История заказов</h3>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Статус</th>
              <th>Клиент</th>
              <th>Сумма</th>
              <th>Кэшбек</th>
              <th>Повод</th>
              <th>Букет</th>
              <th>Склад</th>
              <th>Фото</th>
              <th>Канал</th>
              <th>Доставка</th>
              <th>Менеджер</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            ${data.orders.map((order) => {
              const client = getClient(order.clientId);
              return `
                <tr>
                <td>${escapeHtml(order.date)}</td>
                <td><span class="badge ${statusClass(order.status)}">${statusLabel(order.status)}</span></td>
                  <td>${escapeHtml(client?.name || "Клиент удален")}</td>
                  <td>${money(order.sum)}</td>
                  <td>${money(orderBonus(order, client))}</td>
                  <td>${escapeHtml(order.reason)}</td>
                  <td>${escapeHtml(order.bouquet)}</td>
                  <td>${orderItemsSummary(order)}</td>
                  <td>${order.photo ? `<a class="channel-button" href="${cleanUrl(order.photo)}" target="_blank" rel="noreferrer">Фото</a>` : "-"}</td>
                  <td>${escapeHtml(order.channel)}</td>
                  <td>${escapeHtml(order.deliveryDate || "-")} ${escapeHtml(order.deliveryTime || "")}</td>
                  <td>${escapeHtml(order.manager || "-")}</td>
                  <td>
                    ${orderActionButtons(order, "orders")}
                  </td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function orderActionButtons(order, view = "orders") {
  if (canManageOrders()) {
    return `
      <div class="table-actions">
        <button class="channel-button" type="button" data-action="open-order" data-id="${order.id}">Изменить</button>
        <button class="danger-button" type="button" data-action="delete-order" data-id="${order.id}">Удалить</button>
      </div>
    `;
  }
  if (currentUser?.role === "florist") {
    return `
      <div class="table-actions">
        <button class="channel-button" type="button" data-action="update-order-status" data-id="${order.id}" data-status="work" data-view="${view}">В работе</button>
        <button class="primary-button" type="button" data-action="update-order-status" data-id="${order.id}" data-status="ready" data-view="${view}">Готов</button>
      </div>
    `;
  }
  if (currentUser?.role === "courier") {
    return `<button class="primary-button" type="button" data-action="mark-order-delivered" data-id="${order.id}">Доставлено</button>`;
  }
  return "-";
}

function renderReminders() {
  const sorted = [...data.clients].sort((a, b) => daysUntil(a.event) - daysUntil(b.event));
  document.querySelector("#reminders").innerHTML = `
    <div class="card">
      <h3>Готовые напоминания</h3>
      <div class="list">
        ${sorted.map((client) => {
          const message = reminderMessage(client);
          return `
            <div class="row">
              <div>
                <strong>${escapeHtml(client.name)}</strong>
                <p>${escapeHtml(client.recipient)} · ${escapeHtml(client.relation)} · событие через ${daysUntil(client.event)} дней</p>
                <div class="message-box">${escapeHtml(message)}</div>
              </div>
              <a class="channel-button whatsapp" href="${waLink(client.phone, message)}" target="_blank" rel="noreferrer">WhatsApp</a>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderLoyalty() {
  const totalBonus = data.clients.reduce((sum, client) => sum + Number(client.bonus), 0);
  const vip = data.clients.filter((client) => clientTier(client).name === "VIP").length;
  const avgScore = Math.round(data.clients.reduce((sum, client) => sum + bloomScore(client), 0) / (data.clients.length || 1));
  const tierCounts = Object.fromEntries(["VIP", "Gold", "Silver", "Standard"].map((tier) => [tier, data.clients.filter((client) => clientTier(client).name === tier).length]));

  document.querySelector("#loyalty").innerHTML = `
    <div class="grid stats-grid">
      ${metric("Активные бонусы", money(totalBonus))}
      ${metric("VIP клиентов", vip)}
      ${metric("Средний BloomScore", avgScore)}
      ${metric("Базовый кэшбек", "5-10%")}
    </div>
    <div class="grid three-column" style="margin-top:16px">
      <div class="card"><h3>VIP</h3><p>${tierCounts.VIP} клиентов · высокий чек, частые покупки, персональный сервис.</p></div>
      <div class="card"><h3>Gold</h3><p>${tierCounts.Gold} клиентов · приоритетная доставка и усиленные бонусы.</p></div>
      <div class="card"><h3>Silver</h3><p>${tierCounts.Silver} клиентов · стабильные повторные продажи.</p></div>
      <div class="card"><h3>Standard</h3><p>${tierCounts.Standard} клиентов · новые и редкие покупатели для прогрева.</p></div>
    </div>
  `;
}

function renderChannels() {
  document.querySelector("#channels").innerHTML = `
    <div class="grid three-column">
      <div class="card">
        <h3>WhatsApp</h3>
        <p>Быстрые сообщения клиентам, напоминания и возврат спящих покупателей.</p>
        <span class="badge green">${countByChannel("WhatsApp")} клиентов</span>
      </div>
      <div class="card">
        <h3>Instagram</h3>
        <p>Хранение профилей, открытие Direct и учет заказов из Instagram.</p>
        <span class="badge">${countByChannel("Instagram")} клиентов</span>
      </div>
      <div class="card">
        <h3>2GIS</h3>
        <p>Адреса доставки, карта и подготовка будущей интеграции с API 2GIS.</p>
        <span class="badge blue">${countByChannel("2GIS")} клиентов</span>
      </div>
    </div>
    <div class="card telegram-card" style="margin-top:16px">
      <div class="section-head">
        <h3>Telegram Analytics</h3>
        <button class="primary-button" type="button" data-action="copy-telegram">Скопировать отчет</button>
      </div>
      <div class="telegram-preview">${escapeHtml(telegramDigest()).replaceAll("\n", "<br>")}</div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Клиенты по каналам</h3>
      <div class="list">
        ${data.clients.map((client) => `
          <div class="row">
            <div>
              <strong>${escapeHtml(client.name)}</strong>
              <p>${escapeHtml(client.channel)} · ${escapeHtml(client.instagram || "Instagram не указан")} · ${escapeHtml(client.address || "Адрес не указан")}</p>
            </div>
            <div class="channel-actions">${clientLinks(client)}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderReturns() {
  const stats = getReturnStats();
  const lost = lostMoneyStats();
  const activeTasks = data.returnTasks
    .map((task) => ({ ...task, client: getClient(task.clientId) }))
    .filter((task) => task.client)
    .sort((a, b) => (a.status === "returned") - (b.status === "returned") || daysSince(b.client.lastOrder) - daysSince(a.client.lastOrder));

  document.querySelector("#returns").innerHTML = `
    <div class="grid stats-grid">
      ${metric("Задач возврата", stats.total)}
      ${metric("Вернулось клиентов", stats.returned)}
      ${metric("Заработано дополнительно", money(stats.earned))}
      ${metric("Потенциал", money(stats.potential))}
    </div>
    <div class="grid two-column">
      <div class="card lost-money-card">
        <div class="section-head">
          <h3>Потерянные деньги</h3>
          <button class="primary-button" type="button" data-action="touch-return-tasks">Запустить возврат</button>
        </div>
        <p>За последние 60 дней вы потеряли <b>${lost.clients}</b> клиентов.</p>
        <div class="metric"><small>Потенциально потеряно</small><strong>${money(lost.amount)}</strong></div>
      </div>
      <div class="card">
        <h3>Как система считает возврат</h3>
        <div class="message-box">Если клиент не покупал 30 дней, JA Bloom362 автоматически создает задачу, предлагает сообщение и считает деньги после нового заказа или отметки “Вернулся”.</div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Автоматические задачи</h3>
      <div class="list">
        ${activeTasks.map((task) => `
          <div class="row return-row">
            <div>
              <div class="row-title">
                <strong>${escapeHtml(task.client.name)}</strong>
                ${tierBadge(task.client)}
                <span class="badge ${returnStatusClass(task.status)}">${returnStatusLabel(task.status)}</span>
              </div>
              <p>Не покупал(а) ${daysSince(task.client.lastOrder)} дней · средний чек ${money(task.client.budget)} · ${escapeHtml(task.client.flowers)}</p>
              <div class="message-box">${escapeHtml(task.suggestedMessage || returnMessage(task.client))}</div>
            </div>
            <div class="return-actions">
              <a class="channel-button whatsapp" href="${waLink(task.client.phone, task.suggestedMessage || returnMessage(task.client))}" target="_blank" rel="noreferrer">WhatsApp</a>
              <button class="channel-button" type="button" data-action="mark-return-task" data-id="${task.id}" data-status="contacted">Написали</button>
              <button class="primary-button" type="button" data-action="complete-return-task" data-id="${task.id}">Вернулся</button>
            </div>
          </div>
        `).join("") || '<p class="muted">Сейчас нет клиентов, которым нужен возврат.</p>'}
      </div>
    </div>
  `;
}

function renderLeads() {
  const pipelineValue = data.leads
    .filter((lead) => !["order", "lost"].includes(lead.status))
    .reduce((sum, lead) => sum + Number(lead.budget || 0), 0);
  document.querySelector("#leads").innerHTML = `
    <div class="grid stats-grid">
      ${metric("Лидов в работе", data.leads.filter((lead) => !["order", "lost"].includes(lead.status)).length)}
      ${metric("Потенциал воронки", money(pipelineValue))}
      ${metric("В заказе", data.leads.filter((lead) => lead.status === "order").length)}
      ${metric("Потеряно", data.leads.filter((lead) => lead.status === "lost").length)}
    </div>
    <div class="section-head screen-actions">
      <h3>Воронка продаж</h3>
      <button class="primary-button" type="button" data-action="open-lead">+ Потенциальный клиент</button>
    </div>
    <div class="pipeline">
      ${leadStatuses.map(([status, label]) => {
        const leads = data.leads.filter((lead) => lead.status === status);
        return `
          <div class="pipeline-column">
            <div class="pipeline-head">
              <strong>${label}</strong>
              <span class="badge blue">${leads.length}</span>
            </div>
            ${leads.map((lead) => `
              <article class="lead-card">
                <h3>${escapeHtml(lead.name)}</h3>
                <p>${escapeHtml(lead.source)} · ${escapeHtml(lead.phone)}</p>
                <p><b>${money(lead.budget)}</b> · ${escapeHtml(lead.need)}</p>
                <div class="message-box">${escapeHtml(lead.nextAction || "Следующее действие не указано")}</div>
                <div class="client-actions">
                  <button class="channel-button" type="button" data-action="open-lead" data-id="${lead.id}">Изменить</button>
                  <button class="channel-button" type="button" data-action="move-lead" data-id="${lead.id}" data-direction="1">Дальше</button>
                  <button class="primary-button" type="button" data-action="convert-lead" data-id="${lead.id}">В клиента</button>
                </div>
              </article>
            `).join("") || '<p class="muted">Пусто</p>'}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderFinance() {
  const node = document.querySelector("#finance");
  if (!node) return;
  if (!isOwner()) {
    node.innerHTML = `<div class="card"><h3>Финансы</h3><p>Раздел доступен только владельцу магазина.</p></div>`;
    return;
  }
  const stats = getFinanceStats();
  const todayRows = data.financeEntries.filter((entry) => entry.date === today.toISOString().slice(0, 10));
  const openShift = getOpenCashShift();
  const openShiftStats = openShift ? getCashShiftStats(openShift) : null;
  const flowRows = cashflowRows();
  const maxFlow = Math.max(...flowRows.map((row) => row.revenue), 1);
  node.innerHTML = `
    <div class="grid stats-grid">
      ${metric("Сегодня: выручка", money(stats.todayRevenue))}
      ${metric("Сегодня: расходы", money(stats.todayExpenses))}
      ${metric("Сегодня: прибыль", money(stats.todayProfit))}
      ${metric("Месяц: прибыль", money(stats.monthProfit))}
    </div>
    <div class="card finance-command">
      <div class="section-head">
        <h3>Cashflow Control</h3>
        <span class="badge green">Средний чек ${money(data.orders.length ? Math.round(data.orders.reduce((sum, order) => sum + Number(order.sum || 0), 0) / data.orders.length) : 0)}</span>
      </div>
      <div class="cashflow-grid">
        ${flowRows.map((row) => `
          <div class="cashflow-day">
            <small>${formatDayLabel(row.day)}</small>
            <div class="bar-track"><span style="width:${Math.round(row.revenue / maxFlow * 100)}%"></span></div>
            <strong>${money(row.profit)}</strong>
            <p>${money(row.revenue)} / ${money(row.expenses)}</p>
          </div>
        `).join("")}
      </div>
    </div>
    <div class="grid two-column">
      <div class="card cash-card">
        <div class="section-head">
          <h3>Кассовая смена</h3>
          <div class="table-actions">
            <button class="primary-button" type="button" data-action="open-cash-shift" ${openShift ? "disabled" : ""}>Открыть кассу</button>
            <button class="danger-button" type="button" data-action="close-cash-shift" ${openShift ? "" : "disabled"}>Закрыть кассу</button>
          </div>
        </div>
        ${openShift ? `
          <span class="badge green">Открыта</span>
          <p>Открыта: <b>${formatDateTime(openShift.openedAt)}</b> · ${openShift.openedBy || "-"}</p>
          <div class="compact-stats">
            ${miniMetric("Продажи смены", money(openShiftStats.revenue))}
            ${miniMetric("Заказов смены", openShiftStats.orders)}
            ${miniMetric("Средний чек", money(openShiftStats.avg))}
            ${miniMetric("Наличные на старте", money(openShift.openingCash || 0))}
          </div>
        ` : `
          <span class="badge amber">Касса закрыта</span>
          <p>Перед началом продаж откройте кассу. Если менеджер создаст заказ без смены, JA Bloom362 откроет смену автоматически.</p>
        `}
      </div>
      <div class="card">
        <h3>История кассы</h3>
        <div class="list">
          ${data.cashShifts.slice(0, 6).map((shift) => {
            const shiftStats = getCashShiftStats(shift);
            return `
              <div class="row">
                <div>
                  <strong>${shift.closedAt ? "Закрыта" : "Открыта"} · ${formatDateTime(shift.openedAt)}</strong>
                  <p>${shift.closedAt ? `Закрытие: ${formatDateTime(shift.closedAt)}` : "Смена идет"} · заказов: ${shiftStats.orders} · продажи: ${money(shiftStats.revenue)}</p>
                </div>
                <span class="badge ${shift.closedAt ? "blue" : "green"}">${shift.closedAt ? "Смена" : "Live"}</span>
              </div>
            `;
          }).join("") || '<p class="muted">Смен пока нет.</p>'}
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head">
        <h3>Финансовый день</h3>
        <button class="primary-button" type="button" data-action="open-finance-entry">+ Запись</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Дата</th><th>Тип</th><th>Категория</th><th>Сумма</th><th>Комментарий</th></tr></thead>
          <tbody>
            ${todayRows.map((entry) => `
              <tr>
                <td>${escapeHtml(entry.date)}</td>
                <td><span class="badge ${entry.type === "revenue" ? "green" : "red"}">${entry.type === "revenue" ? "Выручка" : "Расход"}</span></td>
                <td>${escapeHtml(entry.category)}</td>
                <td>${money(entry.amount)}</td>
                <td>${escapeHtml(entry.comment || "-")}</td>
              </tr>
            `).join("") || '<tr><td colspan="5">Сегодня записей пока нет.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderAnalytics() {
  const node = document.querySelector("#analytics");
  if (!node) return;
  if (!isOwner()) {
    node.innerHTML = `<div class="card"><h3>Аналитика</h3><p>Раздел доступен только владельцу магазина.</p></div>`;
    return;
  }
  const days = lastNDays(7);
  const totalWeekRevenue = days.reduce((sum, day) => sum + dayRevenue(day), 0);
  const itemRows = weeklyItemSales();
  const topItem = itemRows[0];
  node.innerHTML = `
    <div class="grid stats-grid">
      ${metric("Продажи за 7 дней", money(totalWeekRevenue))}
      ${metric("Заказов за неделю", days.reduce((sum, day) => sum + dayOrders(day).length, 0))}
      ${metric("Топ позиция", topItem ? topItem.name : "-")}
      ${metric("Доля топ позиции", topItem && totalWeekRevenue ? `${Math.round(topItem.revenue / totalWeekRevenue * 100)}%` : "0%")}
    </div>
    <div class="grid two-column">
      <div class="card">
        <h3>Продажи по дням недели</h3>
        <div class="analytics-bars">
          ${days.map((day) => {
            const revenue = dayRevenue(day);
            const percent = totalWeekRevenue ? Math.round(revenue / totalWeekRevenue * 100) : 0;
            return `
              <div class="analytics-row">
                <div>
                  <strong>${formatDayLabel(day)}</strong>
                  <p>${money(revenue)} · ${dayOrders(day).length} заказов · ${percent}% недели</p>
                </div>
                <div class="bar-track"><span style="width:${percent}%"></span></div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <div class="card">
        <h3>Продажи позиций за неделю</h3>
        <div class="analytics-bars">
          ${itemRows.map((item) => {
            const percent = totalWeekRevenue ? Math.round(item.revenue / totalWeekRevenue * 100) : 0;
            return `
              <div class="analytics-row">
                <div>
                  <strong>${escapeHtml(item.name)}</strong>
                  <p>${escapeHtml(item.qty)} ${escapeHtml(item.unit)} · ${money(item.revenue)} · ${percent}% продаж</p>
                </div>
                <div class="bar-track"><span style="width:${percent}%"></span></div>
              </div>
            `;
          }).join("") || '<p class="muted">Пока нет заказов с позициями склада за неделю.</p>'}
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Остатки в реальном времени</h3>
      <div class="grid three-column">
        ${data.inventory.map((item) => `
          <div class="mini-stock ${Number(item.qty || 0) <= Number(item.minQty || 0) ? "low" : ""}">
            <strong>${escapeHtml(item.name)}</strong>
            <p>${escapeHtml(item.qty)} ${escapeHtml(item.unit)} осталось · минимум ${escapeHtml(item.minQty)} ${escapeHtml(item.unit)}</p>
            <div class="bar-track"><span style="width:${stockPercent(item)}%"></span></div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderTrash() {
  const node = document.querySelector("#trash");
  if (!node) return;
  if (!isOwner()) {
    node.innerHTML = `<div class="card"><h3>Корзина</h3><p>Раздел доступен только владельцу магазина.</p></div>`;
    return;
  }
  const deletedClients = data.deleted?.clients || [];
  const deletedOrders = data.deleted?.orders || [];
  node.innerHTML = `
    <div class="grid stats-grid">
      ${metric("Удаленных клиентов", deletedClients.length)}
      ${metric("Удаленных заказов", deletedOrders.length)}
      ${metric("Действий в журнале", data.auditLog.length)}
      ${metric("Можно восстановить", deletedClients.length + deletedOrders.length)}
    </div>
    <div class="grid two-column">
      <div class="card">
        <h3>Удаленные клиенты</h3>
        <div class="list">
          ${deletedClients.map((item) => `
            <div class="row">
              <div>
                <strong>${escapeHtml(item.client.name)}</strong>
                <p>${escapeHtml(item.deletedAt)} · заказов внутри: ${item.orders?.length || 0} · ${escapeHtml(item.reason || "удален вручную")}</p>
              </div>
              <button class="primary-button" type="button" data-action="restore-client" data-id="${item.deletedId}">Восстановить</button>
            </div>
          `).join("") || '<p class="muted">Удаленных клиентов нет.</p>'}
        </div>
      </div>
      <div class="card">
        <h3>Удаленные заказы</h3>
        <div class="list">
          ${deletedOrders.map((item) => `
            <div class="row">
              <div>
                <strong>${escapeHtml(item.order.bouquet)}</strong>
                <p>${escapeHtml(item.deletedAt)} · ${money(item.order.sum)} · клиент: ${escapeHtml(getClient(item.order.clientId)?.name || "клиент удален")}</p>
              </div>
              <button class="primary-button" type="button" data-action="restore-order" data-id="${item.deletedId}">Восстановить</button>
            </div>
          `).join("") || '<p class="muted">Удаленных заказов нет.</p>'}
        </div>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head">
        <h3>Журнал действий</h3>
        <button class="channel-button" type="button" data-action="download-export">Экспорт JSON</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Дата</th><th>Пользователь</th><th>Действие</th><th>Объект</th><th>Описание</th></tr></thead>
          <tbody>
            ${data.auditLog.slice(0, 80).map((entry) => `
              <tr>
                <td>${escapeHtml(entry.at)}</td>
                <td>${escapeHtml(entry.user || "-")}</td>
                <td>${escapeHtml(entry.action)}</td>
                <td>${escapeHtml(entry.entity)}</td>
                <td>${escapeHtml(entry.label || "-")}</td>
              </tr>
            `).join("") || '<tr><td colspan="5">Журнал пока пуст.</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderCalendar() {
  const month = currentCalendarDate.getMonth();
  const year = currentCalendarDate.getFullYear();
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let index = 0; index < offset; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  document.querySelector("#calendar").innerHTML = `
    <div class="card">
      <div class="section-head">
        <h3>${currentCalendarDate.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</h3>
        <div class="table-actions">
          <button class="channel-button" type="button" data-action="change-calendar-month" data-offset="-1">Назад</button>
          <button class="channel-button" type="button" data-action="change-calendar-month" data-offset="1">Вперед</button>
        </div>
      </div>
      <div class="calendar-weekdays">
        ${["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => `<strong>${day}</strong>`).join("")}
      </div>
      <div class="calendar-grid">
        ${cells.map((date) => {
          if (!date) return '<div class="calendar-day muted-day"></div>';
          const dateKey = date.toISOString().slice(0, 10);
          const events = calendarEvents(dateKey);
          return `
            <div class="calendar-day ${dateKey === today.toISOString().slice(0, 10) ? "today-day" : ""}">
              <strong>${date.getDate()}</strong>
              ${events.map((event) => `<div class="calendar-event ${escapeHtml(event.type)}">${escapeHtml(event.icon)} ${escapeHtml(event.title)}</div>`).join("")}
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function renderDelivery() {
  const deliveries = data.orders
    .filter((order) => order.deliveryDate)
    .sort((a, b) => `${a.deliveryDate} ${a.deliveryTime || ""}`.localeCompare(`${b.deliveryDate} ${b.deliveryTime || ""}`));
  document.querySelector("#delivery").innerHTML = `
    <div class="grid stats-grid">
      ${metric("Доставок сегодня", deliveries.filter((order) => order.deliveryDate === today.toISOString().slice(0, 10)).length)}
      ${metric("В маршруте", deliveries.filter((order) => order.status !== "delivered" && order.status !== "cancelled").length)}
      ${metric("Доставлено", deliveries.filter((order) => order.status === "delivered").length)}
      ${metric("Фото заказов", deliveries.filter((order) => order.photo).length)}
    </div>
    <div class="card delivery-map-card">
      <div class="section-head">
        <h3>Courier Live Map</h3>
        <span class="badge green">${deliveries.filter((order) => order.status !== "delivered" && order.status !== "cancelled").length} активных точек</span>
      </div>
      <div class="delivery-map">
        ${deliveries.slice(0, 7).map((order, index) => {
          const client = getClient(order.clientId);
          const x = 12 + (index * 13) % 76;
          const y = 18 + (index * 19) % 62;
          return `<div class="map-pin ${order.status === "delivered" ? "done" : ""}" style="left:${x}%;top:${y}%"><span>${index + 1}</span><small>${escapeHtml(client?.name || "Клиент")}</small></div>`;
        }).join("") || '<p class="muted">Маршрут появится после создания доставки.</p>'}
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Маршрут курьера</h3>
      <div class="list">
        ${deliveries.map((order, index) => {
          const client = getClient(order.clientId);
          return `
            <div class="row delivery-row">
              <div>
                <div class="row-title">
                  <span class="route-index">${index + 1}</span>
                  <strong>${escapeHtml(client?.name || "Клиент удален")}</strong>
                  <span class="badge ${statusClass(order.status)}">${statusLabel(order.status)}</span>
                </div>
                <p>${escapeHtml(order.deliveryDate || order.date)} ${escapeHtml(order.deliveryTime || "")} · ${escapeHtml(client?.address || "Адрес не указан")} · ${money(order.sum)}</p>
                <p>${escapeHtml(order.bouquet)} · ${escapeHtml(order.comment || "без комментария")}</p>
                ${order.photo ? `<img class="order-photo" src="${cleanUrl(order.photo)}" alt="Фото букета">` : ""}
              </div>
              <div class="return-actions">
                ${client?.address ? `<a class="channel-button map" href="https://2gis.kz/search/${encodeURIComponent(client.address)}" target="_blank" rel="noreferrer">2GIS</a>` : ""}
                <button class="primary-button" type="button" data-action="mark-order-delivered" data-id="${order.id}">Доставлено</button>
              </div>
            </div>
          `;
        }).join("") || '<p class="muted">Доставок пока нет.</p>'}
      </div>
    </div>
  `;
}

function renderInventory() {
  const node = document.querySelector("#inventory");
  if (!node) return;
  if (!isOwner()) {
    node.innerHTML = `<div class="card"><h3>Склад</h3><p>Раздел доступен только владельцу магазина.</p></div>`;
    return;
  }
  const stockValue = data.inventory.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.cost || 0), 0);
  const lowItems = data.inventory.filter((item) => Number(item.qty || 0) <= Number(item.minQty || 0));
  const todayWriteoff = inventoryOrderWriteoff(today.toISOString().slice(0, 10));
  node.innerHTML = `
    <div class="grid stats-grid">
      ${metric("Стоимость остатков", money(stockValue))}
      ${metric("Позиций на складе", data.inventory.length)}
      ${metric("Ниже минимума", lowItems.length)}
      ${metric("Списано заказами сегодня", `${todayWriteoff.qty} шт`)}
    </div>
    <div class="grid three-column inventory-intelligence">
      ${data.inventory.map((item) => `
        <div class="card smart-stock-card ${Number(item.qty || 0) <= Number(item.minQty || 0) ? "critical" : ""}">
          <div class="section-head">
            <h3>${escapeHtml(item.name)}</h3>
            <span class="badge ${Number(item.qty || 0) <= Number(item.minQty || 0) ? "red" : "green"}">${Number(item.qty || 0) <= Number(item.minQty || 0) ? "Risk" : "Stable"}</span>
          </div>
          <div class="metric hero-metric"><small>Остаток</small><strong>${escapeHtml(item.qty)} ${escapeHtml(item.unit)}</strong></div>
          <p>${escapeHtml(inventoryForecastText(item))}</p>
          <div class="bar-track"><span style="width:${stockPercent(item)}%"></span></div>
        </div>
      `).join("")}
    </div>
    <div class="card" style="margin-top:16px">
      <div class="section-head">
        <h3>Складские остатки</h3>
        <button class="primary-button" type="button" data-action="open-inventory-item">+ Позиция</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Товар</th><th>Категория</th><th>Остаток</th><th>Себестоимость</th><th>Стоимость</th><th>Минимум</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>
            ${data.inventory.map((item) => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.category)}</td>
                <td>${escapeHtml(item.qty)} ${escapeHtml(item.unit)}</td>
                <td>${money(item.cost)}</td>
                <td>${money(Number(item.qty || 0) * Number(item.cost || 0))}</td>
                <td>${escapeHtml(item.minQty)} ${escapeHtml(item.unit)}</td>
                <td>${Number(item.qty || 0) <= Number(item.minQty || 0) ? '<span class="badge red">Заканчивается</span>' : '<span class="badge green">Ок</span>'}</td>
                <td>
                  <div class="table-actions">
                    <button class="channel-button" type="button" data-action="open-inventory-move" data-id="${item.id}" data-type="receipt">Приход</button>
                    <button class="danger-button" type="button" data-action="open-inventory-move" data-id="${item.id}" data-type="writeoff">Списание</button>
                  </div>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>История движений</h3>
      <div class="list">
        ${data.inventoryMoves.slice(0, 12).map((move) => `
          <div class="row">
            <div><strong>${move.type === "receipt" ? "Приход" : "Списание"}: ${escapeHtml(move.itemName)}</strong><p>${escapeHtml(move.date)} · ${escapeHtml(move.qty)} ${escapeHtml(move.unit)} · ${escapeHtml(move.reason || "без комментария")} · ${escapeHtml(move.user || "-")}</p></div>
            <span class="badge ${move.type === "receipt" ? "green" : "red"}">${move.type === "receipt" ? "+" : "-"}${move.qty}</span>
          </div>
        `).join("") || '<p class="muted">Движений пока нет.</p>'}
      </div>
    </div>
  `;
}

function openInventoryItemForm() {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <h3 id="modalTitle">Новая складская позиция</h3>
    <form class="form-grid" id="inventoryItemForm">
      <label>Название<input required name="name" placeholder="Розы белые"></label>
      <label>Категория<input name="category" placeholder="Цветы"></label>
      <label>Остаток<input required name="qty" type="number" min="0" value="0"></label>
      <label>Ед. изм.<input name="unit" value="шт"></label>
      <label>Себестоимость<input required name="cost" type="number" min="0" value="0"></label>
      <label>Минимум<input name="minQty" type="number" min="0" value="0"></label>
      <button class="primary-button span-2" type="submit">Добавить позицию</button>
    </form>
  `;
  openModal(wrapper);
  document.querySelector("#inventoryItemForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const record = sanitizeRecordStrings({
      name: formData.get("name"),
      category: formData.get("category") || "Товар",
      qty: Number(formData.get("qty")),
      unit: formData.get("unit") || "шт",
      cost: Number(formData.get("cost")),
      minQty: Number(formData.get("minQty"))
    });
    try {
      const response = await api("/api/inventory", {
        method: "POST",
        body: JSON.stringify({ record })
      });
      closeModal();
      applyServerData(response, "inventory");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function openInventoryMove(itemId, type) {
  const item = data.inventory.find((entry) => entry.id === Number(itemId));
  if (!item) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <h3 id="modalTitle">${type === "receipt" ? "Приход товара" : "Списание товара"}</h3>
    <form class="form-grid" id="inventoryMoveForm">
      <label>Товар<input name="itemName" value="${escapeHtml(item.name)}" disabled></label>
      <label>Количество<input required name="qty" type="number" min="1" value="1"></label>
      <label class="span-2">Причина<input name="reason" placeholder="${type === "receipt" ? "Поставка от поставщика" : "Брак, продажа, утилизация"}"></label>
      <button class="primary-button span-2" type="submit">${type === "receipt" ? "Оприходовать" : "Списать"}</button>
    </form>
  `;
  openModal(wrapper);
  document.querySelector("#inventoryMoveForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const qty = Number(formData.get("qty"));
    if (type === "writeoff" && qty > Number(item.qty || 0)) {
      alert("Нельзя списать больше текущего остатка.");
      return;
    }
    try {
      const response = await api(`/api/inventory/${item.id}/move`, {
        method: "POST",
        body: JSON.stringify({ type, qty, reason: formData.get("reason") })
      });
      closeModal();
      applyServerData(response, "inventory");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

async function loadStaffUsers() {
  if (!isOwner()) {
    staffUsers = [];
    return;
  }
  try {
    const response = await api("/api/users");
    staffUsers = response.users || [];
  } catch (error) {
    staffUsers = [];
    console.warn(error);
  }
}

function renderStaff() {
  const node = document.querySelector("#staff");
  if (!node) return;
  if (!isOwner()) {
    node.innerHTML = `<div class="card"><h3>Сотрудники</h3><p>Раздел доступен только владельцу магазина.</p></div>`;
    return;
  }
  node.innerHTML = `
    <div class="card">
      <div class="section-head">
        <h3>Профили сотрудников</h3>
        <button class="primary-button" type="button" data-action="open-staff">+ Сотрудник</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Имя</th><th>Email</th><th>Роль</th></tr></thead>
          <tbody>
            ${staffUsers.map((user) => `
              <tr>
                <td>${escapeHtml(user.name || "-")}</td>
                <td>${escapeHtml(user.login)}</td>
                <td><span class="badge ${user.role === "owner" ? "green" : "blue"}">${roleLabel(user.role)}</span></td>
              </tr>
            `).join("") || '<tr><td colspan="3">Загрузка сотрудников...</td></tr>'}
          </tbody>
        </table>
      </div>
      <p class="muted">Сотрудник входит по своему email и паролю. Владелец управляет финансами, складом и ролями команды.</p>
    </div>
  `;
}

function openStaffForm() {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <h3 id="modalTitle">Новый сотрудник</h3>
    <form class="form-grid" id="staffForm">
      <label>Имя<input required name="name" placeholder="Мадина"></label>
      <label>Email<input required name="login" type="text" inputmode="email" placeholder="manager@shop.kz"></label>
      <label>Пароль<input required name="password" type="password" placeholder="Минимум 10 символов, Aa1!"></label>
      <label>Роль<select name="role"><option value="manager">Менеджер</option><option value="florist">Флорист</option><option value="courier">Курьер</option><option value="operator">Оператор</option><option value="owner">Владелец</option></select></label>
      <button class="primary-button span-2" type="submit">Создать сотрудника</button>
      <p class="form-error span-2" id="staffError"></p>
    </form>
  `;
  openModal(wrapper);
  document.querySelector("#staffForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password"));
    if (!isStrongPassword(password)) {
      document.querySelector("#staffError").textContent = PASSWORD_HINT;
      return;
    }
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name: String(formData.get("name")).trim(),
          login: String(formData.get("login")).trim().toLowerCase(),
          password,
          role: String(formData.get("role"))
        })
      });
      closeModal();
      await loadStaffUsers();
      renderStaff();
      showView("staff");
    } catch (error) {
      document.querySelector("#staffError").textContent = error.message;
    }
  });
}

function renderSettings() {
  const node = document.querySelector("#settings");
  if (!node) return;
  if (!isOwner()) {
    node.innerHTML = `<div class="card"><h3>Настройки</h3><p>Раздел доступен только владельцу магазина.</p></div>`;
    return;
  }
  const settings = data.settings || {};
  node.innerHTML = `
    <div class="grid stats-grid">
      ${metric("Город", settings.city || currentUser?.city || "Актау")}
      ${metric("Валюта", settings.currency || "₸")}
      ${metric("Бонус обычный", `${Number(settings.bonusBasePercent || 5)}%`)}
      ${metric("Бонус VIP", `${Number(settings.bonusVipPercent || 10)}%`)}
    </div>
    <div class="grid two-column">
      <div class="card">
        <div class="section-head">
          <h3>Параметры магазина</h3>
          <span class="badge green">Owner Control</span>
        </div>
        <form class="form-grid" id="settingsForm">
          <label>Город<input name="city" value="${escapeHtml(settings.city || currentUser?.city || "Актау")}"></label>
          <label>Валюта<input name="currency" value="${escapeHtml(settings.currency || "₸")}"></label>
          <label>Бонус обычный, %<input name="bonusBasePercent" type="number" min="0" max="50" value="${Number(settings.bonusBasePercent || 5)}"></label>
          <label>Бонус VIP, %<input name="bonusVipPercent" type="number" min="0" max="50" value="${Number(settings.bonusVipPercent || 10)}"></label>
          <label>Дней до события<input name="birthdayReminderDays" type="number" min="1" max="60" value="${Number(settings.birthdayReminderDays || 7)}"></label>
          <label>Спящий клиент, дней<input name="sleepyClientDays" type="number" min="7" max="365" value="${Number(settings.sleepyClientDays || 30)}"></label>
          <label class="checkbox-line span-2"><input name="lowStockAlert" type="checkbox" ${settings.lowStockAlert === false ? "" : "checked"}> Показывать предупреждения по складу</label>
          <button class="primary-button span-2" type="submit">Сохранить настройки</button>
          <p class="form-success span-2" id="settingsStatus"></p>
        </form>
      </div>
      <div class="card">
        <div class="section-head">
          <h3>Backup и экспорт</h3>
          <span class="badge blue">Data Safety</span>
        </div>
        <div class="list">
          <div class="row">
            <div>
              <strong>Контрольная копия базы</strong>
              <p>Создает DB-копию в папке backups на сервере.</p>
            </div>
            <button class="primary-button" type="button" data-action="create-backup">Создать backup</button>
          </div>
          <div class="row">
            <div>
              <strong>Экспорт данных</strong>
              <p>CSV подходит для Excel, JSON подходит для полной технической копии.</p>
            </div>
            <div class="table-actions">
              <a class="channel-button" href="/api/export/clients.csv" target="_blank" rel="noreferrer">Клиенты CSV</a>
              <a class="channel-button" href="/api/export/orders.csv" target="_blank" rel="noreferrer">Заказы CSV</a>
              <a class="channel-button" href="/api/export/json" target="_blank" rel="noreferrer">JSON</a>
            </div>
          </div>
        </div>
        <p class="form-success" id="backupStatus"></p>
      </div>
    </div>
  `;
  document.querySelector("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const settingsPayload = sanitizeRecordStrings({
      city: formData.get("city") || "Актау",
      currency: formData.get("currency") || "₸",
      bonusBasePercent: Number(formData.get("bonusBasePercent") || 5),
      bonusVipPercent: Number(formData.get("bonusVipPercent") || 10),
      birthdayReminderDays: Number(formData.get("birthdayReminderDays") || 7),
      sleepyClientDays: Number(formData.get("sleepyClientDays") || 30),
      lowStockAlert: Boolean(formData.get("lowStockAlert"))
    });
    try {
      const response = await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ settings: settingsPayload })
      });
      if (response.data) data = response.data;
      else data.settings = response.settings || settingsPayload;
      document.querySelector("#settingsStatus").textContent = "Настройки сохранены.";
    } catch (error) {
      document.querySelector("#settingsStatus").textContent = error.message;
    }
  });
}

async function createServerBackup() {
  const status = document.querySelector("#backupStatus");
  if (status) status.textContent = "Создаем backup...";
  try {
    const response = await api("/api/backup", { method: "POST" });
    if (status) status.textContent = `Backup создан: ${response.backup}`;
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

function metric(label, value) {
  return `<div class="card metric"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function miniMetric(label, value) {
  return `<div class="mini-metric"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`;
}

function clientLinks(client) {
  const instagramName = cleanText(client.instagram || "", 80).replace("@", "");
  const instagramHref = instagramName ? cleanUrl(`https://www.instagram.com/${instagramName}`) : "";
  const mapHref = client.address ? cleanUrl(`https://2gis.kz/search/${encodeURIComponent(client.address)}`) : "";
  const instagram = client.instagram
    ? `<a class="channel-button instagram" href="${instagramHref}" target="_blank" rel="noreferrer">Instagram</a>`
    : "";
  const map = client.address
    ? `<a class="channel-button map" href="${mapHref}" target="_blank" rel="noreferrer">2GIS</a>`
    : "";
  return `
    <a class="channel-button whatsapp" href="${waLink(client.phone, reminderMessage(client))}" target="_blank" rel="noreferrer">WhatsApp</a>
    ${instagram}
    ${map}
  `;
}

function waLink(phone, text) {
  const cleanPhone = String(phone || "").replace(/\D/g, "");
  return cleanUrl(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(cleanText(text, 1200))}`);
}

function reminderMessage(client) {
  return `Здравствуйте, ${client.name.split(" ")[0]}! Через ${daysUntil(client.event)} дней важная дата для ${client.recipient}. У вас ${client.bonus} бонусов. Подберем свежий букет в любимом стиле: ${client.flowers}?`;
}

function bloomScore(client) {
  const recency = Math.max(0, 40 - Math.min(daysSince(client.lastOrder), 120) / 3);
  const frequency = Math.min(client.orders * 4, 40);
  const value = Math.min(client.budget / 1500, 20);
  return Math.round(recency + frequency + value);
}

function countByChannel(channel) {
  return data.clients.filter((client) => client.channel === channel).length;
}

function addAudit(action, entity, label = "") {
  data.auditLog ||= [];
  data.auditLog.unshift({
    id: Date.now(),
    at: new Date().toLocaleString("ru-RU"),
    user: currentUser?.login || currentUser?.name || "",
    action,
    entity,
    label
  });
  data.auditLog = data.auditLog.slice(0, 300);
}

async function restoreClient(deletedId) {
  const index = data.deleted.clients.findIndex((item) => item.deletedId === Number(deletedId));
  if (index < 0) return;
  try {
    const response = await api("/api/trash/restore", {
      method: "POST",
      body: JSON.stringify({ type: "client", deletedId: Number(deletedId) })
    });
    applyServerData(response, "trash");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function restoreOrder(deletedId) {
  const index = data.deleted.orders.findIndex((item) => item.deletedId === Number(deletedId));
  if (index < 0) return;
  try {
    const response = await api("/api/trash/restore", {
      method: "POST",
      body: JSON.stringify({ type: "order", deletedId: Number(deletedId) })
    });
    applyServerData(response, "trash");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function downloadStoreExport() {
  const payload = {
    exportedAt: new Date().toISOString(),
    store: currentUser ? {
      storeId: currentUser.storeId,
      storeName: currentUser.storeName,
      owner: currentUser.owner,
      city: currentUser.city
    } : null,
    data
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ja-bloom362-${currentUser?.storeId || "store"}-${today.toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function clientTier(client) {
  const score = bloomScore(client);
  if (client.orders >= 12 || client.budget >= 40000 || score >= 85) return { name: "VIP", className: "green" };
  if (client.orders >= 7 || score >= 65) return { name: "Gold", className: "amber" };
  if (client.orders >= 3 || score >= 42) return { name: "Silver", className: "blue" };
  return { name: "Standard", className: "" };
}

function tierBadge(client) {
  const tier = clientTier(client);
  return `<span class="badge ${tier.className}">${tier.name}</span>`;
}

function returnCandidates() {
  return data.clients.filter((client) => daysSince(client.lastOrder) >= settingNumber("sleepyClientDays", 30));
}

function syncReturnTasks() {
  returnCandidates().forEach((client) => {
    const existing = data.returnTasks.find((task) => task.clientId === client.id);
    if (!existing) {
      data.returnTasks.push({
        id: Date.now() + Number(client.id),
        clientId: client.id,
        createdAt: today.toISOString().slice(0, 10),
        status: "todo",
        suggestedMessage: returnMessage(client),
        expectedRevenue: Number(client.budget || 0),
        earned: 0,
        returnedAt: ""
      });
    } else {
      existing.suggestedMessage ||= returnMessage(client);
      existing.expectedRevenue = Number(client.budget || existing.expectedRevenue || 0);
    }
  });
}

function returnMessage(client) {
  if (!client) return "Отправьте персональное сообщение со свежей подборкой букетов и бонусами.";
  return `Здравствуйте, ${client.name.split(" ")[0]}! Давно не радовали ${client.recipient}. У вас есть ${client.bonus || 0} бонусов, а мы как раз собрали свежие букеты в стиле: ${client.flowers}. Подобрать вариант на ${money(client.budget)}?`;
}

function getReturnStats() {
  const tasks = data.returnTasks || [];
  return {
    total: tasks.length,
    returned: tasks.filter((task) => task.status === "returned").length,
    earned: tasks.reduce((sum, task) => sum + Number(task.earned || 0), 0),
    potential: tasks.filter((task) => task.status !== "returned").reduce((sum, task) => sum + Number(task.expectedRevenue || 0), 0)
  };
}

function lostMoneyStats() {
  const clients = data.clients.filter((client) => daysSince(client.lastOrder) >= settingNumber("sleepyClientDays", 30) * 2);
  return {
    clients: clients.length,
    amount: clients.reduce((sum, client) => sum + Number(client.budget || 0), 0)
  };
}

function returnStatusLabel(status) {
  return {
    todo: "Нужно вернуть",
    contacted: "Написали",
    returned: "Вернулся"
  }[status] || "Нужно вернуть";
}

function returnStatusClass(status) {
  return {
    todo: "red",
    contacted: "amber",
    returned: "green"
  }[status] || "red";
}

function markReturnTask(id, status) {
  const task = data.returnTasks.find((item) => item.id === Number(id));
  if (!task) return;
  task.status = status;
  task.contactedAt = today.toISOString().slice(0, 10);
  addAudit("update", "return_task", `${returnStatusLabel(status)} · ${getClient(task.clientId)?.name || ""}`);
  commitData("returns");
}

function touchAllReturnTasks() {
  data.returnTasks.forEach((task) => {
    if (task.status === "todo") {
      task.status = "contacted";
      task.contactedAt = today.toISOString().slice(0, 10);
    }
  });
  commitData("returns");
}

function completeReturnTask(id) {
  const task = data.returnTasks.find((item) => item.id === Number(id));
  const client = task ? getClient(task.clientId) : null;
  if (!task || !client) return;
  const sum = Number(client.budget || task.expectedRevenue || 0);
  const order = {
    id: Date.now(),
    clientId: client.id,
    date: today.toISOString().slice(0, 10),
    sum,
    reason: "Возврат клиента",
    bouquet: "Персональный букет",
    channel: client.channel || "WhatsApp",
    status: "delivered",
    deliveryDate: today.toISOString().slice(0, 10),
    deliveryTime: "",
    manager: currentUser?.name || currentUser?.owner || "",
    comment: "Клиент вернулся через автоматическую задачу JA Bloom362",
    photo: "",
    bonus: Math.round(sum * cashbackRate(client))
  };
  data.orders.unshift(order);
  applyOrderImpact(order, 1);
  task.status = "returned";
  task.returnedAt = today.toISOString().slice(0, 10);
  task.earned = sum;
  addAudit("return", "client", `${client.name} · ${money(sum)}`);
  commitData("returns");
}

function getFinanceStats() {
  const todayKey = today.toISOString().slice(0, 10);
  const monthKey = todayKey.slice(0, 7);
  const orderRevenueToday = data.orders.filter((order) => order.date === todayKey).reduce((sum, order) => sum + Number(order.sum || 0), 0);
  const orderRevenueMonth = data.orders.filter((order) => order.date?.startsWith(monthKey)).reduce((sum, order) => sum + Number(order.sum || 0), 0);
  const revenueEntriesToday = data.financeEntries.filter((entry) => entry.date === todayKey && entry.type === "revenue").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const expenseEntriesToday = data.financeEntries.filter((entry) => entry.date === todayKey && entry.type === "expense").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const revenueEntriesMonth = data.financeEntries.filter((entry) => entry.date?.startsWith(monthKey) && entry.type === "revenue").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const expenseEntriesMonth = data.financeEntries.filter((entry) => entry.date?.startsWith(monthKey) && entry.type === "expense").reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const todayRevenue = orderRevenueToday + revenueEntriesToday;
  const monthRevenue = orderRevenueMonth + revenueEntriesMonth;
  return {
    todayRevenue,
    todayExpenses: expenseEntriesToday,
    todayProfit: todayRevenue - expenseEntriesToday,
    monthRevenue,
    monthExpenses: expenseEntriesMonth,
    monthProfit: monthRevenue - expenseEntriesMonth
  };
}

function getOpenCashShift() {
  return data.cashShifts.find((shift) => !shift.closedAt);
}

function getCashShiftStats(shift) {
  const orders = data.orders.filter((order) => order.cashShiftId === shift.id && order.status !== "cancelled");
  const revenue = orders.reduce((sum, order) => sum + Number(order.sum || 0), 0);
  return {
    orders: orders.length,
    revenue,
    avg: orders.length ? Math.round(revenue / orders.length) : 0
  };
}

function openCashShift(auto = false) {
  if (getOpenCashShift()) return getOpenCashShift();
  const shift = {
    id: Date.now(),
    openedAt: new Date().toISOString(),
    openedBy: currentUser?.name || currentUser?.login || "",
    openingCash: 0,
    closedAt: "",
    closedBy: "",
    closingCash: 0,
    auto
  };
  data.cashShifts.unshift(sanitizeRecordStrings(shift));
  addAudit(auto ? "auto_open" : "open", "cash_shift", "Касса открыта");
  if (!auto) {
    commitData("finance");
  }
  return shift;
}

function closeCashShift() {
  const shift = getOpenCashShift();
  if (!shift) return;
  const stats = getCashShiftStats(shift);
  shift.closedAt = new Date().toISOString();
  shift.closedBy = currentUser?.name || currentUser?.login || "";
  shift.closingCash = Number(shift.openingCash || 0) + stats.revenue;
  addAudit("close", "cash_shift", `Продажи ${money(stats.revenue)} · заказов ${stats.orders}`);
  commitData("finance");
}

function ensureCashShiftForOrder() {
  return getOpenCashShift() || openCashShift(true);
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

function lastNDays(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (count - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

function dayOrders(day) {
  return data.orders.filter((order) => order.date === day && order.status !== "cancelled");
}

function dayRevenue(day) {
  return dayOrders(day).reduce((sum, order) => sum + Number(order.sum || 0), 0);
}

function formatDayLabel(day) {
  return new Date(`${day}T12:00:00`).toLocaleDateString("ru-RU", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function weeklyItemSales() {
  const days = new Set(lastNDays(7));
  const rows = new Map();
  data.orders
    .filter((order) => days.has(order.date) && order.status !== "cancelled")
    .forEach((order) => {
      const totalQty = (order.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0) || 1;
      (order.items || []).forEach((item) => {
        const revenuePart = Number(order.sum || 0) * (Number(item.qty || 0) / totalQty);
        const current = rows.get(item.inventoryItemId) || {
          name: item.itemName,
          unit: item.unit || "шт",
          qty: 0,
          revenue: 0
        };
        current.qty += Number(item.qty || 0);
        current.revenue += revenuePart;
        rows.set(item.inventoryItemId, current);
      });
    });
  return [...rows.values()].sort((a, b) => b.revenue - a.revenue);
}

function stockPercent(item) {
  const min = Math.max(Number(item.minQty || 0), 1);
  const qty = Number(item.qty || 0);
  return Math.max(5, Math.min(100, Math.round(qty / (min * 3) * 100)));
}

function inventoryOrderWriteoff(day) {
  const qty = data.inventoryMoves
    .filter((move) => move.date === day && move.type === "writeoff" && String(move.reason || "").includes("заказ"))
    .reduce((sum, move) => sum + Number(move.qty || 0), 0);
  return { qty };
}

function openFinanceEntryForm() {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <h3 id="modalTitle">Финансовая запись</h3>
    <form class="form-grid" id="financeEntryForm">
      <label>Дата<input required name="date" type="date" value="${today.toISOString().slice(0, 10)}"></label>
      <label>Тип<select name="type"><option value="revenue">Выручка</option><option value="expense">Расход</option></select></label>
      <label>Категория<input required name="category" placeholder="Зарплата, аренда, закуп цветов"></label>
      <label>Сумма<input required name="amount" type="number" min="0" step="1000" value="10000"></label>
      <label class="span-2">Комментарий<input name="comment" placeholder="Детали записи"></label>
      <button class="primary-button span-2" type="submit">Сохранить</button>
    </form>
  `;
  openModal(wrapper);
  document.querySelector("#financeEntryForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const entry = sanitizeRecordStrings({
      date: formData.get("date"),
      type: formData.get("type"),
      category: formData.get("category"),
      amount: Number(formData.get("amount")),
      comment: formData.get("comment")
    });
    try {
      const response = await api("/api/finance", {
        method: "POST",
        body: JSON.stringify({ record: entry })
      });
      closeModal();
      applyServerData(response, "finance");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function openLeadForm(leadId) {
  if (!canManageLeads()) {
    showToast("Недостаточно прав для изменения лидов.", "error");
    return;
  }
  const lead = leadId ? data.leads.find((item) => item.id === Number(leadId)) : null;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <h3 id="modalTitle">${lead ? "Редактировать потенциального клиента" : "Новый потенциальный клиент"}</h3>
    <form class="form-grid" id="leadForm">
      <label>Имя<input required name="name" placeholder="Алия"></label>
      <label>Телефон<input required name="phone" placeholder="+7 777 000 00 00"></label>
      <label>Источник<select name="source"><option>WhatsApp</option><option>Instagram</option><option>2GIS</option><option>Офлайн</option></select></label>
      <label>Бюджет<input required name="budget" type="number" min="0" step="1000" value="20000"></label>
      <label>Статус<select name="status">${leadStatuses.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></label>
      <label>Потребность<input name="need" placeholder="Букет на день рождения"></label>
      <label class="span-2">Следующее действие<input name="nextAction" placeholder="Написать сегодня, уточнить адрес, отправить КП"></label>
      <button class="primary-button span-2" type="submit">Сохранить</button>
    </form>
  `;
  openModal(wrapper);
  const form = document.querySelector("#leadForm");
  if (lead) {
    form.name.value = lead.name;
    form.phone.value = lead.phone;
    form.source.value = lead.source;
    form.budget.value = lead.budget;
    form.status.value = lead.status;
    form.need.value = lead.need;
    form.nextAction.value = lead.nextAction;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = sanitizeRecordStrings({
      name: formData.get("name"),
      phone: formData.get("phone"),
      source: formData.get("source"),
      budget: Number(formData.get("budget")),
      status: formData.get("status"),
      need: formData.get("need") || "Букет",
      nextAction: formData.get("nextAction") || "Связаться с клиентом",
      createdAt: lead?.createdAt || today.toISOString().slice(0, 10)
    });
    try {
      const response = await api(lead ? `/api/leads/${lead.id}` : "/api/leads", {
        method: lead ? "PATCH" : "POST",
        body: JSON.stringify({ record: payload })
      });
      closeModal();
      applyServerData(response, "leads");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

async function moveLead(id, direction) {
  if (!canManageLeads()) {
    showToast("Недостаточно прав для изменения лидов.", "error");
    return;
  }
  const lead = data.leads.find((item) => item.id === Number(id));
  if (!lead) return;
  const index = leadStatuses.findIndex(([status]) => status === lead.status);
  const next = leadStatuses[Math.max(0, Math.min(leadStatuses.length - 1, index + direction))];
  try {
    const response = await api(`/api/leads/${Number(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ record: { status: next[0] } })
    });
    applyServerData(response, "leads");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function convertLeadToClient(id) {
  if (!canManageLeads()) {
    showToast("Недостаточно прав для конвертации лидов.", "error");
    return;
  }
  const lead = data.leads.find((item) => item.id === Number(id));
  if (!lead) return;
  const clientPayload = sanitizeRecordStrings({
    name: lead.name,
    phone: lead.phone,
    instagram: "",
    address: "",
    recipient: "Получатель",
    relation: "Клиент",
    flowers: lead.need || "Сезонный букет",
    colors: "По настроению",
    event: nextDate(30),
    budget: Number(lead.budget || 0),
    bonus: 0,
    orders: 0,
    lastOrder: pastDate(999),
    channel: lead.source || "WhatsApp",
    status: "Новый"
  });
  try {
    const created = await api("/api/clients", {
      method: "POST",
      body: JSON.stringify({ record: clientPayload })
    });
    const updatedLead = await api(`/api/leads/${Number(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ record: { status: "order" } })
    });
    applyServerData(updatedLead.data ? updatedLead : created, "clients");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function changeCalendarMonth(offset) {
  currentCalendarDate = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth() + offset, 1);
  renderCalendar();
}

function calendarEvents(dateKey) {
  const clientEvents = data.clients
    .filter((client) => client.event === dateKey)
    .map((client) => ({ type: "client", icon: "🌹", title: `${eventKind(client)}: ${client.name}` }));
  const deliveries = data.orders
    .filter((order) => order.deliveryDate === dateKey)
    .map((order) => {
      const client = getClient(order.clientId);
      return { type: "delivery", icon: "🚚", title: `Доставка: ${client?.name || "клиент"}` };
    });
  return [...clientEvents, ...deliveries];
}

function eventKind(client) {
  const text = `${client.relation || ""} ${client.recipient || ""}`.toLowerCase();
  if (text.includes("свад")) return "Свадьба";
  if (text.includes("жена") || text.includes("муж") || text.includes("годов")) return "Годовщина";
  return "День рождения";
}

async function markOrderDelivered(id) {
  await updateOrderStatus(id, "delivered", "delivery");
}

async function updateOrderStatus(id, status, view = activeView) {
  try {
    const response = await api("/api/delivery/status", {
      method: "PATCH",
      body: JSON.stringify({ orderId: Number(id), status })
    });
    applyServerData(response, view);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function telegramDigest() {
  const todayKey = today.toISOString().slice(0, 10);
  const yesterdayKey = new Date(Date.now() - dayMs).toISOString().slice(0, 10);
  const deliveries = data.orders.filter((order) => order.deliveryDate === todayKey && order.status !== "cancelled").length;
  const birthdays = data.clients.filter((client) => client.event === todayKey).length;
  const lowRoses = (data.inventory || []).find((item) => item.name.toLowerCase().includes("роз"));
  const yesterdayRevenue = data.orders.filter((order) => order.date === yesterdayKey).reduce((sum, order) => sum + Number(order.sum || 0), 0);
  return `Сегодня:\n${deliveries} доставки\n${birthdays} события клиентов\nОстаток роз: ${lowRoses ? `${lowRoses.qty} ${lowRoses.unit}` : "не указан"}\nВыручка вчера: ${money(yesterdayRevenue)}`;
}

async function copyTelegramDigest() {
  const text = telegramDigest();
  try {
    await navigator.clipboard.writeText(text);
    alert("Telegram-отчет скопирован.");
  } catch (error) {
    openModal(Object.assign(document.createElement("div"), {
      innerHTML: `<h3 id="modalTitle">Telegram-отчет</h3><div class="message-box">${escapeHtml(text).replaceAll("\n", "<br>")}</div>`
    }));
  }
}

function openBloomAI() {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <h3 id="modalTitle">JA Bloom362 AI</h3>
    <div class="bloom-ai-panel">
      <div class="message-box" id="bloomAiAnswer">${bloomAiResponse("неделя")}</div>
      <div class="quick-questions">
        <button class="channel-button" type="button" data-action="ask-bloom-ai" data-question="Какие клиенты могут купить букет на этой неделе?">Покупки на неделе</button>
        <button class="channel-button" type="button" data-action="ask-bloom-ai" data-question="Кого нужно вернуть?">Кого вернуть</button>
        <button class="channel-button" type="button" data-action="ask-bloom-ai" data-question="Сколько денег потеряно?">Потерянные деньги</button>
      </div>
      <form class="form-grid" id="bloomAiForm">
        <label class="span-2">Вопрос<input name="question" value="Какие клиенты могут купить букет на этой неделе?"></label>
        <button class="primary-button span-2" type="submit">Спросить JA Bloom362 AI</button>
      </form>
    </div>
  `;
  openModal(wrapper);
  document.querySelector("#bloomAiForm").addEventListener("submit", (event) => {
    event.preventDefault();
    askBloomAI(new FormData(event.currentTarget).get("question"));
  });
}

function askBloomAI(question) {
  const answer = document.querySelector("#bloomAiAnswer");
  if (answer) answer.innerHTML = bloomAiResponse(String(question));
}

function bloomAiResponse(question) {
  const normalized = question.toLowerCase();
  if (normalized.includes("верн") || normalized.includes("спящ")) {
    const clients = returnCandidates().slice(0, 5);
    return clients.length
      ? clients.map((client) => `<b>${escapeHtml(client.name)}</b> — не покупал(а) ${daysSince(client.lastOrder)} дней. Сообщение: ${escapeHtml(returnMessage(client))}`).join("<br><br>")
      : "Сейчас нет клиентов старше 30 дней без покупки.";
  }
  if (normalized.includes("потер")) {
    const lost = lostMoneyStats();
    return `За последние 60 дней потеряно клиентов: <b>${lost.clients}</b>.<br>Потенциально потеряно: <b>${money(lost.amount)}</b>.`;
  }
  const weekClients = data.clients
    .filter((client) => daysUntil(client.event) >= 0 && daysUntil(client.event) <= 7)
    .sort((a, b) => daysUntil(a.event) - daysUntil(b.event));
  return weekClients.length
    ? weekClients.map((client) => `<b>${escapeHtml(client.name)}</b> — ${escapeHtml(eventKind(client).toLowerCase())} для ${escapeHtml(client.recipient)} через ${daysUntil(client.event)} дней. Любимые цветы: ${escapeHtml(client.flowers)}.`).join("<br>")
    : "На этой неделе нет важных дат. Лучше открыть экран “Возврат” и вернуть спящих клиентов.";
}

function statusLabel(status) {
  return {
    new: "Новый",
    work: "В работе",
    ready: "Готов",
    delivered: "Доставлен",
    cancelled: "Отменен"
  }[status] || "Новый";
}

function statusClass(status) {
  return {
    new: "blue",
    work: "amber",
    ready: "green",
    delivered: "green",
    cancelled: "red"
  }[status] || "blue";
}

function orderBonus(order, client = getClient(order.clientId)) {
  return Number(order.bonus ?? Math.round(Number(order.sum || 0) * cashbackRate(client || { orders: 0 })));
}

function orderItemsSummary(order) {
  const items = order.items || [];
  if (!items.length) return "-";
  return items
    .map((item) => `${escapeHtml(item.itemName)}: ${escapeHtml(item.qty)} ${escapeHtml(item.unit || "шт")}`)
    .join("<br>");
}

function recalcOrderSum() {
  const form = document.querySelector("#orderForm");
  if (!form) return;
  const rows = [...document.querySelectorAll("#orderInventoryLines .order-line")];
  const total = rows.reduce((sum, row) => {
    const inventoryItemId = Number(row.querySelector(".order-item-select")?.value || 0);
    const qty = Number(row.querySelector(".order-item-qty")?.value || 0);
    if (!inventoryItemId || qty <= 0) return sum;
    const stock = data.inventory.find((item) => Number(item.id) === inventoryItemId);
    if (!stock) return sum;
    return sum + qty * Number(stock.cost || 0);
  }, 0);
  if (total > 0) form.sum.value = total;
}

function addOrderInventoryRow(item = {}) {
  const container = document.querySelector("#orderInventoryLines");
  if (!container) return;
  const row = document.createElement("div");
  row.className = "order-line";
  row.innerHTML = `
    <select class="order-item-select">
      <option value="">Выберите позицию</option>
      ${data.inventory.map((stock) => `
        <option value="${Number(stock.id)}" ${Number(item.inventoryItemId) === Number(stock.id) ? "selected" : ""}>
          ${escapeHtml(stock.name)} · остаток ${escapeHtml(stock.qty)} ${escapeHtml(stock.unit)}
        </option>
      `).join("")}
    </select>
    <input class="order-item-qty" type="number" min="0" step="1" value="${item.qty || 1}" placeholder="шт">
    <button class="danger-button" type="button">Удалить</button>
  `;
  row.querySelector("button").addEventListener("click", () => { row.remove(); recalcOrderSum(); });
  row.querySelector(".order-item-select").addEventListener("change", recalcOrderSum);
  row.querySelector(".order-item-qty").addEventListener("input", recalcOrderSum);
  container.append(row);
  recalcOrderSum();
}

function renderOrderInventoryRows(items = []) {
  const container = document.querySelector("#orderInventoryLines");
  if (!container) return;
  container.innerHTML = "";
  if (items.length) items.forEach((item) => addOrderInventoryRow(item));
  else addOrderInventoryRow();
}

function collectOrderInventoryItems() {
  const rows = [...document.querySelectorAll("#orderInventoryLines .order-line")];
  const grouped = new Map();
  rows.forEach((row) => {
    const inventoryItemId = Number(row.querySelector(".order-item-select")?.value || 0);
    const qty = Number(row.querySelector(".order-item-qty")?.value || 0);
    if (!inventoryItemId || qty <= 0) return;
    const stock = data.inventory.find((item) => Number(item.id) === inventoryItemId);
    if (!stock) return;
    const current = grouped.get(inventoryItemId) || {
      inventoryItemId,
      itemName: stock.name,
      qty: 0,
      unit: stock.unit || "шт"
    };
    current.qty += qty;
    grouped.set(inventoryItemId, current);
  });
  return [...grouped.values()];
}

function combineOrderItems(orders) {
  const grouped = new Map();
  orders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const current = grouped.get(item.inventoryItemId) || { ...item, qty: 0 };
      current.qty += Number(item.qty || 0);
      grouped.set(item.inventoryItemId, current);
    });
  });
  return [...grouped.values()];
}

function validateOrderStock(items, editingOrder = null) {
  for (const item of items) {
    const stock = data.inventory.find((entry) => Number(entry.id) === Number(item.inventoryItemId));
    if (!stock) return `Позиция ${item.itemName} не найдена на складе.`;
    const oldQty = (editingOrder?.items || [])
      .filter((entry) => Number(entry.inventoryItemId) === Number(item.inventoryItemId))
      .reduce((sum, entry) => sum + Number(entry.qty || 0), 0);
    const available = Number(stock.qty || 0) + oldQty;
    if (Number(item.qty || 0) > available) {
      return `Недостаточно на складе: ${stock.name}. Нужно ${item.qty} ${stock.unit}, доступно ${available} ${stock.unit}.`;
    }
  }
  return "";
}

function applyInventoryForOrder(order, direction, reason) {
  (order.items || []).forEach((orderItem) => {
    const stock = data.inventory.find((item) => Number(item.id) === Number(orderItem.inventoryItemId));
    if (!stock) return;
    const qty = Number(orderItem.qty || 0);
    stock.qty = Math.max(0, Number(stock.qty || 0) + direction * qty);
    data.inventoryMoves.unshift(sanitizeRecordStrings({
      id: Date.now() + Math.floor(Math.random() * 1000),
      type: direction < 0 ? "writeoff" : "receipt",
      itemId: stock.id,
      itemName: stock.name,
      qty,
      unit: stock.unit,
      reason: `${reason}: ${order.bouquet || "заказ"}`,
      date: today.toISOString().slice(0, 10),
      user: currentUser?.name || currentUser?.owner || ""
    }));
  });
}

function applyOrderImpact(order, direction) {
  const client = getClient(order.clientId);
  if (!client) return;
  client.orders = Math.max(0, Number(client.orders || 0) + direction);
  client.bonus = Math.max(0, Number(client.bonus || 0) + direction * orderBonus(order, client));
  refreshClientLastOrder(client.id);
}

function refreshClientLastOrder(clientId) {
  const client = getClient(clientId);
  if (!client) return;
  const orders = getClientOrders(clientId);
  if (!orders.length) {
    client.lastOrder = pastDate(999);
    return;
  }
  client.lastOrder = orders.map((order) => order.date).sort().at(-1);
}

function openClientForm(clientId) {
  if (!canManageClients()) {
    showToast("Недостаточно прав для изменения клиентов.", "error");
    return;
  }
  const editingClient = clientId ? getClient(clientId) : null;
  const content = document.querySelector("#clientFormTemplate").content.cloneNode(true);
  openModal(content);
  const form = document.querySelector("#clientForm");
  document.querySelector("#modalTitle").textContent = editingClient ? "Редактировать клиента" : "Новый клиент";
  form.event.value = nextDate(30);
  if (editingClient) {
    form.name.value = editingClient.name;
    form.phone.value = editingClient.phone;
    form.instagram.value = editingClient.instagram || "";
    form.address.value = editingClient.address || "";
    form.recipient.value = editingClient.recipient || "";
    form.relation.value = editingClient.relation || "";
    form.flowers.value = editingClient.flowers || "";
    form.colors.value = editingClient.colors || "";
    form.event.value = editingClient.event;
    form.budget.value = editingClient.budget;
    form.querySelector("button[type='submit']").textContent = "Сохранить изменения";
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const clientPayload = sanitizeRecordStrings({
      name: formData.get("name"),
      phone: formData.get("phone"),
      instagram: formData.get("instagram"),
      address: formData.get("address"),
      recipient: formData.get("recipient") || "Получатель",
      relation: formData.get("relation") || "Близкий человек",
      flowers: formData.get("flowers") || "Сезонный букет",
      colors: formData.get("colors") || "По настроению",
      event: formData.get("event"),
      budget: Number(formData.get("budget")),
      channel: formData.get("instagram") ? "Instagram" : "WhatsApp"
    });
    try {
      const response = await api(editingClient ? `/api/clients/${editingClient.id}` : "/api/clients", {
        method: editingClient ? "PATCH" : "POST",
        body: JSON.stringify({ record: clientPayload })
      });
      closeModal();
      applyServerData(response, "clients");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function openOrderForm(orderId) {
  if (!canManageOrders()) {
    showToast("Недостаточно прав для изменения заказов.", "error");
    return;
  }
  const editingOrder = orderId ? data.orders.find((order) => order.id === Number(orderId)) : null;
  const content = document.querySelector("#orderFormTemplate").content.cloneNode(true);
  openModal(content);
  const form = document.querySelector("#orderForm");
  document.querySelector("#modalTitle").textContent = editingOrder ? "Редактировать заказ" : "Новый заказ";
  form.date.value = today.toISOString().slice(0, 10);
  form.deliveryDate.value = today.toISOString().slice(0, 10);
  form.manager.value = currentUser?.name || currentUser?.owner || "";
  form.clientId.innerHTML = data.clients.map((client) => `<option value="${Number(client.id)}">${escapeHtml(client.name)}</option>`).join("");
  renderOrderInventoryRows(editingOrder?.items || []);
  document.querySelector("#addOrderInventoryItem").addEventListener("click", () => addOrderInventoryRow());
  if (editingOrder) {
    form.clientId.value = editingOrder.clientId;
    form.date.value = editingOrder.date;
    form.sum.value = editingOrder.sum;
    form.reason.value = editingOrder.reason || "";
    form.bouquet.value = editingOrder.bouquet || "";
    form.photo.value = editingOrder.photo || "";
    form.channel.value = editingOrder.channel || "WhatsApp";
    form.status.value = editingOrder.status || "new";
    form.deliveryDate.value = editingOrder.deliveryDate || editingOrder.date;
    form.deliveryTime.value = editingOrder.deliveryTime || "";
    form.manager.value = editingOrder.manager || "";
    form.comment.value = editingOrder.comment || "";
    form.querySelector("button[type='submit']").textContent = "Сохранить заказ";
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const client = getClient(formData.get("clientId"));
    const sum = Number(formData.get("sum"));
    const rate = cashbackRate(client);
    const items = collectOrderInventoryItems();
    const stockError = validateOrderStock(items, editingOrder);
    if (stockError) {
      alert(stockError);
      return;
    }
    const payload = sanitizeRecordStrings({
      clientId: Number(formData.get("clientId")),
      date: formData.get("date"),
      sum,
      reason: formData.get("reason") || "Заказ",
      bouquet: formData.get("bouquet") || "Букет",
      photo: formData.get("photo") || "",
      channel: formData.get("channel"),
      status: formData.get("status"),
      deliveryDate: formData.get("deliveryDate") || formData.get("date"),
      deliveryTime: formData.get("deliveryTime"),
      manager: formData.get("manager") || currentUser?.name || currentUser?.owner || "",
      comment: formData.get("comment"),
      items,
      createdAt: editingOrder?.createdAt || new Date().toISOString(),
      cashShiftId: editingOrder?.cashShiftId || "",
      bonus: Math.round(sum * rate)
    });
    try {
      const response = await api(editingOrder ? `/api/orders/${editingOrder.id}` : "/api/orders", {
        method: editingOrder ? "PATCH" : "POST",
        body: JSON.stringify({ record: payload })
      });
      closeModal();
      applyServerData(response, "orders");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

async function deleteOrder(id) {
  if (!canManageOrders()) {
    showToast("Недостаточно прав для удаления заказа.", "error");
    return;
  }
  const order = data.orders.find((item) => item.id === Number(id));
  if (!order) return;
  const approved = confirm("Переместить этот заказ в корзину и пересчитать бонусы клиента?");
  if (!approved) return;
  try {
    const response = await api(`/api/orders/${Number(id)}`, { method: "DELETE" });
    applyServerData(response, "orders");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function openPassport(id) {
  const client = getClient(id);
  if (!client) {
    showToast("Клиент не найден.", "error");
    return;
  }
  const orders = getClientOrders(id);
  const ordersTotal = orders.reduce((sum, order) => sum + Number(order.sum), 0);
  const lastOrder = [...orders].sort((a, b) => b.date.localeCompare(a.date))[0];
  const content = document.createElement("div");
  content.innerHTML = `
    <h3 id="modalTitle">Цветочный паспорт</h3>
    <div class="passport-actions">
      <button class="primary-button" type="button" data-action="open-client" data-id="${client.id}">Редактировать</button>
      <button class="danger-button" type="button" data-action="delete-client" data-id="${client.id}">Удалить клиента</button>
    </div>
    <div class="grid two-column">
      <div class="card passport-card">
        <div class="passport-hero">
          <div>
            <h3>${escapeHtml(client.name)}</h3>
            <p>${escapeHtml(client.phone)} · ${escapeHtml(client.instagram || "Instagram не указан")}</p>
          </div>
          <div class="badge-stack">${tierBadge(client)}${badge(client.status)}</div>
        </div>
        <p><b>Телефон:</b> ${escapeHtml(client.phone)}</p>
        <p><b>Instagram:</b> ${escapeHtml(client.instagram || "не указан")}</p>
        <p><b>Адрес:</b> ${escapeHtml(client.address || "не указан")}</p>
        <p><b>Получатель:</b> ${escapeHtml(client.recipient)} (${escapeHtml(client.relation)})</p>
        <p><b>Любимые цветы:</b> ${escapeHtml(client.flowers)}</p>
        <p><b>Любимые цвета:</b> ${escapeHtml(client.colors || "По настроению")}</p>
        <p><b>Важная дата:</b> ${escapeHtml(client.event)} · ${escapeHtml(eventKind(client))}</p>
        <p><b>Последний букет:</b> ${escapeHtml(lastOrder?.bouquet || "еще не покупал(а)")}</p>
        <p><b>Средний чек:</b> ${money(client.budget)}</p>
        <p><b>Бонусы:</b> ${money(client.bonus)}</p>
        <p><b>BloomScore:</b> ${bloomScore(client)}/100</p>
        <div class="client-actions">${clientLinks(client)}</div>
      </div>
      <div class="card">
        <h3>Готовое сообщение</h3>
        <div class="message-box">${escapeHtml(reminderMessage(client))}</div>
        <p class="muted">Заказов: ${orders.length}. Последний заказ: ${escapeHtml(client.lastOrder)}. Всего купил(а): ${money(ordersTotal)}.</p>
      </div>
    </div>
    <div class="card passport-history">
      <h3>История заказов клиента</h3>
      ${orders.length ? `
        <div class="table-wrap">
          <table class="mini-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Статус</th>
                <th>Сумма</th>
                <th>Повод</th>
                <th>Букет</th>
                <th>Фото</th>
                <th>Канал</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              ${orders.map((order) => `
                <tr>
                  <td>${escapeHtml(order.date)}</td>
                  <td><span class="badge ${statusClass(order.status)}">${statusLabel(order.status)}</span></td>
                  <td>${money(order.sum)}</td>
                  <td>${escapeHtml(order.reason)}</td>
                  <td>${escapeHtml(order.bouquet)}</td>
                  <td>${order.photo ? `<a class="channel-button" href="${cleanUrl(order.photo)}" target="_blank" rel="noreferrer">Фото</a>` : "-"}</td>
                  <td>${escapeHtml(order.channel)}</td>
                  <td><button class="channel-button" type="button" data-action="open-order" data-id="${order.id}">Изменить</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      ` : `<p class="muted">У клиента пока нет заказов. Добавьте первый заказ через кнопку сверху.</p>`}
    </div>
  `;
  openModal(content);
}

function openModal(content) {
  const body = document.querySelector("#modalBody");
  body.innerHTML = "";
  body.append(content);
  document.querySelector("#modal").classList.remove("hidden");
}

function closeModal() {
  document.querySelector("#modal").classList.add("hidden");
}

