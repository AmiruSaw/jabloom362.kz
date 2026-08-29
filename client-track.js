var TOKEN = window.CLIENT_TOKEN || "";
var map = null;
var marker = null;
var firstFix = true;

function initMap() {
  if (!window.L) { setTimeout(initMap, 200); return; }
  map = L.map("map").setView([48.0, 68.0], 5);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap",
    maxZoom: 18
  }).addTo(map);
  poll();
  setInterval(poll, 8000);
}

var courierIconHtml = '<div style="font-size:30px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.6))">🛵</div>';

function poll() {
  var xhr = new XMLHttpRequest();
  xhr.open("GET", "/api/track/status?token=" + encodeURIComponent(TOKEN), true);
  xhr.onload = function() {
    if (xhr.status !== 200) return;
    try {
      var d = JSON.parse(xhr.responseText);
      var status = document.getElementById("status");
      var infoText = document.getElementById("infoText");
      var distText = document.getElementById("distText");
      if (!d.lat) {
        if (status) status.innerHTML = '<span class="dot" style="background:#888"></span>Курьер ещё не вышел';
        return;
      }
      var latlng = [d.lat, d.lng];
      if (!marker) {
        var icon = L.divIcon({className: "", html: courierIconHtml, iconSize: [36,36], iconAnchor: [18,36]});
        marker = L.marker(latlng, {icon: icon}).addTo(map);
      } else {
        marker.setLatLng(latlng);
      }
      if (firstFix) { map.setView(latlng, 15); firstFix = false; }
      if (status) status.innerHTML = '<span class="dot"></span>Курьер онлайн · ' + new Date().toLocaleTimeString("ru");
      if (infoText) infoText.textContent = "Точность GPS: " + (d.acc || "?") + "м";
      if (distText) distText.textContent = "🛵 Курьер в пути";
    } catch(e) {}
  };
  xhr.send();
}

// Ждём Leaflet и DOM
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initMap);
} else {
  initMap();
}
