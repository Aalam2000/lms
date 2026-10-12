// ДЗ, схема v2 (backend/app/routers/homework.py, claude/homework-plan.md).
import api from './auth';
import { needsPdfPreview } from '../utils/libraryItems';
import { notifyHomeworkChanged } from '../hooks/useHomeworkRefresh';

const hw = (lessonId) => `/lessons/${lessonId}/homework`;

// --- Педагог ---

// Таблица «Студенты»: задания урока + по каждому студенту статусы/оценки и последняя реплика диалога
export function getHomeworkBoard(lessonId) {
  return api.get(hw(lessonId)).then(res => res.data);
}

// Выдать задание. studentId = null — всем. Источник: materialId (из Базы знаний) ИЛИ file.
// deadline — Date | null. 409 code=name_taken — имя занято чужим файлом Базы знаний.
export function createHomeworkTask(lessonId, { studentId, deadline, materialId, file }) {
  const fd = new FormData();
  if (studentId) fd.append('student_id', studentId);
  if (deadline) fd.append('deadline', deadline.toISOString());
  if (materialId) fd.append('material_id', materialId);
  if (file) fd.append('file', file);
  return api.post(hw(lessonId), fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(res => res.data);
}

// Срок сразу для всех общих заданий урока (studentId = null) или для всех
// персональных заданий студента. Новые задания получают этот же срок.
export function setScopeDeadline(lessonId, studentId, deadline) {
  return api.put(`${hw(lessonId)}/deadline`, {
    student_id: studentId || null,
    deadline: deadline ? deadline.toISOString() : null,
  }).then(res => res.data);
}

export function setHomeworkDeadline(lessonId, taskId, deadline) {
  return api.patch(`${hw(lessonId)}/${taskId}`, { deadline: deadline ? deadline.toISOString() : null }).then(res => res.data);
}

export function deleteHomeworkTask(lessonId, taskId) {
  return api.delete(`${hw(lessonId)}/${taskId}`).then(res => res.data);
}

// Одна оценка на всё ДЗ студента в уроке. Поставить: {grade: 90};
// принять без оценки: {accepted: true}; вернуть на доработку: {grade: null, accepted: false}
export function reviewHomework(lessonId, studentId, { grade = null, accepted = false }) {
  return api.put(`${hw(lessonId)}/answers/${studentId}/review`, { grade, accepted }).then(res => {
    notifyHomeworkChanged(); // шапка и списки обновляются сразу, не дожидаясь опроса
    return res.data;
  });
}

// --- Студент ---

// { tasks: [...], answer: {status, grade, accepted, deadline, is_locked, files} }
export function getMyHomework(lessonId) {
  return api.get(`${hw(lessonId)}/my`).then(res => res.data);
}

export function uploadMyAnswerFiles(lessonId, files) {
  const fd = new FormData();
  Array.from(files).forEach(f => fd.append('files', f));
  return api.post(`${hw(lessonId)}/my/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(res => {
    notifyHomeworkChanged(); // полоса «Не сдано ДЗ» в шапке студента гаснет сразу
    return res.data;
  });
}

export function deleteMyAnswerFile(lessonId, fileId) {
  return api.delete(`${hw(lessonId)}/my/files/${fileId}`).then(res => {
    notifyHomeworkChanged();
    return res.data;
  });
}

// --- Диалог в строке студента ---

export function getMessages(lessonId, studentId) {
  return api.get(`/lessons/${lessonId}/messages/${studentId}`).then(res => res.data);
}

export function sendMessage(lessonId, studentId, text) {
  return api.post(`/lessons/${lessonId}/messages/${studentId}`, { text }).then(res => res.data);
}

export function editMessage(lessonId, studentId, messageId, text) {
  return api.patch(`/lessons/${lessonId}/messages/${studentId}/${messageId}`, { text }).then(res => res.data);
}

// --- Скачивание ---

export async function saveBlob(url, filename, contentType) {
  const res = await api.get(url, { responseType: 'blob' });
  const blobUrl = window.URL.createObjectURL(new Blob([res.data], { type: contentType || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60000);
}

// Файл задания (обычный файл Базы знаний / персональный)
export function downloadTaskFile(task) {
  return saveBlob(`/materials/${task.material_id}/download`, task.title, task.content_type);
}

// Файл задания — открыть в новой вкладке (педагог ничего не скачивает;
// docx/xlsx/pptx — через конвертацию в PDF, как в Базе знаний).
// Окно открываем синхронно по клику, иначе браузер заблокирует всплывающее.
export async function openTaskFile(task) {
  const win = window.open('', '_blank');
  const endpoint = needsPdfPreview(task.content_type) ? 'preview' : 'download';
  if (win && endpoint === 'preview') {
    win.document.write('<p style="font-family:sans-serif;color:#4B5563;padding:24px">Конвертируем файл в PDF...</p>');
    win.document.close();
  }
  try {
    const res = await api.get(`/materials/${task.material_id}/${endpoint}`, { responseType: 'blob' });
    const type = res.headers?.['content-type'] || (endpoint === 'preview' ? 'application/pdf' : task.content_type || 'application/octet-stream');
    const url = window.URL.createObjectURL(new Blob([res.data], { type }));
    if (win) win.location.href = type === 'application/pdf' ? `${url}#navpanes=0` : url;
    setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

// Файл ответа студента — скачать
export function downloadAnswerFile(lessonId, file) {
  return saveBlob(`${hw(lessonId)}/answer-files/${file.id}/download`, file.original_filename, file.content_type);
}

// Файл ответа для просмотра (картинка/PDF как есть, код/текст — текстом):
// blob-URL для панели проверки или новой вкладки. Не забыть revokeObjectURL.
export async function answerFileViewUrl(lessonId, file) {
  const res = await api.get(`${hw(lessonId)}/answer-files/${file.id}/download`, { params: { inline: 1 }, responseType: 'blob' });
  const type = res.headers?.['content-type'] || file.content_type || 'application/octet-stream';
  return { url: window.URL.createObjectURL(new Blob([res.data], { type })), type };
}

// Открыть файл ответа в новой вкладке, ничего не скачивая. Окно открываем
// синхронно по клику, иначе браузер заблокирует его как всплывающее.
export async function openAnswerFile(lessonId, file) {
  const win = window.open('', '_blank');
  try {
    const { url } = await answerFileViewUrl(lessonId, file);
    if (win) win.location.href = url;
    setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}
