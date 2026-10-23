// Карточка пользователя — админ, педагог, куратор (вкладка «Пользователи» у
// админа). Одно окно и для нового, и для существующего; разделы сверху вниз:
// Роль → Данные → Доступ → Выходные (только у педагога).
// Роль переключается здесь же; себе роль сменить нельзя. Новому пользователю
// логин подбирается сам по имени (пароль = логину, как у учеников) — поля
// можно поправить до сохранения. После создания окно остаётся открытым уже как
// карточка: можно скопировать или отправить доступ и задать выходные педагогу.
//   <UserCardModal user? currentUserId onClose(changed) />
import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import Avatar from './Avatar';
import PasswordModal from './PasswordModal';
import DaysOffEditor from './DaysOffEditor';
import { AccessBlock } from './ParentLinkBlock';
import { createUser, updateUser, suggestLogin, setUserPassword } from '../api/admin';
import { PHONE_PLACEHOLDER } from '../utils/phone';
import { extractErrorMessage } from '../utils/errors';

const ROLES = ['admin', 'teacher', 'curator'];
const ROLE_LABELS = { admin: 'Админ', teacher: 'Педагог', curator: 'Куратор' };
const ROLE_RIGHTS = {
  admin: 'Админ: всё в системе — пользователи, курсы, группы, расписание, настройки компании.',
  teacher: 'Педагог: свои группы и уроки, журнал, домашние задания, ученики своих групп. Есть выходные.',
  curator: 'Куратор: добавляет учеников, передаёт их педагогам, ставит пробные уроки; видит календари педагогов.',
};

function UserCardModal({ user: initialUser, currentUserId, onClose }) {
  const [user, setUser] = useState(initialUser || null);   // null — новый, ещё не сохранён
  const isNew = !user;
  const isSelf = !!user && user.id === currentUserId;
  const changed = useRef(false);
  const close = () => onClose(changed.current);

  const [form, setForm] = useState({
    role: initialUser?.role || 'teacher',
    full_name: initialUser?.full_name || '',
    phone: initialUser?.phone || '',
    email: initialUser?.email || '',
    telegram_username: initialUser?.telegram_username || '',
    whatsapp: initialUser?.whatsapp || '',
  });
  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  // Логин и пароль нового: подбираются по имени, пока их не тронули руками
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const loginTouched = useRef(false);
  const passwordTouched = useRef(false);
  useEffect(() => {
    if (!isNew || loginTouched.current || form.full_name.trim().length < 2) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      suggestLogin(form.full_name.trim()).then(name => {
        if (!alive || loginTouched.current) return;
        setLogin(name);
        if (!passwordTouched.current) setPassword(name);
      }).catch(() => {});
    }, 400);
    return () => { alive = false; clearTimeout(timer); };
  }, [form.full_name, isNew]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);

  const save = async () => {
    if (!form.full_name.trim()) { setError('Укажите имя и фамилию'); return; }
    if (!form.phone.trim()) { setError('Укажите телефон'); return; }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const data = { ...form, full_name: form.full_name.trim() };
      const saved = isNew
        ? await createUser({ ...data, username: login.trim() || null, password: password || null })
        : await updateUser(user.id, data);
      changed.current = true;
      if (isNew) {
        // Остаёмся в карточке: доступ — скопировать/отправить, педагогу — выходные
        setUser(saved);
        setNotice('Пользователь создан. Передайте ему логин и пароль.');
      } else {
        close();
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось сохранить пользователя'));
    } finally {
      setSaving(false);
    }
  };

  // Выходные — у сохранённого педагога (роль уже педагог на сервере)
  const showDaysOff = form.role === 'teacher';
  const daysOffReady = !!user && user.role === 'teacher';

  return (
    <Modal
      title={isNew ? 'Новый пользователь' : <>{'Пользователь'}{': '}{user.full_name || user.username}</>}
      size="wide"
      onClose={close}
      footer={(
        <>
          <button type="button" className="btn btn--secondary" onClick={close}>{isNew ? 'Отмена' : 'Закрыть'}</button>
          <button type="button" className="btn" onClick={save} disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить'}</button>
        </>
      )}
    >
      <div className="group-form">
        <div className="group-form__section">{'Роль'}</div>
        <div className="role-switch">
          {ROLES.map(r => (
            <button
              key={r}
              type="button"
              className={`role-switch__btn role-switch__btn--${r}${form.role === r ? ' role-switch__btn--on' : ''}`}
              disabled={isSelf}
              data-tip={isSelf ? 'Нельзя сменить роль самому себе' : undefined}
              onClick={() => setForm(f => ({ ...f, role: r }))}
            >
              {ROLE_LABELS[r]}
            </button>
          ))}
        </div>
        <p className="text-muted">{ROLE_RIGHTS[form.role]}</p>

        <div className="group-form__section">{'Данные'}</div>
        <div className="group-form__grid">
          <label className="field-label">{'Имя и фамилия *'}
            <input className="input" autoComplete="off" value={form.full_name} onChange={set('full_name')} />
          </label>
          <label className="field-label">{'Телефон *'}
            <input className="input" autoComplete="off" placeholder={PHONE_PLACEHOLDER} value={form.phone} onChange={set('phone')} />
          </label>
          <label className="field-label">{'Email'}
            <input className="input" autoComplete="off" value={form.email} onChange={set('email')} />
          </label>
          <label className="field-label">{'Telegram'}
            <input className="input" autoComplete="off" placeholder="@username" value={form.telegram_username} onChange={set('telegram_username')} />
          </label>
          <label className="field-label">{'WhatsApp'}
            <input className="input" autoComplete="off" value={form.whatsapp} onChange={set('whatsapp')} />
          </label>
          {!isNew && (
            <div className="field-label">{'Фото'}
              <span className="person">
                <Avatar userId={user.id} photoUrl={user.photo_url} name={user.full_name || user.username} size="sm" />
                <span className="text-muted">{'фото пользователь меняет сам в профиле'}</span>
              </span>
            </div>
          )}
        </div>

        <div className="group-form__section">{'Доступ'}</div>
        {isNew ? (
          <>
            <div className="group-form__grid">
              <label className="field-label">{'Логин'}
                <input className="input" autoComplete="new-password" value={login}
                  onChange={e => { loginTouched.current = true; setLogin(e.target.value); }} />
              </label>
              <label className="field-label">{'Пароль'}
                <input className="input" autoComplete="new-password" value={password}
                  onChange={e => { passwordTouched.current = true; setPassword(e.target.value); }} />
              </label>
            </div>
            <p className="text-muted">{'Логин и пароль подбираются сами по имени (пароль равен логину) — можно поправить. Пустые поля — создадутся при сохранении.'}</p>
          </>
        ) : (
          <>
            <AccessBlock
              username={user.username}
              phone={user.phone}
              passwordIsLogin={!!user.password_is_login}
              onReset={() => setUserPassword(user.id, user.username)}
            />
            <div className="button-row">
              <button type="button" className="btn btn--secondary" onClick={() => setPasswordOpen(true)}>{'Сменить пароль'}</button>
            </div>
          </>
        )}

        {showDaysOff && (
          <>
            <div className="group-form__section">{'Выходные'}</div>
            {daysOffReady
              ? <DaysOffEditor teacherId={user.id} />
              : <p className="text-muted">{'Выходные задаются после сохранения пользователя педагогом.'}</p>}
          </>
        )}

        {notice && <div className="banner banner--success">{notice}</div>}
        {error && <div className="form-field__error">{error}</div>}
      </div>

      {passwordOpen && (
        <PasswordModal
          user={user}
          save={(value) => setUserPassword(user.id, value)}
          onClose={() => setPasswordOpen(false)}
        />
      )}
    </Modal>
  );
}

export default UserCardModal;
