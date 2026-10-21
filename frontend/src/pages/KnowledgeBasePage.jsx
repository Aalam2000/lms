import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DeleteButton from '../components/DeleteButton';
import LibrarySearch, { EMPTY_FILTERS } from '../components/LibrarySearch';
import { getCourses, getMyGroups } from '../api/groups';
import { getSectors } from '../api/academy';
import {
  uploadMaterial, updateMaterialTemplate, bulkUpdateMaterialTemplate, deleteMaterial, openPendingTab, showMaterialInTab,
} from '../api/materials';
import { getLibraryItems, setFolderTags } from '../api/library';
import { createLink, deleteLink } from '../api/links';
import { getQuizHtml, deleteQuiz } from '../api/quizzes';
import { useAuth } from '../context/AuthContext';
import { usePref } from '../hooks/usePref';
import { resourceKey, needsPdfPreview, isPresentation, openSlides, ALL_FOLDER } from '../utils/libraryItems';

function itemKey(item) {
  return resourceKey(item.resource_type, item.id);
}

// «База знаний»: загрузка (файл, ссылка, квиз, курс — админ) и поиск по базе
// (components/LibrarySearch.jsx). Фильтры поиска — в профиле (kb.filters);
// педагог по умолчанию видит свои курсы.
function KnowledgeBasePage() {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const isAdmin = hasRole('admin');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = usePref('kb.filters', isAdmin ? EMPTY_FILTERS : { ...EMPTY_FILTERS, course: 'mine' });
  const [myPairs, setMyPairs] = useState(null); // Set('ru/3') — сектор/курс групп педагога
  // Правка сектора и курса выбранного материала
  const [tagEditKey, setTagEditKey] = useState(null);
  const [tagCourseId, setTagCourseId] = useState('');
  const [tagSector, setTagSector] = useState('');
  const [tagSaving, setTagSaving] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);

  // "Загрузить курс" — массовая загрузка папки как шаблона курса (только admin)
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

  // Решение по пакету шаблона курса — админ, когда в фильтрах выбраны сектор и курс
  const packSector = filters.sector && filters.sector !== ALL_FOLDER ? filters.sector : '';
  const packCourseId = filters.course && filters.course !== 'mine' ? filters.course : '';
  const [bulkTemplateSaving, setBulkTemplateSaving] = useState(false);
  const [savingTemplateKey, setSavingTemplateKey] = useState(null);

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line
  }, []);

  // Курсы и секторы — для имён и правки тегов; группы педагога — для «Мои курсы»
  useEffect(() => {
    ensureCoursesLoaded();
    if (!isAdmin) {
      getMyGroups()
        .then(groups => setMyPairs(new Set(groups.map(g => `${g.sector || ''}/${g.course_id}`))))
        .catch(() => setMyPairs(new Set()));
    }
    // eslint-disable-next-line
  }, [isAdmin]);

  const loadItems = async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await getLibraryItems({}));
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
    }
  };

  // Массовое решение по всему пакету материалов курса+сектора (оба фильтра
  // должны быть выбраны) — см. course-templates-plan.md.
  const handleBulkTemplateStatus = async (status) => {
    if (!packCourseId || !packSector) return;
    setBulkTemplateSaving(true);
    setError('');
    try {
      await bulkUpdateMaterialTemplate({ course_id: packCourseId, sector: packSector, template_status: status });
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

  // Права на действия с материалом
  const canDelete = (item) => {
    if (item.resource_type === 'quiz') return isAdmin || item.uploaded_by === user?.id;
    return isAdmin; // файлы и ссылки — только admin
  };
  const canTag = (item) => isAdmin || item.uploaded_by === user?.id;

  const DELETE_FN = { material: deleteMaterial, quiz: deleteQuiz, link: deleteLink };
  const DELETE_TIP = { material: 'Удалить файл', quiz: 'Удалить квиз', link: 'Удалить ссылку' };

  const sectorName = (code) => sectors.find(sec => sec.code === code)?.name || code;
  const courseTitle = (id) => courses.find(c => String(c.id) === String(id))?.title
    || items.find(i => String(i.course_id) === String(id))?.course_title || `#${id}`;

  const startTagEdit = (item) => {
    setTagEditKey(itemKey(item));
    setTagCourseId(item.course_id ? String(item.course_id) : '');
    setTagSector(item.sector || '');
  };
  const saveTags = async (item) => {
    setTagSaving(true);
    setError('');
    try {
      const saved = await setFolderTags(item.resource_type, item.id, { course_id: tagCourseId ? Number(tagCourseId) : null, sector: tagSector });
      setItems(prev => prev.map(i => (itemKey(i) === itemKey(item)
        ? { ...i, course_id: saved.course_id, sector: saved.sector, course_title: saved.course_id ? courseTitle(saved.course_id) : null }
        : i)));
      setTagEditKey(null);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось сохранить сектор и курс');
    } finally {
      setTagSaving(false);
    }
  };

  // Под просмотром: сектор и курс (с правкой) и статус шаблона (админ)
  const renderExtra = (item) => (
    <>
      {tagEditKey === itemKey(item) ? (
        <div className="kbs__tags">
          <select className="input" value={tagSector} onChange={e => setTagSector(e.target.value)}>
            <option value="">{'Сектор...'}</option>
            {sectors.map(sec => <option key={sec.code} value={sec.code}>{sec.name}</option>)}
          </select>
          <select className="input" value={tagCourseId} onChange={e => setTagCourseId(e.target.value)}>
            <option value="">{'Курс...'}</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button type="button" className="btn btn--sm" onClick={() => saveTags(item)}
            disabled={tagSaving || !tagSector !== !tagCourseId}>{'Сохранить'}</button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => setTagEditKey(null)}>{'Отмена'}</button>
        </div>
      ) : (
        <div className="kbs__tags">
          <span>{'Сектор и курс:'}</span>
          <b>{item.sector && item.course_id ? `${sectorName(item.sector)}, ${courseTitle(item.course_id)}` : 'не заданы'}</b>
          {canTag(item) && (
            <button type="button" className="link" onClick={() => startTagEdit(item)}>{'Изменить'}</button>
          )}
        </div>
      )}
      {isAdmin && item.resource_type === 'material' && item.template_lesson_no && (
        <div className="kbs__tags">
          <span>{`Шаблон, урок ${item.template_lesson_no}:`}</span>
          <b>
            {item.template_status === 'approved' ? 'Одобрено'
              : item.template_status === 'rejected' ? 'Отклонено'
              : 'На проверке'}
          </b>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => handleSetMaterialTemplateStatus(item, 'approved')}
            disabled={savingTemplateKey === itemKey(item) || item.template_status === 'approved'}>{'Одобрить'}</button>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => handleSetMaterialTemplateStatus(item, 'rejected')}
            disabled={savingTemplateKey === itemKey(item) || item.template_status === 'rejected'}>{'Заблокировать'}</button>
        </div>
      )}
    </>
  );

  // Кнопки под просмотром — на странице «Добавить в урок» нет
  const renderActions = (item) => {
    const deletable = canDelete(item);
    return (
      <>
        <button type="button" className="btn" onClick={() => handleOpen(item)}>{'Открыть'}</button>
        {item.resource_type === 'quiz' && deletable && (
          <button type="button" className="btn btn--outline" onClick={() => navigate(`/dashboard/add-quiz/${item.id}`)}>
            {'Редактировать'}
          </button>
        )}
        {deletable && (
          <DeleteButton
            entity={item.resource_type}
            id={item.id}
            name={item.title}
            tip={DELETE_TIP[item.resource_type]}
            onDelete={() => DELETE_FN[item.resource_type](item.id)}
            onDeleted={() => setItems(prev => prev.filter(i => itemKey(i) !== itemKey(item)))}
            onError={setError}
          />
        )}
      </>
    );
  };

  return (
    <div className="page">
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

      {isAdmin && packSector && packCourseId && (
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

      <LibrarySearch
        items={items}
        loading={loading}
        filters={{ ...EMPTY_FILTERS, ...filters }}
        onFiltersChange={setFilters}
        sectors={sectors}
        courses={courses}
        myPairs={myPairs}
        userId={user?.id}
        onActivate={handleOpen}
        activateHint={'открыть'}
        renderActions={renderActions}
        renderExtra={renderExtra}
        emptyText={items.length ? 'Ничего не найдено' : 'В базе знаний пока пусто'}
      />
    </div>
  );
}

export default KnowledgeBasePage;
