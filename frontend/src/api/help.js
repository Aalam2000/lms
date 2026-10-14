// Роутер /help (backend/app/routers/help.py) — справка своей роли
import api from './auth';

// → { html }
export function getHelp(lang) {
  return api.get('/help', { params: { lang } }).then(res => res.data);
}
