// «Положить на рабочий стол» (установка платформы как приложения).
// Браузер присылает событие beforeinstallprompt один раз и рано — ещё до того,
// как отрисуется меню, — поэтому ловим его здесь, при загрузке модуля
// (импортируется в index.jsx), и отдаём кнопке по запросу.
// Chrome/Edge (Android, Windows, Mac) — стандартное окно установки;
// iPhone/iPad и Safari на Mac такого окна не дают — там кнопка показывает подсказку.
// Уведомления: та же кнопка спрашивает разрешение, подписка устройства уходит
// на сервер (api/push.js). Рассылка — отдельная задача.
import { getPushKey, savePushSubscription } from '../api/push';

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

// ===== Уведомления =====
// Браузер умеет уведомления: https, фоновый скрипт, Push API.
// На iPhone — только в приложении, открытом со значка «Домой».
export function pushSupported() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// 'default' — ещё не спрашивали, 'granted' / 'denied', 'unsupported'
export function pushPermission() {
  return pushSupported() ? Notification.permission : 'unsupported';
}

function keyBytes(b64) {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
}

async function syncSubscription(publicKey) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await savePushSubscription(sub.toJSON());
}

// По нажатию кнопки: спросить разрешение (вызывать сразу в обработчике клика —
// без await перед ним, иначе iPhone и Safari окно не покажут) и записать устройство
export async function enablePush() {
  if (!pushSupported()) return false;
  const asked = Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission;
  const [perm, { public_key: key }] = await Promise.all([asked, getPushKey()]);
  notify();
  if (perm !== 'granted' || !key) return false;
  await syncSubscription(key);
  return true;
}

// При входе: разрешение уже есть — обновить запись устройства на сервере
// (сменился пользователь на этом устройстве, браузер обновил подписку)
export async function refreshPush() {
  if (pushPermission() !== 'granted') return;
  const { public_key: key } = await getPushKey();
  if (key) await syncSubscription(key);
}
