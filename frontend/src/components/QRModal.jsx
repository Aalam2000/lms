import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import Modal from './Modal';
import { useAuth } from '../context/AuthContext';
import { registerStudent } from '../api/auth';
import { isValidPhone, registerErrorText, PHONE_PLACEHOLDER, PHONE_FORMAT_TEXT } from '../utils/phone';

// QR для регистрации + «Добавить студента»: педагог сам вносит студентов
// (имя, логин, пароль). После «Сохранить» — снова QR, и так сколько нужно.
function QRModal({ group, onClose, onAdded }) {
  // «Добавить студента» — завести ученика сразу в группу: право students.create (админ, куратор)
  const { can } = useAuth();
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lastAdded, setLastAdded] = useState('');

  const baseUrl = import.meta.env.REACT_APP_PUBLIC_URL || window.location.origin;
  const inviteLink = `${baseUrl}/join/${group.invite_code}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback для старых браузеров
      const el = document.createElement('textarea');
      el.value = inviteLink;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError('');
    if (!isValidPhone(phone)) {
      setError(PHONE_FORMAT_TEXT);
      return;
    }
    setSaving(true);
    try {
      await registerStudent({
        username: username.trim(),
        password,
        full_name: fullName.trim() || null,
        phone,
        invite_code: group.invite_code,
      });
      setLastAdded(`${fullName.trim() || username.trim()} (${username.trim()})`);
      setFullName('');
      setUsername('');
      setPassword('');
      setPhone('');
      setAdding(false);
      if (onAdded) onAdded();
    } catch (err) {
      setError(registerErrorText(err, 'Не удалось сохранить'));
    } finally {
      setSaving(false);
    }
  };

  if (adding) {
    return (
      <Modal title={'Добавить студента'} onClose={onClose} centered>
        <p className="text-muted">{group.name}</p>
        <form onSubmit={handleSave} className="form-stack">
          <input className="input" placeholder={'Имя и фамилия'} value={fullName} onChange={e => setFullName(e.target.value)} autoFocus />
          <input className="input" type="tel" placeholder={PHONE_PLACEHOLDER} data-tip="Телефон с кодом страны, например +994 50 123 45 67" value={phone} onChange={e => setPhone(e.target.value)} required />
          <input className="input" placeholder={'Логин'} value={username} onChange={e => setUsername(e.target.value)} required />
          <input className="input" placeholder={'Пароль'} value={password} onChange={e => setPassword(e.target.value)} required />
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </form>
        {error && <p className="error-text error-text--sm">{error}</p>}
      </Modal>
    );
  }

  return (
    <Modal title={'Регистрация в группу'} onClose={onClose} centered>
      <p className="text-muted">{group.name}</p>

      <div className="qr-frame">
        <QRCodeSVG value={inviteLink} size={220} />
      </div>

      <div className="input-row">
        <input
          className="input input--soft"
          value={inviteLink}
          readOnly
          onFocus={e => e.target.select()}
        />
        <button className="btn" onClick={handleCopy}>
          {copied ? 'Скопировано' : 'Копировать'}
        </button>
      </div>

      <p className="hint-text">
        {'Отправьте эту ссылку или QR-код ученикам для регистрации в группе'}
      </p>

      {can('students.create') && (
        <button type="button" className="btn btn--outline" onClick={() => { setError(''); setAdding(true); }}>
          {'Добавить студента'}
        </button>
      )}
      {lastAdded && <p className="hint-text">{`Добавлен: ${lastAdded}`}</p>}
    </Modal>
  );
}

export default QRModal;
