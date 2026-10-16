// «Положить на рабочий стол» (установка платформы как приложения).
// Браузер присылает событие beforeinstallprompt один раз и рано — ещё до того,
// как отрисуется меню, — поэтому ловим его здесь, при загрузке модуля
// (импортируется в index.jsx), и отдаём кнопке по запросу.
// Chrome/Edge (Android, Windows, Mac) — стандартное окно установки;
// iPhone/iPad и Safari на Mac такого окна не дают — там кнопка показывает подсказку.

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // своё окно браузер покажет по нашей кнопке
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
  // Фоновый скрипт (public/sw.js): без него браузер не предложит установку
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }
}

// Уже открыто как приложение (со значка на рабочем столе)
export function isInstalled() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function canPrompt() {
  return !!deferred;
}

// Показать окно установки браузера; true — пользователь согласился
export async function promptInstall() {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  notify();
  return outcome === 'accepted';
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Где открыт сайт — для подсказки, если окна установки нет
export function platform() {
  const ua = navigator.userAgent;
  const iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  const safari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
  if (/Macintosh/.test(ua) && safari) return 'mac-safari';
  return 'other';
}
