var TOKEN = window.COURIER_TOKEN || "";
var active = false;
var watchId = null;
var backupIv = null;
var lastPos = null;
var sendFail = 0;

function log(msg) {
  var el = document.getElementById("log");
  if (el) el.textContent += new Date().toLocaleTimeString("ru") + " " + msg + "\n";
}

window.onerror = function(msg, src, line) {
  log("ОШИБКА: " + msg + " строка " + line);
};

function ui(text, state) {
  var dot = document.getElementById("dot");
  var badge = document.getElementById("badgeText");
  var status = document.getElementById("status");
  if (status) status.textContent = text;
  if (dot) dot.className = "dot" + (state === "ok" ? " green" : state === "err" ? " red" : "");
  if (badge) badge.textContent = state === "ok" ? "Онлайн" : state === "err" ? "Ошибка" : state === "warn" ? "Слабый GPS" : "Ожидание";
}

function sendPos(pos) {
  if (!active) return;
  lastPos = pos;
  var lat = pos.coords.latitude;
  var lng = pos.coords.longitude;
  var acc = Math.round(pos.coords.accuracy);
  log("GPS: " + lat.toFixed(5) + "," + lng.toFixed(5) + " acc=" + acc + "м");
  var xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/track/location", true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onload = function() {
    sendFail = 0;
    ui("Отправлено " + new Date().toLocaleTimeString("ru"), "ok");
    log("Сервер: " + xhr.status);
  };
  xhr.onerror = function() {
    sendFail++;
    ui("Нет связи", sendFail > 2 ? "err" : "warn");
    log("XHR ошибка");
  };
  xhr.send(JSON.stringify({token: TOKEN, lat: lat, lng: lng, acc: acc}));
}

function onGeoError(e) {
  log("GPS ошибка код=" + e.code + " " + (e.message||""));
  if (e.code === 1) { ui("Геолокация отключена", "err"); doStop(false); }
  else if (e.code === 2) { ui("GPS сигнал потерян", "warn"); }
  else { ui("Таймаут GPS", "warn"); }
}

function doStart() {
  log("doStart");
  if (!navigator.geolocation) { alert("Геолокация не поддерживается"); return; }
  active = true;
  var btn = document.getElementById("btn");
  if (btn) { btn.textContent = "⏹ Остановить трекинг"; btn.className = "stop"; }
  var warn = document.getElementById("bgWarn");
  if (warn) warn.style.display = "block";
  ui("Получаем GPS...", "idle");
  log("Запрашиваем геолокацию...");

  if (navigator.wakeLock) {
    navigator.wakeLock.request("screen").then(function(wl) {
      window._wl = wl;
      log("Wake Lock: активен");
    }).catch(function(e) { log("Wake Lock недоступен: " + e.message); });
  }

  watchId = navigator.geolocation.watchPosition(sendPos, onGeoError, {
    enableHighAccuracy: true, timeout: 20000, maximumAge: 3000
  });
  log("watchPosition запущен id=" + watchId);

  backupIv = setInterval(function() {
    if (!active) return;
    if (lastPos) sendPos(lastPos);
  }, 12000);
}

function doStop(userInitiated) {
  active = false;
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (backupIv) { clearInterval(backupIv); backupIv = null; }
  if (window._wl) { window._wl.release().catch(function(){}); window._wl = null; }
  var btn = document.getElementById("btn");
  if (btn) { btn.textContent = "📡 Начать трекинг"; btn.className = ""; }
  var warn = document.getElementById("bgWarn");
  if (warn) warn.style.display = "none";
  if (userInitiated !== false) ui("Трекинг остановлен", "idle");
  log("Трекинг остановлен");
}

log("courier.js загружен");
log("TOKEN=" + TOKEN.substring(0, 8) + "...");
log("geolocation=" + (!!navigator.geolocation));

document.getElementById("btn").onclick = function() {
  log("Кнопка нажата active=" + active);
  if (active) doStop(true); else doStart();
};
log("Кнопка инициализирована");