// Фоновый скрипт платформы (service worker). Нужен, чтобы браузер разрешил
// «Положить на рабочий стол» (установку как приложения), а дальше — чтобы
// принимать уведомления. Страницы и файлы НЕ кэширует: всё грузится с сервера,
// как обычно, поэтому старая версия сайта «залипнуть» не может.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
