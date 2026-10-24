// Роутер /quiz-live (backend/app/routers/quiz_live.py) — живой квиз
import api from './auth';

// Открыть игру по квизу из урока: { code } — по нему страница хоста
export function openLiveQuiz(quizId, lessonId) {
  return api.post(`/quiz-live/${quizId}/open`, { lesson_id: lessonId }).then(res => res.data);
}

// --- Педагог (хост игры) ---
export function getLiveHostState(code) {
  return api.get(`/quiz-live/${code}/host`).then(res => res.data);
}

export function setLiveExam(code, isExam) {
  return api.post(`/quiz-live/${code}/set-exam`, { is_exam: isExam }).then(res => res.data);
}

export function startLiveQuiz(code) {
  return api.post(`/quiz-live/${code}/start`).then(res => res.data);
}

export function nextLiveQuestion(code) {
  return api.post(`/quiz-live/${code}/next`).then(res => res.data);
}

// Закрыть квиз: кнопка «Войти в квиз» у учеников пропадает
export function closeLiveQuiz(code) {
  return api.post(`/quiz-live/${code}/close`).then(res => res.data);
}

// --- Ученик ---
// Идёт ли в уроке квиз: { code, title } или null — кнопка «Войти в квиз»
export function getLessonLiveQuiz(lessonId) {
  return api.get(`/quiz-live/lesson/${lessonId}/active`).then(res => res.data);
}

// Вход под своим логином (ученик в платформе): { token, name }
export function joinLiveQuizMe(code) {
  return api.post(`/quiz-live/${code}/join-me`).then(res => res.data);
}

export function getLiveRoster(code) {
  return api.get(`/quiz-live/${code}/roster`).then(res => res.data);
}

export function joinLiveQuiz(code, studentId) {
  return api.post(`/quiz-live/${code}/join`, { student_id: studentId }).then(res => res.data);
}

export function getLivePlayerState(code, token) {
  return api.get(`/quiz-live/${code}/state`, { params: { token } }).then(res => res.data);
}

export function answerLiveQuestion(code, token, questionIndex, option) {
  return api.post(`/quiz-live/${code}/answer`, { token, question_index: questionIndex, option }).then(res => res.data);
}
