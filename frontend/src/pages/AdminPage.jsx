import React, { useState, useEffect, useRef } from 'react';
import Button from '../components/Button';
import Modal from '../components/Modal';
import { ContactIcon } from '../components/ContactIcons';
import IconButton from '../components/IconButton';
import DeleteButton from '../components/DeleteButton';
import PasswordModal from '../components/PasswordModal';
import DaysOffEditor from '../components/DaysOffEditor';
import * as adminApi from '../api/admin';
import Avatar from '../components/Avatar';
import { useAuth } from '../context/AuthContext';
import AcademyTab from '../components/AcademyTab';
import { AccessBlock } from '../components/ParentLinkBlock';
import { getSectors } from '../api/academy';
import PushMark from '../components/PushMark';
import { usePushUsers } from '../hooks/usePushUsers';
import { GroupAdminModal } from '../components/GroupScheduleModal';

const emptyTeacher = { username: '', password: '', full_name: '', email: '', phone: '', telegram_username: '', whatsapp: '' };
const emptyAdmin   = { username: '', password: '', full_name: '', email: '', phone: '', telegram_username: '', whatsapp: '' };
// Куратор: логин и пароль генерирует бэкенд (пароль = логину)
const emptyCurator = { full_name: '', phone: '', email: '', telegram_username: '', whatsapp: '' };
const emptyCourse  = { title: '', description: '' };

const emptyUserEdit = { full_name: '', email: '', phone: '', telegram_username: '', whatsapp: '' };
const emptyCourseEdit = { title: '', description: '' };

function AdminPage() {
  const { user: currentUser } = useAuth();
  const pushUsers = usePushUsers(); // кто разрешил уведомления
  const [tab, setTab] = useState('teachers');

  const [teachers, setTeachers] = useState([]);
  const [admins,   setAdmins]   = useState([]);
  const [curators, setCurators] = useState([]);
  const [courses,  setCourses]  = useState([]);
  const [groups,   setGroups]   = useState([]);
  // «Настройка группы»: { group } — клик по строке, { group: null } — «+ Добавить группу»
  const [groupModal, setGroupModal] = useState(null);
  // Секторы — справочник с вкладки «Академия»: [{code, name, lesson_word}]
  const [sectors,  setSectors]  = useState([]);

  const [newTeacher, setNewTeacher] = useState(emptyTeacher);
  const [newAdmin,   setNewAdmin]   = useState(emptyAdmin);
  const [newCurator, setNewCurator] = useState(emptyCurator);
  const [newCourse,  setNewCourse]  = useState(emptyCourse);

  // Модалка «Добавить»: null | 'teacher' | 'admin' | 'course' | 'group'
  const [openAddModal, setOpenAddModal] = useState(null);

  const [editingTeacherId, setEditingTeacherId] = useState(null);
  const [editingTeacherDraft, setEditingTeacherDraft] = useState(emptyUserEdit);
  const [isSavingTeacher, setIsSavingTeacher] = useState(false);
  const teachersTableRef = useRef(null);

  const [editingAdminId, setEditingAdminId] = useState(null);
  const [editingAdminDraft, setEditingAdminDraft] = useState(emptyUserEdit);
  const [isSavingAdmin, setIsSavingAdmin] = useState(false);
  const adminsTableRef = useRef(null);

  const [editingCuratorId, setEditingCuratorId] = useState(null);
  const [editingCuratorDraft, setEditingCuratorDraft] = useState(emptyUserEdit);
  const [isSavingCurator, setIsSavingCurator] = useState(false);
  const curatorsTableRef = useRef(null);
  const [accessUser, setAccessUser] = useState(null); // куратор: окно «Доступ» (логин и пароль)

  const [editingCourseId, setEditingCourseId] = useState(null);
  const [editingCourseDraft, setEditingCourseDraft] = useState(emptyCourseEdit);
  const [isSavingCourse, setIsSavingCourse] = useState(false);
  const coursesTableRef = useRef(null);


  const [error, setError] = useState('');
  const [passwordUser, setPasswordUser] = useState(null); // кому админ меняет пароль
  const [daysOffUser, setDaysOffUser] = useState(null); // чьи выходные админ правит

  useEffect(() => {
    loadAll();
  }, []);

  // Клик по строке таблицы открывает её поля для редактирования, клик
  // мимо таблицы (в любой вкладке) сохраняет черновик. Один обработчик
  // на все 4 вкладки — ветвимся по активной.
  useEffect(() => {
    const handleDocumentMouseDown = (event) => {
      if (tab === 'teachers' && editingTeacherId !== null && !isSavingTeacher) {
        if (!teachersTableRef.current?.contains(event.target)) saveEditingTeacher();
      } else if (tab === 'admins' && editingAdminId !== null && !isSavingAdmin) {
        if (!adminsTableRef.current?.contains(event.target)) saveEditingAdmin();
      } else if (tab === 'curators' && editingCuratorId !== null && !isSavingCurator) {
        if (!curatorsTableRef.current?.contains(event.target)) saveEditingCurator();
      } else if (tab === 'courses' && editingCourseId !== null && !isSavingCourse) {
        if (!coursesTableRef.current?.contains(event.target)) saveEditingCourse();
      }
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [
    tab,
    editingTeacherId, editingTeacherDraft, isSavingTeacher,
    editingAdminId, editingAdminDraft, isSavingAdmin,
    editingCuratorId, editingCuratorDraft, isSavingCurator,
    editingCourseId, editingCourseDraft, isSavingCourse,
  ]);

  const loadAll = () => {
    loadTeachers();
    loadAdmins();
    loadCurators();
    loadCourses();
    loadGroups();
    loadSectors();
  };

  const loadTeachers = async () => setTeachers(await adminApi.getTeachers());
  const loadAdmins   = async () => setAdmins(await adminApi.getAdmins());
  const loadCurators = async () => setCurators(await adminApi.getCurators());
  const loadCourses  = async () => setCourses(await adminApi.getCourses());
  const loadGroups   = async () => setGroups(await adminApi.getGroups());
  const loadSectors  = async () => { setSectors(await getSectors()); };

  const handleError = (e) => {
    setError(e.response?.data?.detail || 'Ошибка');
    setTimeout(() => setError(''), 4000);
  };


  const closeAddModal = () => {
    setOpenAddModal(null);
    setNewTeacher(emptyTeacher);
    setNewAdmin(emptyAdmin);
    setNewCurator(emptyCurator);
    setNewCourse(emptyCourse);
  };

  const createTeacher = async () => {
    try {
      await adminApi.createTeacher({ ...newTeacher, role: 'teacher' });
      closeAddModal();
      loadTeachers();
    } catch(e) { handleError(e); }
  };

  const createAdmin = async () => {
    try {
      await adminApi.createAdmin({ ...newAdmin, role: 'admin' });
      closeAddModal();
      loadAdmins();
    } catch(e) { handleError(e); }
  };

  // Новый куратор: после создания сразу окно «Доступ» — скопировать или отправить логин и пароль
  const createCurator = async () => {
    if (!newCurator.full_name.trim()) {
      setError('Укажите имя и фамилию');
      setTimeout(() => setError(''), 4000);
      return;
    }
    try {
      const saved = await adminApi.createCurator(newCurator);
      closeAddModal();
      await loadCurators();
      setAccessUser(saved);
    } catch(e) { handleError(e); }
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

  // ── inline-редактирование: педагоги ──
  const startEditTeacher = (u) => {
    if (editingTeacherId === u.id) return;
    if (isSavingTeacher) return;
    setEditingTeacherId(u.id);
    setEditingTeacherDraft({
      full_name: u.full_name || '',
      email: u.email || '',
      phone: u.phone || '',
      telegram_username: u.telegram_username || '',
      whatsapp: u.whatsapp || '',
    });
  };
  const saveEditingTeacher = async () => {
    if (editingTeacherId === null || isSavingTeacher) return;
    try {
      setIsSavingTeacher(true);
      const saved = await adminApi.updateTeacher(editingTeacherId, editingTeacherDraft);
      setTeachers(prev => prev.map(u => u.id === editingTeacherId ? saved : u));
      setEditingTeacherId(null);
    } catch (e) {
      handleError(e);
    } finally {
      setIsSavingTeacher(false);
    }
  };

  // ── inline-редактирование: админы ──
  const startEditAdmin = (u) => {
    if (editingAdminId === u.id) return;
    if (isSavingAdmin) return;
    setEditingAdminId(u.id);
    setEditingAdminDraft({
      full_name: u.full_name || '',
      email: u.email || '',
      phone: u.phone || '',
      telegram_username: u.telegram_username || '',
      whatsapp: u.whatsapp || '',
    });
  };
  const saveEditingAdmin = async () => {
    if (editingAdminId === null || isSavingAdmin) return;
    try {
      setIsSavingAdmin(true);
      const saved = await adminApi.updateAdmin(editingAdminId, editingAdminDraft);
      setAdmins(prev => prev.map(u => u.id === editingAdminId ? saved : u));
      setEditingAdminId(null);
    } catch (e) {
      handleError(e);
    } finally {
      setIsSavingAdmin(false);
    }
  };

  // ── inline-редактирование: кураторы ──
  const startEditCurator = (u) => {
    if (editingCuratorId === u.id) return;
    if (isSavingCurator) return;
    setEditingCuratorId(u.id);
    setEditingCuratorDraft({
      full_name: u.full_name || '',
      email: u.email || '',
      phone: u.phone || '',
      telegram_username: u.telegram_username || '',
      whatsapp: u.whatsapp || '',
    });
  };
  const saveEditingCurator = async () => {
    if (editingCuratorId === null || isSavingCurator) return;
    try {
      setIsSavingCurator(true);
      const saved = await adminApi.updateCurator(editingCuratorId, editingCuratorDraft);
      setCurators(prev => prev.map(u => u.id === editingCuratorId ? saved : u));
      setEditingCuratorId(null);
    } catch (e) {
      handleError(e);
    } finally {
      setIsSavingCurator(false);
    }
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
    { key: 'teachers', label: 'Педагоги' },
    { key: 'admins',   label: 'Админы' },
    { key: 'curators', label: 'Кураторы' },
    { key: 'courses',  label: 'Курсы' },
    { key: 'groups',   label: 'Группы' },
    { key: 'academy',  label: 'Компания' },
  ];

  const teachersForGroups = [...teachers, ...admins].filter(
    (user, index, arr) => arr.findIndex(u => u.id === user.id) === index
  );

  const sectorLabel = (code) => sectors.find(s => s.code === code)?.name || code || '—';
  const courseLabelById = (courseId) => courses.find(c => c.id === courseId)?.title || `#${courseId}`;
  const teacherLabelById = (teacherId) => {
    const user = teachersForGroups.find(u => u.id === teacherId);
    return user?.full_name || user?.username || `#${teacherId}`;
  };

  const userFields = (data, setData) => [
    ['username',          'Логин',    'text'],
    ['password',          'Пароль',   'password'],
    ['full_name',         'Полное имя', 'text'],
    ['email',             'Email',    'text'],
    ['phone',             'Телефон',  'text'],
    ['telegram_username', 'Telegram', 'text'],
    ['whatsapp',           'WhatsApp', 'text'],
  ].map(([field, label, type]) => (
    <input key={field} placeholder={label} className="input input--min160"
      type={type} autoComplete={field === 'username' || field === 'password' ? 'new-password' : 'off'}
      value={data[field]}
      onChange={e => setData({ ...data, [field]: e.target.value })}
    />
  ));

  // del: {path, reload, tip} — удаление через общую кнопку с контролем
  // использования (DeleteButton, entity "user")
  const showError = (msg) => { setError(msg); setTimeout(() => setError(''), 4000); };

  // Смена роли педагог ⇄ админ. Себе менять нельзя (кнопка неактивна, бэкенд тоже откажет).
  const changeRole = async (u, role) => {
    const name = u.full_name || u.username;
    if (!window.confirm(role === 'admin' ? `Сделать админом: ${name}?` : `Перевести в педагоги: ${name}?`)) return;
    try {
      await adminApi.setUserRole(u.id, role);
      await Promise.all([loadTeachers(), loadAdmins()]);
    } catch (e) { handleError(e); }
  };
  const userTable = (list, del, editingId, editingDraft, setEditingDraft, onRowClick, tableRef) => (
    <div className="table-scroll" ref={tableRef}>
      <table className="table">
        <thead><tr>
          <th>{'Имя'}</th>
          <th>{'Логин'}</th>
          <th>{'Email'}</th>
          <th>{'Телефон'}</th>
          <th>{'Telegram'}</th>
          <th>{'WhatsApp'}</th>
          <th></th>
        </tr></thead>
        <tbody>
          {list.map(u => (
            <tr key={u.id} onClick={() => onRowClick(u)} className="table__row--clickable">
              <td>
                {editingId === u.id ? (
                  <input className="input input--min160" value={editingDraft.full_name}
                    onChange={e => setEditingDraft({ ...editingDraft, full_name: e.target.value })}
                  />
                ) : (
                  <>
                    <span className="person">
                      <Avatar userId={u.id} photoUrl={u.photo_url} name={u.full_name || u.username} size="xs" />
                      {u.full_name}
                    </span>
                    {pushUsers.has(u.id) && <PushMark />}
                  </>
                )}
              </td>
              <td>{u.username}</td>
              <td>
                {editingId === u.id ? (
                  <input className="input input--min160" value={editingDraft.email}
                    onChange={e => setEditingDraft({ ...editingDraft, email: e.target.value })}
                  />
                ) : u.email}
              </td>
              <td>
                {editingId === u.id ? (
                  <input className="input input--min160" value={editingDraft.phone}
                    onChange={e => setEditingDraft({ ...editingDraft, phone: e.target.value })}
                  />
                ) : u.phone}
              </td>
              <td>
                {editingId === u.id ? (
                  <input className="input input--min160" value={editingDraft.telegram_username}
                    onChange={e => setEditingDraft({ ...editingDraft, telegram_username: e.target.value })}
                  />
                ) : u.telegram_username}
              </td>
              <td>
                {editingId === u.id ? (
                  <input className="input input--min160" value={editingDraft.whatsapp}
                    onChange={e => setEditingDraft({ ...editingDraft, whatsapp: e.target.value })}
                  />
                ) : u.whatsapp}
              </td>
              <td>
                {/* stopPropagation: клик по строке включает правку — кнопкам это не нужно */}
                <div className="icon-row" onClick={e => e.stopPropagation()}>
                  {/* У куратора пароль по умолчанию = логину: вместо смены пароля — окно «Доступ» */}
                  {del.toRole ? (
                    <IconButton icon="key" tip="Сменить пароль" onClick={() => setPasswordUser(u)} />
                  ) : (
                    <IconButton icon="key" tip="Логин и пароль" onClick={() => setAccessUser(u)} />
                  )}
                  {del.toRole === 'admin' && (
                    <IconButton icon="schedule" tip="Выходные" onClick={() => setDaysOffUser(u)} />
                  )}
                  {!del.toRole ? null : u.id === currentUser?.id ? (
                    <IconButton icon="role" tip="Нельзя сменить роль самому себе" disabled />
                  ) : del.toRole === 'admin' ? (
                    <IconButton icon="role" tip="Сделать админом" onClick={() => changeRole(u, 'admin')} />
                  ) : (
                    <IconButton icon="role" tip="Сделать педагогом" onClick={() => changeRole(u, 'teacher')} />
                  )}
                  <DeleteButton
                    entity="user"
                    id={u.id}
                    name={u.full_name || u.username}
                    tip={del.tip}
                    onDelete={() => del.remove(u.id)}
                    onDeleted={del.reload}
                    onError={showError}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page">
      {error && <div className="banner banner--error">{error}</div>}

      {passwordUser && (
        <PasswordModal
          user={passwordUser}
          save={(password) => adminApi.setUserPassword(passwordUser.id, password)}
          onClose={() => setPasswordUser(null)}
        />
      )}

      {accessUser && (
        <Modal title={<>{'Логин и пароль'}: {accessUser.full_name || accessUser.username}</>} onClose={() => { setAccessUser(null); loadCurators(); }}>
          <AccessBlock
            username={accessUser.username}
            phone={accessUser.phone}
            passwordIsLogin={!!accessUser.password_is_login}
            onReset={() => adminApi.setUserPassword(accessUser.id, accessUser.username)}
          />
        </Modal>
      )}

      {daysOffUser && (
        <Modal title={<>{'Выходные'}: {daysOffUser.full_name || daysOffUser.username}</>} onClose={() => setDaysOffUser(null)} size="wide">
          <DaysOffEditor teacherId={daysOffUser.id} onSaved={() => setDaysOffUser(null)} />
        </Modal>
      )}

      <div className="tabs-row">
        {tabs.map(tb => (
          <button key={tb.key} onClick={() => setTab(tb.key)}
            className={`tab${tab === tb.key ? ' tab--active' : ''}`}>
            {tb.label}
          </button>
        ))}
      </div>

      {/* ПЕДАГОГИ */}
      {tab === 'teachers' && (
        <div>
          <div className="toolbar">
            <h3 className="toolbar__title">{'Список педагогов'}</h3>
            <Button onClick={() => setOpenAddModal('teacher')}>{'+ Добавить педагога'}</Button>
          </div>
          {userTable(teachers, { remove: adminApi.deleteTeacher, reload: loadTeachers, tip: 'Удалить педагога', toRole: 'admin' }, editingTeacherId, editingTeacherDraft, setEditingTeacherDraft, startEditTeacher, teachersTableRef)}
        </div>
      )}

      {/* АДМИНЫ */}
      {tab === 'admins' && (
        <div>
          <div className="toolbar">
            <h3 className="toolbar__title">{'Список администраторов'}</h3>
            <Button onClick={() => setOpenAddModal('admin')}>{'+ Добавить администратора'}</Button>
          </div>
          {userTable(admins, { remove: adminApi.deleteAdmin, reload: loadAdmins, tip: 'Удалить админа', toRole: 'teacher' }, editingAdminId, editingAdminDraft, setEditingAdminDraft, startEditAdmin, adminsTableRef)}
        </div>
      )}

      {/* КУРАТОРЫ */}
      {tab === 'curators' && (
        <div>
          <div className="toolbar">
            <h3 className="toolbar__title">{'Список кураторов'}</h3>
            <Button onClick={() => setOpenAddModal('curator')}>{'+ Добавить куратора'}</Button>
          </div>
          {userTable(curators, { remove: adminApi.deleteCurator, reload: loadCurators, tip: 'Удалить куратора', toRole: null }, editingCuratorId, editingCuratorDraft, setEditingCuratorDraft, startEditCurator, curatorsTableRef)}
        </div>
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

      {/* Модалка: новый педагог */}
      {openAddModal === 'teacher' && (
        <Modal title={'Новый педагог'} onClose={closeAddModal} footer={(
          <>
            <button className="btn btn--secondary" onClick={closeAddModal}>{'Отмена'}</button>
            <Button onClick={createTeacher}>{'Добавить'}</Button>
          </>
        )}>
          <div className="form-stack">
            {userFields(newTeacher, setNewTeacher)}
          </div>
        </Modal>
      )}

      {/* Модалка: новый администратор */}
      {openAddModal === 'admin' && (
        <Modal title={'Новый администратор'} onClose={closeAddModal} footer={(
          <>
            <button className="btn btn--secondary" onClick={closeAddModal}>{'Отмена'}</button>
            <Button onClick={createAdmin}>{'Добавить'}</Button>
          </>
        )}>
          <div className="form-stack">
            {userFields(newAdmin, setNewAdmin)}
          </div>
        </Modal>
      )}

      {/* Модалка: новый куратор — логин и пароль создадутся сами */}
      {openAddModal === 'curator' && (
        <Modal title={'Новый куратор'} onClose={closeAddModal} footer={(
          <>
            <button className="btn btn--secondary" onClick={closeAddModal}>{'Отмена'}</button>
            <Button onClick={createCurator}>{'Добавить'}</Button>
          </>
        )}>
          <div className="form-stack">
            {[
              ['full_name',         'Имя и фамилия'],
              ['phone',             'Телефон'],
              ['email',             'Email'],
              ['telegram_username', 'Telegram'],
              ['whatsapp',          'WhatsApp'],
            ].map(([field, label]) => (
              <input key={field} placeholder={label} className="input input--min160" autoComplete="off"
                value={newCurator[field]}
                onChange={e => setNewCurator({ ...newCurator, [field]: e.target.value })}
              />
            ))}
            <div className="hint-text">{'Логин и пароль создадутся сами: имя.3 буквы фамилии и цифры, пароль равен логину.'}</div>
          </div>
        </Modal>
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
