// Роутер /groups (backend/app/routers/groups.py)
import api from './auth';

// params.with_guest — ещё и группы, где педагог не основной, но ведёт или вёл уроки (is_main: false)
export function getMyGroups(params) {
  return api.get('/groups/my', { params }).then(res => res.data);
}

// Флаг «Проверь ДЗ» у педагога: {count — ответов ждут проверки, lesson_id — с какого урока начать}
export function getHomeworkToReview() {
  return api.get('/groups/homework-to-review').then(res => res.data);
}

// Флаг «Проверь работы» у педагога: {count — учеников с непроверенной работой на уроке, lesson_id — с какого урока начать}
export function getWorkToReview() {
  return api.get('/groups/work-to-review').then(res => res.data);
}

// Список курсов для регистрации/создания группы — отдельный эндпоинт
// /groups/courses, не путать с admin.getCourses() (/admin/courses).
export function getCourses() {
  return api.get('/groups/courses').then(res => res.data);
}

export function getGroupByInvite(inviteCode) {
  return api.get(`/groups/invite/${inviteCode}`).then(res => res.data);
}

export function getGroupStudents(groupId, status = 'active') {
  return api.get(`/groups/${groupId}/students`, { params: { status } }).then(res => res.data);
}

export function searchAvailableStudents(groupId, q = '') {
  return api.get(`/groups/${groupId}/available-students`, { params: { q } }).then(res => res.data);
}

export function addGroupMember(groupId, studentId) {
  return api.post(`/groups/${groupId}/members`, { student_id: studentId }).then(res => res.data);
}

export function expelGroupMember(groupId, studentId, reason) {
  return api.post(`/groups/${groupId}/members/${studentId}/expel`, { reason }).then(res => res.data);
}

export function restoreGroupMember(groupId, studentId) {
  return api.post(`/groups/${groupId}/members/${studentId}/restore`).then(res => res.data);
}

// Настройки группы, которые меняет сам педагог: name, telegram_chat_id,
// whatsapp, video_url. Возвращает обновлённую группу (GroupOut).
export function updateGroupSettings(groupId, data) {
  return api.patch(`/groups/${groupId}/settings`, data).then(res => res.data);
}

// Группы студента (для плашек с видеоконференцией вверху кабинета).
export function getStudentGroups() {
  return api.get('/groups/student/my').then(res => res.data);
}
