import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMe, updateMe, uploadMyPhoto, deleteMyPhoto } from '../api/auth';
import Avatar from '../components/Avatar';
import Modal from '../components/Modal';
import FormField from '../components/FormField';
import DaysOffEditor from '../components/DaysOffEditor';

// Исходник фото до обработки — как на сервере (routers/auth.py, PHOTO_MAX_UPLOAD)
const PHOTO_MAX_MB = 15;

// Сторона снимка с камеры: сервер всё равно ужмёт до 256×256
const CAMERA_SHOT = 512;

// Фото профиля: кружок с «Изменить» при наведении, по клику — меню
// «Загрузить / Сфотографировать / Удалить». Фото сохраняется сразу, без
// кнопки «Сохранить» формы.
function ProfilePhoto({ me, onChanged, onError }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const send = async (file) => {
    if (file.size > PHOTO_MAX_MB * 1024 * 1024) {
      onError(`Фото слишком большое (максимум ${PHOTO_MAX_MB} МБ)`);
      return false;
    }
    setBusy(true);
    try {
      onChanged(await uploadMyPhoto(file));
      return true;
    } catch (err) {
      onError(err.response?.data?.detail || 'Не удалось загрузить фото');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';  // тот же файл можно выбрать ещё раз
    if (file) send(file);
  };

  const remove = async () => {
    setMenuOpen(false);
    setBusy(true);
    try {
      onChanged(await deleteMyPhoto());
    } catch (err) {
      onError(err.response?.data?.detail || 'Не удалось удалить фото');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-photo" ref={boxRef}>
      <button
        type="button"
        className={`profile-photo__btn${busy ? ' profile-photo__btn--busy' : ''}`}
        onClick={() => !busy && setMenuOpen(v => !v)}
        disabled={busy}
      >
        <Avatar userId={me.id} photoUrl={me.photo_url} name={me.full_name || me.username} size="lg" />
        <span className="profile-photo__overlay">{busy ? 'Загрузка…' : 'Изменить'}</span>
      </button>
      {menuOpen && (
        <div className="dropdown__panel profile-photo__menu">
          <button type="button" className="dropdown__option" onClick={() => { setMenuOpen(false); fileRef.current?.click(); }}>
            {'Загрузить'}
          </button>
          <button type="button" className="dropdown__option" onClick={() => { setMenuOpen(false); setCameraOpen(true); }}>
            {'Сфотографировать'}
          </button>
          {me.photo_url && (
            <button type="button" className="dropdown__option dropdown__option--split profile-photo__delete" onClick={remove}>
              {'Удалить'}
            </button>
          )}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      {cameraOpen && (
        <CameraModal
          onClose={() => setCameraOpen(false)}
          onShot={async (blob) => { if (await send(blob)) setCameraOpen(false); }}
          saving={busy}
        />
      )}
    </div>
  );
}

// Окно «Сфотографировать»: шаг 1 — видео с камеры, круг показывает, что
// попадёт в фото; шаг 2 — снимок, «Переснять» или «Сохранить».
// Камера работает только по https (или localhost) — это правило браузера.
function CameraModal({ onClose, onShot, saving }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameras, setCameras] = useState([]);
  const [cameraId, setCameraId] = useState('');
  const [shot, setShot] = useState(null);   // { blob, url }
  const [error, setError] = useState('');

  const stop = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    let alive = true;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Камера недоступна в этом браузере. Выберите «Загрузить».');
      return undefined;
    }
    stop();
    setError('');
    const video = cameraId
      ? { deviceId: { exact: cameraId } }
      : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } };
    navigator.mediaDevices.getUserMedia({ video, audio: false })
      .then(async (stream) => {
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        // Названия камер браузер отдаёт только после разрешения доступа
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (alive) setCameras(devices.filter(d => d.kind === 'videoinput'));
      })
      .catch((err) => {
        if (!alive) return;
        setError(err?.name === 'NotFoundError'
          ? 'Камера не найдена. Выберите «Загрузить».'
          : 'Нет доступа к камере. Разрешите доступ в браузере или выберите «Загрузить».');
      });
    return () => { alive = false; stop(); };
  }, [cameraId]);

  useEffect(() => () => { if (shot) window.URL.revokeObjectURL(shot.url); }, [shot]);

  // Квадрат из середины кадра, отражённый — как в зеркальном превью
  const takeShot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CAMERA_SHOT;
    const ctx = canvas.getContext('2d');
    ctx.translate(CAMERA_SHOT, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, CAMERA_SHOT, CAMERA_SHOT);
    canvas.toBlob((blob) => {
      if (blob) setShot({ blob, url: window.URL.createObjectURL(blob) });
    }, 'image/jpeg', 0.92);
  };

  const footer = shot ? (
    <>
      <button type="button" className="btn btn--secondary" onClick={() => setShot(null)} disabled={saving}>{'Переснять'}</button>
      <button type="button" className="btn" onClick={() => onShot(shot.blob)} disabled={saving}>
        {saving ? 'Сохранение…' : 'Сохранить'}
      </button>
    </>
  ) : (
    <>
      <button type="button" className="btn btn--secondary" onClick={onClose}>{'Отмена'}</button>
      <button type="button" className="camera__shoot" onClick={takeShot} disabled={!!error} aria-label={'Снять'} data-tip={'Снять'} />
    </>
  );

  return (
    <Modal title={'Сфотографировать'} onClose={onClose} footer={footer} centered>
      <div className="camera">
        {cameras.length > 1 && !shot && (
          <select className="input camera__select" value={cameraId} onChange={e => setCameraId(e.target.value)}>
            {!cameraId && <option value="">{'Камера по умолчанию'}</option>}
            {cameras.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>{c.label || `Камера ${i + 1}`}</option>
            ))}
          </select>
        )}
        {error ? (
          <div className="banner banner--error">{error}</div>
        ) : (
          <div className={`camera__frame${shot ? ' camera__frame--shot' : ''}`}>
            <video ref={videoRef} className={`camera__video${shot ? ' camera__video--hidden' : ''}`} autoPlay playsInline muted />
            {shot && <img className="camera__still" src={shot.url} alt="" />}
          </div>
        )}
        {!error && (
          <p className="hint-text">{shot ? 'Так фото будет выглядеть в профиле' : 'Поместите лицо в круг'}</p>
        )}
      </div>
    </Modal>
  );
}

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
  const [me, setMe] = useState(null);  // id и фото — для блока фото
  const [username, setUsername] = useState('');
  const [role, setRole]         = useState('');
  const [msg, setMsg]           = useState('');
  const [error, setError]       = useState('');

  useEffect(() => {
    getMe().then(me => {
      setMe(me);
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

  const photoChanged = (updated) => {
    setMe(updated);
    setError('');
    refreshUser();  // фото в шапке
  };

  return (
    <div className="page page--md">
      <h2>{'Мой профиль'}</h2>

      <div className="profile">
        {me && <ProfilePhoto me={me} onChanged={photoChanged} onError={(m) => { setError(m); setMsg(''); }} />}
        <div className="profile__form">
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
        </div>
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
