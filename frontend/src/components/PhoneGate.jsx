// Телефон обязателен: у кого он не заполнен, после входа видит окно
// «Укажите телефон» и не может работать дальше, пока не сохранит номер
// (или не выйдет). Формат и запрет повторов — backend/app/phones.py.
import React, { useState } from 'react';
import Modal from './Modal';
import FormField from './FormField';
import { updateMe } from '../api/auth';
import { useAuth } from '../context/AuthContext';
import { isValidPhone, PHONE_PLACEHOLDER, PHONE_FORMAT_TEXT, PHONE_INVALID_TEXT } from '../utils/phone';

function PhoneGate() {
  const { user, refreshUser, logout } = useAuth();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Родителю свой телефон не нужен: его вход привязан к телефону родителя ученика
  if (!user || user.role === 'parent' || (user.phone || '').trim()) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!isValidPhone(phone)) {
      setError(PHONE_FORMAT_TEXT);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateMe({ phone });
      refreshUser();
    } catch (err) {
      const status = err?.response?.status;
      setError(status === 409
        ? 'Этот телефон уже зарегистрирован. Обратитесь к педагогу или администратору'
        : status === 422 ? PHONE_INVALID_TEXT : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={'Укажите телефон'}
      onClose={() => {}}
      footer={(
        <>
          <button type="button" className="btn btn--secondary" onClick={logout}>{'Выйти'}</button>
          <button type="submit" form="phone-gate-form" className="btn" disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </>
      )}
    >
      <form id="phone-gate-form" onSubmit={submit} className="form-stack">
        <div>{'Чтобы продолжить работу, заполните номер телефона.'}</div>
        <FormField
          label={'Телефон'}
          type="tel"
          placeholder={PHONE_PLACEHOLDER}
          autoFocus
          value={phone}
          onChange={e => setPhone(e.target.value)}
        />
        {error && <div className="form-field__error">{error}</div>}
      </form>
    </Modal>
  );
}

export default PhoneGate;
