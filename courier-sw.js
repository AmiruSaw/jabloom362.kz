// Service Worker для фонового трекинга курьера
var CACHE = 'courier-v1';
var trackToken = null;
var trackInterval = null;
var lastLat = null;
var lastLng = null;
var lastAcc = null;

// Принимаем сообщения от страницы
self.addEventListener('message', function(e) {
  if (!e.data) return;

  if (e.data.type === 'START') {
    trackToken = e.data.token;
    lastLat = e.data.lat || null;
    lastLng = e.data.lng || null;
    lastAcc = e.data.acc || null;
    startInterval();
  }

  if (e.data.type === 'LOCATION') {
    // Страница прислала свежие координаты — сохраняем
    lastLat = e.data.lat;
    lastLng = e.data.lng;
    lastAcc = e.data.acc;
    // Сразу отправляем
    sendToServer(e.data.lat, e.data.lng, e.data.acc);
  }

  if (e.data.type === 'STOP') {
    trackToken = null;
    stopInterval();
  }
});

function startInterval() {
  stopInterval();
  // Каждые 15 сек — пингуем страницу чтобы она прислала координаты
  // Если страница не отвечает — отправляем последние известные
  trackInterval = setInterval(function() {
    if (!trackToken) return;

    // Пингуем все открытые вкладки
    self.clients.matchAll({includeUncontrolled: true, type: 'window'}).then(function(clients) {
      if (clients.length > 0) {
        clients.forEach(function(c) {
          c.postMessage({type: 'PING'});
        });
      } else if (lastLat && lastLng) {
        // Вкладка закрыта — отправляем последние координаты
        sendToServer(lastLat, lastLng, lastAcc);
      }
    });
  }, 15000);
}

function stopInterval() {
  if (trackInterval) {
    clearInterval(trackInterval);
    trackInterval = null;
  }
}

function sendToServer(lat, lng, acc) {
  if (!trackToken || !lat || !lng) return;
  fetch('/api/track/location', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({token: trackToken, lat: lat, lng: lng, acc: acc || 0})
  }).catch(function() {});
}

// Background Sync — отправляет когда появляется сеть
self.addEventListener('sync', function(e) {
  if (e.tag === 'send-location' && lastLat && lastLng && trackToken) {
    e.waitUntil(sendToServer(lastLat, lastLng, lastAcc));
  }
});

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(self.clients.claim());
});
