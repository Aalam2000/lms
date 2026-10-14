// Выходные педагога (backend/app/routers/days_off.py).
// settings: { weeks: [[0..6], ...], dates: { 'YYYY-MM-DD': 'off' | 'work' } }
import api from './auth';

export function getDaysOffSettings(teacherId) {
  return api.get(`/days-off/teacher/${teacherId}/settings`).then(res => res.data);
}

export function saveDaysOffSettings(teacherId, settings) {
  return api.put(`/days-off/teacher/${teacherId}/settings`, settings).then(res => res.data);
}

// Какие дни будут выходными при несохранённых настройках: { dates, pattern }
export function previewDaysOff(teacherId, settings, dateFrom, dateTo) {
  return api.post(`/days-off/teacher/${teacherId}/preview`, { ...settings, date_from: dateFrom, date_to: dateTo })
    .then(res => res.data);
}

export function getTeacherDaysOff(teacherId, dateFrom, dateTo) {
  return api.get(`/days-off/teacher/${teacherId}`, { params: { date_from: dateFrom, date_to: dateTo } })
    .then(res => res.data.dates);
}

export function getStudentDaysOff(dateFrom, dateTo) {
  return api.get('/days-off/student', { params: { date_from: dateFrom, date_to: dateTo } })
    .then(res => res.data.dates);
}
