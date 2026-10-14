// Роутер /methodology (backend/app/routers/methodology.py) — Методика
import api from './auth';

// Дерево разделов → { sections: [{ ..., materials: [...] }] }
export function getMethodologyTree(lang) {
  return api.get('/methodology', { params: { lang } }).then(res => res.data);
}

export function getMethodologyDoc(section, slug, lang) {
  return api.get(`/methodology/${section}/${slug}`, { params: { lang } }).then(res => res.data);
}
