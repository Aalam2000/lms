import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMe, updateMe } from '../api/auth';
import Modal from '../components/Modal';
import FormField from '../components/FormField';
import DaysOffEditor from '../components/DaysOffEditor';

function ProfilePage() {
  const { refreshUser, user } = useAuth();
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', telegram_username: '', whatsapp: ''
  });
  // Смена пароля — в отдельном окне (кнопка «Сменить пароль»)
  const [pwdOpen, setPwdOpen]     = useState(false);
  const [pwd, setPwd]             = useState({ old_password: '', new_password: '' });
  const [pwdError, setPwdError]   = useState('');
  const [pwdSaving, setPwdSaving] = useState(false);
  const [username, setUsername] = useState('');
  const [role, setRole]         = useState('');
  const [msg, setMsg]           = useState('');
  const [error, setError]       = useState('');

  useEffect(() => {
    getMe().then(me => {
      setUsername(me.username);
      setRole(me.role);
      setForm(f => ({
        ...f,
        full_name:        me.full_name || '',
        email:            me.email || '',
        phone:            me.phone || '',
        telegram_username: me.telegram_username || '',
        whatsapp:         me.whatsapp || '',
      }));
    });
  }, []);

  const save = async () => {
    try {
      await updateMe(form);
      setMsg('Сохранено!');
      refreshUser();
      setError('');
      setTimeout(() => setMsg(''), 3000);
    } catch(e) {
      setError(e.response?.data?.detail || 'Ошибка');
      setMsg('');
    }
  };

  const openPwd = () => {
    setPwd({ old_password: '', new_password: '' });
    setPwdError('');
    setPwdOpen(true);
  };

  const savePwd = async (e) => {
    e.preventDefault();
    if (!pwd.old_password || !pwd.new_password) { setPwdError('Заполните оба поля'); return; }
    setPwdSaving(true);
    setPwdError('');
    try {
      await updateMe(pwd);
      setPwdOpen(false);
      setMsg('Пароль изменён');
      setError('');
      setTimeout(() => setMsg(''), 3000);
    } catch (err) {
      setPwdError(err.response?.data?.detail || 'Не удалось сменить пароль');
    } finally {
      setPwdSaving(false);
    }
  };

  const f = (field, label, type='text') => (
    <div className="form-row">
      <label className="form-row__label">{label}</label>
      <input className="input form-row__value" type={type} autoComplete="new-password"
        value={form[field]}
        onChange={e => setForm({ ...form, [field]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="page page--narrow">
      <h2>{'Мой профиль'}</h2>

      <div className="form-row">
        <label className="form-row__label">{'Логин'}</label>
        <span className="readonly-text">{username} <span className={`badge badge--role badge--inline badge--${role}`}>{role}</span></span>
      </div>

      {f('full_name',         'Полное имя')}
      {f('email',             'Email')}
      {f('phone',             'Телефон')}
      {f('telegram_username', 'Telegram')}
      {f('whatsapp',          'WhatsApp')}

      {msg   && <div className="banner banner--success">{msg}</div>}
      {error && <div className="banner banner--error">{error}</div>}

      <div className="icon-row">
        <button className="btn" onClick={save}>{'Сохранить'}</button>
        <button type="button" className="btn btn--secondary" onClick={openPwd}>{'Сменить пароль'}</button>
      </div>

      {/* Выходные педагога ставит админ — здесь только просмотр (DaysOffEditor) */}
      {role === 'teacher' && user?.id && (
        <>
          <h3 className="form-section">{'Выходные'}</h3>
          <DaysOffEditor teacherId={user.id} readOnly />
          <p className="hint-text">{'Выходные ставит администратор.'}</p>
        </>
      )}

      {pwdOpen && (
        <Modal
          title={'Смена пароля'}
          onClose={() => setPwdOpen(false)}
          footer={(
            <>
              <button type="button" className="btn btn--secondary" onClick={() => setPwdOpen(false)}>{'Отмена'}</button>
              <button type="submit" form="profile-password-form" className="btn" disabled={pwdSaving}>
                {pwdSaving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </>
          )}
        >
          <form id="profile-password-form" onSubmit={savePwd} className="form-stack">
            <FormField
              label={'Текущий пароль'}
              type="password"
              autoComplete="current-password"
              autoFocus
              value={pwd.old_password}
              onChange={e => setPwd({ ...pwd, old_password: e.target.value })}
            />
            <FormField
              label={'Новый пароль'}
              type="password"
              autoComplete="new-password"
              value={pwd.new_password}
              onChange={e => setPwd({ ...pwd, new_password: e.target.value })}
            />
            {pwdError && <div className="form-field__error">{pwdError}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}

export default ProfilePage;
