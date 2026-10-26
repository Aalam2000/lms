// Фоновый скрипт платформы (service worker). Нужен, чтобы браузер разрешил
// «Положить на рабочий стол» (установку как приложения), а дальше — чтобы
// принимать уведомления. Страницы и файлы НЕ кэширует: всё грузится с сервера,
// как обычно, поэтому старая версия сайта «залипнуть» не может.
// Уведомления: показывает присланное сервером и открывает страницу по нажатию.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Уведомление с сервера: { title, body, url, tag }. Одинаковый tag — новое
// уведомление заменяет прежнее (сводка «что ждёт»), renotify — телефон всё равно звенит.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Log Academy', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/dashboard' },
    ...(data.tag ? { tag: data.tag, renotify: true } : {}),
  }));
});

// Нажали на уведомление — открыть платформу на нужной странице
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find(w => w.url.startsWith(self.location.origin));
    if (win) { await win.focus(); return win.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
