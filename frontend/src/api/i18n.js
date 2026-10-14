// Роутер /i18n (backend/app/routers/i18n.py) — языки интерфейса
import api from './auth';

// → { languages: [...] }
export function getLanguages() {
  return api.get('/i18n/languages').then(res => res.data);
}
