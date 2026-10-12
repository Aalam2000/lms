// Страница родителя /p/<токен> — без входа, только просмотр, рассчитана на телефон.
// Вкладки с именами детей (все дети с этим телефоном родителя), у каждого —
// средние оценки, список уроков и пропуски. Клик по уроку — что задано,
// ответ ученика и диалог урока. Сервер: backend/app/routers/parent.py.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Modal from '../components/Modal';
import LanguageSwitcher from '../components/LanguageSwitcher';
import {
  getParentHome, getChildMarks, getChildGrades, getChildHomework, getChildMessages,
  taskFileUrl, answerFileUrl,
} from '../api/parent';
import { formatDeadline } from '../components/DeadlinePicker';
import { extractErrorMessage } from '../utils/errors';

const GRADE_KINDS = [
  { key: 'lesson', label: 'За уроки' },
  { key: 'homework', label: 'За ДЗ' },
  { key: 'exam', label: 'Экзамены' },
];
const ABSENCE_LABELS = {
  absent: 'Пропуск',
  excused: 'По уважительной причине',
  made_up: 'Пропуск закрыт дополнительным уроком',
};
const ATT_CHIP = { in_person: 'chip--green', online: 'chip--green', excused: 'chip--grey', made_up: 'chip--grey', absent: 'chip--red' };

const day = (v) => (v ? new Date(v).toLocaleDateString('ru-RU') : '—');
const stamp = (v) => (v ? new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

function answerChip(answer) {
  switch (answer.status) {
    case 'graded': return { label: `Оценка ${answer.grade}`, cls: 'chip chip--green' };
    case 'accepted': return { label: 'Принято', cls: 'chip chip--green' };
    case 'submitted': return { label: 'Сдано, ждёт проверки', cls: 'chip chip--grey' };
    case 'returned': return { label: 'Вернули на доработку', cls: 'chip chip--red' };
    case 'expired': return { label: 'Не сдано, срок истёк', cls: 'chip chip--red' };
    default: return { label: 'Ещё не сдано', cls: 'chip chip--amber' };
  }
}

// Окно урока: задания ДЗ, ответ ученика, диалог — всё только для чтения
function LessonModal({ token, studentId, lesson, onClose }) {
  const [hw, setHw] = useState(null);
  const [messages, setMessages] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getChildHomework(token, studentId, lesson.lesson_id).then(setHw)
      .catch(err => setError(extractErrorMessage(err, 'Не удалось загрузить урок')));
    getChildMessages(token, studentId, lesson.lesson_id).then(setMessages).catch(() => setMessages([]));
  }, [token, studentId, lesson.lesson_id]);

  const chip = hw && answerChip(hw.answer);
  return (
    <Modal title={`${lesson.lesson_title} · ${day(lesson.date)}`} onClose={onClose} size="wide">
      {error && <div className="error-text error-text--muted">{error}</div>}
      <h4 className="parent-section">{'Домашнее задание'}</h4>
      {!hw && !error && <p className="text-muted">{'Загрузка...'}</p>}
      {hw && hw.tasks.length === 0 && <p className="text-muted">{'К этому уроку домашнего задания нет'}</p>}
      {hw && hw.tasks.length > 0 && (
        <>
          <ul className="parent-files">
            {hw.tasks.map(t => (
              <li key={t.id}>
                <a className="link" href={taskFileUrl(token, studentId, lesson.lesson_id, t.id)} target="_blank" rel="noopener noreferrer">{t.title}</a>
                {t.deadline && <span className={`chip ${t.is_expired ? 'chip--red' : 'chip--amber'}`}>{`до ${formatDeadline(t.deadline)}`}</span>}
              </li>
            ))}
          </ul>
          <div className="parent-answer">
            <b>{'Ответ ученика'}</b>
            <span className={chip.cls}>{chip.label}</span>
          </div>
          {hw.answer.files.length > 0 && (
            <ul className="parent-files">
              {hw.answer.files.map(f => (
                <li key={f.id}>
                  <a className="link" href={answerFileUrl(token, studentId, lesson.lesson_id, f.id)} target="_blank" rel="noopener noreferrer">{f.original_filename}</a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <h4 className="parent-section">{'Диалог педагога и ученика'}</h4>
      {!messages && <p className="text-muted">{'Загрузка...'}</p>}
      {messages && messages.length === 0 && <p className="text-muted">{'Сообщений нет'}</p>}
      {messages && messages.length > 0 && (
        <div className="dialog__messages parent-dialog">
          {messages.map(m => (
            <div key={m.id} className={`dialog__msg${m.from_teacher ? '' : ' dialog__msg--mine'}`}>
              <div className="dialog__meta">{m.author_name} · {stamp(m.created_at)}</div>
              <div className="dialog__text">{m.text}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ChildView({ token, child }) {
  const [marks, setMarks] = useState(null);
  const [grades, setGrades] = useState(null);
  const [tab, setTab] = useState('lessons'); // lessons | absences
  const [openKind, setOpenKind] = useState(null);
  const [openLesson, setOpenLesson] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setMarks(null); setGrades(null); setError('');
    getChildMarks(token, child.id).then(setMarks).catch(err => setError(extractErrorMessage(err, 'Не удалось загрузить данные')));
    getChildGrades(token, child.id).then(setGrades).catch(() => {});
  }, [token, child.id]);

  const absences = (marks || []).filter(m => ABSENCE_LABELS[m.attendance_status]);

  return (
    <>
      {child.groups.length > 0 && <p className="text-muted parent-groups">{'Группа'}: {child.groups.join(', ')}</p>}
      {error && <div className="error-text error-text--muted">{error}</div>}

      {grades && (
        <div className="grade-tiles parent-tiles">
          {GRADE_KINDS.map(k => (
            <button key={k.key} type="button" className="grade-tile" onClick={() => setOpenKind(k)}>
              <span className="grade-tile__value">{grades[k.key].avg ?? '—'}</span>
              <span className="grade-tile__label">{k.label}</span>
              <span className="grade-tile__sub">
                {grades[k.key].items.length ? `оценок: ${grades[k.key].items.length}` : 'оценок пока нет'}
              </span>
            </button>
          ))}
        </div>
      )}
      {openKind && grades && (
        <Modal title={`Оценки: ${openKind.label.toLowerCase()}`} onClose={() => setOpenKind(null)}>
          {grades[openKind.key].items.length === 0 && <p className="text-muted">{'Оценок пока нет'}</p>}
          <ul className="parent-grade-list">
            {grades[openKind.key].items.map((g, i) => (
              <li key={i}><span>{day(g.date)} · {g.lesson_title}</span><b>{g.grade}</b></li>
            ))}
          </ul>
        </Modal>
      )}

      <div className="toolbar__filters parent-tabs">
        <button type="button" className={`tab tab--underline${tab === 'lessons' ? ' tab--active' : ''}`} onClick={() => setTab('lessons')}>{'Уроки'}</button>
        <button type="button" className={`tab tab--underline${tab === 'absences' ? ' tab--active' : ''}`} onClick={() => setTab('absences')}>
          {'Пропуски'}{absences.length > 0 && ` (${absences.length})`}
        </button>
      </div>

      {!marks && !error && <p className="text-muted">{'Загрузка...'}</p>}
      {marks && tab === 'lessons' && (
        <div className="parent-lessons">
          {marks.length === 0 && <p className="text-muted">{'Открытых уроков пока нет'}</p>}
          {marks.map(m => (
            <button key={m.lesson_id} type="button" className="parent-lesson" onClick={() => setOpenLesson(m)}>
              <span className="parent-lesson__head">
                <b>{m.lesson_title}</b>
                <span className="text-muted">{day(m.date)}</span>
              </span>
              <span className="parent-lesson__chips">
                {m.attendance_status && <span className={`chip ${ATT_CHIP[m.attendance_status] || 'chip--grey'}`}>{m.status_label}</span>}
                {m.is_late && <span className="chip chip--amber">{'Опоздал'}</span>}
                {m.score != null && <span className="chip">{'Урок'}: {m.score}</span>}
                {m.hw_grades && m.hw_grades.length > 0 && <span className="chip">{'ДЗ'}: {m.hw_grades.join(' / ')}</span>}
                {m.exam_score != null && <span className="chip">{'Экзамен'}: {m.exam_score}</span>}
              </span>
              <span className="parent-lesson__more">{'Задание и диалог →'}</span>
            </button>
          ))}
        </div>
      )}
      {marks && tab === 'absences' && (
        <div className="parent-lessons">
          {absences.length === 0 && <p className="text-muted">{'Пропусков нет'}</p>}
          {absences.map(m => (
            <div key={m.lesson_id} className="parent-lesson parent-lesson--static">
              <span className="parent-lesson__head"><b>{m.lesson_title}</b><span className="text-muted">{day(m.date)}</span></span>
              <span className="parent-lesson__chips"><span className={`chip ${ATT_CHIP[m.attendance_status]}`}>{ABSENCE_LABELS[m.attendance_status]}</span></span>
            </div>
          ))}
        </div>
      )}

      {openLesson && <LessonModal token={token} studentId={child.id} lesson={openLesson} onClose={() => setOpenLesson(null)} />}
    </>
  );
}

function ParentPage() {
  const { token } = useParams();
  const [home, setHome] = useState(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    // свой текст, а не с сервера — его переводит autoi18n
    getParentHome(token).then(setHome).catch(() => setError('Ссылка недействительна'));
  }, [token]);

  return (
    <div className="parent-page">
      <header className="parent-header">
        <span className="parent-header__brand">{'Log Academy'}</span>
        <span className="parent-header__title">{'Успеваемость'}</span>
        <span className="parent-header__lang"><LanguageSwitcher /></span>
      </header>
      <main className="parent-main">
        {error && <div className="parent-empty">{error}</div>}
        {!home && !error && <p className="text-muted">{'Загрузка...'}</p>}
        {home && home.children.length === 0 && (
          <div className="parent-empty">{'Сейчас по этой ссылке нет учеников в активных группах.'}</div>
        )}
        {home && home.children.length > 1 && (
          <div className="parent-kids">
            {home.children.map((c, i) => (
              <button key={c.id} type="button" className={`parent-kid${i === active ? ' parent-kid--active' : ''}`} onClick={() => setActive(i)}>
                {c.name}
              </button>
            ))}
          </div>
        )}
        {home && home.children.length === 1 && <h2 className="parent-name">{home.children[0].name}</h2>}
        {home && home.children[active] && <ChildView key={home.children[active].id} token={token} child={home.children[active]} />}
        <p className="parent-foot">{'Только просмотр. Вопросы по урокам — педагогу.'}</p>
      </main>
    </div>
  );
}

export default ParentPage;
