// Блоки доступа в карточке ученика (StudentCardModal.jsx):
//   ParentLinkBlock    — «Ссылка для родителя». Ссылка принадлежит телефону
//                        родителя: по ней видны все его дети (backend/app/routers/parent.py).
//   AccessBlock        — адрес платформы, логин и пароль, пока пароль равен логину
//                        StudentAccessBlock — ученик,
//                        у куратора — в админке (AdminPage.jsx).
// Кнопки «Скопировать» / «Отправить в WhatsApp» у обоих блоков общие (ShareButtons).
// Работают педагог (ученикам своих групп) и админ.
import React, { useEffect, useState } from 'react';
import { getParentLink, makeParentLink, parentLinkUrl, resetParentPassword, loginUrl } from '../api/parent';
import { setStudentPassword } from '../api/students';
import { whatsappHref } from './ContactIcons';
import { extractErrorMessage } from '../utils/errors';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
}

// Общие кнопки: скопировать текст и отправить его в WhatsApp на телефон.
function ShareButtons({ copyValue, phone, message, children }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await copyText(copyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const waBase = whatsappHref(phone);
  const wa = waBase ? `${waBase}?text=${encodeURIComponent(message)}` : null;
  return (
    <div className="button-row">
      <button type="button" className="btn btn--sm" onClick={copy}>{copied ? 'Скопировано' : 'Скопировать'}</button>
      {wa && <a className="btn btn--sm" href={wa} target="_blank" rel="noopener noreferrer">{'Отправить в WhatsApp'}</a>}
      {children}
    </div>
  );
}

function ParentLinkBlock({ studentId }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getParentLink(studentId).then(setData).catch(err => setError(extractErrorMessage(err, 'Не удалось загрузить ссылку')));
  }, [studentId]);

  const make = async (renew) => {
    if (renew && !window.confirm('Старая ссылка перестанет открываться. Создать новую?')) return;
    setBusy(true);
    setError('');
    try {
      setData(await makeParentLink(studentId, renew));
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось создать ссылку'));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <div className="form-field__error">{error}</div> : null;
  if (!data.parent_phone) {
    return <div className="hint-text">{'Заполните телефон родителя и сохраните карточку — тогда можно будет создать ссылку.'}</div>;
  }

  const reset = async () => {
    if (!window.confirm('Пароль родителя станет равен логину. Сбросить?')) return;
    setBusy(true);
    setError('');
    try {
      setData(await resetParentPassword(studentId));
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось сбросить пароль'));
    } finally {
      setBusy(false);
    }
  };

  const url = data.token ? parentLinkUrl(data.token) : '';
  const address = loginUrl();
  const loginLines = data.login
    ? `\n${'Вход в платформу'}: ${address}\n${'Логин'}: ${data.login}${data.password_is_login ? `\n${'Пароль'}: ${data.login}` : ''}`
    : '';
  const waText = `Здравствуйте! Успеваемость вашего ребёнка в Log Academy: ${url}${loginLines}`;

  return (
    <div className="parent-link">
      {data.token ? (
        <>
          <div className="parent-link__url">
            {url}
            {data.login && (
              <>
                <br />{'Адрес'}{': '}{address}
                <br />{'Логин'}{': '}{data.login}
                <br />{'Пароль'}{': '}{data.password_is_login ? data.login : 'сменён родителем'}
              </>
            )}
          </div>
          <ShareButtons copyValue={`${url}${loginLines}`} phone={data.parent_phone} message={waText}>
            <button type="button" className="btn btn--sm btn--secondary" onClick={() => make(true)} disabled={busy}>{'Новая ссылка'}</button>
            {!data.login && (
              <button type="button" className="btn btn--sm btn--secondary" onClick={() => make(false)} disabled={busy}>{'Создать вход для родителя'}</button>
            )}
            {data.login && !data.password_is_login && (
              <button type="button" className="btn btn--sm btn--secondary" onClick={reset} disabled={busy}>{'Сбросить на логин'}</button>
            )}
          </ShareButtons>
          <div className="hint-text">
            {'По ссылке (или войдя по логину) родитель видит: '}{data.children.join(', ') || '—'}{'. '}
            {data.last_used_at
              ? <>{'Открывали: '}{new Date(data.last_used_at).toLocaleString('ru-RU')}{'.'}</>
              : 'Ещё не открывали.'}
          </div>
        </>
      ) : (
        <button type="button" className="btn btn--sm" onClick={() => make(false)} disabled={busy}>
          {busy ? 'Создаём…' : 'Создать ссылку для родителя'}
        </button>
      )}
      {error && <div className="form-field__error">{error}</div>}
    </div>
  );
}

// Доступ по логину: адрес входа, логин и пароль, пока он равен логину (пароль
// по умолчанию); сменил сам — changedText и кнопка «Сбросить на логин».
// onReset — функция сброса пароля на логин (у ученика и куратора свои эндпоинты).
export function AccessBlock({ username, phone, passwordIsLogin, onReset, changedText = 'сменён' }) {
  const [isDefault, setIsDefault] = useState(passwordIsLogin);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setIsDefault(passwordIsLogin); }, [passwordIsLogin]);

  const reset = async () => {
    if (!window.confirm('Пароль станет равен логину. Сбросить?')) return;
    setBusy(true);
    setError('');
    try {
      await onReset();
      setIsDefault(true);
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось сбросить пароль'));
    } finally {
      setBusy(false);
    }
  };

  const address = loginUrl();
  const text = isDefault
    ? `${'Вход в платформу'}: ${address}\n${'Логин'}: ${username}\n${'Пароль'}: ${username}`
    : `${'Вход в платформу'}: ${address}\n${'Логин'}: ${username}`;

  return (
    <div className="parent-link">
      <div className="parent-link__url">
        {'Адрес'}{': '}{address}<br />
        {'Логин'}{': '}{username}<br />
        {'Пароль'}{': '}{isDefault ? username : changedText}
      </div>
      <ShareButtons copyValue={text} phone={phone} message={text}>
        {!isDefault && (
          <button type="button" className="btn btn--sm btn--secondary" onClick={reset} disabled={busy}>{'Сбросить на логин'}</button>
        )}
      </ShareButtons>
      {error && <div className="form-field__error">{error}</div>}
    </div>
  );
}

// «Доступ ученика» в карточке ученика
export function StudentAccessBlock({ studentId, username, phone, passwordIsLogin }) {
  return (
    <AccessBlock
      username={username} phone={phone} passwordIsLogin={passwordIsLogin}
      changedText={'сменён учеником'}
      onReset={() => setStudentPassword(studentId, username)}
    />
  );
}

export default ParentLinkBlock;
