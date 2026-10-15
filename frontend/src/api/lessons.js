// Роутер /lessons (backend/app/routers/lessons.py)
import api from './auth';

// params (только имеют смысл для admin, см. backend): {teacher_id?, mine?}
export function getMyLessons(params) {
  return api.get('/lessons/my', { params }).then(res => res.data);
}

export function getGroupLessons(groupId) {
  return api.get(`/lessons/group/${groupId}`).then(res => res.data);
}

// params.include_closed — и закрытые уроки (для календаря)
export function getStudentLessons(params) {
  return api.get('/lessons/student', { params }).then(res => res.data);
}

export function getLesson(id) {
  return api.get(`/lessons/${id}`).then(res => res.data);
}

// payload: {group_id, date, duration_min, title?, is_personal?, student_ids?}
export function createLesson(payload) {
  return api.post('/lessons/', payload).then(res => res.data);
}

// Состав участников персонального урока
export function setLessonParticipants(lessonId, studentIds) {
  return api.put(`/lessons/${lessonId}/participants`, { student_ids: studentIds }).then(res => res.data);
}

// Генератор расписания группы — см. claude/group-schedule-plan.md.
// payload: {group_id, start_date, start_time, weekdays, lesson_count,
// fill_source?, fill_group_id?}
export function generateSchedule(payload) {
  return api.post('/lessons/generate', payload).then(res => res.data);
}

// Дозаполнение/обновление материалов уже существующих уроков — и как шаг
// после генерации, и как отдельная кнопка «Обновить материалы».
// payload: {source, fill_group_id?, range_from, range_to, mode}
export function fillGroupSchedule(groupId, payload) {
  return api.post(`/lessons/group/${groupId}/fill-schedule`, payload).then(res => res.data);
}

// Открыть / закрыть сразу несколько уроков группы по номерам с..по.
// payload: {range_from, range_to, is_open}
export function openGroupLessonsRange(groupId, payload) {
  return api.post(`/lessons/group/${groupId}/open-range`, payload).then(res => res.data);
}

// Удалить все уроки группы разом — шаг «удалить и пересоздать» в диалоге
// генератора, когда в группе уже есть уроки.
export function deleteGroupLessons(groupId) {
  return api.delete(`/lessons/group/${groupId}`).then(res => res.data);
}

// «Праздник» — сдвигает даты этого и всех последующих уроков серии на
// одну позицию вперёд (материалы/оценки не трогает). Работает только
// внутри этой группы, справочника праздников в системе нет.
export function markLessonHoliday(lessonId) {
  return api.post(`/lessons/${lessonId}/mark-holiday`).then(res => res.data);
}

export function updateLesson(id, payload) {
  return api.patch(`/lessons/${id}`, payload).then(res => res.data);
}

export function openLesson(id) {
  return api.patch(`/lessons/${id}/open`).then(res => res.data);
}

export function deleteLesson(id) {
  return api.delete(`/lessons/${id}`).then(res => res.data);
}

// «Из урока»: уроки группы до сегодняшнего дня — [{id, title, date, items_count, missed_by: [имена]}],
// missed_by — кто из учеников этого урока пропустил тот урок
export function getLessonSources(lessonId) {
  return api.get(`/lessons/${lessonId}/sources`).then(res => res.data);
}

// Подтянуть в урок все материалы другого урока группы → {attached, total}
export function copyLessonItems(lessonId, sourceId) {
  return api.post(`/lessons/${lessonId}/items/copy-from/${sourceId}`).then(res => res.data);
}

export function getLessonMarks(lessonId) {
  return api.get(`/lessons/${lessonId}/marks`).then(res => res.data);
}

export function saveLessonMark(lessonId, studentId, payload) {
  return api.put(`/lessons/${lessonId}/marks/${studentId}`, payload).then(res => res.data);
}

export function saveLessonMarksBulk(lessonId, items) {
  return api.put(`/lessons/${lessonId}/marks`, items).then(res => res.data);
}

// Сумма звёзд студента за все уроки (шапка кабинета студента) → { stars }
export function getMyStars() {
  return api.get('/lessons/student/stars').then(res => res.data);
}

// Отметки студента по урокам (страница «Успеваемость»)
export function getMyMarks() {
  return api.get('/lessons/student/marks').then(res => res.data);
}

// Итоговые оценки студента по видам (страница «Успеваемость»)
export function getMyGrades() {
  return api.get('/lessons/student/grades').then(res => res.data);
}

// Несданные ДЗ студента (полоса под шапкой) → { count, overdue, lesson_id, lesson_title, deadline }
export function getMyHomeworkDebts() {
  return api.get('/lessons/student/homework-debts').then(res => res.data);
}

// Даты выходных для заливки календаря уроков (backend/app/days_off.py)
export function getTeacherDaysOff(teacherId, dateFrom, dateTo) {
  return api.get('/lessons/days-off', { params: { teacher_id: teacherId, date_from: dateFrom, date_to: dateTo } })
    .then(res => res.data.dates);
}

export function getStudentDaysOff(dateFrom, dateTo) {
  return api.get('/lessons/student/days-off', { params: { date_from: dateFrom, date_to: dateTo } })
    .then(res => res.data.dates);
}

// Оценка урока учеником → { can_rate, rating, ... }
export function getMyLessonFeedback(lessonId) {
  return api.get(`/lessons/${lessonId}/feedback/me`).then(res => res.data);
}

export function rateLesson(lessonId, rating) {
  return api.put(`/lessons/${lessonId}/feedback/me`, { rating }).then(res => res.data);
}

// Материалы урока (файл, квиз, ссылка) — привязки к ресурсам Базы знаний
export function getLessonItems(lessonId) {
  return api.get(`/lessons/${lessonId}/items`).then(res => res.data);
}

export function attachLessonItem(lessonId, resourceType, resourceId) {
  return api.post(`/lessons/${lessonId}/items`, { resource_type: resourceType, resource_id: resourceId }).then(res => res.data);
}

export function detachLessonItem(lessonId, resourceType, resourceId) {
  return api.delete(`/lessons/${lessonId}/items/${resourceType}/${resourceId}`).then(res => res.data);
}

// Свой урок (создан этим пользователем) — перенести и открыть/закрыть без доступа
// внутрь урока (право lessons.own, куратор). data: { date (ISO), is_open }
export function updateOwnLesson(lessonId, data) {
  return api.patch(`/lessons/${lessonId}/own`, data).then(res => res.data);
}
