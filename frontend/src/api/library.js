// Роутер /library (backend/app/routers/library.py) — единая лента Базы знаний
import api from './auth';

// params: { type?, uploader?, course_id?, sector?, include_templates? }
export function getLibraryItems(params) {
  return api.get('/library/items', { params }).then(res => res.data);
}
