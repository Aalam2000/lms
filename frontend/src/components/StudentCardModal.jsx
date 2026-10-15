// Карточка ученика: все его данные в одном окне — для админа (секретаря) и
// педагога (только ученики своих групп, проверка на бэкенде).
//   <StudentCardModal studentId={id} onClose onSaved />        — правка
//   <StudentCardModal groups={[{id, name}]} onClose onSaved />   — новый ученик сразу в группу
//   <StudentCardModal groups courses teachers defaults onClose onSaved />
//     — новый ученик без группы тоже можно (куратор, админ): обязателен курс,
//       педагог — по желанию; группа нужна, если сразу ставим доп. урок
// Телефон ученика: обязателен, в базе не повторяется. Телефон родителя
// повторяться может (братья и сёстры). Правила — backend/app/phones.py.
import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import FormField from './FormField';
import DateTimePicker, { nextHour } from './DateTimePicker';
import { getStudentProfile, updateStudentProfile, createStudent } from '../api/students';
import { PHONE_PLACEHOLDER } from '../utils/phone';
import ParentLinkBlock, { StudentAccessBlock } from './ParentLinkBlock';

const EMPTY = {
  full_name: '', phone: '', email: '', telegram_username: '', whatsapp: '',
  parent_name: '', parent_phone: '', username: '', group_id: '',
  course_id: '', teacher_id: '', lesson: false, lesson_at: null,
};

function StudentCardModal({ studentId, groups = [], defaultGroupId = '', courses, teachers, defaults = {}, onClose, onSaved }) {
  const isNew = !studentId;
  const allowNoGroup = isNew && !!courses; // курс вместо группы (куратор, админ)
  const [draft, setDraft] = useState(isNew ? {
    ...EMPTY, group_id: defaultGroupId || '',
    course_id: defaults.course_id ? String(defaults.course_id) : '',
    teacher_id: defaults.teacher_id ? String(defaults.teacher_id) : '',
  } : null); // null — загрузка
  const [groupNames, setGroupNames] = useState([]);
  const [passwordIsLogin, setPasswordIsLogin] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isNew) return undefined;
    let alive = true;
    getStudentProfile(studentId)
      .then(p => {
        if (!alive) return;
        setGroupNames(p.groups || []);
        setPasswordIsLogin(!!p.password_is_login);
        setDraft({
          ...EMPTY,
          username: p.username,
          full_name: p.full_name || '', phone: p.phone || '', email: p.email || '',
          telegram_username: p.telegram_username || '', whatsapp: p.whatsapp || '',
          parent_name: p.parent_name || '', parent_phone: p.parent_phone || '',
        });
      })
      .catch(err => { if (alive) setError(err?.response?.data?.detail || 'Не удалось загрузить данные ученика'); });
    return () => { alive = false; };
  }, [studentId, isNew]);

  const set = (key) => (e) => setDraft({ ...draft, [key]: e.target.value });

  // Группы под выбранные курс и педагога; выбор группы подставляет её курс и педагога
  const groupChoices = groups.filter(g =>
    (!allowNoGroup || !draft?.course_id || String(g.course_id) === draft.course_id)
    && (!allowNoGroup || !draft?.teacher_id || String(g.teacher_id) === draft.teacher_id));
  const chooseGroup = (e) => {
    const g = groups.find(x => String(x.id) === e.target.value);
    setDraft({
      ...draft, group_id: e.target.value,
      ...(g && allowNoGroup ? { course_id: String(g.course_id), teacher_id: String(g.teacher_id) } : {}),
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (isNew) {
      if (!draft.full_name.trim() || !draft.phone.trim()) { setError('Заполните имя и фамилию и телефон'); return; }
      if (!draft.group_id && !(allowNoGroup && draft.course_id)) {
        setError(allowNoGroup ? 'Выберите курс' : 'Выберите группу');
        return;
      }
      if (draft.lesson && (!draft.group_id || !draft.lesson_at)) {
        setError('Для урока выберите группу, дату и время');
        return;
      }
    }
    setSaving(true);
    setError('');
    try {
      // Логин и пароль новому ученику ставит бэкенд: логин из ФИО, пароль = логину
      const { username, group_id, course_id, teacher_id, lesson, lesson_at, ...profile } = draft;
      const saved = isNew
        ? await createStudent({
          ...profile,
          group_id: group_id ? Number(group_id) : null,
          course_id: course_id ? Number(course_id) : null,
          sector: defaults.sector || null,
          teacher_id: teacher_id ? Number(teacher_id) : null,
          lesson_at: lesson && lesson_at ? lesson_at.toISOString() : null,
        })
        : await updateStudentProfile(studentId, profile);
      onSaved(saved);
    } catch (err) {
      const status = err?.response?.status;
      setError(status === 409
        ? 'Этот телефон ученика уже есть у другого пользователя'
        : (err?.response?.data?.detail || 'Не удалось сохранить'));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isNew ? 'Новый ученик' : 'Данные ученика'}
      size="wide"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>{'Отмена'}</button>
          <button type="submit" form="student-card-form" className="btn" disabled={!draft || saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </>
      )}
    >
      {!draft && !error && <div className="text-muted">{'Загрузка...'}</div>}
      {draft && (
        <form id="student-card-form" onSubmit={submit} className="form-stack">
          <h4 className="form-section">{'Ученик'}</h4>
          <div className="form-grid">
            <FormField label={'Имя и фамилия'} value={draft.full_name} onChange={set('full_name')} autoFocus />
            <FormField label={'Телефон ученика'} type="tel" placeholder={PHONE_PLACEHOLDER} value={draft.phone} onChange={set('phone')} />
            <FormField label={'Email'} type="email" value={draft.email} onChange={set('email')} />
            <FormField label={'Telegram'} value={draft.telegram_username} onChange={set('telegram_username')} />
            <FormField label={'WhatsApp'} value={draft.whatsapp} onChange={set('whatsapp')} />
          </div>

          {isNew ? (
            <div className="hint-text">{'Логин и пароль создадутся сами после сохранения: имя.3 буквы фамилии и цифры, пароль равен логину.'}</div>
          ) : (
            <>
              <h4 className="form-section">{'Доступ ученика'}</h4>
              <StudentAccessBlock studentId={studentId} username={draft.username} phone={draft.phone} passwordIsLogin={passwordIsLogin} />
            </>
          )}

          <h4 className="form-section">{'Родитель'}</h4>
          <div className="form-grid">
            <FormField label={'Имя родителя'} value={draft.parent_name} onChange={set('parent_name')} />
            <FormField label={'Телефон родителя'} type="tel" placeholder={PHONE_PLACEHOLDER} value={draft.parent_phone} onChange={set('parent_phone')} />
          </div>
          {/* Личная ссылка родителя: успеваемость без входа (routers/parent.py) */}
          {!isNew && <ParentLinkBlock studentId={studentId} />}

          <h4 className="form-section">{allowNoGroup ? 'Курс и группа' : 'Группа'}</h4>
          {isNew ? (
            <div className="form-stack">
              {allowNoGroup && (
                <div className="form-grid">
                  <select className="input" value={draft.course_id} onChange={e => setDraft({ ...draft, course_id: e.target.value, group_id: '' })}>
                    <option value="">{'Курс'}</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                  <select className="input" value={draft.teacher_id} onChange={e => setDraft({ ...draft, teacher_id: e.target.value, group_id: '' })}>
                    <option value="">{'Педагог — по желанию'}</option>
                    {(teachers || []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              )}
              <select className="input" value={draft.group_id} onChange={chooseGroup}>
                <option value="">{allowNoGroup ? 'Группа — по желанию' : 'Выберите группу'}</option>
                {groupChoices.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <label className="checkbox-row">
                <input type="checkbox" checked={draft.lesson}
                  onChange={e => setDraft({ ...draft, lesson: e.target.checked, lesson_at: draft.lesson_at || nextHour() })} />
                {'Сразу доп. урок (нужна группа)'}
              </label>
              {draft.lesson && (
                <DateTimePicker value={draft.lesson_at} onChange={d => setDraft({ ...draft, lesson_at: d })} floating />
              )}
            </div>
          ) : (
            <div className="readonly-text">{groupNames.join(', ') || '—'}</div>
          )}
          <div className="hint-text">
            {'Если у ребёнка нет своего телефона, в оба поля впишите телефон родителя. Номер можно вводить как +994 50 123 45 67 или 050 123 45 67.'}
          </div>
        </form>
      )}
      {error && <div className="form-field__error">{error}</div>}
    </Modal>
  );
}

export default StudentCardModal;
