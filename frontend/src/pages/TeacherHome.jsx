import React, { useState, useEffect } from 'react';
import { PersonalBadge } from '../components/PersonalLesson';
import { useNavigate } from 'react-router';
import { getMyLessons, createLesson } from '../api/lessons';
import { getMyGroups, getCourses } from '../api/groups';
import Modal from '../components/Modal';
import DateTimePicker, { nextHour } from '../components/DateTimePicker';

function TeacherHome() {
  const navigate = useNavigate();
  const [lessons,  setLessons]  = useState([]);
  const [groups,   setGroups]   = useState([]);
  const [courses,  setCourses]  = useState([]);
  const [filterGroup,  setFilterGroup]  = useState('');
  const [filterCourse, setFilterCourse] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newLessonGroup, setNewLessonGroup] = useState('');
  const [newLessonDate, setNewLessonDate] = useState(nextHour); // Date: сегодня, следующий час, :00
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    getMyLessons().then(setLessons);
    getMyGroups().then(setGroups);
    getCourses().then(setCourses);
  }, []);

  // Связанные фильтры
  const availableGroups = filterCourse
    ? groups.filter(g => g.course_id === parseInt(filterCourse))
    : groups;

  const availableCourses = filterGroup
    ? courses.filter(c => c.id === groups.find(g => g.id === parseInt(filterGroup))?.course_id)
    : courses;

  // Автозаполнение курса если у группы он один
  const handleGroupChange = (gid) => {
    setFilterGroup(gid);
    if (gid) {
      const group = groups.find(g => g.id === parseInt(gid));
      if (group) setFilterCourse(String(group.course_id));
    } else {
      setFilterCourse('');
    }
  };

  const filtered = lessons.filter(l => {
    if (filterGroup  && l.group_id !== parseInt(filterGroup))  return false;
    if (filterCourse && groups.find(g => g.id === l.group_id)?.course_id !== parseInt(filterCourse)) return false;
    return true;
  });

  // По умолчанию — с сегодня
  const today = new Date(); today.setHours(0,0,0,0);
  const visible = filtered.filter(l => !l.date || new Date(l.date) >= today);

  const groupName  = (id) => groups.find(g => g.id === id)?.name || '—';
  const courseName = (id) => {
    const g = groups.find(gr => gr.id === id);
    return courses.find(c => c.id === g?.course_id)?.title || '—';
  };

  const openCreateModal = () => {
    setCreateError('');
    setNewLessonDate(nextHour());
    if (filterGroup) {
      setNewLessonGroup(filterGroup);
    } else if (availableGroups.length === 1) {
      setNewLessonGroup(String(availableGroups[0].id));
    } else {
      setNewLessonGroup('');
    }
    setIsModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsModalOpen(false);
    setCreateError('');
    setIsCreating(false);
  };

  const handleCreateLesson = async (e) => {
    e.preventDefault();
    if (!newLessonGroup || !newLessonDate) {
      setCreateError('Выберите группу и дату/время начала урока');
      return;
    }

    setIsCreating(true);
    setCreateError('');

    try {
      const payload = {
        group_id: parseInt(newLessonGroup),
        date: newLessonDate.toISOString(),
      };
      const created = await createLesson(payload);
      setLessons(prev => [...prev, created]);
      closeCreateModal();
    } catch (err) {
      setCreateError(err?.response?.data?.detail || 'Не удалось создать урок');
      setIsCreating(false);
    }
  };

  return (
    <div className="page">
      <div className="toolbar toolbar--start">
        <h2 className="toolbar__title">{'Уроки'}</h2>
        <div className="toolbar__filters">
          <select className="input" value={filterGroup} onChange={e => handleGroupChange(e.target.value)}>
            <option value="">{'— Все группы —'}</option>
            {availableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select className="input" value={filterCourse} onChange={e => { setFilterCourse(e.target.value); setFilterGroup(''); }}>
            <option value="">{'— Все курсы —'}</option>
            {availableCourses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </div>
        <button className="btn" onClick={openCreateModal}>
          {'+ Урок'}
        </button>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>{'Дата'}</th>
            <th>{'Тема урока'}</th>
            <th>{'Группа'}</th>
            <th>{'Курс'}</th>
            <th>{'Доступ'}</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr><td colSpan={5} className="table__empty">
              {'Уроков нет'}
            </td></tr>
          )}
          {visible.map(l => (
            <tr key={l.id} className="table__row--clickable" onClick={() => navigate(`/dashboard/lessons/${l.id}`)}>
              <td>{l.date ? new Date(l.date).toLocaleDateString('ru-RU') : '—'}</td>
              <td>{l.title}<PersonalBadge lesson={l} /></td>
              <td>{groupName(l.group_id)}</td>
              <td>{courseName(l.group_id)}</td>
              <td>
                <span className={`badge ${l.is_open ? 'badge--open' : 'badge--closed'}`}>
                  {l.is_open ? 'Открыт' : 'Закрыт'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

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
              {'Группа'}
              <select
                className="input"
                value={newLessonGroup}
                onChange={e => setNewLessonGroup(e.target.value)}
                required
              >
                <option value="">{'— Выберите группу —'}</option>
                {availableGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </label>

            <div className="field-label">
              {'Дата и время начала'}
              <div>
                <DateTimePicker value={newLessonDate} onChange={setNewLessonDate} floating />
              </div>
            </div>

            {createError && <div className="form-field__error">{createError}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}

export default TeacherHome;
