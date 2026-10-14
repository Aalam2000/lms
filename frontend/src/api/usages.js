// Роутер /usages (backend/app/routers/usages.py) — где используется объект перед удалением
import api from './auth';

// → { usages: [...] }; 400 — удалить нельзя в принципе (текст в detail)
export function getUsages(entity, id) {
  return api.get(`/usages/${entity}/${id}`).then(res => res.data);
}
