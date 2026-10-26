// Роутер /presence (backend/app/routers/presence.py) — присутствие в системе
import api from './auth';

export function sendPresencePing() {
  return api.post('/presence/ping');
}

// Закрыл вкладку — «ушёл» сразу. fetch с keepalive: запрос доходит и после
// закрытия страницы (axios так не умеет); токен — как у остальных запросов.
export function sendPresenceBye() {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    fetch(`${api.defaults.baseURL}/presence/bye`, {
      method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  } catch { /* не критично — сработает окно «сейчас» */ }
}

// Кто сейчас в системе: [{ user_id, full_name, role, since, last_seen }]
export function getOnlineUsers() {
  return api.get('/presence/online').then(res => res.data);
}

// params: { date_from, date_to, role?, group_id? } → { days: [...], totals: [...] }
export function getPresenceReport(params) {
  return api.get('/presence/report', { params }).then(res => res.data);
}
