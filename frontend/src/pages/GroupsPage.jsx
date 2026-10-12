import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { StudentContactIcons } from '../components/ContactIcons';
import Dropdown from '../components/Dropdown';
import Calendar, { GROUP_COLORS } from '../components/Calendar';
import { getMyLessons } from '../api/lessons';
import { useHomeworkRefresh } from '../hooks/useHomeworkRefresh';
import IconButton from '../components/IconButton';

function GroupsPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');

  const [allMyGroups, setGroups] = useState([]);
  // Группы в архиве показываются только по кнопке «Архив»
  const [showArchived, setShowArchived] = useState(false);
  const groups = useMemo(
    () => allMyGroups.filter(g => (g.status === 'archived') === showArchived),
    [allMyGroups, showArchived],
  );
  // Свои группы и группы, где педагог только ведёт или вёл отдельные уроки (is_main: false)
  const mainGroups = useMemo(() => groups.filter(g => g.is_main !== false), [groups]);
  const guestGroups = useMemo(() => groups.filter(g => g.is_main === false), [groups]);
  const [courses, setCourses] = useState([]);
  const [allGroups, setAllGroups] = useState([]); // только у admin — для списка «Препод»
  const [lessons, setLessons] = useState([]); // для календаря — уроки всех видимых групп
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Таблица/Календарь — по умолчанию таблица, выбор запоминается отдельно
  // от того же переключателя на странице группы (GroupPage.jsx).
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('la_groups_viewmode') || 'table'); // table | calendar
  useEffect(() => {
    localStorage.setItem('la_groups_viewmode', viewMode);
  }, [viewMode]);

  // Выбор «Препод/Мои» запоминаем в localStorage — чтобы не сбрасывался
  // при возврате на страницу (уходишь в группу и назад — фильтр на месте).
  const [teacherId, setTeacherId] = useState(() => localStorage.getItem('la_groups_teacherId') || '');
  const [mine, setMine] = useState(() => {
    const stored = localStorage.getItem('la_groups_mine');
    return stored === null ? true : stored === 'true'; // у admin по умолчанию — только свои группы
  });

  useEffect(() => {
    localStorage.setItem('la_groups_teacherId', teacherId);
  }, [teacherId]);

  useEffect(() => {
    localStorage.setItem('la_groups_mine', String(mine));
  }, [mine]);

  // Курсы и (у admin) полный список групп — один раз, для фильтров.
  useEffect(() => {
    api.get('/groups/courses').then(r => setCourses(r.data)).catch(() => {});
    if (isAdmin) {
      api.get('/admin/groups').then(r => setAllGroups(r.data)).catch(() => {});
    }
    // eslint-disable-next-line
  }, [isAdmin]);

  useEffect(() => {
    loadGroups();
    // eslint-disable-next-line
  }, [teacherId, mine]);

  // silent — фоновое обновление отметок о ДЗ: без «Загрузка...» и без сообщения об ошибке
  const loadGroups = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const params = {};
      if (isAdmin && mine) params.mine = true;
      if (isAdmin && !mine && teacherId) params.teacher_id = teacherId;
      const [groupsRes, lessonsRes] = await Promise.all([
        api.get('/groups/my', { params: { ...params, with_guest: true } }),
        getMyLessons(params),
      ]);
      setGroups(groupsRes.data);
      setLessons(lessonsRes);
    } catch (err) {
      if (!silent) setError(err?.response?.data?.detail || 'Не удалось загрузить группы');
    } finally {
      if (!silent) setLoading(false);
    }
  };
  useHomeworkRefresh(() => loadGroups(true));

  const courseName = (courseId) =>
    courses.find(c => c.id === courseId)?.title || '—';

  // Для календаря — имя группы у каждого урока (сама LessonOut его не
  // содержит), и, если видно несколько преподавателей сразу, добавляем
  // имя препода — иначе на агрегированном календаре не различить, чей урок.
  const calendarLessons = lessons.filter(l => groups.some(g => g.id === l.group_id)).map(l => {
    const g = groups.find(x => x.id === l.group_id);
    const groupName = g?.name || `#${l.group_id}`;
    const showTeacher = isAdmin && !mine && !teacherId;
    return { ...l, group_name: showTeacher && g?.teacher_name ? `${groupName} (${g.teacher_name})` : groupName };
  });

  // Цвет группы — от полного списка видимых групп (groups), а не только
  // тех, у кого уже есть уроки: иначе только что созданная пустая группа
  // пропадала бы из вида в режиме календаря — её нельзя было бы ни увидеть,
  // ни открыть. Порядок стабильный — id, тот же цвет и в календаре, и в
  // списке групп рядом с ним.
  const groupColorMap = useMemo(() => {
    const map = {};
    groups.forEach((g, i) => { map[g.id] = GROUP_COLORS[i % GROUP_COLORS.length]; });
    return map;
  }, [groups]);
  const getEventColor = (lesson) => groupColorMap[lesson.group_id] || GROUP_COLORS[0];

  // Список преподавателей — из полного списка групп (только те, у кого
  // реально есть группы), тот же приём, что и в StudentsPage.
  const teacherOptions = isAdmin
    ? Array.from(
        new Map(allGroups.map(g => [g.teacher_id, g.teacher_name || `#${g.teacher_id}`])).entries()
      ).sort((a, b) => a[1].localeCompare(b[1]))
    : [];

  const handleMineToggle = () => {
    setMine(v => {
      const next = !v;
      if (next) setTeacherId('');
      return next;
    });
  };

  if (loading) return <div className="page">{'Загрузка...'}</div>;

  return (
    <div className="page">
      <div className="toolbar toolbar--inline">
        <h2 className="toolbar__title">
          {showArchived ? 'Архив групп' : (isAdmin ? 'Группы' : 'Мои группы')}
        </h2>
        {/* В строке заголовка: переключатель вида (выбранный значок залит) и архив */}
        <div className="icon-row">
          <IconButton icon="tableView" tip={'Таблица'} active={viewMode === 'table'} onClick={() => setViewMode('table')} />
          <IconButton icon="calendarView" tip={'Календарь'} active={viewMode === 'calendar'} onClick={() => setViewMode('calendar')} />
          <IconButton
            icon="archive"
            tip={showArchived ? 'Вернуться к активным группам' : 'Показать архив'}
            active={showArchived}
            onClick={() => setShowArchived(v => !v)}
          />
        </div>
      </div>

      {isAdmin && (
        <div className="toolbar__filters">
          <Dropdown
            value={mine ? '' : teacherId}
            disabled={mine}
            onChange={v => setTeacherId(v)}
            placeholder={'Учитель — все'}
            options={teacherOptions.map(([id, name]) => ({ value: id, label: name }))}
          />
          <button type="button" className={`tab tab--underline${mine ? ' tab--active' : ''}`} onClick={handleMineToggle}>
            {'Мои'}
          </button>
        </div>
      )}

      {error && <div className="error-text error-text--top">{error}</div>}

      {viewMode === 'calendar' ? (
        <>
          <Calendar
            lessons={calendarLessons}
            getEventColor={getEventColor}
            onSelectLesson={(l) => navigate(`/dashboard/lessons/${l.id}`)}
          />
          {/* Список групп остаётся виден и кликабелен и в календаре — тут
              же можно открыть саму группу, а не только её урок. Со всеми
              видимыми группами, даже без единого урока пока. */}
          <div className="la-calendar__legend">
            {groups.map(g => (
              <button
                key={g.id}
                type="button"
                className="la-calendar__legend-item la-calendar__legend-item--clickable"
                onClick={() => navigate(`/dashboard/groups/${g.id}`)}
              >
                <span className="la-calendar__legend-dot" style={{ '--la-event-color': groupColorMap[g.id] }} />
                {g.name}
                {g.is_main === false && <span className="badge badge--teacher badge--inline">{'мои уроки'}</span>}
                {g.homework_to_review > 0 && (
                  <span className="badge badge--homework-pending badge--inline" data-tip={'Есть непроверенные решения ДЗ'}>
                    {'ДЗ: проверить'}<span className="badge__count">{g.homework_to_review}</span>
                  </span>
                )}
                {g.work_to_review > 0 && (
                  <span className="badge badge--homework-pending badge--inline" data-tip={'Есть непроверенные работы на уроке'}>
                    {'Работы: проверить'}<span className="badge__count">{g.work_to_review}</span>
                  </span>
                )}
                {g.pending_count > 0 && (
                  <span className="badge badge--homework-pending badge--inline" data-tip={'Новые ученики ждут подтверждения'}>
                    {'Новые'}<span className="badge__count">{g.pending_count}</span>
                  </span>
                )}
              </button>
            ))}
            <span className="la-calendar__legend-item">
              <span className="la-calendar__legend-dot la-calendar__legend-dot--light" />
              {'светлый — открыт ученикам'}
            </span>
          </div>
        </>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{'Название группы'}</th>
                <th>{'Курс'}</th>
                {isAdmin && !mine && !teacherId && <th>{'Учитель'}</th>}
                <th>{'Учеников'}</th>
                <th>{'Контакты'}</th>
              </tr>
            </thead>
            <tbody>
              {mainGroups.length === 0 && (
                <tr>
                  <td colSpan={isAdmin && !mine && !teacherId ? 5 : 4} className="table__empty">
                    {showArchived ? 'Архив пуст' : 'Групп пока нет'}
                  </td>
                </tr>
              )}
              {mainGroups.map(g => (
                <tr
                  key={g.id}
                  className={`table__row--clickable${g.homework_to_review > 0 || g.work_to_review > 0 || g.pending_count > 0 ? ' table__row--homework-pending table__row--attention' : ''}`}
                  onClick={() => navigate(`/dashboard/groups/${g.id}`)}
                >
                  <td>
                    {g.name}
                    {g.homework_to_review > 0 && (
                      <span className="badge badge--homework-pending badge--inline" data-tip={'Есть непроверенные решения ДЗ'}>
                        {'ДЗ: проверить'}<span className="badge__count">{g.homework_to_review}</span>
                      </span>
                    )}
                    {g.work_to_review > 0 && (
                      <span className="badge badge--homework-pending badge--inline" data-tip={'Есть непроверенные работы на уроке'}>
                        {'Работы: проверить'}<span className="badge__count">{g.work_to_review}</span>
                      </span>
                    )}
                    {g.pending_count > 0 && (
                      <span className="badge badge--homework-pending badge--inline" data-tip={'Новые ученики ждут подтверждения'}>
                        {'Новые'}<span className="badge__count">{g.pending_count}</span>
                      </span>
                    )}
                  </td>
                  <td>{courseName(g.course_id)}</td>
                  {isAdmin && !mine && !teacherId && <td>{g.teacher_name || `#${g.teacher_id}`}</td>}
                  <td>{g.student_count ?? 0}</td>
                  <td>
                    <StudentContactIcons telegram={g.telegram_chat_id} whatsapp={g.whatsapp} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Группы, где педагог не основной: замены и уроки до передачи группы — только эти уроки */}
      {viewMode === 'table' && guestGroups.length > 0 && (
        <>
          <div className="toolbar toolbar--inline">
            <h2 className="toolbar__title">{'Мои уроки в других группах'}</h2>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{'Название группы'}</th>
                  <th>{'Курс'}</th>
                  <th>{'Основной педагог'}</th>
                  <th>{'Моих уроков'}</th>
                </tr>
              </thead>
              <tbody>
                {guestGroups.map(g => (
                  <tr key={g.id} className="table__row--clickable" onClick={() => navigate(`/dashboard/groups/${g.id}`)}>
                    <td>{g.name}</td>
                    <td>{courseName(g.course_id)}</td>
                    <td>{g.teacher_name || '—'}</td>
                    <td>{lessons.filter(l => l.group_id === g.id).length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default GroupsPage;
