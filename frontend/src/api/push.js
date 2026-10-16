// Роутер /push (backend/app/routers/push.py) — согласия на уведомления
import api from './auth';

// → { public_key } (null — ключи на сервере не заданы)
export function getPushKey() {
  return api.get('/push/key').then(res => res.data);
}

// Подписка устройства: { endpoint, keys: { p256dh, auth } }
export function savePushSubscription(sub) {
  return api.post('/push/subscribe', { endpoint: sub.endpoint, keys: sub.keys });
}

// id пользователей, разрешивших уведомления (значок 🔔)
export function getPushUsers() {
  return api.get('/push/users').then(res => res.data);
}
