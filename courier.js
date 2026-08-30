var TOKEN = window.COURIER_TOKEN || "";
var active = false;
var watchId = null;
var backupIv = null;
var lastPos = null;
var sendFail = 0;
var sw = null;

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

// Отправка координат — и напрямую, и через SW
function sendPos(pos) {
  if (!active) return;
  lastPos = pos;
  var lat = pos.coords.latitude;
  var lng = pos.coords.longitude;
  var acc = Math.round(pos.coords.accuracy);

  log("GPS: " + lat.toFixed(5) + "," + lng.toFixed(5) + " ±" + acc + "м");
  document.getElementById("acc").textContent = "GPS точность: " + acc + "м";

  // Сообщаем SW свежие координаты (для фонового режима)
  if (sw) {
    sw.postMessage({type: 'LOCATION', lat: lat, lng: lng, acc: acc});
  }

  // Прямая отправка
  var xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/track/location", true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.onload = function() {
    sendFail = 0;
    if (xhr.status === 200) {
      ui("Отправлено · " + new Date().toLocaleTimeString("ru"), "ok");
    } else {
      ui("Ошибка сервера " + xhr.status, "warn");
    }
  };
  xhr.onerror = function() {
    sendFail++;
    ui(sendFail > 2 ? "Нет связи" : "Слабая связь", sendFail > 2 ? "err" : "warn");
    // Background Sync — отправит когда появится сеть
    if ('serviceWorker' in navigator && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(function(reg) {
        if (reg.sync) reg.sync.register('send-location').catch(function(){});
      });
    }
  };
  xhr.send(JSON.stringify({token: TOKEN, lat: lat, lng: lng, acc: acc}));
}

function onGeoError(e) {
  log("GPS ошибка код=" + e.code);
  if (e.code === 1) { ui("Геолокация отключена", "err"); doStop(false); }
  else if (e.code === 2) { ui("GPS сигнал потерян", "warn"); }
  else { ui("Таймаут GPS", "warn"); }
}

// Регистрируем SW
function registerSW() {
  if (!('serviceWorker' in navigator)) {
    log("SW: не поддерживается");
    return;
  }
  navigator.serviceWorker.register('/courier-sw.js').then(function(reg) {
    log("SW: зарегистрирован");
    // Ждём активации
    function getSW(reg) {
      return reg.active || reg.installing || reg.waiting;
    }
    sw = getSW(reg);
    if (!sw) {
      reg.addEventListener('updatefound', function() {
        sw = getSW(reg);
      });
    }
    // SW пингует нас — мы отвечаем координатами
    navigator.serviceWorker.addEventListener('message', function(e) {
      if (e.data && e.data.type === 'PING' && active && lastPos) {
        sendPos(lastPos);
        log("SW ping → отправили координаты");
      }
    });
  }).catch(function(err) {
    log("SW ошибка: " + err.message);
  });
}

function doStart() {
  log("Старт трекинга");
  if (!navigator.geolocation) { alert("Геолокация не поддерживается"); return; }
  active = true;

  var btn = document.getElementById("btn");
  if (btn) { btn.textContent = "⏹ Остановить трекинг"; btn.className = "stop"; }
  var warn = document.getElementById("bgWarn");
  if (warn) warn.style.display = "block";
  ui("Получаем GPS...", "idle");

  // Wake Lock — не даём экрану гаснуть
  if (navigator.wakeLock) {
    navigator.wakeLock.request("screen").then(function(wl) {
      window._wl = wl;
      log("Wake Lock: активен");
    }).catch(function(e) { log("Wake Lock: " + e.message); });
  }

  // Сообщаем SW о старте
  if (sw) sw.postMessage({type: 'START', token: TOKEN});

  // watchPosition — стреляет при каждом изменении координат
  watchId = navigator.geolocation.watchPosition(sendPos, onGeoError, {
    enableHighAccuracy: true,
    timeout: 20000,
    maximumAge: 3000
  });
  log("watchPosition id=" + watchId);

  // Резерв — каждые 12 сек
  backupIv = setInterval(function() {
    if (!active) return;
    if (lastPos) {
      sendPos(lastPos);
    } else {
      navigator.geolocation.getCurrentPosition(sendPos, onGeoError, {
        enableHighAccuracy: true, timeout: 10000
      });
    }
  }, 12000);
}

function doStop(userInitiated) {
  active = false;
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (backupIv) { clearInterval(backupIv); backupIv = null; }
  if (window._wl) { window._wl.release().catch(function(){}); window._wl = null; }
  if (sw) sw.postMessage({type: 'STOP'});

  var btn = document.getElementById("btn");
  if (btn) { btn.textContent = "📡 Начать трекинг"; btn.className = ""; }
  var warn = document.getElementById("bgWarn");
  if (warn) warn.style.display = "none";
  document.getElementById("acc").textContent = "";
  if (userInitiated !== false) ui("Трекинг остановлен", "idle");
  log("Трекинг остановлен");
}

// Wake Lock переполучаем при возврате на страницу
document.addEventListener("visibilitychange", function() {
  if (!document.hidden && active) {
    if (navigator.wakeLock && !window._wl) {
      navigator.wakeLock.request("screen").then(function(wl) { window._wl = wl; }).catch(function(){});
    }
    // Страница снова активна — сразу отправляем позицию
    if (lastPos) sendPos(lastPos);
    log("Страница активна");
  } else if (document.hidden && active) {
    log("Страница ушла в фон — SW продолжает");
  }
});

log("courier.js загружен");
log("Token=" + TOKEN.substring(0, 8) + "...");
log("geolocation=" + (!!navigator.geolocation));
log("serviceWorker=" + ('serviceWorker' in navigator));

// Регистрируем SW сразу
registerSW();

// Вешаем кнопку
document.getElementById("btn").onclick = function() {
  log("Кнопка: active=" + active);
  if (active) doStop(true); else doStart();
};
log("Готов к работе");
