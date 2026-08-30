var TOKEN = window.CLIENT_TOKEN || "";
var map = null;
var marker = null;
var firstFix = true;

function initMap() {
  var el = document.getElementById("map");
  if (!el || !window.L) { setTimeout(initMap, 100); return; }

  map = L.map("map", {zoomControl: true}).setView([43.65, 51.17], 12);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19
  }).addTo(map);

  // Критично — без этого карта чёрная
  setTimeout(function() { map.invalidateSize(); }, 100);
  setTimeout(function() { map.invalidateSize(); }, 500);
  setTimeout(function() { map.invalidateSize(); }, 1000);

  poll();
  setInterval(poll, 8000);
}

function poll() {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "/api/track/status?token=" + encodeURIComponent(TOKEN), true);
  xhr.timeout = 7000;
  xhr.onload = function() {
    if (xhr.status !== 200) return;
    try {
      var d = JSON.parse(xhr.responseText);
      var statusEl = document.getElementById("status");
      var infoText = document.getElementById("infoText");
      var distText = document.getElementById("distText");

      // Проверяем наличие координат явно
      if (d.lat === null || d.lat === undefined || d.lat === 0) {
        if (statusEl) statusEl.innerHTML = '<span class="dot" style="background:#888;animation:none"></span><span>Курьер ещё не вышел</span>';
        return;
      }

      var lat = parseFloat(d.lat);
      var lng = parseFloat(d.lng);
      if (isNaN(lat) || isNaN(lng)) return;

      if (!map) return;

      if (!marker) {
        var icon = L.divIcon({
          className: "",
          html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8))">🛵</div>',
          iconSize: [36, 36],
          iconAnchor: [18, 36]
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

      if (statusEl) statusEl.innerHTML = '<span class="dot"></span><span>Курьер онлайн · ' + new Date().toLocaleTimeString("ru") + '</span>';
      if (distText) distText.textContent = "🛵 Курьер в пути";
      if (infoText && d.acc) infoText.textContent = "Точность GPS: " + d.acc + "м";

    } catch(e) {}
  };
  xhr.onerror = function() {};
  xhr.send();
}

window.addEventListener("load", function() {
  setTimeout(initMap, 200);
});

window.addEventListener("resize", function() {
  if (map) map.invalidateSize();
});
