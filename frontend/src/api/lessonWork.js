// Работа на уроке (backend/app/routers/lesson_work.py): ученик сдаёт файлы во
// время урока, педагог смотрит, скачивает и проверяет — «Принять» или оценка.
// Оценка — это оценка за урок (одна за урок).
import api from './auth';
import { saveBlob } from './homework';
import { notifyHomeworkChanged } from '../hooks/useHomeworkRefresh';

const work = (lessonId) => `/lessons/${lessonId}/work`;
const fileUrl = (lessonId, file) => `${work(lessonId)}/files/${file.id}/download`;

// --- Ученик ---

// { status: none|submitted|accepted|graded, score, is_locked, lock_reason: reviewed|day_over|null, files }
export function getMyWork(lessonId) {
  return api.get(`${work(lessonId)}/my`).then(res => res.data);
}

export function uploadMyWorkFiles(lessonId, files) {
  const fd = new FormData();
  Array.from(files).forEach(f => fd.append('files', f));
  return api.post(`${work(lessonId)}/my/files`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(res => res.data);
}

export function deleteMyWorkFile(lessonId, fileId) {
  return api.delete(`${work(lessonId)}/my/files/${fileId}`).then(res => res.data);
}

// --- Педагог ---

// { students: [{student_id, full_name, work: {status, score, submitted_at, files}}], to_review }
export function getWorkBoard(lessonId) {
  return api.get(work(lessonId)).then(res => res.data);
}

// Оценить: {grade: 90} (это оценка за урок); принять без оценки: {accepted: true}
export function reviewWork(lessonId, studentId, { grade = null, accepted = false }) {
  return api.put(`${work(lessonId)}/${studentId}/review`, { grade, accepted }).then(res => {
    notifyHomeworkChanged(); // шапка и списки уроков обновляются сразу
    return res.data;
  });
}

// --- Файлы (ученик — свои, педагог — в своём уроке) ---

// Для просмотра: картинка/PDF как есть, код/HTML/текст — текстом. Не забыть revokeObjectURL.
export async function workFileViewUrl(lessonId, file) {
  const res = await api.get(fileUrl(lessonId, file), { params: { inline: 1 }, responseType: 'blob' });
  const type = res.headers?.['content-type'] || file.content_type || 'application/octet-stream';
  return { url: window.URL.createObjectURL(new Blob([res.data], { type })), type };
}

// Открыть в новой вкладке. Окно — синхронно по клику, иначе браузер заблокирует всплывающее.
export async function openWorkFile(lessonId, file) {
  const win = window.open('', '_blank');
  try {
    const { url } = await workFileViewUrl(lessonId, file);
    if (win) win.location.href = url;
    setTimeout(() => window.URL.revokeObjectURL(url), 60000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

export function downloadWorkFile(lessonId, file) {
  return saveBlob(fileUrl(lessonId, file), file.original_filename, file.content_type);
}
