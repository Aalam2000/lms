import React, { useEffect, useRef, useState } from 'react';
import SortTh, { sortRows } from '../components/SortTh';
import { useNavigate } from 'react-router-dom';
import DeleteButton from '../components/DeleteButton';
import IconButton from '../components/IconButton';
import { getCourses } from '../api/admin';
import { getSectors } from '../api/academy';
import {
  uploadMaterial, updateMaterialTemplate, bulkUpdateMaterialTemplate, deleteMaterial, openPendingTab, showMaterialInTab,
} from '../api/materials';
import { getLibraryItems } from '../api/library';
import { createLink, deleteLink } from '../api/links';
import { getQuizHtml, deleteQuiz } from '../api/quizzes';
import { useAuth } from '../context/AuthContext';
import { TYPE_META, formatSize, subtypeLabel, resourceKey, needsPdfPreview, isPresentation, openSlides } from '../utils/libraryItems';
import { IconBadgeFile, IconBadgeQuiz, IconBadgeLink } from '../components/TypeBadgeIcons';
function itemKey(item) {
  return resourceKey(item.resource_type, item.id);
}
// Иконка по типу ресурса — SVG в стиле бейджа (белая, 12×12).
function BadgeIcon({ type }) {
  if (type === 'material') return <IconBadgeFile className="type-badge__icon" />;
  if (type === 'quiz') return <IconBadgeQuiz className="type-badge__icon" />;
  if (type === 'link') return <IconBadgeLink className="type-badge__icon" />;
  return null;
}
function KnowledgeBasePage() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const isAdmin = hasRole('admin');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState(''); // '' | material | quiz | link
  const [onlyMine, setOnlyMine] = useState(false);
  // Сортировка — в браузере, кликом по шапке столбца (SortTh). По умолчанию — свежие сверху.
  const [sortKey, setSortKey] = useState('date');
  const [sortDir, setSortDir] = useState('desc'); // asc | desc
  const [openingKey, setOpeningKey] = useState(null);

  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);

  // "Загрузить курс" — массовая загрузка папки как шаблона курса (только
  // admin). См. claude/course-templates-plan.md.
  const [showCourseUpload, setShowCourseUpload] = useState(false);
  const [courses, setCourses] = useState([]);
  const [coursesLoaded, setCoursesLoaded] = useState(false);
  const [sectors, setSectors] = useState([]); // справочник секторов: [{code, name}]
  const [courseId, setCourseId] = useState('');
  const [courseSector, setCourseSector] = useState('');
  const [courseRows, setCourseRows] = useState([]); // [{file, relPath, lessonNo}]
  const [isUploadingCourse, setIsUploadingCourse] = useState(false);
  const [courseUploadProgress, setCourseUploadProgress] = useState(null); // {done, total, failed}
  const [courseUploadError, setCourseUploadError] = useState('');
  const [courseUploadFailures, setCourseUploadFailures] = useState([]); // [{name, reason}]
  // Что произошло при загрузке: загружен / заменён / без изменений
  const [uploadNotice, setUploadNotice] = useState('');
  const courseFolderInputRef = useRef(null);

  // Фильтры по курсу/сектору в базе знаний — только admin, для проверки/
  // утверждения пакета шаблонных материалов. См. course-templates-plan.md.
  const [filterCourseId, setFilterCourseId] = useState('');
  const [filterSector, setFilterSector] = useState('');
  const [bulkTemplateSaving, setBulkTemplateSaving] = useState(false);
  const [savingTemplateKey, setSavingTemplateKey] = useState(null);

  // Материалы шаблонов уроков курса по умолчанию скрыты — мешают в
  // обычной работе с БЗ; этот флажок их показывает (см. library.py).
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line
  }, [typeFilter, onlyMine, filterCourseId, filterSector, showTemplates]);

  useEffect(() => {
    if (isAdmin) ensureCoursesLoaded();
    // eslint-disable-next-line
  }, [isAdmin]);

  const loadItems = async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (typeFilter) params.type = typeFilter;
      if (onlyMine && user) params.uploader = user.id;
      if (isAdmin && filterCourseId) params.course_id = filterCourseId;
      if (isAdmin && filterSector) params.sector = filterSector;
      if (showTemplates) params.include_templates = true;
      setItems(await getLibraryItems(params));
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось загрузить базу знаний');
    } finally {
      setLoading(false);
    }
  };

  // Кнопка сама открывает системный проводник (клик по скрытому input) —
  // выбор файла сразу запускает загрузку, без промежуточного шага.
  const handlePickFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError('');
    setUploadNotice('');
    try {
      // Имя новое — новый файл; то же имя и другое содержимое — замена;
      // то же имя и то же содержимое — ничего не меняется (см. api/materials.js)
      const res = await uploadMaterial(file);
      if (res.upload_result === 'replaced') {
        setUploadNotice(`Файл «${file.name}» заменён новой версией`);
      } else if (res.upload_result === 'unchanged') {
        setUploadNotice(`Файл «${file.name}» уже есть в Базе знаний, изменений нет`);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      loadItems();
    } catch (err) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setError(err?.response?.data?.detail || 'Не удалось загрузить файл');
    } finally {
      setIsUploading(false);
    }
  };

  const handleAddLink = async () => {
    if (!linkTitle.trim() || !linkUrl.trim()) return;

    setIsAddingLink(true);
    setError('');
    try {
      await createLink(linkTitle.trim(), linkUrl.trim());
      setLinkTitle('');
      setLinkUrl('');
      setShowLinkForm(false);
      loadItems();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось добавить ссылку');
    } finally {
      setIsAddingLink(false);
    }
  };

  // Номер урока из имени файла: "Урок 5.2 — ....html" -> "5.2",
  // "Урок 5.docx" -> "5", азербайджанский сектор: "Dərs 5.2 — ....html" -> "5.2". Папка вокруг файла (её название) не участвует —
  // источник номера всегда само имя файла. Не распознано — пусто,
  // admin вводит вручную в предпросмотре (загрузка ничего не блокирует).
  const parseLessonNo = (filename) => {
    const m = filename.match(/(?:урок|d[əƏe]rs)\s*№?\s*(\d+)(?:[.\-_](\d+))?/i);
    if (!m) return '';
    return m[2] ? `${m[1]}.${m[2]}` : m[1];
  };

  // Список курсов нужен и загрузчику, и фильтрам БЗ — грузим один раз.
  const ensureCoursesLoaded = async () => {
    if (coursesLoaded) return;
    try {
      const [data, sectorList] = await Promise.all([getCourses(), getSectors()]);
      setCourses(data);
      setSectors(sectorList);
      setCoursesLoaded(true);
    } catch (err) {
      setCourseUploadError(err?.response?.data?.detail || 'Не удалось загрузить список курсов');
    }
  };

  const handleOpenCourseUpload = () => {
    setShowCourseUpload(v => !v);
    setCourseUploadError('');
    setCourseUploadFailures([]);
    ensureCoursesLoaded();
  };

  const handleCourseFolderSelected = (e) => {
    const files = Array.from(e.target.files || []);
    const rows = files.map(file => ({
      file,
      relPath: file.webkitRelativePath || file.name,
      lessonNo: parseLessonNo(file.name),
    }));
    setCourseRows(rows);
    setCourseUploadProgress(null);
    setCourseUploadError('');
    setCourseUploadFailures([]);
  };

  const updateCourseRowLessonNo = (index, value) => {
    setCourseRows(prev => prev.map((row, i) => i === index ? { ...row, lessonNo: value } : row));
  };

  const handleConfirmCourseUpload = async () => {
    if (!courseId || !courseSector || courseRows.length === 0) return;
    setIsUploadingCourse(true);
    setCourseUploadError('');
    setCourseUploadFailures([]);
    setUploadNotice('');
    const total = courseRows.length;
    let done = 0;
    let failed = 0;
    const counts = { created: 0, replaced: 0, unchanged: 0 };
    const failures = [];
    setCourseUploadProgress({ done, total, failed });
    // Имя в Базе знаний — без папок: одинаковые имена из разных подпапок
    // затёрли бы друг друга, такие файлы не загружаем.
    const nameCounts = {};
    for (const row of courseRows) nameCounts[row.file.name] = (nameCounts[row.file.name] || 0) + 1;
    for (const row of courseRows) {
      try {
        if (nameCounts[row.file.name] > 1) {
          throw { response: { data: { detail: 'В выбранной папке несколько файлов с таким именем — переименуйте' } } };
        }
        const res = await uploadMaterial(row.file, {
          course_id: courseId,
          sector: courseSector,
          template_lesson_no: row.lessonNo.trim() || null,
        });
        const kind = counts[res.upload_result] !== undefined ? res.upload_result : 'created';
        counts[kind] += 1;
      } catch (err) {
        failed += 1;
        failures.push({
          name: row.relPath,
          reason: err?.response?.data?.detail || 'Не удалось загрузить файл',
        });
      }
      done += 1;
      setCourseUploadProgress({ done, total, failed });
    }
    setIsUploadingCourse(false);
    // Итог пакета: новые / заменённые / без изменений / не загруженные
    const summary = `Загружено новых: ${counts.created}, заменено: ${counts.replaced}, `
      + `без изменений: ${counts.unchanged}, не загружено: ${failed}`;
    // Панель закрываем всегда; итог и список отказов остаются над таблицей
    setCourseRows([]);
    setCourseId('');
    setCourseSector('');
    setShowCourseUpload(false);
    if (courseFolderInputRef.current) courseFolderInputRef.current.value = '';
    if (failed === 0) {
      setUploadNotice(summary);
    } else {
      setCourseUploadError(summary);
      setCourseUploadFailures(failures);
    }
    loadItems();
  };

  // Окно под файл/квиз открываем сразу, синхронно по клику — если открыть
  // его уже после await, браузер считает это всплывающим окном не по
  // действию пользователя и блокирует.
  const handleOpen = async (item) => {
    setError('');

    if (item.resource_type === 'link') {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (item.resource_type === 'material' && isPresentation(item.content_type)) {
      openSlides(item.id, item.title);
      return;
    }

    const key = itemKey(item);
    setOpeningKey(key);
    const win = openPendingTab(item.resource_type === 'material' && needsPdfPreview(item.content_type));
    try {
      if (item.resource_type === 'material') {
        await showMaterialInTab(win, item.id, item.content_type);
      } else {
        const quiz = await getQuizHtml(item.id);
        if (win) {
          win.document.write(quiz.html);
          win.document.close();
        }
      }
    } catch (err) {
      if (win) win.close();
      setError(err?.response?.data?.detail || 'Не удалось открыть');
    } finally {
      setOpeningKey(null);
    }
  };

  // Массовое решение по всему пакету материалов курса+сектора (оба фильтра
  // должны быть выбраны) — см. course-templates-plan.md.
  const handleBulkTemplateStatus = async (status) => {
    if (!filterCourseId || !filterSector) return;
    setBulkTemplateSaving(true);
    setError('');
    try {
      await bulkUpdateMaterialTemplate({ course_id: filterCourseId, sector: filterSector, template_status: status });
      loadItems();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось обновить статус пакета');
    } finally {
      setBulkTemplateSaving(false);
    }
  };

  // Решение по одному файлу — независимо от массового.
  const handleSetMaterialTemplateStatus = async (item, status) => {
    const key = itemKey(item);
    setSavingTemplateKey(key);
    setError('');
    try {
      await updateMaterialTemplate(item.id, { template_status: status });
      loadItems();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось обновить статус');
    } finally {
      setSavingTemplateKey(null);
    }
  };

  // Право удалять (где используется — проверяет сама DeleteButton)
  const canDelete = (item) => {
    if (item.resource_type === 'quiz') return isAdmin || item.uploaded_by === user?.id;
    return isAdmin; // файлы и ссылки — только admin
  };

  const DELETE_FN = { material: deleteMaterial, quiz: deleteQuiz, link: deleteLink };
  const DELETE_TIP = { material: 'Удалить файл', quiz: 'Удалить квиз', link: 'Удалить ссылку' };

  const columnCount = 9;

  // Сортировка кликом по шапке. Текстовые столбцы — от А до Я, дата и «В уроках» — сначала большие.
  const TEXT_KEYS = ['type', 'course', 'title', 'uploader'];
  const sortValue = (item, key) => {
    if (key === 'type') return subtypeLabel(item);
    if (key === 'course') return (item.attached_courses || []).join(', ');
    if (key === 'title') return item.title || '';
    if (key === 'uploader') return item.uploaded_by_name || '';
    if (key === 'date') return new Date(item.created_at).getTime();
    if (key === 'lessons') return item.attached_lessons_count > 0 ? item.attached_lessons_count : null;
    return null;
  };
  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(TEXT_KEYS.includes(key) ? 'asc' : 'desc');
    }
  };
  const sortedItems = sortRows(items, sortKey, sortDir, sortValue, TEXT_KEYS, item => item.title);
  const sortTh = (key, label, tip) => (
    <SortTh k={key} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} tip={tip}>{label}</SortTh>
  );

  return (
    <div className="page">
      <div className="toolbar toolbar--underline-row">
        <div className="toolbar__filters">
          <button type="button" className={`tab tab--underline${typeFilter === '' ? ' tab--active' : ''}`} onClick={() => setTypeFilter('')}>
            {'Все'}
          </button>
          <button type="button" className={`tab tab--underline${typeFilter === 'material' ? ' tab--active' : ''}`} onClick={() => setTypeFilter('material')}>
            {'Файлы'}
          </button>
          <button type="button" className={`tab tab--underline${typeFilter === 'link' ? ' tab--active' : ''}`} onClick={() => setTypeFilter('link')}>
            {'Ссылки'}
          </button>
          <button type="button" className={`tab tab--underline${typeFilter === 'quiz' ? ' tab--active' : ''}`} onClick={() => setTypeFilter('quiz')}>
            {'Квизы'}
          </button>
        </div>
        <div className="toolbar__filters">
          <button type="button" className={`tab tab--underline${onlyMine ? ' tab--active' : ''}`} onClick={() => setOnlyMine(v => !v)}>
            {'Моё'}
          </button>
          <label className="checkbox-row">
            <input type="checkbox" checked={showTemplates} onChange={e => setShowTemplates(e.target.checked)} />
            {'Показывать материалы из шаблонов уроков'}
          </label>
          {isAdmin && (
            <>
              <select className="input input--min160" value={filterCourseId} onChange={e => setFilterCourseId(e.target.value)}>
                <option value="">{'Курс: все'}</option>
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <select className="input input--min160" value={filterSector} onChange={e => setFilterSector(e.target.value)}>
                <option value="">{'Сектор: все'}</option>
                {sectors.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {isAdmin && filterCourseId && filterSector && (
        <div className="form-toolbar">
          <span>{'Пакет материалов курса — решение разом:'}</span>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => handleBulkTemplateStatus('approved')} disabled={bulkTemplateSaving}>
            {'Одобрить пакет'}
          </button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => handleBulkTemplateStatus('rejected')} disabled={bulkTemplateSaving}>
            {'Заблокировать пакет'}
          </button>
        </div>
      )}

      <div className="form-toolbar">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelected}
          hidden
        />
        <button type="button" className="btn" onClick={handlePickFile} disabled={isUploading}>
          {isUploading ? 'Загрузка...' : 'Загрузить файл'}
        </button>
        <button type="button" className="btn btn--outline" onClick={() => setShowLinkForm(v => !v)}>
          {'+ Добавить ссылку'}
        </button>
        <button type="button" className="btn btn--outline" onClick={() => navigate('/dashboard/add-quiz')}>
          {'+ Создать квиз'}
        </button>
        {isAdmin && (
          <button type="button" className="btn btn--outline" onClick={handleOpenCourseUpload}>
            {'Загрузить курс'}
          </button>
        )}
      </div>

      {showLinkForm && (
        <div className="form-toolbar">
          <input
            type="text"
            className="input"
            placeholder={'Название ссылки'}
            value={linkTitle}
            onChange={e => setLinkTitle(e.target.value)}
          />
          <input
            type="text"
            className="input"
            placeholder={'https://...'}
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
          />
          <button
            type="button"
            className="btn"
            onClick={handleAddLink}
            disabled={isAddingLink || !linkTitle.trim() || !linkUrl.trim()}
          >
            {isAddingLink ? 'Добавление...' : 'Сохранить'}
          </button>
        </div>
      )}

      {isAdmin && showCourseUpload && (
        <div>
          <div className="form-toolbar">
            <select className="input" value={courseId} onChange={e => setCourseId(e.target.value)}>
              <option value="">{'Курс...'}</option>
              {courses.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            <select className="input" value={courseSector} onChange={e => setCourseSector(e.target.value)}>
              <option value="">{'Направление...'}</option>
              {sectors.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
            </select>
            <input
              type="file"
              ref={courseFolderInputRef}
              onChange={handleCourseFolderSelected}
              webkitdirectory="true"
              directory="true"
              multiple
              hidden
            />
            <button type="button" className="btn" onClick={() => courseFolderInputRef.current?.click()}>
              {'Выбрать папку курса'}
            </button>
          </div>

          {courseRows.length > 0 && (
            <>
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{'Файл'}</th>
                      <th>{'Номер урока'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {courseRows.map((row, i) => (
                      <tr key={row.relPath + i}>
                        <td className="table__cell--truncate" data-tip={row.relPath}>{row.relPath}</td>
                        <td>
                          <input
                            type="text"
                            className="input"
                            value={row.lessonNo}
                            placeholder={'не распознано'}
                            onChange={e => updateCourseRowLessonNo(i, e.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-toolbar">
                <button
                  type="button"
                  className="btn"
                  onClick={handleConfirmCourseUpload}
                  disabled={!courseId || !courseSector || isUploadingCourse}
                >
                  {isUploadingCourse
                    ? `Загрузка ${courseUploadProgress?.done ?? 0} из ${courseUploadProgress?.total ?? courseRows.length}...`
                    : `Загрузить ${courseRows.length} файл(ов)`}
                </button>
              </div>
            </>
          )}

        </div>
      )}

      {courseUploadError && <div className="error-text error-text--muted">{courseUploadError}</div>}
      {courseUploadFailures.length > 0 && (
        <ul className="text-muted">
          {courseUploadFailures.map((f, i) => (
            <li key={f.name + i}>{f.name}{' — '}{f.reason}</li>
          ))}
        </ul>
      )}

      {error && <div className="error-text error-text--muted">{error}</div>}
      {uploadNotice && <p className="text-muted">{uploadNotice}</p>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {sortTh('type', 'Тип')}
              {sortTh('course', 'Курс', 'Курсы, в уроках которых это используется')}
              {sortTh('title', 'Название')}
              <th>{'Детали'}</th>
              {sortTh('uploader', 'Загрузил')}
              {sortTh('date', 'Дата')}
              {sortTh('lessons', 'В уроках')}
              <th>{'Статус'}</th>
              <th>{'Удалить'}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columnCount} className="table__empty">{'Загрузка...'}</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={columnCount} className="table__empty">{'В базе знаний пока пусто'}</td></tr>
            ) : (
              sortedItems.map(item => {
                const meta = TYPE_META[item.resource_type];
                const key = itemKey(item);
                const deletable = canDelete(item);
                return (
                  <tr key={key} className={`table__row--${item.resource_type}`}>
                    <td>
                      <span className={`type-badge type-badge--${item.resource_type}`}>
                        <BadgeIcon type={item.resource_type} />
                        {subtypeLabel(item)}
                      </span>
                      {item.is_homework && (
                        <span className="badge badge--homework badge--inline" data-tip={'Используется как ДЗ в уроке'}>{'ДЗ'}</span>
                      )}
                    </td>
                    <td>
                      {/* Курсы, в уроках которых ресурс используется — чтобы понимать, где он может понадобиться */}
                      {item.attached_courses?.length > 0 ? (
                        <span className="table__cell--truncate" data-tip={item.attached_courses.join(', ')}>
                          {item.attached_courses.join(', ')}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      <button type="button" className="link" onClick={() => handleOpen(item)} disabled={openingKey === key}>
                        {openingKey === key ? `${item.title} — открываем...` : item.title}
                      </button>
                    </td>
                    <td className="nowrap">
                      {item.resource_type === 'material' && formatSize(item.size_bytes || 0)}
                      {item.resource_type === 'quiz' && (item.topic || '—')}
                      {item.resource_type === 'link' && (
                        <span className="table__cell--truncate" data-tip={item.url}>{item.url}</span>
                      )}
                    </td>
                    <td>{item.uploaded_by_name || '—'}</td>
                    <td className="nowrap">{new Date(item.created_at).toLocaleDateString('ru-RU')}</td>
                    <td className="nowrap">{item.attached_lessons_count > 0 ? item.attached_lessons_count : '—'}</td>
                    <td className="nowrap">
                      {isAdmin && item.resource_type === 'material' && item.template_lesson_no ? (
                        <>
                          {item.template_status === 'approved' ? 'Одобрено'
                            : item.template_status === 'rejected' ? 'Отклонено'
                            : 'На проверке'}
                          {' '}
                          <button
                            type="button"
                            className="btn btn--sm"
                            data-tip={'Одобрить'}
                            onClick={() => handleSetMaterialTemplateStatus(item, 'approved')}
                            disabled={savingTemplateKey === key || item.template_status === 'approved'}
                          >
                            {'✅'}
                          </button>
                          <button
                            type="button"
                            className="btn btn--sm"
                            data-tip={'Заблокировать'}
                            onClick={() => handleSetMaterialTemplateStatus(item, 'rejected')}
                            disabled={savingTemplateKey === key || item.template_status === 'rejected'}
                          >
                            {'🚫'}
                          </button>
                        </>
                      ) : '—'}
                    </td>
                    <td>
                      <div className="icon-row">
                      {/* Редактор квиза (AddQuizPage): автор или admin — то же право, что на удаление */}
                      {item.resource_type === 'quiz' && (
                        <IconButton
                          icon="edit"
                          disabled={!deletable}
                          tip={deletable ? 'Редактировать квиз' : 'Редактировать может только автор или администратор'}
                          onClick={() => navigate(`/dashboard/add-quiz/${item.id}`)}
                        />
                      )}
                      {deletable ? (
                        <DeleteButton
                          entity={item.resource_type}
                          id={item.id}
                          name={item.title}
                          tip={DELETE_TIP[item.resource_type]}
                          onDelete={() => DELETE_FN[item.resource_type](item.id)}
                          onDeleted={() => setItems(prev => prev.filter(i => itemKey(i) !== key))}
                          onError={setError}
                        />
                      ) : (
                        <IconButton
                          icon="delete"
                          disabled
                          tip={item.resource_type === 'quiz'
                            ? 'Удалить может только автор или администратор'
                            : 'Удалить может только администратор'}
                        />
                      )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default KnowledgeBasePage;
