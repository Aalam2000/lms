import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useBack } from '../hooks/useBack';
import Modal from '../components/Modal';
import Avatar from '../components/Avatar';
import { useAuth } from '../context/AuthContext';
import { usePref } from '../hooks/usePref';
import IconButton from '../components/IconButton';
import QRModal from '../components/QRModal';
import StudentsModal from '../components/StudentsModal';
import GroupSettingsModal from '../components/GroupSettingsModal';
import { GroupContactIcons } from '../components/ContactIcons';
import { DEFAULT_DURATION_MIN } from '../utils/lessonTime';
import Calendar from '../components/Calendar';
import DateTimePicker, { nextHour } from '../components/DateTimePicker';
import { PersonalBadge, ParticipantsPicker } from '../components/PersonalLesson';
import LessonTeacherModal from '../components/LessonTeacherModal';
import GroupScheduleModal from '../components/GroupScheduleModal';
import { useDaysOff } from '../hooks/useDaysOff';
import { getMyGroups, getCourses, downloadGroupScratchCsv } from '../api/groups';
import { useHomeworkRefresh } from '../hooks/useHomeworkRefresh';
import {
  getGroupLessons, createLesson,
  fillGroupSchedule, markLessonHoliday, openGroupLessonsRange,
} from '../api/lessons';

function GroupPage() {
  const navigate = useNavigate();
  const back = useBack();
  const { hasRole, user, can } = useAuth();
  const isAdmin = hasRole('admin');
  // Расписание группы (создать, удалить, аудитории по дням) — только право schedule.edit (админ)
  const canSchedule = can('schedule.edit');
  const { groupId } = useParams();
  const gid = parseInt(groupId);

  const [lessons, setLessons] = useState([]);
  const [groups, setGroups] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newLessonDate, setNewLessonDate] = useState(null); // Date | null
  const [newLessonDuration, setNewLessonDuration] = useState(DEFAULT_DURATION_MIN); // мин
  const [newLessonTitle, setNewLessonTitle] = useState(''); // пусто — стандартное «Урок» на языке сектора
  // Персональный урок: только для выбранных учеников группы
  const [newLessonPersonal, setNewLessonPersonal] = useState(false);
  const [newLessonStudentIds, setNewLessonStudentIds] = useState([]);
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [isStudentsModalOpen, setIsStudentsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [rangeFilter, setRangeFilter] = useState('upcoming'); // upcoming | week | month | all

  // Таблица/Календарь — выбор хранится в профиле (hooks/usePref.js)
  const [viewMode, setViewMode] = usePref('group.view', 'table'); // table | calendar

  // Расписание группы (создать заново, аудитории по дням) — components/GroupScheduleModal.jsx
  const [isScheduleOpen, setIsScheduleOpen] = useState(false);

  // Дозаполнение/обновление материалов уже существующих уроков — и как
  // шаг после решения "уроки уже есть", и как отдельная кнопка
  const [isFillModalOpen, setIsFillModalOpen] = useState(false);
  // «Открыть уроки» — открыть/закрыть доступ к урокам с № по №
  const [isOpenRangeModalOpen, setIsOpenRangeModalOpen] = useState(false);
  const [openRangeFrom, setOpenRangeFrom] = useState('');
  const [openRangeTo, setOpenRangeTo] = useState('');
  const [openRangeAction, setOpenRangeAction] = useState('open'); // open | close
  const [isOpeningRange, setIsOpeningRange] = useState(false);
  const [openRangeError, setOpenRangeError] = useState('');
  const [fillSource, setFillSource] = useState('template'); // template | group
  const [fillGroupId, setFillGroupId] = useState('');
  const [fillRangeFrom, setFillRangeFrom] = useState('');
  const [fillRangeTo, setFillRangeTo] = useState('');
  const [fillMode, setFillMode] = useState('add'); // add (Дополнить) | replace (Заменить)
  const [isFilling, setIsFilling] = useState(false);
  const [fillError, setFillError] = useState('');

  const [markingHolidayId, setMarkingHolidayId] = useState(null);
  // «Педагог уроков» (только админ): после назначения данные группы перечитываются
  const [isTeacherModalOpen, setIsTeacherModalOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [lessonsRes, groupsRes, coursesRes] = await Promise.all([
          getGroupLessons(gid),
          getMyGroups({ with_guest: true }),
          getCourses(),
        ]);
        setLessons(lessonsRes);
        setGroups(groupsRes);
        setCourses(coursesRes);
      } catch (err) {
        setError(err?.response?.data?.detail || 'Не удалось загрузить группу');
      } finally {
        setLoading(false);
      }
    };
    load();
    // eslint-disable-next-line
  }, [gid, reloadKey]);

  // Отметки о непроверенном ДЗ у уроков — тихо, без «Загрузка...»
  useHomeworkRefresh(() => { getGroupLessons(gid).then(setLessons).catch(() => {}); });

  const group = groups.find(g => g.id === gid);
  // Педагог в группе не основной: видит только свои уроки, без управления группой
  const isGuest = group?.is_main === false;
  // Выходные в календаре: основного педагога группы, у педагога-замены — свои
  const isDayOff = useDaysOff({ teacherId: isGuest ? user?.id : group?.teacher_id });
  const courseName = courses.find(c => c.id === group?.course_id)?.title || '—';

  // Уроки только этой группы. По умолчанию — с сегодня и далее; кнопками
  // «Неделя»/«Месяц»/«Все» нижняя граница отодвигается назад (в прошлое),
  // будущие уроки при этом видны всегда — верхней границы нет никогда.
  const startOfWeek = (d) => {
    // Неделя с понедельника (getDay(): 0 — воскресенье)
    const date = new Date(d);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const startOfMonth = (d) => {
    const date = new Date(d.getFullYear(), d.getMonth(), 1);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const visible = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let lowerBound = today;
    if (rangeFilter === 'week') lowerBound = startOfWeek(today);
    else if (rangeFilter === 'month') lowerBound = startOfMonth(today);
    else if (rangeFilter === 'all') lowerBound = null;

    return lessons
      .filter(l => l.group_id === gid)
      .filter(l => !l.date || lowerBound === null || new Date(l.date) >= lowerBound)
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  }, [lessons, gid, rangeFilter]);

  // Для календаря — все уроки группы без обрезки по «с сегодня»: там
  // своя навигация вперёд/назад по месяцу/неделе, обрезка не нужна и
  // только мешала бы смотреть прошлое.
  const groupLessons = useMemo(
    () => lessons.filter(l => l.group_id === gid),
    [lessons, gid]
  );

  const isToday = (dateStr) => {
    if (!dateStr) return false;
    return new Date(dateStr).toDateString() === new Date().toDateString();
  };

  const openCreateModal = () => {
    setCreateError('');
    setNewLessonTitle('');
    setNewLessonPersonal(false);
    setNewLessonStudentIds([]);
    setNewLessonDate(nextHour()); // сегодня, следующий час, :00
    setNewLessonDuration(group?.lesson_duration_min || DEFAULT_DURATION_MIN);
    setIsModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsModalOpen(false);
    setCreateError('');
    setIsCreating(false);
  };

  const handleCreateLesson = async (e) => {
    e.preventDefault();
    if (!newLessonDate) {
      setCreateError('Укажите дату и время начала урока');
      return;
    }
    if (newLessonPersonal && newLessonStudentIds.length === 0) {
      setCreateError('Выберите хотя бы одного ученика');
      return;
    }

    setIsCreating(true);
    setCreateError('');
    try {
      const payload = {
        group_id: gid,
        date: newLessonDate.toISOString(),
        duration_min: newLessonDuration,
      };
      if (newLessonTitle.trim()) payload.title = newLessonTitle.trim();
      if (newLessonPersonal) {
        payload.is_personal = true;
        payload.student_ids = newLessonStudentIds;
      }
      const created = await createLesson(payload);
      setLessons(prev => [...prev, created]);
      closeCreateModal();
    } catch (err) {
      setCreateError(err?.response?.data?.detail || 'Не удалось создать урок');
      setIsCreating(false);
    }
  };

  // «Расписание и материалы»: админ — окно расписания группы (GroupScheduleModal),
  // педагог расписание не создаёт — только дозаполняет уроки материалами
  const handleOpenScheduleFlow = () => {
    // Персональные уроки в расписание группы не входят
    const hasLessons = lessons.some(l => l.group_id === gid && !l.is_personal);
    if (canSchedule) setIsScheduleOpen(true);
    else if (hasLessons) openFillModal();
    else setError('Расписания у группы пока нет — его создаёт администратор');
  };

  // «Обновить материалы» — источник (шаблон курса группы / другая группа),
  // диапазон уроков, режим Дополнить/Заменить. См. course-templates-plan.md.
  const openFillModal = () => {
    // Диапазон — по настоящим номерам уроков (расписание может начинаться не с 1)
    const orders = lessons.filter(l => l.group_id === gid && !l.is_personal).map(l => l.order);
    setFillSource('template');
    setFillGroupId('');
    setFillRangeFrom(String(orders.length ? Math.min(...orders) : 1));
    setFillRangeTo(String(orders.length ? Math.max(...orders) : 1));
    setFillMode('add');
    setFillError('');
    setIsFillModalOpen(true);
  };

  const handleFillSchedule = async (e) => {
    e.preventDefault();
    if (!fillRangeFrom || !fillRangeTo) {
      setFillError('Укажите диапазон уроков');
      return;
    }
    if (fillSource === 'group' && !fillGroupId) {
      setFillError('Выберите группу-источник');
      return;
    }

    setIsFilling(true);
    setFillError('');
    try {
      const payload = {
        source: fillSource,
        range_from: parseInt(fillRangeFrom, 10),
        range_to: parseInt(fillRangeTo, 10),
        mode: fillMode,
      };
      if (fillSource === 'group') payload.fill_group_id = parseInt(fillGroupId, 10);
      await fillGroupSchedule(gid, payload);
      setIsFillModalOpen(false);
    } catch (err) {
      setFillError(err?.response?.data?.detail || 'Не удалось обновить материалы');
    } finally {
      setIsFilling(false);
    }
  };

  // «Открыть уроки» — по умолчанию с первого урока по последний, чья дата
  // уже наступила (сегодня включительно).
  const openOpenRangeModal = () => {
    const groupLessons = lessons.filter(l => l.group_id === gid && !l.is_personal);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const started = groupLessons.filter(l => l.date && new Date(l.date) <= endOfToday).map(l => l.order);
    const orders = groupLessons.map(l => l.order);
    setOpenRangeFrom(String(orders.length ? Math.min(...orders) : 1));
    setOpenRangeTo(String(started.length ? Math.max(...started) : (orders.length ? Math.min(...orders) : 1)));
    setOpenRangeAction('open');
    setOpenRangeError('');
    setIsOpenRangeModalOpen(true);
  };

  const handleOpenRange = async (e) => {
    e.preventDefault();
    if (!openRangeFrom || !openRangeTo) {
      setOpenRangeError('Укажите диапазон уроков');
      return;
    }
    setIsOpeningRange(true);
    setOpenRangeError('');
    try {
      const res = await openGroupLessonsRange(gid, {
        range_from: parseInt(openRangeFrom, 10),
        range_to: parseInt(openRangeTo, 10),
        is_open: openRangeAction === 'open',
      });
      const ids = new Set(res.lesson_ids);
      setLessons(prev => prev.map(l => (ids.has(l.id) ? { ...l, is_open: res.is_open } : l)));
      setIsOpenRangeModalOpen(false);
    } catch (err) {
      setOpenRangeError(err?.response?.data?.detail || 'Не удалось изменить доступ к урокам');
    } finally {
      setIsOpeningRange(false);
    }
  };

  // «Праздник» — сдвигает этот и все последующие уроки серии на одну
  // позицию вперёд (материалы/оценки не трогает), см. lessons.py.
  const handleMarkHoliday = async (lesson) => {
    const dateLabel = lesson.date ? new Date(lesson.date).toLocaleDateString('ru-RU') : '—';
    const confirmed = window.confirm(
      `Отметить «${lesson.title}» (${dateLabel}) как выходной для этой группы? Этот и все последующие уроки серии сдвинутся на одну позицию вперёд.`
    );
    if (!confirmed) return;

    setMarkingHolidayId(lesson.id);
    setError('');
    try {
      const updated = await markLessonHoliday(lesson.id);
      const updatedById = new Map(updated.map(l => [l.id, l]));
      setLessons(prev => prev.map(l => updatedById.get(l.id) || l));
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось отметить праздник');
    } finally {
      setMarkingHolidayId(null);
    }
  };

  // CSV для класса Scratch (кнопка в шапке группы): логины и пароли учеников
  const downloadScratchCsv = async () => {
    setError('');
    try {
      await downloadGroupScratchCsv(group.id, group.name);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось выгрузить CSV');
    }
  };

  if (loading) return <div className="page">{'Загрузка...'}</div>;

  if (!group) {
    return (
      <div className="page">
        <button className="btn btn--outline" onClick={() => back('/dashboard')}>
          {'Назад'}
        </button>
        <div className="error-text error-text--muted">
          {'Группа не найдена'}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {/* Шапка группы в одну строку: «Назад», название/курс/педагог — слева; контакты и значки (настройки, QR, ученики) — справа */}
      <div className="group-header">
        <div className="group-header__left">
          <button className="btn btn--outline" onClick={() => back('/dashboard')}>
            {'Назад'}
          </button>
          {/* Название и курс — в одну строку, чтобы шапка была ниже */}
          <div className="group-header__titleline">
            <h2 className="group-header__title">{group.name}</h2>
            <div className="meta-row">
              <span>{'Курс'}: <b>{courseName}</b></span>
              {/* Педагогу своё имя не показываем (оно в шапке) — только админу, который смотрит чужие группы,
                  и педагогу, который в группе не основной */}
              {(isAdmin || isGuest) && (
                <>
                  <span>·</span>
                  <span>{'Преподаватель'}: <b>{group.teacher_name || '—'}</b></span>
                </>
              )}
            </div>
          </div>
        </div>
        {!isGuest && (
          <div className="icon-row">
            <GroupContactIcons video={group.video_url} telegram={group.telegram_chat_id} whatsapp={group.whatsapp} />
            <IconButton icon="settings" tip={'Настройки группы'} onClick={() => setIsSettingsOpen(true)} />
            <IconButton icon="qr" tip={'QR для регистрации'} onClick={() => setIsQRModalOpen(true)} />
            <IconButton icon="students" tip={'Ученики'} label={group.student_count ?? 0} onClick={() => setIsStudentsModalOpen(true)} />
            <button
              type="button"
              className="btn btn--outline"
              data-tip={'Логины и пароли учеников для класса Scratch'}
              onClick={downloadScratchCsv}
            >
              {'CSV для Scratch'}
            </button>
            {/* Записались по QR и ждут подтверждения — пока не примете, их нет в журнале */}
            {group.pending_count > 0 && (
              <button
                type="button"
                className="btn btn--attention"
                data-tip={'Новые ученики ждут подтверждения'}
                onClick={() => setIsStudentsModalOpen('pending')}
              >
                {'Новые'}<span className="btn__count">{group.pending_count}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {isGuest && (
        <p className="hint-text">{'Здесь только уроки, которые ведёте или вели вы. Работать в уроке можно до полуночи дня урока, потом он остаётся для просмотра.'}</p>
      )}

      {isTeacherModalOpen && (
        <LessonTeacherModal
          group={group}
          lessons={groupLessons}
          onClose={() => setIsTeacherModalOpen(false)}
          onSaved={() => { setIsTeacherModalOpen(false); setReloadKey(k => k + 1); }}
        />
      )}

      {isSettingsOpen && (
        <GroupSettingsModal
          group={group}
          onClose={() => setIsSettingsOpen(false)}
          onSaved={(updated) => {
            setGroups(gs => gs.map(g => (g.id === updated.id ? { ...g, ...updated } : g)));
            setIsSettingsOpen(false);
          }}
        />
      )}

      {/* Тулбар уроков: Таблица/Календарь — слева, действия с уроками — справа (в одну строку и на телефоне) */}
      <div className="toolbar toolbar--inline">
        {/* Переключатель вида: выбранный значок залит */}
        <div className="icon-row">
          <IconButton icon="tableView" tip={'Таблица'} active={viewMode === 'table'} onClick={() => setViewMode('table')} />
          <IconButton icon="calendarView" tip={'Календарь'} active={viewMode === 'calendar'} onClick={() => setViewMode('calendar')} />
        </div>
        {!isGuest && (
          <div className="button-row">
            {/* Замена на урок, передача группы с такого-то урока — назначает только админ */}
            {isAdmin && (
              <button type="button" className="btn btn--outline" onClick={() => setIsTeacherModalOpen(true)}>
                {'Педагог уроков'}
              </button>
            )}
            <button className="btn" onClick={openCreateModal}>
              {'+ Урок'}
            </button>
            <IconButton icon="unlock" tip={'Открыть уроки'} onClick={openOpenRangeModal} />
            {/* Материалы заполняются здесь же: «Оставить даты — дозаполнить материалами» */}
            <IconButton icon="schedule" tip={'Расписание и материалы'} onClick={handleOpenScheduleFlow} />
          </div>
        )}
      </div>

      {viewMode === 'table' && (
        <div className="toolbar__filters">
          {[
            { key: 'upcoming', label: 'С сегодня' },
            { key: 'week', label: 'С начала недели' },
            { key: 'month', label: 'С начала месяца' },
            { key: 'all', label: 'Все уроки' },
          ].map(opt => (
            <button
              key={opt.key}
              type="button"
              className={`tab tab--underline${rangeFilter === opt.key ? ' tab--active' : ''}`}
              onClick={() => setRangeFilter(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {error && <div className="error-text error-text--top">{error}</div>}

      {viewMode === 'calendar' ? (
        <Calendar
          lessons={groupLessons}
          onSelectLesson={(l) => navigate(`/dashboard/lessons/${l.id}`)}
          isDayOff={isDayOff}
          dayOffTeacher={isGuest ? (user?.full_name || user?.username) : group?.teacher_name}
        />
      ) : (
        /* Таблица уроков */
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{'Дата'}</th>
                <th>{'Тема урока'}</th>
                <th>{'Доступ'}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={4} className="table__empty">
                    {'Уроков нет'}
                  </td>
                </tr>
              )}
              {visible.map(l => {
                const today = isToday(l.date);
                return (
                  <tr
                    key={l.id}
                    className={`table__row--clickable${today ? ' table__row--today' : ''}${l.has_unreviewed_homework || l.has_unreviewed_work ? ' table__row--homework-pending' : ''}`}
                    onClick={() => navigate(`/dashboard/lessons/${l.id}`)}
                  >
                    <td>
                      {l.date ? new Date(l.date).toLocaleDateString('ru-RU') : '—'}
                      {today && <span className="badge badge--today badge--inline">{'Сегодня'}</span>}
                    </td>
                    <td>
                      {l.title}
                      <PersonalBadge lesson={l} />
                      {/* Урок ведёт не основной педагог группы: замена или прежний педагог */}
                      {l.teacher_name && (
                        <span className="badge badge--teacher badge--inline badge--photo" data-tip={'Урок ведёт этот педагог'}>
                          <Avatar userId={l.teacher_id} photoUrl={l.teacher_photo_url} name={l.teacher_name} size="xs" />
                          {l.teacher_name}
                        </span>
                      )}
                      {l.has_unreviewed_homework && (
                        <span className="badge badge--homework-pending badge--inline" data-tip={'Есть непроверенные решения ДЗ'}>
                          {'ДЗ: проверить'}
                        </span>
                      )}
                      {l.has_unreviewed_work && (
                        <span className="badge badge--homework-pending badge--inline" data-tip={'Есть непроверенные работы на уроке'}>
                          {'Работы: проверить'}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${l.is_open ? 'badge--open' : 'badge--closed'}`}>
                        {l.is_open ? 'Открыт' : 'Закрыт'}
                      </span>
                    </td>
                    <td>
                      {/* «Выходной» сдвигает расписание группы — персональных уроков не касается */}
                      {!l.is_personal && !isGuest && (
                      <button
                        type="button"
                        className="btn btn--sm"
                        data-tip={l.is_locked ? 'Прошла полночь — прошедший урок переносить нельзя' : 'Отметить праздником — сдвинуть эту и следующие даты'}
                        onClick={(e) => { e.stopPropagation(); handleMarkHoliday(l); }}
                        disabled={markingHolidayId === l.id || l.is_locked}
                      >
                        {'🎉'}
                      </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Модалка создания урока */}
      {isModalOpen && (
        <Modal
          title={'Новый урок'}
          onClose={closeCreateModal}
          footer={(
            <>
              <button type="button" className="btn btn--secondary" onClick={closeCreateModal}>
                {'Отмена'}
              </button>
              <button type="submit" form="new-lesson-form" className="btn" disabled={isCreating}>
                {isCreating ? 'Сохранение...' : 'Создать'}
              </button>
            </>
          )}
        >
          <form id="new-lesson-form" onSubmit={handleCreateLesson} className="form-stack">
            <label className="field-label">
              {'Название урока'}
              <input
                className="input"
                value={newLessonTitle}
                onChange={e => setNewLessonTitle(e.target.value)}
                placeholder={'Необязательно'}
                maxLength={200}
              />
            </label>
            {/* Тот же выбор даты, что в уроке: минуты шагом 10, по умолчанию :00 */}
            <div className="field-label">
              {'Дата, время начала и длительность'}
              <div>
                <DateTimePicker
                  value={newLessonDate}
                  onChange={setNewLessonDate}
                  duration={newLessonDuration}
                  onDurationChange={setNewLessonDuration}
                  floating
                />
              </div>
            </div>

            <label className="check-list__item">
              <input
                type="checkbox"
                checked={newLessonPersonal}
                onChange={e => setNewLessonPersonal(e.target.checked)}
              />
              <span data-tip="Урок увидят только выбранные ученики; остальным пропуск не ставится">{'Персональный урок'}</span>
            </label>
            {newLessonPersonal && (
              <ParticipantsPicker groupId={gid} value={newLessonStudentIds} onChange={setNewLessonStudentIds} />
            )}

            {createError && <div className="form-field__error">{createError}</div>}
          </form>
        </Modal>
      )}

      {isScheduleOpen && (
        <GroupScheduleModal
          group={group}
          groups={groups}
          onFill={() => { setIsScheduleOpen(false); openFillModal(); }}
          onClose={(changed) => { setIsScheduleOpen(false); if (changed) setReloadKey(k => k + 1); }}
        />
      )}

      {/* Открыть / закрыть доступ к урокам с № по № */}
      {isOpenRangeModalOpen && (
        <Modal
          title={'Открыть уроки'}
          onClose={() => setIsOpenRangeModalOpen(false)}
          footer={(
            <>
              <button type="button" className="btn btn--secondary" onClick={() => setIsOpenRangeModalOpen(false)}>
                {'Отмена'}
              </button>
              <button type="submit" form="open-range-form" className="btn" disabled={isOpeningRange}>
                {isOpeningRange ? 'Сохранение...' : 'Применить'}
              </button>
            </>
          )}
        >
          <form id="open-range-form" onSubmit={handleOpenRange} className="form-stack">
            <div className="button-row">
              <label className="field-label">
                {'Урок с №'}
                <input
                  type="number"
                  min="1"
                  className="input input--sm-num"
                  value={openRangeFrom}
                  onChange={e => setOpenRangeFrom(e.target.value)}
                  required
                />
              </label>
              <label className="field-label">
                {'по №'}
                <input
                  type="number"
                  min="1"
                  className="input input--sm-num"
                  value={openRangeTo}
                  onChange={e => setOpenRangeTo(e.target.value)}
                  required
                />
              </label>
            </div>
            <label className="field-label">
              {'Действие'}
              <select className="input" value={openRangeAction} onChange={e => setOpenRangeAction(e.target.value)}>
                <option value="open">{'Открыть доступ'}</option>
                <option value="close">{'Закрыть доступ'}</option>
              </select>
            </label>

            {openRangeError && <div className="form-field__error">{openRangeError}</div>}
          </form>
        </Modal>
      )}

      {/* Дозаполнение/обновление материалов — course-templates-plan.md */}
      {isFillModalOpen && (
        <Modal
          title={'Обновить материалы уроков'}
          onClose={() => setIsFillModalOpen(false)}
          footer={(
            <>
              <button type="button" className="btn btn--secondary" onClick={() => setIsFillModalOpen(false)}>
                {'Отмена'}
              </button>
              <button type="submit" form="fill-schedule-form" className="btn" disabled={isFilling}>
                {isFilling ? 'Обновление...' : 'Обновить'}
              </button>
            </>
          )}
        >
          <form id="fill-schedule-form" onSubmit={handleFillSchedule} className="form-stack">
            <label className="field-label">
              {'Источник материалов'}
              <select className="input" value={fillSource} onChange={e => setFillSource(e.target.value)}>
                <option value="template">{'Шаблон курса группы'}</option>
                <option value="group">{'Другая группа'}</option>
              </select>
            </label>
            {fillSource === 'group' && (
              <label className="field-label">
                {'Группа-источник'}
                <select className="input" value={fillGroupId} onChange={e => setFillGroupId(e.target.value)}>
                  <option value="">{'— Группа —'}</option>
                  {groups.filter(g => g.id !== gid).map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </label>
            )}
            <div className="button-row">
              <label className="field-label">
                {'Урок с №'}
                <input
                  type="number"
                  min="1"
                  className="input input--sm-num"
                  value={fillRangeFrom}
                  onChange={e => setFillRangeFrom(e.target.value)}
                  required
                />
              </label>
              <label className="field-label">
                {'по №'}
                <input
                  type="number"
                  min="1"
                  className="input input--sm-num"
                  value={fillRangeTo}
                  onChange={e => setFillRangeTo(e.target.value)}
                  required
                />
              </label>
            </div>
            <label className="field-label">
              {'Режим'}
              <select className="input" value={fillMode} onChange={e => setFillMode(e.target.value)}>
                <option value="add">{'Дополнить — добавить только недостающее'}</option>
                <option value="replace">{'Заменить — сначала отвязать всё текущее'}</option>
              </select>
            </label>

            {fillError && <div className="form-field__error">{fillError}</div>}
          </form>
        </Modal>
      )}

      {isQRModalOpen && (
        <QRModal
          group={group}
          onClose={() => setIsQRModalOpen(false)}
          onAdded={() => setGroups(gs => gs.map(g => (g.id === gid ? { ...g, student_count: (g.student_count || 0) + 1 } : g)))}
        />
      )}

      {isStudentsModalOpen && (
        <StudentsModal
          groupId={gid}
          groupName={group.name}
          initialTab={isStudentsModalOpen === 'pending' ? 'pending' : 'active'}
          pendingCount={group.pending_count || 0}
          onClose={() => {
            setIsStudentsModalOpen(false);
            // приняли или отклонили новых — обновить число учеников и метку «Новые»
            getMyGroups({ with_guest: true }).then(setGroups).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

export default GroupPage;
