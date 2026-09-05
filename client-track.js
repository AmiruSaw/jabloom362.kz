var TOKEN = window.CLIENT_TOKEN || "";
var map = null;
var marker = null;
var firstFix = true;

function setStatus(html) {
  var el = document.getElementById("status");
  if (el) el.innerHTML = html;
}

function initMap() {
  var el = document.getElementById("map");
  if (!el || !window.L) { setTimeout(initMap, 100); return; }

  map = L.map("map", {zoomControl: true}).setView([43.65, 51.17], 12);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap", maxZoom: 19
  }).addTo(map);

  setTimeout(function() { map.invalidateSize(); }, 300);
  setTimeout(function() { map.invalidateSize(); }, 800);

  poll();
  setInterval(poll, 8000);
}

function poll() {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "/api/track/status?token=" + encodeURIComponent(TOKEN), true);
  xhr.timeout = 7000;
  xhr.onload = function() {
    var debugEl = document.getElementById("debug");

    if (xhr.status !== 200) {
      setStatus('<span class="dot" style="background:#e74c3c;animation:none"></span><span>Ошибка ' + xhr.status + '</span>');
      if (debugEl) debugEl.textContent = "HTTP " + xhr.status + ": " + xhr.responseText;
      return;
    }

    try {
      var d = JSON.parse(xhr.responseText);
      if (debugEl) debugEl.textContent = "Ответ: " + JSON.stringify(d);

      if (d.error || d.lat === null || d.lat === undefined) {
        setStatus('<span class="dot" style="background:#888;animation:none"></span><span>' + (d.error || "Курьер ещё не вышел") + '</span>');
        return;
      }

      var lat = parseFloat(d.lat);
      var lng = parseFloat(d.lng);
      if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
        setStatus('<span class="dot" style="background:#888;animation:none"></span><span>Ожидаем координаты</span>');
        return;
      }

      if (!map) return;

      if (!marker) {
        var icon = L.divIcon({
          className: "",
          html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8))">🛵</div>',
          iconSize: [36, 36], iconAnchor: [18, 36]
        });
        marker = L.marker([lat, lng], {icon: icon}).addTo(map);
      } else {
        marker.setLatLng([lat, lng]);
      }

      if (firstFix) {
        map.setView([lat, lng], 15);
        map.invalidateSize();
        firstFix = false;
      }

      setStatus('<span class="dot"></span><span>Курьер онлайн · ' + new Date().toLocaleTimeString("ru") + '</span>');
      var distEl = document.getElementById("distText");
      var infoEl = document.getElementById("infoText");
      if (distEl) distEl.textContent = "🛵 Курьер в пути";
      if (infoEl && d.acc) infoEl.textContent = "Точность GPS: " + d.acc + "м";

    } catch(e) {
      if (debugEl) debugEl.textContent = "Parse error: " + e.message;
    }
  };
  xhr.onerror = function() {
    setStatus('<span class="dot" style="background:#e74c3c;animation:none"></span><span>Нет связи</span>');
  };
  xhr.send();
}

window.addEventListener("load", function() { setTimeout(initMap, 200); });
window.addEventListener("resize", function() { if (map) map.invalidateSize(); });
