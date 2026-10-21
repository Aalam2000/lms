// Общие хелперы отображения ресурсов «Базы знаний» (файл/квиз/ссылка) —
// используются и на странице «База знаний» (KnowledgeBasePage.jsx), и на
// вкладке «Урок» (LessonPage.jsx), чтобы бейдж типа/подтипа выглядел
// одинаково в обоих местах.

export const TYPE_META = {
  material: { icon: '📄', label: 'Файл' },
  quiz: { icon: '🧩', label: 'Квиз' },
  link: { icon: '🔗', label: 'Ссылка' },
};

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Короткая подпись типа файла по content_type — для бейджа в таблице.
export function materialTypeLabel(contentType) {
  if (!contentType) return 'Файл';
  if (contentType.includes('pdf')) return 'PDF';
  if (contentType.includes('wordprocessingml') || contentType.includes('msword')) return 'DOCX';
  if (contentType.includes('spreadsheetml') || contentType.includes('excel')) return 'XLSX';
  if (contentType.includes('presentationml') || contentType.includes('powerpoint')) return 'PPTX';
  if (contentType.startsWith('image/')) return contentType.split('/')[1]?.toUpperCase() || 'Изображение';
  if (contentType.startsWith('video/')) return 'Видео';
  if (contentType.startsWith('audio/')) return 'Аудио';
  if (contentType.includes('zip') || contentType.includes('rar') || contentType.includes('7z')) return 'Архив';
  if (contentType.includes('html')) return 'HTML';
  if (contentType.startsWith('text/')) return 'Текст';
  return contentType.split('/')[1]?.toUpperCase() || contentType;
}

export function subtypeLabel(item) {
  if (item.resource_type === 'material') return materialTypeLabel(item.content_type);
  if (item.resource_type === 'quiz') return item.template_type || '—';
  return 'Ссылка';
}

// docx/xlsx/pptx браузер нативно не открывает — для них бэкенд конвертирует
// в PDF на лету (/materials/{id}/preview), дальше открывается тем же
// способом, что уже работает для PDF/картинок (/download).
// Презентация (.pptx) открывается не лентой PDF, а просмотрщиком по слайдам
// (pages/SlideViewerPage.jsx) в новой вкладке.
export function isPresentation(contentType) {
  return materialTypeLabel(contentType) === 'PPTX';
}

export function openSlides(materialId, title) {
  const q = title ? `?title=${encodeURIComponent(title)}` : '';
  window.open(`/slides/${materialId}${q}`, '_blank', 'noopener');
}

export function needsPdfPreview(contentType) {
  return ['DOCX', 'XLSX', 'PPTX'].includes(materialTypeLabel(contentType));
}

export function resourceKey(resourceType, resourceId) {
  return `${resourceType}:${resourceId}`;
}

// ===== Папки Базы знаний =====
// Папки не хранятся — считаются из тегов ресурса и мест, где он используется
// (library.py: course_id, sector, places). Путь папки — строка:
// 'all' — «Для всех»; 'ru' — сектор; 'ru/3' — курс; 'ru/3/L5' — «Урок 5»;
// 'ru/3/common' — «Общее». '' — вся база. Используют страница «База знаний»
// и окно выбора из базы в уроке (LibraryPickerModal.jsx).
export const ALL_FOLDER = 'all';

export function folderPaths(item) {
  const places = item.places || [];
  const numbered = places.filter(p => p.lesson_no);
  if (numbered.length) return [...new Set(numbered.map(p => `${p.sector || ''}/${p.course_id}/L${p.lesson_no}`))];
  if (places.length) return [...new Set(places.map(p => `${p.sector || ''}/${p.course_id}/common`))];
  if (item.sector && item.course_id) return [`${item.sector}/${item.course_id}/common`];
  return [ALL_FOLDER];
}

// Лежит ли ресурс в папке (с вложенными)
export function inFolder(paths, folder) {
  if (!folder) return true;
  return paths.some(p => p === folder || p.startsWith(`${folder}/`));
}

// Название курса по ленте БЗ (у ресурса и в местах использования оно есть) —
// когда курса нет в списке курсов пользователя
export function courseTitleFromItems(items, courseId) {
  for (const item of items) {
    if (String(item.course_id) === String(courseId) && item.course_title) return item.course_title;
    const place = (item.places || []).find(pl => String(pl.course_id) === String(courseId) && pl.course_title);
    if (place) return place.course_title;
  }
  return `#${courseId}`;
}

// Подпись последней части пути: «Общее» или «Урок N»
export function leafLabel(leaf) {
  return leaf === 'common' ? 'Общее' : `Урок ${leaf.slice(1)}`;
}

// Порядок папок урока: «Общее», затем уроки по номеру
export function leafOrder(leaf) {
  return leaf === 'common' ? 0 : Number(leaf.slice(1));
}
