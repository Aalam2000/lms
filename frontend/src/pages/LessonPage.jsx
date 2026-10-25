import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { useBack } from '../hooks/useBack';
import DateTimePicker, { formatDateTime } from '../components/DateTimePicker';
import { formatDuration, DEFAULT_DURATION_MIN } from '../utils/lessonTime';
import LibraryPickerModal from '../components/LibraryPickerModal';
import Avatar from '../components/Avatar';
import LessonSourcesModal from '../components/LessonSourcesModal';
import TrashIcon from '../components/TrashIcon';
import IconButton from '../components/IconButton';
import { PersonalBadge, ParticipantsModal } from '../components/PersonalLesson';
import { TYPE_META, formatSize, subtypeLabel, resourceKey, needsPdfPreview, isPresentation, openSlides } from '../utils/libraryItems';
import { extractErrorMessage } from '../utils/errors';
import { StudentContactIcons, GroupContactIcons } from '../components/ContactIcons';
import { subscribeLessonMarksUpdated } from '../utils/lessonMarksChannel';
import { HomeworkAddModal, HomeworkFlags, HomeworkCheckView, ReviewPanel, AiBatchModal, personalOrCommonDeadline } from '../components/HomeworkTeacher';
import { DialogCell } from '../components/LessonDialog';
import { getHomeworkBoard } from '../api/homework';
import { getWorkBoard } from '../api/lessonWork';
import { useHomeworkRefresh } from '../hooks/useHomeworkRefresh';
import { uploadMaterial, openPendingTab, showMaterialInTab } from '../api/materials';
import {
  getLesson, getLessonMarks, saveLessonMark, saveLessonMarksBulk, updateLesson, openLesson, deleteLesson,
  getLessonItems, attachLessonItem, detachLessonItem, getLessonRooms, setLessonRoom,
} from '../api/lessons';
import Modal from '../components/Modal';
import { getMyGroups } from '../api/groups';
import { getQuizViewUrl } from '../api/quizzes';
import { openLiveQuiz } from '../api/quizLive';
import { createLink } from '../api/links';

// 409 от бэкенда при контроле дублей: code=duplicate — вернуть existing_id;
// code=name_taken — имя занято чужим файлом, показать как ошибку.
const conflictOf = (err) => (err?.response?.status === 409 ? err.response.data : null);

// Кружки посещаемости вместо select'а. Пришёл/Онлайн/Уважительная —
// взаимоисключающие («ИЛИ», attendance_status), «Опоздал» — независимый
// модификатор («И» поверх Пришёл или Онлайн: is_late), недоступен при
// Уважительной причине и при отсутствии отметки (см. решение Андрея,
// 2026-09-15). Если не выбрано ничего из первых трёх — считаем пропуском.
const ATTENDANCE_STATUS_BUTTONS = [
  { kind: 'in_person', status: 'in_person', label: 'Пришёл' },
  { kind: 'online', status: 'online', label: 'Онлайн' },
  { kind: 'excused', status: 'excused', label: 'Уважительная причина' },
];
const LATE_STATUSES = new Set(['in_person', 'online']);

function LessonPage() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const back = useBack();
  const location = useLocation();

  // ?view=students — сразу журнал (ссылка «Проверь работы» из шапки)
  const [view, setView] = useState(() => (new URLSearchParams(location.search).get('view') === 'students' ? 'students' : 'lesson'));
  useEffect(() => {
    if (new URLSearchParams(location.search).get('view') === 'students') setView('students');
  }, [location.key, location.search]);

  const [lesson, setLesson] = useState(null);
  // Выбор аудитории урока: null — окно закрыто
  const [roomChoice, setRoomChoice] = useState(null);
  const [roomError, setRoomError] = useState('');
  const [participantsOpen, setParticipantsOpen] = useState(false); // смена участников персонального урока
  const [groups, setGroups] = useState([]);
  const [dateValue, setDateValue] = useState(null);
  const [durationValue, setDurationValue] = useState(DEFAULT_DURATION_MIN); // мин, правится в том же попапе, что и дата
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isSavingDate, setIsSavingDate] = useState(false);
  const [isTogglingOpen, setIsTogglingOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lessonComment, setLessonComment] = useState('');
  const [isSavingComment, setIsSavingComment] = useState(false);
  // «Заметки для себя» — видят только педагог и админ (lessons.private_note)
  const [privateNote, setPrivateNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);

  const [marksLoading, setMarksLoading] = useState(false);
  const [marksLoaded, setMarksLoaded] = useState(false);
  const [marksError, setMarksError] = useState('');
  const [marksLocked, setMarksLocked] = useState(false);
  const [marksRows, setMarksRows] = useState([]);
  const [rowErrors, setRowErrors] = useState({});
  const [isSavingAll, setIsSavingAll] = useState(false);
  const marksRowsRef = useRef([]);

  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsError, setItemsError] = useState('');
  const [lessonItems, setLessonItems] = useState([]);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showSourcesModal, setShowSourcesModal] = useState(false); // «Из урока» — материалы другого урока
  const [detachingKey, setDetachingKey] = useState(null);
  const [openingKey, setOpeningKey] = useState(null);

  const [isUploadingMaterial, setIsUploadingMaterial] = useState(false);
  const materialInputRef = useRef(null);

  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [isAddingLink, setIsAddingLink] = useState(false);

  // ДЗ: загрузка файла сразу как ДЗ (+ «Кому») и список студентов для «Кому»
  // ДЗ (схема v2): задания урока + по каждому студенту статусы/оценки и диалог
  const [hwBoard, setHwBoard] = useState({ tasks: [], students: [], to_review: 0 });
  const [hwAddOpen, setHwAddOpen] = useState(false);
  const [hwAddFor, setHwAddFor] = useState(null); // строка студента — персональный файл в ДЗ
  // «Проверить ДЗ»: таблица перестраивается под приём и оценку ДЗ
  const [hwCheckMode, setHwCheckMode] = useState(false);
  const [itemsNotice, setItemsNotice] = useState('');
  // Работа на уроке (api/lessonWork.js): файлы учеников и их проверка — колонка «Файлы с урока»
  const [workBoard, setWorkBoard] = useState({ students: [], to_review: 0 });
  const [workPanel, setWorkPanel] = useState(null); // { studentId, fileId } — окно проверки
  // «Проверка ИИ» работ на уроке пакетом; черновики — здесь, чтобы закрытое окно их не теряло
  const [aiBatchOpen, setAiBatchOpen] = useState(false);
  const [aiDrafts, setAiDrafts] = useState({});

  useEffect(() => {
    marksRowsRef.current = marksRows;
  }, [marksRows]);

  useEffect(() => {
    // Смена урока (переход по ссылке без ремаунта компонента) — сбрасываем
    // кэш вкладок «Студенты»/«Урок», иначе показывались бы данные
    // предыдущего урока, пока не потрогать их руками.
    setMarksLoaded(false);
    setItemsLoaded(false);
    setAiDrafts({});
    setAiBatchOpen(false);

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [lessonData, groupsData] = await Promise.all([getLesson(lessonId), getMyGroups()]);
        setLesson(lessonData);
        setGroups(groupsData);
        setDateValue(lessonData?.date ? new Date(lessonData.date) : null);
        setDurationValue(lessonData?.duration_min || DEFAULT_DURATION_MIN);
        setLessonComment(lessonData?.comment || '');
        setPrivateNote(lessonData?.teacher_notes || '');
      } catch (err) {
        setError(extractErrorMessage(err, 'Не удалось загрузить урок'));
      } finally {
        setLoading(false);
      }
    };

    load();
    loadWork();
    // eslint-disable-next-line
  }, [lessonId]);

  useEffect(() => {
    if (view === 'students' && !marksLoaded) {
      loadMarks();
    }
    if (view === 'lesson' && !itemsLoaded) {
      loadItems();
    }
    // eslint-disable-next-line
  }, [view, lessonId]);

  // Сигнал от вкладки живого квиза-«Экзамен» (та же группа браузера) — как
  // только там записалась оценка, подтягиваем табличку здесь заново, не
  // дожидаясь ручной перезагрузки страницы.
  useEffect(() => {
    return subscribeLessonMarksUpdated((updatedLessonId) => {
      if (String(updatedLessonId) === String(lessonId)) {
        loadMarks();
      }
    });
    // eslint-disable-next-line
  }, [lessonId]);

  const loadMarks = async () => {
    setMarksLoading(true);
    setMarksError('');
    try {
      const [marks] = await Promise.all([getLessonMarks(lessonId), loadHomework()]);
      setMarksLocked(marks.locked);
      setMarksRows(marks.students.map(s => ({
        student_id: s.student_id,
        full_name: s.full_name,
        photo_url: s.photo_url,
        telegram_username: s.telegram_username,
        whatsapp: s.whatsapp,
        phone: s.phone,
        attendance_status: s.attendance_status || '',
        is_late: !!s.is_late,
        score: s.score === null || s.score === undefined ? '' : s.score,
        exam_score: s.exam_score === null || s.exam_score === undefined ? '' : s.exam_score,
        stars: s.stars || 0,
        comment: s.comment || '',
      })));
      setMarksLoaded(true);
    } catch (err) {
      setMarksError(extractErrorMessage(err, 'Не удалось загрузить студентов'));
    } finally {
      setMarksLoading(false);
    }
  };

  // Тихо (без «Загрузка...»): вызывается и после каждой правки ДЗ/диалога
  const loadHomework = async () => {
    try {
      setHwBoard(await getHomeworkBoard(lessonId));
    } catch (err) {
      setMarksError(extractErrorMessage(err, 'Не удалось загрузить домашние задания'));
    }
  };
  // Новые решения учеников появляются в журнале сами
  useHomeworkRefresh(() => { getHomeworkBoard(lessonId).then(setHwBoard).catch(() => {}); });

  // Работа на уроке — тихо, без «Загрузка...»; новые файлы учеников появляются сами
  const loadWork = () => getWorkBoard(lessonId).then(setWorkBoard).catch(() => {});
  useHomeworkRefresh(loadWork);

  // После проверки работы оценка за урок могла измениться — подтягиваем оценки
  // в таблицу тихо, не трогая остальные поля, которые педагог может сейчас править
  const reloadScores = async () => {
    try {
      const marks = await getLessonMarks(lessonId);
      const scores = Object.fromEntries(marks.students.map(s => [s.student_id, s.score]));
      setMarksRows(prev => prev.map(r => (r.student_id in scores
        ? { ...r, score: scores[r.student_id] === null || scores[r.student_id] === undefined ? '' : scores[r.student_id] }
        : r)));
    } catch {
      // оценки обновятся при следующем открытии журнала
    }
  };
  const onWorkReviewed = async () => {
    await Promise.all([loadWork(), reloadScores()]);
  };

  const loadItems = async () => {
    setItemsLoading(true);
    setItemsError('');
    try {
      setLessonItems(await getLessonItems(lessonId));
      setItemsLoaded(true);
    } catch (err) {
      setItemsError(extractErrorMessage(err, 'Не удалось загрузить материалы'));
    } finally {
      setItemsLoading(false);
    }
  };

  // Окно под файл/квиз открываем сразу, синхронно по клику — если открыть
  // его уже после await, браузер считает это всплывающим окном не по
  // действию пользователя и блокирует.
  const handleOpenItem = async (item) => {
    setItemsError('');

    if (item.resource_type === 'link') {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (item.resource_type === 'material' && isPresentation(item.content_type)) {
      openSlides(item.resource_id, item.title);
      return;
    }

    const key = resourceKey(item.resource_type, item.resource_id);
    setOpeningKey(key);
    const win = openPendingTab(item.resource_type === 'material' && needsPdfPreview(item.content_type));
    try {
      if (item.resource_type === 'material') {
        await showMaterialInTab(win, item.resource_id, item.content_type);
      } else if (item.resource_type === 'quiz' && item.template_type === 'live') {
        // Живой квиз — не статичный HTML, а страница хоста: открываем игру
        // на бэкенде и переводим уже открытую вкладку на неё.
        const game = await openLiveQuiz(item.resource_id, Number(lessonId));
        if (win) win.location.href = `/quiz-live/${game.code}/host`;
      } else {
        // Квиз — по ссылке изолированного просмотра (api/view.js)
        const url = await getQuizViewUrl(item.resource_id);
        if (win) win.location.href = url;
      }
    } catch (err) {
      if (win) win.close();
      setItemsError(extractErrorMessage(err, 'Не удалось открыть'));
    } finally {
      setOpeningKey(null);
    }
  };

  const handleDetachItem = async (item) => {
    const key = resourceKey(item.resource_type, item.resource_id);
    setDetachingKey(key);
    setItemsError('');
    try {
      await detachLessonItem(lessonId, item.resource_type, item.resource_id);
      setLessonItems(prev => prev.filter(i => resourceKey(i.resource_type, i.resource_id) !== key));
    } catch (err) {
      setItemsError(extractErrorMessage(err, 'Не удалось открепить'));
    } finally {
      setDetachingKey(null);
    }
  };

  // Загрузить новый файл и сразу привязать к уроку (в библиотеке он тоже
  // остаётся — как и всё в «Базе знаний»)
  const handlePickMaterial = () => materialInputRef.current?.click();

  const handleUploadMaterial = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingMaterial(true);
    setItemsError('');
    setItemsNotice('');
    try {
      let materialId;
      try {
        // Имя файла уникально по всей БЗ: то же имя с другим содержимым —
        // замена своей версии, то же имя и содержимое — берём существующий
        // (см. api/materials.js). В любом случае файл привязывается к уроку.
        const res = await uploadMaterial(file);
        materialId = res.id;
        if (res.upload_result === 'replaced') {
          setItemsNotice(`Файл «${file.name}» заменён новой версией`);
        } else if (res.upload_result === 'unchanged') {
          setItemsNotice(`Файл «${file.name}» уже есть в Базе знаний — привязан существующий`);
        }
      } catch (err) {
        const c = conflictOf(err);
        if (c?.code === 'duplicate') {
          // Такое же содержимое лежит в БЗ под другим именем — привязываем
          // существующий файл, копию не создаём
          materialId = c.existing_id;
          setItemsNotice(`${c.detail} — привязан существующий`);
        } else {
          // в т.ч. name_taken: одноимённый чужой файл — нужно переименовать
          throw err;
        }
      }
      await attachLessonItem(lessonId, 'material', materialId);
      await loadItems();
    } catch (err) {
      setItemsError(extractErrorMessage(err, 'Не удалось загрузить файл'));
    } finally {
      if (materialInputRef.current) materialInputRef.current.value = '';
      setIsUploadingMaterial(false);
    }
  };

  // Создать новую ссылку и сразу привязать к уроку
  const handleAddLink = async () => {
    if (!linkTitle.trim() || !linkUrl.trim()) return;

    setIsAddingLink(true);
    setItemsError('');
    setItemsNotice('');
    try {
      let linkId;
      try {
        linkId = (await createLink(linkTitle.trim(), linkUrl.trim())).id;
      } catch (err) {
        const c = conflictOf(err);
        if (c?.code !== 'duplicate') throw err;
        // Такая ссылка уже есть в БЗ — привязываем существующую
        linkId = c.existing_id;
        setItemsNotice(`${c.detail} — привязана существующая`);
      }
      await attachLessonItem(lessonId, 'link', linkId);
      setLinkTitle('');
      setLinkUrl('');
      setShowLinkForm(false);
      await loadItems();
    } catch (err) {
      setItemsError(extractErrorMessage(err, 'Не удалось добавить ссылку'));
    } finally {
      setIsAddingLink(false);
    }
  };

  const updateRowField = (studentId, field, value) => {
    setMarksRows(prev => prev.map(r => (r.student_id === studentId ? { ...r, [field]: value } : r)));
  };

  const buildPayload = (row) => ({
    attendance_status: row.attendance_status || null,
    is_late: !!row.is_late,
    score: row.score === '' ? null : Number(row.score),
    exam_score: row.exam_score === '' ? null : Number(row.exam_score),
    stars: row.stars || 0,
    comment: row.comment || null,
  });

  // Закрытый урок открывается сам при первой отметке «пришёл» (бэкенд,
  // _open_on_arrival) — показываем это на кнопке «Открыть / Закрыть»
  const syncLessonOpen = (isOpen) => {
    setLesson(prev => (prev && prev.is_open !== isOpen ? { ...prev, is_open: isOpen } : prev));
  };

  const saveRow = async (studentId, rowOverride) => {
    const row = rowOverride || marksRowsRef.current.find(r => r.student_id === studentId);
    if (!row) return;

    setRowErrors(prev => ({ ...prev, [studentId]: '' }));
    try {
      const saved = await saveLessonMark(lessonId, studentId, buildPayload(row));
      syncLessonOpen(saved.is_open);
      loadWork(); // оценка за урок при сданной работе — это и есть её проверка
    } catch (err) {
      setRowErrors(prev => ({ ...prev, [studentId]: extractErrorMessage(err, 'Не удалось сохранить') }));
      if (err?.response?.status === 403) {
        setMarksLocked(true);
      }
    }
  };

  const handleImmediateChange = (studentId, field, value) => {
    const current = marksRowsRef.current.find(r => r.student_id === studentId);
    if (!current) return;
    const updated = { ...current, [field]: value };
    setMarksRows(prev => prev.map(r => (r.student_id === studentId ? updated : r)));
    saveRow(studentId, updated);
  };

  const handleStarsClick = (studentId, value) => {
    const current = marksRowsRef.current.find(r => r.student_id === studentId);
    if (!current) return;
    const newValue = current.stars === value ? 0 : value;
    handleImmediateChange(studentId, 'stars', newValue);
  };

  // Клик по кружку Пришёл/Онлайн/Уважительная — как и звёзды, сохраняется
  // сразу, без blur. Повторный клик по уже активной кнопке снимает отметку
  // (пропуск). «Опоздал» комбинируется только с Пришёл/Онлайн — при уходе
  // на Уважительную или снятии отметки сбрасываем и его.
  const handleAttendanceClick = (studentId, btn) => {
    const current = marksRowsRef.current.find(r => r.student_id === studentId);
    if (!current) return;
    const isActive = current.attendance_status === btn.status;
    const nextStatus = isActive ? '' : btn.status;
    const updated = {
      ...current,
      attendance_status: nextStatus,
      is_late: LATE_STATUSES.has(nextStatus) ? current.is_late : false,
    };
    setMarksRows(prev => prev.map(r => (r.student_id === studentId ? updated : r)));
    saveRow(studentId, updated);
  };

  // «Опоздал» — независимый модификатор, доступен только поверх
  // Пришёл/Онлайн (см. LATE_STATUSES).
  const handleLateToggle = (studentId) => {
    const current = marksRowsRef.current.find(r => r.student_id === studentId);
    if (!current || !LATE_STATUSES.has(current.attendance_status)) return;
    const updated = { ...current, is_late: !current.is_late };
    setMarksRows(prev => prev.map(r => (r.student_id === studentId ? updated : r)));
    saveRow(studentId, updated);
  };

  // Оценка 0..100 — то же ограничение стоит на бэке (Field(ge=0, le=100)).
  // HTML min/max на <input type="number"> не мешает ввести 200 руками, а
  // бэк на такое ответит 422 — подрезаем на blur, до отправки.
  const handleScoreLikeBlur = (studentId, field) => {
    const current = marksRowsRef.current.find(r => r.student_id === studentId);
    if (current && current[field] !== '') {
      const clamped = Math.max(0, Math.min(100, Number(current[field])));
      if (clamped !== Number(current[field])) {
        const updated = { ...current, [field]: clamped };
        setMarksRows(prev => prev.map(r => (r.student_id === studentId ? updated : r)));
        saveRow(studentId, updated);
        return;
      }
    }
    saveRow(studentId);
  };

  const handleScoreBlur = (studentId) => handleScoreLikeBlur(studentId, 'score');
  const handleExamScoreBlur = (studentId) => handleScoreLikeBlur(studentId, 'exam_score');

  const saveAllRows = async (rowsOverride) => {
    const rows = rowsOverride || marksRowsRef.current;
    setIsSavingAll(true);
    setMarksError('');
    try {
      const items = rows.map(r => ({ student_id: r.student_id, ...buildPayload(r) }));
      const saved = await saveLessonMarksBulk(lessonId, items);
      syncLessonOpen(saved.is_open);
      setRowErrors({});
    } catch (err) {
      setMarksError(extractErrorMessage(err, 'Не удалось сохранить таблицу'));
      if (err?.response?.status === 403) {
        setMarksLocked(true);
      }
    } finally {
      setIsSavingAll(false);
    }
  };

  // «Все пришли» — отмечает всех присутствующими очно (без опозданий) и
  // сразу сохраняет всю таблицу разом.
  const handleMarkAllPresent = () => {
    if (marksLocked) return;
    const updated = marksRowsRef.current.map(r => ({ ...r, attendance_status: 'in_person', is_late: false }));
    setMarksRows(updated);
    saveAllRows(updated);
  };

  const handleCommitDate = async () => {
    if (!lesson) return;

    const originalTime = lesson.date ? new Date(lesson.date).getTime() : null;
    const newTime = dateValue ? dateValue.getTime() : null;
    const dateChanged = originalTime !== newTime;
    const durationChanged = durationValue !== lesson.duration_min;
    if (!dateChanged && !durationChanged) return;

    setIsSavingDate(true);
    setError('');
    try {
      const payload = {};
      if (dateChanged) payload.date = dateValue ? dateValue.toISOString() : null;
      if (durationChanged) payload.duration_min = durationValue;
      const updated = await updateLesson(lesson.id, payload);
      setLesson(updated);
      setDateValue(updated?.date ? new Date(updated.date) : null);
      setDurationValue(updated?.duration_min || DEFAULT_DURATION_MIN);
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось сохранить изменения'));
    } finally {
      setIsSavingDate(false);
    }
  };

  const handleCommitComment = async () => {
    if (!lesson) return;
    if ((lesson.comment || '') === lessonComment) return;

    setIsSavingComment(true);
    setError('');
    try {
      const updated = await updateLesson(lesson.id, { comment: lessonComment });
      setLesson(updated);
      setLessonComment(updated?.comment || '');
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось сохранить комментарий'));
    } finally {
      setIsSavingComment(false);
    }
  };

  const handleCommitPrivateNote = async () => {
    if (!lesson) return;
    if ((lesson.teacher_notes || '') === privateNote) return;

    setIsSavingNote(true);
    setError('');
    try {
      const updated = await updateLesson(lesson.id, { private_note: privateNote });
      setLesson(updated);
      setPrivateNote(updated?.teacher_notes || '');
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось сохранить заметки'));
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleToggleOpen = async () => {
    if (!lesson) return;

    setIsTogglingOpen(true);
    setError('');
    try {
      const opened = await openLesson(lesson.id);
      setLesson(prev => ({ ...prev, is_open: opened.is_open }));
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось изменить доступ к уроку'));
    } finally {
      setIsTogglingOpen(false);
    }
  };

  const handleDelete = async () => {
    if (!lesson || isDeleting) return;
    const confirmed = window.confirm('Удалить этот урок?');
    if (!confirmed) return;

    setIsDeleting(true);
    setError('');
    try {
      await deleteLesson(lesson.id);
      navigate('/dashboard');
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось удалить урок'));
      setIsDeleting(false);
    }
  };

  if (loading) {
    return <div className="page">{'Загрузка...'}</div>;
  }

  if (!lesson) {
    return (
      <div className="page">
        {error || 'Урок не найден'}
      </div>
    );
  }

  // Педагог, который в группе не основной (замена, уроки до передачи), своей группы
  // в /groups/my не имеет — данные группы тогда берём из самого урока.
  const lessonGroup = groups.find(g => g.id === lesson.group_id) || {
    name: lesson.group_name, video_url: lesson.group_video_url,
    telegram_chat_id: lesson.group_telegram, whatsapp: lesson.group_whatsapp,
  };
  const groupName = lessonGroup?.name || `#${lesson.group_id}`;
  // Права в уроке (backend/app/lesson_teacher.py): readOnly — только просмотр;
  // canManage — расписание и состав урока (основной педагог группы и админ).
  const readOnly = lesson.can_edit === false;
  const canManage = lesson.can_manage !== false;

  return (
    <div className="page">
      <div className="toolbar">
        <div className="lesson-toolbar__info">
          <button className="btn btn--outline" onClick={() => back(`/dashboard/groups/${lesson.group_id}`)}>
            {'Назад'}
          </button>
          {canManage ? (
            <button
              type="button"
              className={`lesson-room${lesson.room_number ? '' : ' lesson-room--none'}`}
              data-tip={'Выбрать аудиторию урока'}
              onClick={() => {
                setRoomError('');
                getLessonRooms(lesson.id)
                  .then(setRoomChoice)
                  .catch(err => setRoomError(extractErrorMessage(err, 'Не удалось загрузить аудитории')));
              }}
            >
              {lesson.room_number ? `А${lesson.room_number}` : 'аудитория не назначена'}
            </button>
          ) : lesson.room_number && (
            <strong className="lesson-room lesson-room--static" data-tip={'Аудитория'}>{`А${lesson.room_number}`}</strong>
          )}
          {roomError && <span className="error-text">{roomError}</span>}
          {roomChoice && (
            <Modal title={'Аудитория урока'} onClose={() => setRoomChoice(null)} footer={(
              <>
                {lesson.room_id && (
                  <button type="button" className="btn btn--secondary" onClick={() => setLessonRoom(lesson.id, null)
                    .then(r => { setLesson(prev => ({ ...prev, ...r })); setRoomChoice(null); })
                    .catch(err => setRoomError(extractErrorMessage(err, 'Не удалось снять аудиторию')))}>
                    {'Снять аудиторию'}
                  </button>
                )}
                <button type="button" className="btn btn--secondary" onClick={() => setRoomChoice(null)}>{'Отмена'}</button>
              </>
            )}>
              <div className="form-stack">
                <p className="text-muted">{`Учеников на уроке: ${roomChoice.people}. Аудитория меняется только у этого урока.`}</p>
                {roomChoice.rooms.length === 0 && <p className="text-muted">{'Аудиторий пока нет — их заводят на странице «Аудитории».'}</p>}
                {roomChoice.rooms.map(r => {
                  const busy = r.busy_with.length > 0;
                  const small = r.capacity < roomChoice.people;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`lesson-room-option${busy ? ' lesson-room-option--busy' : ''}${r.id === roomChoice.room_id ? ' lesson-room-option--current' : ''}`}
                      onClick={() => setLessonRoom(lesson.id, r.id)
                        .then(res => { setLesson(prev => ({ ...prev, ...res })); setRoomChoice(null); })
                        .catch(err => setRoomError(extractErrorMessage(err, 'Не удалось сохранить аудиторию')))}
                    >
                      <b>{`А${r.number}`}</b>
                      <span className={small ? 'lesson-room-option__over' : undefined}>{`мест ${r.capacity}`}</span>
                      <span>{busy ? `занята: ${r.busy_with.join(', ')}` : 'свободна'}</span>
                    </button>
                  );
                })}
              </div>
            </Modal>
          )}
          <span className="lesson-toolbar__title">{lesson.title}</span>
          <span className="lesson-toolbar__group">{'Группа'}: {groupName}</span>
          {/* Персональный урок: метка с участниками, по клику — смена состава */}
          <PersonalBadge lesson={lesson} onClick={canManage ? () => setParticipantsOpen(true) : undefined} />
          {lesson.teacher_name && (
            <span className="badge badge--teacher badge--inline badge--photo" data-tip={'Урок ведёт этот педагог'}>
              <Avatar userId={lesson.teacher_id} photoUrl={lesson.teacher_photo_url} name={lesson.teacher_name} size="xs" />
              {lesson.teacher_name}
            </span>
          )}
          {participantsOpen && (
            <ParticipantsModal
              lesson={lesson}
              onClose={() => setParticipantsOpen(false)}
              onSaved={() => window.location.reload()}
            />
          )}
          <GroupContactIcons video={lessonGroup?.video_url} telegram={lessonGroup?.telegram_chat_id} whatsapp={lessonGroup?.whatsapp} />
          <span className="lesson-toolbar__date">
            {formatDateTime(dateValue) || '—'}
            {dateValue && ` · ${formatDuration(durationValue)}`}
            {canManage && (
            <DateTimePicker
              value={dateValue}
              onChange={setDateValue}
              onCommit={handleCommitDate}
              disabled={isSavingDate || lesson.is_locked}
              iconOnly
              floating
              tip={lesson.is_locked ? 'Прошла полночь — перенести урок нельзя' : 'Смена даты, времени и длительности урока'}
              duration={durationValue}
              onDurationChange={setDurationValue}
            />
            )}
          </span>
          {!readOnly && (
          <button
            type="button"
            className={`btn btn--sm${lesson.is_open ? '' : ' btn--muted'}`}
            onClick={handleToggleOpen}
            disabled={isTogglingOpen}
          >
            {isTogglingOpen ? '...' : (lesson.is_open ? 'Закрыть' : 'Открыть')}
          </button>
          )}
          {canManage && (
          <button
            type="button"
            className="btn btn--sm btn--outline"
            onClick={handleDelete}
            disabled={isDeleting || lesson.is_locked}
            data-tip={lesson.is_locked ? 'Прошла полночь — удалить урок нельзя' : 'Удалить урок'}
          >
            <TrashIcon size={16} />
          </button>
          )}
        </div>
        <div className="toolbar__filters">
          <button
            type="button"
            className={`tab${view === 'lesson' ? ' tab--active' : ''}`}
            onClick={() => setView('lesson')}
          >
            {'Урок'}
          </button>
          <button
            type="button"
            className={`tab${view === 'students' ? ' tab--active' : ''}`}
            onClick={() => setView('students')}
            data-tip={workBoard.to_review > 0 ? 'Работы на уроке ждут проверки' : undefined}
          >
            {'Студенты'}
            {workBoard.to_review > 0 && <span className="btn__count">{workBoard.to_review}</span>}
          </button>
        </div>
      </div>

      {error && <div className="error-text error-text--muted">{error}</div>}
      {readOnly && (
        <p className="hint-text">{'Только просмотр: урок в группе другого педагога, день урока прошёл.'}</p>
      )}

      {view === 'lesson' && (
        <>
          {!readOnly && (
          <div className="form-toolbar">
            <button type="button" className="btn btn--outline" onClick={() => setShowLibraryModal(true)}>
              {'Добавить из базы'}
            </button>
            {/* Дополнительный урок: взять материалы урока, который ученик пропустил */}
            {lesson.is_personal && (
              <button type="button" className="btn btn--outline" onClick={() => setShowSourcesModal(true)}>
                {'Из урока'}
              </button>
            )}
            <input
              type="file"
              ref={materialInputRef}
              onChange={handleUploadMaterial}
              hidden
            />
            <button type="button" className="btn btn--outline" onClick={handlePickMaterial} disabled={isUploadingMaterial}>
              {isUploadingMaterial ? 'Загрузка...' : '+ Файл'}
            </button>
            <button
              type="button"
              className="btn btn--outline"
              onClick={() => navigate(`/dashboard/add-quiz?lessonId=${lessonId}`)}
            >
              {'+ Квиз'}
            </button>
            <button type="button" className="btn btn--outline" onClick={() => setShowLinkForm(v => !v)}>
              {'+ Ссылка'}
            </button>
          </div>
          )}

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

          {showSourcesModal && (
            <LessonSourcesModal
              lessonId={lessonId}
              onClose={() => setShowSourcesModal(false)}
              onCopied={(result) => {
                setShowSourcesModal(false);
                setItemsNotice(result.attached > 0 ? `Добавлено материалов: ${result.attached}` : 'Все материалы этого урока уже добавлены');
                loadItems();
              }}
            />
          )}

          {showLibraryModal && (
            <LibraryPickerModal
              lessonId={lessonId}
              attachedKeys={new Set(lessonItems.map(i => resourceKey(i.resource_type, i.resource_id)))}
              onAttached={loadItems}
              onClose={() => setShowLibraryModal(false)}
              sector={lesson.group_sector}
              courseId={lesson.group_course_id}
              lessonNo={lesson.is_personal ? null : lesson.order}
            />
          )}

          <div className="toolbar">
            <h3 className="toolbar__title">{'Материалы урока'}</h3>
          </div>

          {itemsLoading && <p className="text-muted">{'Загрузка...'}</p>}
          {itemsError && <div className="error-text error-text--muted">{itemsError}</div>}
          {itemsNotice && <p className="text-muted">{itemsNotice}</p>}

          {!itemsLoading && itemsLoaded && (
            <>
              {/* Ширина по содержимому, прокрутка — только у таблицы и только
                  когда места действительно не хватает */}
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{'Тип'}</th>
                      <th>{'Название'}</th>
                      <th>{'Детали'}</th>
                      <th>{'Добавил'}</th>
                      <th className="table__col--date">{'Дата'}</th>
                      <th className="table__col--delete">{'Открепить'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lessonItems.length === 0 ? (
                      <tr><td colSpan="6" className="table__empty">{'К уроку ничего не привязано'}</td></tr>
                    ) : (
                      lessonItems.map(item => {
                        const meta = TYPE_META[item.resource_type];
                        const key = resourceKey(item.resource_type, item.resource_id);
                        return (
                          <tr key={key} className={`table__row--${item.resource_type}`}>
                            <td>
                              <span className={`type-badge type-badge--${item.resource_type}`}>
                                {meta.icon} {subtypeLabel(item)}
                              </span>
                            </td>
                            <td>
                              <button type="button" className="link" onClick={() => handleOpenItem(item)} disabled={openingKey === key}>
                                {openingKey === key ? `${item.title} — открываем...` : item.title}
                              </button>
                            </td>
                            <td>
                              {item.resource_type === 'material' && (
                                <span className="nowrap">{formatSize(item.size_bytes || 0)}</span>
                              )}
                              {item.resource_type === 'quiz' && (
                                <span className="table__cell--truncate" data-tip={item.topic || ''}>{item.topic || '—'}</span>
                              )}
                              {item.resource_type === 'link' && (
                                <span className="table__cell--truncate" data-tip={item.url}>{item.url}</span>
                              )}
                            </td>
                            <td>{item.added_by_name || '—'}</td>
                            <td className="table__col--date nowrap">{item.added_at ? new Date(item.added_at).toLocaleDateString('ru-RU') : '—'}</td>
                            <td className="table__col--delete">
                              {!readOnly && (
                              <div className="icon-row">
                              {/* Редактор квиза; после сохранения/отмены вернёт в этот урок (?lessonId) */}
                              {item.resource_type === 'quiz' && (
                                <IconButton
                                  icon="edit"
                                  disabled={!item.can_edit}
                                  tip={item.can_edit ? 'Редактировать квиз' : 'Редактировать может только автор или администратор'}
                                  onClick={() => navigate(`/dashboard/add-quiz/${item.resource_id}?lessonId=${lessonId}`)}
                                />
                              )}
                              <button
                                type="button"
                                className="btn btn--sm"
                                onClick={() => handleDetachItem(item)}
                                disabled={detachingKey === key}
                              >
                                ✕
                              </button>
                              </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

        </>
      )}

      {view === 'students' && (
        // Только просмотр: все поля и кнопки таблицы отключаются разом
        <fieldset className="fieldset-plain" disabled={readOnly}>
          {marksLoading && <p className="text-muted">{'Загрузка...'}</p>}
          {marksError && <div className="error-text error-text--muted">{marksError}</div>}

          {!marksLoading && marksLoaded && (
            <>
              {marksLocked && (
                <p className="text-muted">
                  {'Прошла полночь по Баку: присутствие и оценку за урок менять нельзя (отсутствующему можно отметить уважительную причину). Оценку за урок ученику, сдавшему работу на уроке, экзамен, звёзды, ДЗ и диалог — можно.'}
                </p>
              )}

              {marksRows.length > 0 && (
                <div className="button-row">
                  {!hwCheckMode && (
                    <button type="button" className="btn btn--outline" onClick={handleMarkAllPresent} disabled={isSavingAll || marksLocked}>
                      {'Все пришли'}
                    </button>
                  )}
                  <button type="button" className="btn btn--outline" onClick={() => setHwAddOpen(true)} data-tip="Добавить домашнее задание ВСЕМ">
                    {'+ ДЗ всем'}
                  </button>
                  {!hwCheckMode && workBoard.students.some(w => w.work.files.length > 0) && (
                    <button type="button" className="btn btn--outline" onClick={() => setAiBatchOpen(true)} data-tip="Проверить работы с урока через ИИ — пакетом на всю группу">
                      {'Проверка ИИ'}
                    </button>
                  )}
                  {hwCheckMode ? (
                    <button type="button" className="btn" onClick={() => setHwCheckMode(false)}>
                      {'← Обычный вид'}
                    </button>
                  ) : (
                    <button type="button" className="btn btn--outline" onClick={() => setHwCheckMode(true)} data-tip="Принять и оценить домашние задания">
                      {'Проверить ДЗ'}
                      {hwBoard.to_review > 0 && <span className="btn__count">{hwBoard.to_review}</span>}
                    </button>
                  )}
                </div>
              )}

              {aiBatchOpen && (
                <AiBatchModal
                  lessonId={lessonId}
                  lessonTitle={lesson.title}
                  sector={lesson.group_sector}
                  rows={workBoard.students}
                  drafts={aiDrafts}
                  setDrafts={setAiDrafts}
                  onChanged={onWorkReviewed}
                  onClose={() => setAiBatchOpen(false)}
                />
              )}

              {hwCheckMode && (
                <HomeworkCheckView lessonId={lessonId} board={hwBoard} onChanged={loadHomework} onError={setMarksError} />
              )}

              {hwAddOpen && (
                <HomeworkAddModal
                  lessonId={lessonId}
                  student={null}
                  tasks={hwBoard.tasks.filter(t => !t.student_id)}
                  deadline={hwBoard.tasks.find(t => !t.student_id && t.deadline)?.deadline || null}
                  sector={lesson.group_sector}
                  courseId={lesson.group_course_id}
                  lessonNo={lesson.is_personal ? null : lesson.order}
                  onChanged={loadHomework}
                  onClose={() => setHwAddOpen(false)}
                />
              )}

              {hwAddFor && (
                <HomeworkAddModal
                  lessonId={lessonId}
                  student={hwAddFor}
                  tasks={hwBoard.tasks.filter(t => t.student_id === hwAddFor.student_id)}
                  deadline={personalOrCommonDeadline(hwBoard, hwAddFor.student_id)}
                  sector={lesson.group_sector}
                  courseId={lesson.group_course_id}
                  lessonNo={lesson.is_personal ? null : lesson.order}
                  onChanged={loadHomework}
                  onClose={() => setHwAddFor(null)}
                />
              )}

              {!hwCheckMode && (
              <div className="table-scroll">
                <table className="table table--fixed table--marks">
                  <thead>
                    <tr>
                      <th>{'Имя'}</th>
                      <th className="table__col--attendance">{'Посещаемость'}</th>
                      <th className="table__col--work-files">{'Файлы с урока'}</th>
                      <th className="table__col--score">{'Оценка'}</th>
                      <th className="table__col--score">{'Экзамен'}</th>
                      <th className="table__col--stars">{'Звёзды'}</th>
                      <th className="table__col--flag">{'ДЗ'}</th>
                      <th className="table__col--flag">{'Ответ'}</th>
                      <th>{'Комментарий'}</th>
                      <th className="table__col--icons">{'Контакты'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marksRows.length === 0 ? (
                      <tr><td colSpan="10" className="table__empty">{'В группе нет студентов'}</td></tr>
                    ) : (
                      marksRows.map(row => {
                        const hwRow = hwBoard.students.find(h => h.student_id === row.student_id);
                        const work = workBoard.students.find(w => w.student_id === row.student_id)?.work;
                        return (
                          <tr key={row.student_id} className={hwRow?.answer.status === 'submitted' ? 'table__row--homework-pending' : undefined}>
                            <td>
                              <span className="person">
                                <Avatar userId={row.student_id} photoUrl={row.photo_url} name={row.full_name} size="xs" />
                                {/* Отчёт по ученику; «Назад» из него вернёт в этот урок (hooks/useBack.js) */}
                                <Link className="link" to={`/dashboard/students/${row.student_id}/report`} data-tip="Отчёт по ученику">
                                  {row.full_name}
                                </Link>
                              </span>
                            </td>
                            <td>
                              <div className="attendance-group">
                                {ATTENDANCE_STATUS_BUTTONS.map(btn => (
                                  <button
                                    key={btn.kind}
                                    type="button"
                                    className={`attendance-btn attendance-btn--${btn.kind}${row.attendance_status === btn.status ? ' attendance-btn--active' : ''}`}
                                    data-tip={btn.label}
                                    disabled={marksLocked && !(btn.kind === 'excused' && !LATE_STATUSES.has(row.attendance_status))}
                                    onClick={() => handleAttendanceClick(row.student_id, btn)}
                                  />
                                ))}
                                <button
                                  type="button"
                                  className={`attendance-btn attendance-btn--late${row.is_late ? ' attendance-btn--active' : ''}`}
                                  data-tip={'Опоздал'}
                                  disabled={marksLocked || !LATE_STATUSES.has(row.attendance_status)}
                                  onClick={() => handleLateToggle(row.student_id)}
                                />
                              </div>
                            </td>
                            <td>
                              {/* Работа на уроке: клик — окно проверки; оранжевые ждут проверки */}
                              <div className="work-files">
                                {(work?.files || []).map(f => (
                                  <button
                                    key={f.id}
                                    type="button"
                                    className={`link work-files__item${work.status === 'submitted' ? ' work-files__item--todo' : ''}`}
                                    data-tip={work.status === 'submitted' ? 'Ждёт проверки — посмотреть' : 'Посмотреть'}
                                    onClick={() => setWorkPanel({ studentId: row.student_id, fileId: f.id })}
                                  >
                                    {f.original_filename}
                                  </button>
                                ))}
                                {!work?.files?.length && <span className="text-muted">{'—'}</span>}
                              </div>
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                className="input input--sm-num"
                                value={row.score}
                                disabled={marksLocked && !work?.files?.length}
                                onChange={e => updateRowField(row.student_id, 'score', e.target.value)}
                                onBlur={() => handleScoreBlur(row.student_id)}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                min="0"
                                max="100"
                                className="input input--sm-num"
                                value={row.exam_score}
                                onChange={e => updateRowField(row.student_id, 'exam_score', e.target.value)}
                                onBlur={() => handleExamScoreBlur(row.student_id)}
                              />
                            </td>
                            <td>
                              <div className="star-picker">
                                {[1, 2, 3].map(n => (
                                  <button
                                    key={n}
                                    type="button"
                                    className={`star-picker__btn${row.stars >= n ? ' star-picker__btn--active' : ''}`}
                                    onClick={() => handleStarsClick(row.student_id, n)}
                                  >
                                    ★
                                  </button>
                                ))}
                              </div>
                            </td>
                            <HomeworkFlags row={hwRow} onAdd={setHwAddFor} />
                            <td>
                              {/* Диалог педагог ↔ студент (вместо комментария); полуночная блокировка на него не действует */}
                              <DialogCell
                                lessonId={lessonId}
                                studentId={row.student_id}
                                studentName={row.full_name}
                                lastMessage={hwRow?.last_message}
                                count={hwRow?.messages_count || 0}
                                onChanged={loadHomework}
                              />
                              {rowErrors[row.student_id] && (
                                <div className="error-text--sm">{rowErrors[row.student_id]}</div>
                              )}
                            </td>
                            <td>
                              <StudentContactIcons telegram={row.telegram_username} whatsapp={row.whatsapp} phone={row.phone} />
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              )}

              {workPanel && (
                <ReviewPanel
                  key={workPanel.studentId}
                  mode="work"
                  lessonId={lessonId}
                  rows={workBoard.students}
                  queue={workBoard.students}
                  toReviewCount={workBoard.to_review}
                  studentId={workPanel.studentId}
                  fileId={workPanel.fileId}
                  onNavigate={(studentId) => setWorkPanel({ studentId, fileId: null })}
                  onChanged={onWorkReviewed}
                  onClose={() => setWorkPanel(null)}
                />
              )}

            </>
          )}
        </fieldset>
      )}

      <label className="field-label field-label--top-gap">
        {'Комментарий к уроку — видят ученики'}
        <textarea
          className="input input--textarea"
          value={lessonComment}
          onChange={e => setLessonComment(e.target.value)}
          onBlur={handleCommitComment}
          disabled={isSavingComment || readOnly}
          placeholder={'Заметки педагога по уроку в целом — что обсудили, на что обратить внимание в следующий раз...'}
        />
        {isSavingComment && <span className="hint-text">{'Сохранение…'}</span>}
      </label>

      <label className="field-label field-label--top-gap">
        {'Заметки для себя — видят только педагог и админ'}
        <textarea
          className="input input--textarea"
          value={privateNote}
          onChange={e => setPrivateNote(e.target.value)}
          onBlur={handleCommitPrivateNote}
          disabled={isSavingNote || readOnly}
          placeholder={'Что учесть на следующем уроке, кому уделить внимание...'}
        />
        {isSavingNote && <span className="hint-text">{'Сохранение…'}</span>}
      </label>
    </div>
  );
}

export default LessonPage;
