// Роутер /links (backend/app/routers/links.py) — ссылки в Базе знаний
import api from './auth';

export function createLink(title, url) {
  return api.post('/links/', { title, url }).then(res => res.data);
}

export function deleteLink(id) {
  return api.delete(`/links/${id}`).then(res => res.data);
}
