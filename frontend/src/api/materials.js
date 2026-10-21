// Роутер /materials (backend/app/routers/materials.py)
import api from './auth';
import { needsPdfPreview } from '../utils/libraryItems';

export function getMaterials() {
  return api.get('/materials/').then(res => res.data);
}

// templateFields — необязательный {course_id, sector, template_lesson_no},
// проставить их может только admin (см. backend/app/routers/materials.py).
// Имя файла уникально по всей Базе знаний. В ответе upload_result:
//   created   — загружен новый файл;
//   replaced  — файл с таким именем уже был, содержимое заменено (id тот же);
//   unchanged — такой же файл с таким же именем уже есть, ничего не менялось.
// Отказы — 409: code=duplicate (то же содержимое лежит под другим именем,
// existing_id — его id), code=name_taken (одноимённый файл чужой или из
// другого курса/сектора — заменить нельзя, нужно переименовать).
export function uploadMaterial(file, templateFields) {
  const formData = new FormData();
  formData.append('file', file);
  if (templateFields) {
    const { course_id, sector, template_lesson_no } = templateFields;
    if (course_id != null) formData.append('course_id', course_id);
    if (sector != null) formData.append('sector', sector);
    if (template_lesson_no != null) formData.append('template_lesson_no', template_lesson_no);
  }
  return api.post('/materials/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(res => res.data);
}

export function downloadMaterial(id) {
  return api.get(`/materials/${id}/download`, { responseType: 'blob' }).then(res => res.data);
}

// Файл, сконвертированный в PDF, — байтами (для показа слайдов через pdf.js)
export function getMaterialPreviewBytes(id) {
  return api.get(`/materials/${id}/preview`, { responseType: 'arraybuffer' }).then(res => res.data);
}

export function deleteMaterial(id) {
  return api.delete(`/materials/${id}`).then(res => res.data);
}

// Текст файла для помощника квизов → { text, ... }; limit — сколько символов
export function getMaterialText(id, limit) {
  return api.get(`/materials/${id}/text`, { params: { limit } }).then(res => res.data);
}

// Правка тегов шаблона курса / одобрение / блокировка одного файла — admin.
export function updateMaterialTemplate(id, data) {
  return api.patch(`/materials/${id}/template`, data).then(res => res.data);
}

// Массовое одобрение/блокировка всего пакета материалов курса+сектора — admin.
export function bulkUpdateMaterialTemplate(data) {
  return api.patch('/materials/template/bulk', data).then(res => res.data);
}

// Новая вкладка под файл. Открывать синхронно по клику — иначе браузер
// заблокирует всплывающее окно; пока docx/xlsx/pptx конвертируется в PDF,
// во вкладке надпись.
export function openPendingTab(converting) {
  const win = window.open('', '_blank');
  if (win && converting) {
    win.document.write('<p style="font-family:sans-serif;color:#4B5563;padding:24px">Конвертируем файл в PDF...</p>');
    win.document.close();
  }
  return win;
}

// Файл Базы знаний для показа: docx/xlsx/pptx — сконвертированным в PDF,
// остальное как есть → { blob, type }
export async function getMaterialFile(materialId, contentType) {
  const endpoint = needsPdfPreview(contentType) ? 'preview' : 'download';
  const res = await api.get(`/materials/${materialId}/${endpoint}`, { responseType: 'blob' });
  const type = res.headers?.['content-type'] || (endpoint === 'preview' ? 'application/pdf' : contentType || 'application/octet-stream');
  return { blob: new Blob([res.data], { type }), type };
}

// Показать файл Базы знаний в уже открытой вкладке. Ничего не скачивается.
export async function showMaterialInTab(win, materialId, contentType) {
  const { blob, type } = await getMaterialFile(materialId, contentType);
  const url = window.URL.createObjectURL(blob);
  if (win) win.location.href = type === 'application/pdf' ? `${url}#navpanes=0` : url;
  setTimeout(() => window.URL.revokeObjectURL(url), 60000);
}
