import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { getCourses, getMyGroups } from '../api/groups';
import { getGroups } from '../api/admin';
import { useAuth } from '../context/AuthContext';
import { usePref } from '../hooks/usePref';
import { StudentContactIcons } from '../components/ContactIcons';
import Dropdown from '../components/Dropdown';
import DeleteButton from '../components/DeleteButton';
import IconButton from '../components/IconButton';
import PasswordModal from '../components/PasswordModal';
import SortTh, { sortRows } from '../components/SortTh';
import StudentCardModal from '../components/StudentCardModal';
import Modal from '../components/Modal';
import DateTimePicker, { nextHour } from '../components/DateTimePicker';
import { setStudentPassword, getStudents, deleteStudent, createStudentLesson } from '../api/students';
import Avatar from '../components/Avatar';
import { extractErrorMessage } from '../utils/errors';
import PushMark from '../components/PushMark';
import { usePushUsers } from '../hooks/usePushUsers';

// Последний вход: «05.10.2026 14:32», нет входов — «—»
const formatLogin = (value) => {
  if (!value) return '—';
  const d = new Date(value);
  return `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
};

// Доп. урок ученику (кнопка «Урок» в строке): нет группы — выбрать её, ученик
// запишется в неё; несколько групп — выбрать одну. Урок — персональный урок группы.
function StudentLessonModal({ student, groups, onClose, onDone }) {
  const own = student.groups || [];
  // Без группы — группы его курса (и педагога, к которому направлен, если указан)
  const choices = own.length ? own : groups.filter(g =>
    (!g.status || g.status === 'active')
    && (!student.course_id || g.course_id === student.course_id)
    && (!student.teacher_id || g.teacher_id === student.teacher_id));
  const [groupId, setGroupId] = useState(own.length === 1 ? String(own[0].id) : '');
  const [when, setWhen] = useState(nextHour); // сегодня, следующий час, :00
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!when || (own.length !== 1 && !groupId)) { setError('Выберите группу, дату и время'); return; }
    setBusy(true);
    setError('');
    try {
      await createStudentLesson(student.id, when.toISOString(), groupId ? Number(groupId) : null);
      onDone();
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось создать урок'));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={<>{'Доп. урок'}: {student.full_name}</>}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>{'Отмена'}</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>{'Создать урок'}</button>
        </>
      )}
    >
      <div className="form-stack">
        {own.length !== 1 && (
          <select className="input" value={groupId} onChange={e => setGroupId(e.target.value)}>
            <option value="">{own.length ? 'Группа ученика' : 'Группа — ученик запишется в неё'}</option>
            {choices.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        )}
        <DateTimePicker value={when} onChange={setWhen} floating />
        {error && <div className="form-field__error">{error}</div>}
      </div>
    </Modal>
  );
}

function StudentsPage() {
  const { user, hasRole, can } = useAuth();
  const pushUsers = usePushUsers(); // кто разрешил уведомления
  // Все ученики и фильтр по учителю — право students.all (админ, куратор)
  const isAdmin = can('students.all');
  const canDelete = hasRole('admin');
  const [lessonStudent, setLessonStudent] = useState(null); // ученик в окне «Доп. урок»

  const [students, setStudents] = useState([]);
  const [courses, setCourses] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [passwordStudent, setPasswordStudent] = useState(null); // ученик, которому меняют пароль
  const [cardStudentId, setCardStudentId] = useState(null);     // карточка ученика: id — правка
  const [isAddingStudent, setIsAddingStudent] = useState(false); // карточка нового ученика

  const [courseId, setCourseId] = useState('');
  const [groupId, setGroupId] = useState('');
  // Выбор «Препод/Мои» — в профиле (hooks/usePref.js)
  const [teacherId, setTeacherId] = usePref('students.teacher_id', '');
  const [mine, setMine] = usePref('students.mine', false);

  // Сортировка — в браузере, кликом по шапке столбца: таблица приходит
  // целиком, без постраничной загрузки. Повторный клик меняет направление.
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc'); // asc | desc

  // Курсы и группы — для фильтров. Группы у admin — все (чтобы построить
  // и список «Группа», и список «Препод» по teacher_name), у teacher —
  // только свои (тот же смысл, что и «Моё» у admin).
  useEffect(() => {
    getCourses().then(setCourses).catch(() => {});
    (isAdmin ? getGroups() : getMyGroups()).then(setGroups).catch(() => {});
    // eslint-disable-next-line
  }, [isAdmin]);

  useEffect(() => {
    loadStudents();
    // eslint-disable-next-line
  }, [courseId, groupId, teacherId, mine]);

  const loadStudents = async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (courseId) params.course_id = courseId;
      if (groupId) params.group_id = groupId;
      if (isAdmin && mine) params.mine = true;
      if (isAdmin && !mine && teacherId) params.teacher_id = teacherId;
      setStudents(await getStudents(params));
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось загрузить список студентов');
    } finally {
      setLoading(false);
    }
  };

  // Список преподавателей — из уже загруженных групп (только те, у кого
  // реально есть группы), а не отдельным запросом.
  const teacherOptions = isAdmin
    ? Array.from(
        new Map(groups.map(g => [g.teacher_id, g.teacher_name || `#${g.teacher_id}`])).entries()
      ).sort((a, b) => a[1].localeCompare(b[1]))
    : [];

  // Курсы в фильтре — только те, по которым есть группы в области видимости:
  // у педагога это его группы, у админа — все или группы выбранного педагога / «Моё».
  const scopeGroups = groups.filter(g => {
    if (!isAdmin) return true;
    if (mine) return g.teacher_id === user?.id;
    return !teacherId || String(g.teacher_id) === String(teacherId);
  });
  const scopeCourseIds = new Set(scopeGroups.map(g => g.course_id));
  const courseOptions = courses.filter(c => scopeCourseIds.has(c.id));

  // Группы в выпадающем списке сужаем по уже выбранным Теме/Преподу.
  const groupOptions = groups.filter(g => {
    if (courseId && String(g.course_id) !== String(courseId)) return false;
    if (isAdmin && !mine && teacherId && String(g.teacher_id) !== String(teacherId)) return false;
    return true;
  });

  const handleMineToggle = () => {
    setMine(v => {
      const next = !v;
      if (next) setTeacherId('');
      return next;
    });
  };

  // «Препод» показываем только пока admin смотрит сводно (не выбран ни
  // конкретный препод, ни «Моё») — иначе колонка избыточна, все и так его.
  const showTeacherColumn = isAdmin && !mine && !teacherId;
  const columnCount = 13 + (showTeacherColumn ? 1 : 0); // последняя колонка — действия

  // Значение ячейки для сортировки: текстовые колонки — строка, остальные — число (или null)
  const TEXT_KEYS = ['name', 'group', 'teacher', 'phone', 'parent_name'];
  const sortValue = (s, key) => {
    if (key === 'name') return s.full_name || '';
    if (key === 'group') return s.groups.map(g => g.name).join(', ');
    if (key === 'teacher') return [...new Set(s.groups.map(g => g.teacher_name).filter(Boolean))].join(', ');
    if (key === 'last_login_at') return s.last_login_at ? new Date(s.last_login_at).getTime() : null;
    return s[key];
  };

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // текст — от А до Я, числа — сначала большие
      setSortDir(TEXT_KEYS.includes(key) ? 'asc' : 'desc');
    }
  };

  // Новые (NEW — ещё не были на уроке) всегда в начале, дальше — выбранная сортировка
  const sortedStudents = useMemo(
    () => {
      const rows = sortRows(students, sortKey, sortDir, sortValue, TEXT_KEYS, s => s.full_name);
      return [...rows.filter(s => s.is_new), ...rows.filter(s => !s.is_new)];
    },
    // eslint-disable-next-line
    [students, sortKey, sortDir]
  );

  const sortTh = (key, label, tip, center) => (
    <SortTh k={key} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} tip={tip} center={center}>{label}</SortTh>
  );

  return (
    <div className="page">
      <div className="toolbar toolbar--underline-row">
        <div className="toolbar__filters">
          {isAdmin && (
            <Dropdown
              value={mine ? '' : teacherId}
              disabled={mine}
              onChange={v => setTeacherId(v)}
              placeholder={'Учитель — все'}
              options={teacherOptions.map(([id, name]) => ({ value: id, label: name }))}
            />
          )}
          <Dropdown
            value={courseId}
            onChange={v => { setCourseId(v); setGroupId(''); }}
            placeholder={'Тема — все'}
            options={courseOptions.map(c => ({ value: c.id, label: c.title }))}
          />
          <Dropdown
            value={groupId}
            onChange={v => setGroupId(v)}
            placeholder={'Группа — все'}
            options={groupOptions.map(g => ({ value: g.id, label: g.name }))}
          />
        </div>
        <div className="toolbar__filters">
          {canDelete && (
            <button type="button" className={`tab tab--underline${mine ? ' tab--active' : ''}`} onClick={handleMineToggle}>
              {'Моё'}
            </button>
          )}
          <button type="button" className="btn" onClick={() => setIsAddingStudent(true)}>{'+ Ученик'}</button>
        </div>
      </div>

      {error && <div className="error-text error-text--muted">{error}</div>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {sortTh('name', 'Имя')}
              {sortTh('group', 'Группа')}
              {showTeacherColumn && sortTh('teacher', 'Учитель')}
              {/* Три вида оценок — у каждой своя средняя */}
              {sortTh('avg_score', 'Ср. уроки', 'Средняя оценка за уроки')}
              {sortTh('avg_hw_score', 'Ср. ДЗ', 'Средняя оценка за домашние задания')}
              {sortTh('avg_exam_score', 'Ср. экзамены', 'Средняя экзаменационная оценка')}
              {sortTh('stars_total', <span className="table__th-star">★</span>, 'Звёзды', true)}
              {sortTh('unexcused_absences', 'Пропуски')}
              {sortTh('late_count', 'Опоздания')}
              {sortTh('last_login_at', 'Вход', 'Дата и время последнего входа в систему')}
              {sortTh('phone', 'Телефон')}
              {sortTh('parent_name', 'Родитель')}
              <th>{'Контакты'}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columnCount} className="table__empty">{'Загрузка...'}</td></tr>
            ) : students.length === 0 ? (
              <tr><td colSpan={columnCount} className="table__empty">{'Студентов не найдено'}</td></tr>
            ) : (
              sortedStudents.map(s => (
                <tr key={s.id}>
                  <td>
                    <span className="person">
                      <Avatar userId={s.id} photoUrl={s.photo_url} name={s.full_name} size="xs" />
                      {/* Отчёт по ученику за месяц — для родителей (StudentReportPage.jsx) */}
                      <Link
                        className={`link${s.homework_debt ? ` hw-debt hw-debt--${s.homework_debt}` : ''}`}
                        to={`/dashboard/students/${s.id}/report`}
                        data-tip={s.homework_debt === 'overdue' ? 'Не сдал последнее ДЗ — срок прошёл'
                          : s.homework_debt === 'pending' ? 'Ещё не сдал последнее ДЗ' : 'Отчёт по ученику'}
                      >
                        {s.full_name}
                      </Link>
                    </span>
                    {pushUsers.has(s.id) && <PushMark />}
                    {s.is_new && <span className="new-badge" data-tip="Ещё не был на уроке — поставьте доп. урок">{'NEW'}</span>}
                  </td>
                  <td>{s.groups.length ? s.groups.map(g => g.name).join(', ') : <span className="chip chip--amber">{'без группы'}</span>}</td>
                  {showTeacherColumn && (
                    <td>{[...new Set(s.groups.map(g => g.teacher_name).filter(Boolean))].join(', ') || s.teacher_name || '—'}</td>
                  )}
                  <td>{s.avg_score ?? '—'}</td>
                  <td>{s.avg_hw_score ?? '—'}</td>
                  <td>{s.avg_exam_score ?? '—'}</td>
                  <td className="table__cell--center">{s.stars_total ?? 0}</td>
                  <td>
                    {s.missed_last_lesson
                      ? <span className="absence-ring" data-tip="Пропустил последний урок">{s.unexcused_absences}</span>
                      : s.unexcused_absences}
                  </td>
                  <td>{s.late_count}</td>
                  <td className="nowrap">{formatLogin(s.last_login_at)}</td>
                  <td className={`nowrap${s.phone ? '' : ' cell-missing'}`}>{s.phone || '—'}</td>
                  <td className="nowrap">
                    {s.parent_name || s.parent_phone ? (
                      <>{s.parent_name}{s.parent_name && s.parent_phone && <br />}{s.parent_phone}</>
                    ) : '—'}
                  </td>
                  <td>
                    <StudentContactIcons telegram={s.telegram_username} whatsapp={s.whatsapp} phone={s.phone} />
                  </td>
                  <td>
                    <div className="icon-row">
                      {/* Ученик забыл пароль — педагог (своим ученикам) или админ задаёт новый */}
                      <IconButton icon="edit" tip="Данные ученика" onClick={() => setCardStudentId(s.id)} />
                      <IconButton icon="key" tip="Сменить пароль" onClick={() => setPasswordStudent(s)} />
                      {can('lessons.personal') && (
                        <IconButton icon="schedule" tip="Доп. урок" onClick={() => setLessonStudent(s)} />
                      )}
                      {/* Общая кнопка удаления с контролем использования (app/usages.py) */}
                      {canDelete && (
                      <DeleteButton
                        entity="student"
                        id={s.id}
                        name={s.full_name}
                        tip="Удалить студента"
                        forceable={canDelete}
                        onDelete={(opts) => deleteStudent(s.id, { force: !!opts?.force })}
                        onDeleted={() => setStudents(prev => prev.filter(x => x.id !== s.id))}
                        onError={setError}
                      />
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {cardStudentId && (
        <StudentCardModal
          studentId={cardStudentId}
          onClose={() => setCardStudentId(null)}
          onSaved={() => { setCardStudentId(null); loadStudents(); }}
        />
      )}
      {isAddingStudent && (
        <StudentCardModal
          groups={groups.filter(g => !g.status || g.status === 'active')}
          defaultGroupId={groupId}
          {...(isAdmin ? {
            courses,
            teachers: teacherOptions.map(([id, name]) => ({ id, name })),
            defaults: { course_id: courseId, teacher_id: teacherId },
          } : {})}
          onClose={() => setIsAddingStudent(false)}
          onSaved={(saved) => { setIsAddingStudent(false); loadStudents(); if (saved?.id) setCardStudentId(saved.id); }}
        />
      )}
      {lessonStudent && (
        <StudentLessonModal
          student={lessonStudent}
          groups={groups}
          onClose={() => setLessonStudent(null)}
          onDone={() => { setLessonStudent(null); loadStudents(); }}
        />
      )}
      {passwordStudent && (
        <PasswordModal
          user={passwordStudent}
          save={(password) => setStudentPassword(passwordStudent.id, password)}
          onClose={() => setPasswordStudent(null)}
        />
      )}
    </div>
  );
}

export default StudentsPage;
