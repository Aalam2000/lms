// Роутер /admin (backend/app/routers/admin.py)
import api from './auth';

export function getTeachers() {
  return api.get('/admin/teachers').then(res => res.data);
}

export function createTeacher(data) {
  return api.post('/admin/teachers', data).then(res => res.data);
}

export function updateTeacher(id, data) {
  return api.patch(`/admin/teachers/${id}`, data).then(res => res.data);
}

export function deleteTeacher(id) {
  return api.delete(`/admin/teachers/${id}`).then(res => res.data);
}

// Справочник педагогов (контакты, курсы)
export function getTeacherDirectory() {
  return api.get('/admin/teachers/directory').then(res => res.data);
}

// Отчёт по педагогу за период; params — { period, ... } (см. periodParams на странице отчёта)
export function getTeacherReport(teacherId, params) {
  return api.get(`/admin/teachers/${teacherId}/report`, { params }).then(res => res.data);
}

export function getAdmins() {
  return api.get('/admin/admins').then(res => res.data);
}

export function createAdmin(data) {
  return api.post('/admin/admins', data).then(res => res.data);
}

export function updateAdmin(id, data) {
  return api.patch(`/admin/admins/${id}`, data).then(res => res.data);
}

export function deleteAdmin(id) {
  return api.delete(`/admin/admins/${id}`).then(res => res.data);
}

export function getCourses() {
  return api.get('/admin/courses').then(res => res.data);
}

export function createCourse(data) {
  return api.post('/admin/courses', data).then(res => res.data);
}

export function updateCourse(id, data) {
  return api.patch(`/admin/courses/${id}`, data).then(res => res.data);
}

export function deleteCourse(id) {
  return api.delete(`/admin/courses/${id}`).then(res => res.data);
}

export function getGroups() {
  return api.get('/admin/groups').then(res => res.data);
}

export function createGroup(data) {
  return api.post('/admin/groups', data).then(res => res.data);
}

// Активную группу можно только отправить в архив; удалить навсегда — только из архива
export function archiveGroup(id) {
  return api.post(`/admin/groups/${id}/archive`).then(res => res.data);
}

export function restoreGroup(id) {
  return api.post(`/admin/groups/${id}/restore`).then(res => res.data);
}

export function deleteGroup(id) {
  return api.delete(`/admin/groups/${id}`).then(res => res.data);
}

export function updateGroup(id, data) {
  return api.patch(`/admin/groups/${id}`, data).then(res => res.data);
}
// Педагог уроков группы: {teacher_id, from_lesson_id, to_lesson_id | null — до конца}
export function assignGroupTeacher(groupId, data) {
  return api.post(`/admin/groups/${groupId}/assign-teacher`, data).then(res => res.data);
}

// Смена пароля любому пользователю (педагог, админ, ученик) — только admin
export function setUserPassword(userId, newPassword) {
  return api.put(`/admin/users/${userId}/password`, { new_password: newPassword });
}

// Смена роли педагог ⇄ админ — только admin; себе менять нельзя
export function setUserRole(userId, role) {
  return api.put(`/admin/users/${userId}/role`, { role }).then(res => res.data);
}

// Выходные педагога (backend/app/days_off.py) — ставит только admin.
// settings: { weeks: [[0..6], ...], dates: { 'YYYY-MM-DD': 'off' | 'work' } }
export function getTeacherDaysOffSettings(teacherId) {
  return api.get(`/admin/teachers/${teacherId}/days-off`).then(res => res.data);
}

export function saveTeacherDaysOffSettings(teacherId, settings) {
  return api.put(`/admin/teachers/${teacherId}/days-off`, settings).then(res => res.data);
}

// Какие дни будут выходными при несохранённых настройках: { dates, pattern }
export function previewTeacherDaysOff(teacherId, settings, dateFrom, dateTo) {
  return api.post(`/admin/teachers/${teacherId}/days-off/preview`, { ...settings, date_from: dateFrom, date_to: dateTo })
    .then(res => res.data);
}
