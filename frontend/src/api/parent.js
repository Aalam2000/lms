// Ссылка родителя (backend/app/routers/parent.py).
import axios from 'axios';
import api from './auth';

// --- Педагог / админ: блок «Ссылка для родителя» в карточке ученика ---

export function getParentLink(studentId) {
  return api.get(`/parent-links/student/${studentId}`).then(res => res.data);
}

// renew = true — отключить старую ссылку и выдать новую
export function makeParentLink(studentId, renew = false) {
  return api.post(`/parent-links/student/${studentId}`, { renew }).then(res => res.data);
}

// «Сбросить на логин» — пароль входа родителя снова равен логину
export function resetParentPassword(studentId) {
  return api.post(`/parent-links/student/${studentId}/reset-password`).then(res => res.data);
}

// Вошедший по логину родитель: токен его действующей ссылки (страница /p/<токен>)
export function getMyParentToken() {
  return api.get('/parent/me').then(res => res.data.token);
}

// Адрес входа в платформу — для логина и пароля
export function loginUrl() {
  const base = (import.meta.env.REACT_APP_PUBLIC_URL || window.location.origin).replace(/\/$/, '');
  return `${base}/login`;
}

// Адрес, который отправляем родителю. REACT_APP_PUBLIC_URL — внешний адрес сайта
// (в проде задан в docker-compose.prod.yml), иначе — адрес, с которого открыта платформа.
export function parentLinkUrl(token) {
  const base = (import.meta.env.REACT_APP_PUBLIC_URL || window.location.origin).replace(/\/$/, '');
  return `${base}/p/${token}`;
}

// --- Страница родителя /p/<токен>: без входа, свой клиент без токена пользователя ---
// В проде API за тем же nginx (/api/), что и страница, — берём адрес страницы:
// родитель открывает ссылку с телефона извне, и адрес API должен быть тем же сайтом.
const API_BASE = import.meta.env.PROD
  ? `${window.location.origin}/api`
  : (import.meta.env.REACT_APP_API_URL || 'http://localhost:8000');

const parentApi = axios.create({ baseURL: API_BASE });

const child = (token, studentId) => `/parent/${token}/children/${studentId}`;

export function getParentHome(token) {
  return parentApi.get(`/parent/${token}`).then(res => res.data);
}

export function getChildMarks(token, studentId) {
  return parentApi.get(`${child(token, studentId)}/marks`).then(res => res.data);
}

export function getChildGrades(token, studentId) {
  return parentApi.get(`${child(token, studentId)}/grades`).then(res => res.data);
}

export function getChildHomework(token, studentId, lessonId) {
  return parentApi.get(`${child(token, studentId)}/lessons/${lessonId}/homework`).then(res => res.data);
}

export function getChildMessages(token, studentId, lessonId) {
  return parentApi.get(`${child(token, studentId)}/lessons/${lessonId}/messages`).then(res => res.data);
}

// Файлы открываются прямой ссылкой (токен в адресе, заголовки не нужны) — на телефоне так надёжнее
export function taskFileUrl(token, studentId, lessonId, taskId) {
  return `${API_BASE}${child(token, studentId)}/lessons/${lessonId}/tasks/${taskId}/file`;
}

export function answerFileUrl(token, studentId, lessonId, fileId) {
  return `${API_BASE}${child(token, studentId)}/lessons/${lessonId}/answer-files/${fileId}`;
}
