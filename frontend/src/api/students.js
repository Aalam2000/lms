// Роутер /students (backend/app/routers/students.py)
import api from './auth';

// Смена пароля ученика педагогом/админом — без старого пароля.
// Педагог — только ученикам своих групп (проверка на бэкенде).
export function setStudentPassword(studentId, newPassword) {
  return api.put(`/students/${studentId}/password`, { new_password: newPassword });
}

// Данные ученика для правки: имя, телефон, email, мессенджеры, родитель и его телефон.
// Педагог — только своим ученикам, админ — любому (проверка на бэкенде).
export function getStudentProfile(studentId) {
  return api.get(`/students/${studentId}/profile`).then(res => res.data);
}

// Отчёт по ученику за период; params — как у getTeacherReport
export function getStudentReport(studentId, params) {
  return api.get(`/students/${studentId}/report`, { params }).then(res => res.data);
}

// Новый ученик сразу в группу: {username, password, group_id, phone, full_name?, …}
export function createStudent(data) {
  return api.post('/students', data).then(res => res.data);
}

export function updateStudentProfile(studentId, data) {
  return api.put(`/students/${studentId}/profile`, data).then(res => res.data);
}

// Список студентов. params: { course_id?, group_id?, mine?, teacher_id? }
export function getStudents(params) {
  return api.get('/students', { params }).then(res => res.data);
}

// Удаление: используемого ученика — только с force (всё связанное удаляется вместе с ним)
export function deleteStudent(studentId, { force = false } = {}) {
  return api.delete(`/students/${studentId}`, { params: force ? { force: true } : {} }).then(res => res.data);
}
