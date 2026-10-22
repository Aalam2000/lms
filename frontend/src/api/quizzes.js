// Роутер /quizzes (backend/app/routers/quizzes.py)
import api from './auth';
import { viewUrl } from './view';

export function getQuizzes() {
  return api.get('/quizzes/').then(res => res.data);
}

export function getQuizForEdit(id) {
  return api.get(`/quizzes/${id}/edit`).then(res => res.data);
}

// Ссылка изолированного просмотра квиза (api/view.js, действует 4 часа)
export function getQuizViewUrl(id) {
  return api.post(`/quizzes/${id}/view-link`).then(res => viewUrl(res.data.token));
}

export function createQuiz(payload) {
  return api.post('/quizzes/', payload).then(res => res.data);
}

export function updateQuiz(id, payload) {
  return api.put(`/quizzes/${id}`, payload).then(res => res.data);
}

export function deleteQuiz(id) {
  return api.delete(`/quizzes/${id}`).then(res => res.data);
}
