var TOKEN = window.CLIENT_TOKEN || "";
var map = null;
var marker = null;
var firstFix = true;

function initMap() {
  if (!window.L) { setTimeout(initMap, 100); return; }

  var el = document.getElementById("map");
  if (!el) { setTimeout(initMap, 100); return; }

  // Принудительно задаём размер контейнеру перед init
  var vh = window.innerHeight;
  var headerH = (document.getElementById("header") || {}).offsetHeight || 60;
  var infoH = (document.getElementById("info") || {}).offsetHeight || 60;
  el.style.height = (vh - headerH - infoH) + "px";

  map = L.map("map", {
    zoomControl: true,
    attributionControl: true
  }).setView([43.65, 51.17], 12); // Актау по умолчанию

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 19,
    crossOrigin: true
  }).addTo(map);

  // Принудительно перерисовываем после render
  setTimeout(function() { map.invalidateSize(); }, 300);

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

      if (!d || !d.lat) {
        if (statusEl) statusEl.innerHTML = '<span class="dot" style="background:#888;animation:none"></span><span>Курьер ещё не вышел</span>';
        return;
      }

      var latlng = [parseFloat(d.lat), parseFloat(d.lng)];

      if (!map) return;

      if (!marker) {
        var icon = L.divIcon({
          className: "",
          html: '<div style="font-size:28px;filter:drop-shadow(0 2px 4px rgba(0,0,0,.8))">🛵</div>',
          iconSize: [36, 36],
          iconAnchor: [18, 36]
        });
        marker = L.marker(latlng, {icon: icon}).addTo(map);
      } else {
        marker.setLatLng(latlng);
      }

      if (firstFix) {
        map.setView(latlng, 15);
        map.invalidateSize();
        firstFix = false;
      }

      if (statusEl) statusEl.innerHTML = '<span class="dot"></span><span>Курьер онлайн · ' + new Date().toLocaleTimeString("ru") + '</span>';
      if (distText) distText.textContent = "🛵 Курьер в пути";
      if (infoText) infoText.textContent = d.acc ? "Точность GPS: " + d.acc + "м" : "";

    } catch(e) {}
  };
  xhr.onerror = function() {};
  xhr.send();
}

// Запуск после загрузки DOM и Leaflet
window.addEventListener("load", function() {
  // Небольшая задержка чтобы браузер успел отрисовать layout
  setTimeout(initMap, 200);
});

// Пересчитываем размер при повороте экрана
window.addEventListener("resize", function() {
  if (!map) return;
  var el = document.getElementById("map");
  var vh = window.innerHeight;
  var headerH = (document.getElementById("header") || {}).offsetHeight || 60;
  var infoH = (document.getElementById("info") || {}).offsetHeight || 60;
  el.style.height = (vh - headerH - infoH) + "px";
  map.invalidateSize();
});
