// Роутер /view (backend/app/routers/view.py): изолированный просмотр
// HTML-материалов и квизов. Ссылку (токен на 4 часа) выдают
// getMaterialViewUrl (api/materials.js) и getQuizViewUrl (api/quizzes.js);
// открывается она без входа, с заголовком CSP sandbox — скрипт материала
// не видит платформу и токен входа.
import api from './auth';

// В проде — тот же сайт, что и страница (/api за тем же nginx): ссылка
// работает и в локальной сети, и через Cloudflare. На деве — адрес API.
const VIEW_BASE = import.meta.env.PROD ? `${window.location.origin}/api` : api.defaults.baseURL;

export function viewUrl(token) {
  return `${VIEW_BASE}/view/${token}`;
}
