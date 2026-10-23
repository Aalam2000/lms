import React, { useState, useEffect, useRef } from 'react';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { ContactIcon } from '../components/ContactIcons';
import IconButton from '../components/IconButton';
import DeleteButton from '../components/DeleteButton';
import * as adminApi from '../api/admin';
import Avatar from '../components/Avatar';
import { useAuth } from '../context/AuthContext';
import AcademyTab from '../components/AcademyTab';
import { getSectors } from '../api/academy';
import PushMark from '../components/PushMark';
import { usePushUsers } from '../hooks/usePushUsers';
import { GroupAdminModal } from '../components/GroupScheduleModal';
import UserCardModal from '../components/UserCardModal';
import { useLang } from '../hooks/useLang';

const emptyCourse  = { title: '', description: '' };

const emptyCourseEdit = { title: '', description: '' };
const ROLE_LABELS = { admin: 'Админ', teacher: 'Педагог', curator: 'Куратор' };
// Фильтр пользователей: на ПК — слово, на телефоне — цветная кнопка с первой буквой роли
const ROLE_FILTERS = { admin: 'Админы', teacher: 'Педагоги', curator: 'Кураторы' };
// Буквы — по языку интерфейса: одиночную букву autoi18n не переводит (как подписи
// календаря в Calendar.jsx). Язык без своей строки — буквы английского.
const ROLE_LETTERS_BY_LANG = {
  ru: { admin: 'А', teacher: 'П', curator: 'К' },
  az: { admin: 'A', teacher: 'M', curator: 'K' },
  en: { admin: 'A', teacher: 'T', curator: 'C' },
};

function AdminPage() {
  const { user: currentUser } = useAuth();
  const pushUsers = usePushUsers(); // кто разрешил уведомления
  const { lang } = useLang();
  const ROLE_LETTERS = ROLE_LETTERS_BY_LANG[lang] || ROLE_LETTERS_BY_LANG.en;
  const [tab, setTab] = useState('users');

  // Пользователи — админы, педагоги, кураторы одной вкладкой
  const [users, setUsers] = useState([]);
  const [userFilter, setUserFilter] = useState('all'); // all | admin | teacher | curator
  // Карточка пользователя: { user } — клик по строке, { user: null } — «+ Добавить пользователя»
  const [userModal, setUserModal] = useState(null);
  const [courses,  setCourses]  = useState([]);
  const [groups,   setGroups]   = useState([]);
  // «Настройка группы»: { group } — клик по строке, { group: null } — «+ Добавить группу»
  const [groupModal, setGroupModal] = useState(null);
  // Секторы — справочник с вкладки «Академия»: [{code, name, lesson_word}]
  const [sectors,  setSectors]  = useState([]);

  const [newCourse,  setNewCourse]  = useState(emptyCourse);

  // Модалка «Добавить»: null | 'course'
  const [openAddModal, setOpenAddModal] = useState(null);

  const [editingCourseId, setEditingCourseId] = useState(null);
  const [editingCourseDraft, setEditingCourseDraft] = useState(emptyCourseEdit);
  const [isSavingCourse, setIsSavingCourse] = useState(false);
  const coursesTableRef = useRef(null);


  const [error, setError] = useState('');

  useEffect(() => {
    loadAll();
  }, []);

  // Курсы: клик по строке открывает её поля для редактирования, клик мимо
  // таблицы сохраняет черновик.
  useEffect(() => {
    const handleDocumentMouseDown = (event) => {
      if (tab === 'courses' && editingCourseId !== null && !isSavingCourse) {
        if (!coursesTableRef.current?.contains(event.target)) saveEditingCourse();
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [
    tab,
    editingCourseId, editingCourseDraft, isSavingCourse,
  ]);

  const loadAll = () => {
    loadUsers();
    loadCourses();
    loadGroups();
    loadSectors();
  };

  const loadUsers    = async () => setUsers(await adminApi.getUsers());
  const loadCourses  = async () => setCourses(await adminApi.getCourses());
  const loadGroups   = async () => setGroups(await adminApi.getGroups());
  const loadSectors  = async () => { setSectors(await getSectors()); };

  const handleError = (e) => {
    setError(e.response?.data?.detail || 'Ошибка');
    setTimeout(() => setError(''), 4000);
  };


  const closeAddModal = () => {
    setOpenAddModal(null);
    setNewCourse(emptyCourse);
  };

  const createCourse = async () => {
    try {
      await adminApi.createCourse(newCourse);
      closeAddModal();
      loadCourses();
    } catch(e) { handleError(e); }
  };

  // Активную группу можно только отправить в архив; удалить навсегда —
  // только из архива (бэкенд это тоже проверяет).
  const [showArchivedGroups, setShowArchivedGroups] = useState(false);
  const archiveGroup = async (g) => {
    if (!window.confirm(`Отправить группу «${g.name}» в архив?`)) return;
    try { await adminApi.archiveGroup(g.id); loadGroups(); }
    catch(e) { handleError(e); }
  };
  const restoreGroup = async (g) => {
    try { await adminApi.restoreGroup(g.id); loadGroups(); }
    catch(e) { handleError(e); }
  };
  const deleteGroup = async (g) => {
    if (!window.confirm(`Удалить группу «${g.name}» навсегда? Это действие нельзя отменить.`)) return;
    try { await adminApi.deleteGroup(g.id); loadGroups(); }
    catch(e) { handleError(e); }
  };

  // ── inline-редактирование: курсы ──
  const startEditCourse = (c) => {
    if (editingCourseId === c.id) return;
    if (isSavingCourse) return;
    setEditingCourseId(c.id);
    setEditingCourseDraft({
      title: c.title || '',
      description: c.description || '',
    });
  };
  const saveEditingCourse = async () => {
    if (editingCourseId === null || isSavingCourse) return;
    try {
      setIsSavingCourse(true);
      const saved = await adminApi.updateCourse(editingCourseId, editingCourseDraft);
      setCourses(prev => prev.map(c => c.id === editingCourseId ? saved : c));
      setEditingCourseId(null);
    } catch (e) {
      handleError(e);
    } finally {
      setIsSavingCourse(false);
    }
  };

  const tabs = [
    { key: 'users',    label: 'Пользователи' },
    { key: 'courses',  label: 'Курсы' },
    { key: 'groups',   label: 'Группы' },
    { key: 'academy',  label: 'Компания' },
  ];

  // Вести группы могут педагоги и админы
  const teachersForGroups = users.filter(u => u.role === 'teacher' || u.role === 'admin');

  const sectorLabel = (code) => sectors.find(s => s.code === code)?.name || code || '—';
  const courseLabelById = (courseId) => courses.find(c => c.id === courseId)?.title || `#${courseId}`;
  const teacherLabelById = (teacherId) => {
    const user = teachersForGroups.find(u => u.id === teacherId);
    return user?.full_name || user?.username || `#${teacherId}`;
  };

  // del: {path, reload, tip} — удаление через общую кнопку с контролем
  // использования (DeleteButton, entity "user")
  const showError = (msg) => { setError(msg); setTimeout(() => setError(''), 4000); };

  return (
    <div className="page">
      {error && <div className="banner banner--error">{error}</div>}

      <div className="tabs-row">
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`tab${tab === tb.key ? ' tab--active' : ''}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ПОЛЬЗОВАТЕЛИ: админы, педагоги, кураторы. Клик по строке — карточка */}
      {tab === 'users' && (
        <div>
          <div className="toolbar">
            <div className="role-filter">
              <button type="button" className={`role-filter__btn${userFilter === 'all' ? ' role-filter__btn--on' : ''}`} onClick={() => setUserFilter('all')}>
                {'Все'}
              </button>
              {Object.keys(ROLE_FILTERS).map(key => (
                <button key={key} type="button"
                  className={`role-filter__btn role-filter__btn--${key}${userFilter === key ? ' role-filter__btn--on' : ''}`}
                  data-tip={ROLE_FILTERS[key]}
                  onClick={() => setUserFilter(key)}>
                  <span className="only-desktop">{ROLE_FILTERS[key]}</span>
                  <span className="only-mobile">{ROLE_LETTERS[key]}</span>
                </button>
              ))}
            </div>
            <Button onClick={() => setUserModal({ user: null })}>
              <span className="only-desktop">{'+ Пользователь'}</span>
              <span className="only-mobile role-filter__plus">{'+'}</span>
            </Button>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{'Имя'}</th>
                <th>{'Роль'}</th>
                <th></th>
                <th></th>
                <th></th>
                <th></th>
              </tr></thead>
              <tbody>
                {users.filter(u => userFilter === 'all' || u.role === userFilter).length === 0 && (
                  <tr><td colSpan="6" className="table__empty">{'Пользователей нет'}</td></tr>
                )}
                {users.filter(u => userFilter === 'all' || u.role === userFilter).map(u => (
                  <tr key={u.id} onClick={() => setUserModal({ user: u })} className="table__row--clickable"
                    data-tip={'Карточка пользователя'}>
                    <td>
                      <span className="person">
                        <Avatar userId={u.id} photoUrl={u.photo_url} name={u.full_name || u.username} size="xs" />
                        {u.full_name}
                      </span>
                      {pushUsers.has(u.id) && <PushMark />}
                    </td>
                    <td className="table__icon-col">
                      <span className={`badge badge--role badge--${u.role}`}>
                        <span className="only-desktop">{ROLE_LABELS[u.role] || u.role}</span>
                        <span className="only-mobile">{ROLE_LETTERS[u.role] || u.role}</span>
                      </span>
                    </td>
                    <td className="table__icon-col">{u.telegram_username ? <ContactIcon type="telegram" value={u.telegram_username} /> : null}</td>
                    <td className="table__icon-col">{u.whatsapp ? <ContactIcon type="whatsapp" value={u.whatsapp} /> : null}</td>
                    <td className="table__icon-col">{u.email ? <ContactIcon type="email" value={u.email} /> : null}</td>
                    <td className="table__icon-col" onClick={e => e.stopPropagation()}>
                      {u.id !== currentUser?.id && (
                        <DeleteButton
                          entity="user"
                          id={u.id}
                          name={u.full_name || u.username}
                          tip={'Удалить пользователя'}
                          onDelete={() => adminApi.deleteUser(u.id)}
                          onDeleted={loadUsers}
                          onError={showError}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {userModal && (
        <UserCardModal
          user={userModal.user}
          currentUserId={currentUser?.id}
          onClose={(changed) => { setUserModal(null); if (changed) loadUsers(); }}
        />
      )}

      {/* КУРСЫ */}
      {tab === 'courses' && (
        <div>
          <div className="toolbar">
            <h3 className="toolbar__title">{'Список курсов'}</h3>
            <Button onClick={() => setOpenAddModal('course')}>{'+ Добавить курс'}</Button>
          </div>
          <div className="table-scroll" ref={coursesTableRef}>
            <table className="table">
              <thead><tr>
                <th>{'Название'}</th>
                <th>{'Описание'}</th>
                <th></th>
              </tr></thead>
              <tbody>
                {courses.map(c => (
                  <tr key={c.id} onClick={() => startEditCourse(c)} className="table__row--clickable">
                    <td>
                      {editingCourseId === c.id ? (
                        <input className="input input--min160" value={editingCourseDraft.title}
                          onChange={e => setEditingCourseDraft({ ...editingCourseDraft, title: e.target.value })}
                        />
                      ) : c.title}
                    </td>
                    <td>
                      {editingCourseId === c.id ? (
                        <textarea className="input input--textarea" value={editingCourseDraft.description}
                          onChange={e => setEditingCourseDraft({ ...editingCourseDraft, description: e.target.value })}
                        />
                      ) : c.description}
                    </td>
                    <td>
                      <DeleteButton
                        entity="course"
                        id={c.id}
                        name={c.title}
                        tip="Удалить курс"
                        onDelete={() => adminApi.deleteCourse(c.id)}
                        onDeleted={loadCourses}
                        onError={showError}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ГРУППЫ */}
      {tab === 'groups' && (
        <div>
          <div className="toolbar">
            <h3 className="toolbar__title">{showArchivedGroups ? 'Архив групп' : 'Список групп'}</h3>
            <div className="icon-row">
              <IconButton
                icon="archive"
                tip={showArchivedGroups ? 'Вернуться к активным группам' : 'Показать архив'}
                active={showArchivedGroups}
                onClick={() => setShowArchivedGroups(v => !v)}
              />
              {!showArchivedGroups && (
                <Button onClick={() => setGroupModal({ group: null })}>{'+ Добавить группу'}</Button>
              )}
            </div>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead><tr>
                <th>{'Название'}</th>
                <th>{'Курс'}</th>
                <th>{'Сектор'}</th>
                <th>{'Педагог'}</th>
                <th></th>
                <th></th>
                <th></th>
                <th></th>
              </tr></thead>
              <tbody>
                {groups.filter(g => (g.status === 'archived') === showArchivedGroups).length === 0 && (
                  <tr><td colSpan="8" className="table__empty">{showArchivedGroups ? 'Архив пуст' : 'Групп пока нет'}</td></tr>
                )}
                {/* Клик по строке — «Настройка группы»; значки связи — только заполненные, по колонке на вид */}
                {groups.filter(g => (g.status === 'archived') === showArchivedGroups).map(g => (
                  <tr key={g.id} onClick={() => setGroupModal({ group: g })} className="table__row--clickable"
                    data-tip={'Настройка группы'}>
                    <td>{g.name}</td>
                    <td>{courseLabelById(g.course_id)}</td>
                    <td>{sectorLabel(g.sector)}</td>
                    <td>{teacherLabelById(g.teacher_id)}</td>
                    <td className="table__icon-col">{g.telegram_chat_id ? <ContactIcon type="telegram" value={g.telegram_chat_id} /> : null}</td>
                    <td className="table__icon-col">{g.whatsapp ? <ContactIcon type="whatsapp" value={g.whatsapp} /> : null}</td>
                    <td className="table__icon-col">{g.video_url ? <ContactIcon type="video" value={g.video_url} /> : null}</td>
                    <td className="table__icon-col">
                      <div className="icon-row">
                        {g.status === 'archived' ? (
                          <>
                            <IconButton
                              icon="restore"
                              tip="Вернуть из архива"
                              onClick={(e) => { e.stopPropagation(); restoreGroup(g); }}
                            />
                            <IconButton
                              icon="delete"
                              tip="Удалить навсегда"
                              variant="danger"
                              onClick={(e) => { e.stopPropagation(); deleteGroup(g); }}
                            />
                          </>
                        ) : (
                          <IconButton
                            icon="archive"
                            tip="Отправить в архив"
                            variant="warn"
                            onClick={(e) => { e.stopPropagation(); archiveGroup(g); }}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {groupModal && (
        <GroupAdminModal
          group={groupModal.group}
          groups={groups.filter(g => g.status !== 'archived')}
          courses={courses}
          sectors={sectors}
          teachers={teachersForGroups}
          onClose={(changed) => { setGroupModal(null); if (changed) loadGroups(); }}
        />
      )}

      {/* АКАДЕМИЯ: данные академии и секторы */}
      {tab === 'academy' && (
        <AcademyTab sectors={sectors} onSectorsChanged={loadSectors} onError={showError} />
      )}

      {/* Модалка: новый курс */}
      {openAddModal === 'course' && (
        <Modal title={'Новый курс'} onClose={closeAddModal} footer={(
          <>
            <button className="btn btn--secondary" onClick={closeAddModal}>{'Отмена'}</button>
            <Button onClick={createCourse}>{'Добавить'}</Button>
          </>
        )}>
          <div className="form-stack">
            <input placeholder={'Название курса'} className="input input--min160"
              autoComplete="off"
              value={newCourse.title}
              onChange={e => setNewCourse({ ...newCourse, title: e.target.value })}
            />
            <textarea placeholder={'Описание курса'} className="input input--textarea"
              value={newCourse.description}
              onChange={e => setNewCourse({ ...newCourse, description: e.target.value })}
            />
          </div>
        </Modal>
      )}

    </div>
  );
}

export default AdminPage;
