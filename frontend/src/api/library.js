// Роутер /library (backend/app/routers/library.py) — единая лента Базы знаний
import api from './auth';

// params: { type?, uploader?, course_id?, sector? }
export function getLibraryItems(params) {
  return api.get('/library/items', { params }).then(res => res.data);
}

// Теги папки (сектор и курс) у файла, ссылки или квиза — админ и владелец.
// Оба значения вместе или оба пустые.
export function setFolderTags(resourceType, id, { course_id, sector }) {
  return api.patch(`/library/${resourceType}/${id}/tags`, { course_id: course_id || null, sector: sector || null })
    .then(res => res.data);
}
