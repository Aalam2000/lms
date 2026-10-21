// ДЗ со стороны педагога — вкладка «Студенты» урока (claude/homework-plan.md):
//  - HomeworkAddModal  — окно «+ ДЗ»: «+ Файл», «Из БЗ», «Дедлайн». Без кнопок
//    «Выдать»/«Отмена» и без вопросов. Клик мимо окна — закрыть.
//  - HomeworkFlags     — два узких флажка в обычной таблице: «ДЗ» (выдано) и «Ответ».
//  - HomeworkCheckView — режим «Проверить ДЗ»: таблица перестроена под приём ДЗ
//    (Имя, Задание, Срок, Ответ, Итог ДЗ, Комментарий).
//  - ReviewPanel       — панель справа: файл студента прямо в ней, оценка,
//    «Принять», «Вернуть», «Скачать», диалог, «← Предыдущий / Следующий →».
//    Та же панель проверяет и работу на уроке (mode="work", api/lessonWork.js):
//    там оценка — это оценка за урок, «Вернуть» нет.
//  - AiReviewBlock     — «Проверка с ИИ» в панели (ДЗ и работа на уроке): промпт в буфер,
//    файлы без текста — скачать и приложить к ИИ, ответ ИИ (JSON) → оценка в
//    поле оценки и «Хорошо / Плохо» в поле сообщения диалога. Ничего не
//    сохраняется и не отправляется само — педагог правит и подтверждает.
// Оценка одна на всё ДЗ студента; «принято» или оценка = проверено.
// Файлов в ДЗ сколько угодно — ограничение только размер файла (бэкенд).
import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import DateTimePicker from './DateTimePicker';
import LibraryPickerModal from './LibraryPickerModal';
import { DialogCell, DialogThread } from './LessonDialog';
import { formatDeadline } from './DeadlinePicker';
import {
  createHomeworkTask, setScopeDeadline, reviewHomework,
  openTaskFile, openAnswerFile, answerFileViewUrl, downloadAnswerFile, getAiSource,
} from '../api/homework';
import { LANG_NAMES, copyText } from './QuizHelper';
import { reviewWork, workFileViewUrl, openWorkFile, downloadWorkFile, getWorkAiSource } from '../api/lessonWork';
import { extractErrorMessage } from '../utils/errors';

// ---------- Окно «+ ДЗ» ----------

export function HomeworkAddModal({ lessonId, student, deadline, sector, courseId, lessonNo, onChanged, onClose }) {
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [deadlineValue, setDeadlineValue] = useState(deadline ? new Date(deadline) : null);
  const studentId = student ? student.student_id : null;

  // Имя и содержимое файла в Базе знаний уникальны — правило на бэкенде;
  // отказ (имя занято чужим файлом) показывается как ошибка.
  const create = async (payload) => {
    await createHomeworkTask(lessonId, { studentId, deadline: deadlineValue, ...payload });
    await onChanged();
  };

  // Можно выбрать сразу несколько файлов — каждый становится заданием
  const handleFile = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of files) await create({ file });
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось загрузить файл'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
      setBusy(false);
    }
  };

  const handlePick = async (item) => {
    setError('');
    try {
      await create({ materialId: item.id });
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось добавить файл'));
      throw err;
    }
  };

  const saveDeadline = async () => {
    setError('');
    try {
      await setScopeDeadline(lessonId, studentId, deadlineValue);
      await onChanged();
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось сохранить срок'));
    }
  };

  return (
    <Modal
      title={student ? `Домашнее задание: ${student.full_name}` : 'Домашнее задание всем'}
      onClose={onClose}
      footer={<span />}
    >
      <div className="form-toolbar">
        <input type="file" multiple ref={fileRef} onChange={handleFile} hidden />
        <button type="button" className="btn btn--outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? 'Загрузка...' : '+ Файл'}
        </button>
        <button type="button" className="btn btn--outline" onClick={() => setShowLibrary(true)} disabled={busy}>
          {'Из БЗ'}
        </button>
        <DateTimePicker
          value={deadlineValue}
          onChange={setDeadlineValue}
          onCommit={saveDeadline}
          hourOnly
          floating
          placeholder={'Дедлайн'}
          disabled={busy}
        />
      </div>
      {error && <div className="error-text error-text--muted">{error}</div>}
      {showLibrary && (
        <LibraryPickerModal
          lessonId={lessonId}
          onlyType="material"
          title={'ДЗ из базы знаний'}
          sector={sector}
          courseId={courseId}
          lessonNo={lessonNo}
          onPick={handlePick}
          onClose={() => setShowLibrary(false)}
        />
      )}
    </Modal>
  );
}

// ---------- Два флажка в обычной таблице ----------

const ANSWER_FLAG = {
  none: { cls: 'hw-flag--grey', sign: '·', tip: 'ДЗ не выдано' },
  pending: { cls: 'hw-flag--grey', sign: '·', tip: 'Ответа ещё нет, срок не прошёл' },
  expired: { cls: 'hw-flag--red', sign: '✕', tip: 'Ответа нет, срок прошёл' },
  submitted: { cls: 'hw-flag--amber', sign: '!', tip: 'Ответ прислан — проверить' },
  accepted: { cls: 'hw-flag--green', sign: '✓', tip: 'Принято' },
  graded: { cls: 'hw-flag--green', sign: '✓', tip: 'Оценено' },
  returned: { cls: 'hw-flag--red', sign: '↺', tip: 'Вернули на доработку — ждём исправление' },
};

// Клик по «ДЗ» — положить студенту персональный файл (onAdd)
export function HomeworkFlags({ row, onAdd }) {
  const given = row && row.task_ids.length > 0;
  const canAdd = !!row && !!onAdd;
  const givenTip = given ? 'ДЗ выдано' : 'ДЗ не выдано';
  const a = row ? ANSWER_FLAG[row.answer.status] : ANSWER_FLAG.none;
  const answerTip = row && row.answer.status === 'graded' ? `Оценка ${row.answer.grade}` : a.tip;
  return (
    <>
      <td className="table__col--flag">
        {canAdd ? (
          <button
            type="button"
            className={`hw-flag hw-flag--btn ${given ? 'hw-flag--green' : 'hw-flag--grey'}`}
            data-tip={`${givenTip} — клик: персональный файл в ДЗ`}
            onClick={() => onAdd(row)}
          >
            {given ? '✓' : '+'}
          </button>
        ) : (
          <span className={`hw-flag ${given ? 'hw-flag--green' : 'hw-flag--grey'}`} data-tip={givenTip}>
            {given ? '✓' : '·'}
          </span>
        )}
      </td>
      <td className="table__col--flag">
        <span className={`hw-flag ${a.cls}`} data-tip={answerTip}>{a.sign}</span>
      </td>
    </>
  );
}

// ---------- Режим «Проверить ДЗ» ----------

const STATUS_ORDER = { submitted: 0, returned: 1, pending: 2, expired: 3, accepted: 4, graded: 5, none: 6 };

export function HomeworkCheckView({ lessonId, board, onChanged, onError }) {
  const [panel, setPanel] = useState(null); // { studentId, fileId }
  const [addFor, setAddFor] = useState(null); // строка студента для персонального «+ ДЗ»
  const tasksById = Object.fromEntries(board.tasks.map(t => [t.id, t]));
  const rows = [...board.students].sort((a, b) => STATUS_ORDER[a.answer.status] - STATUS_ORDER[b.answer.status]);
  const toReview = rows.filter(r => r.answer.status === 'submitted');

  return (
    <>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{'Имя'}</th>
              <th>{'Задание'}</th>
              <th>{'Срок'}</th>
              <th>{'Ответ'}</th>
              <th>{'Итог ДЗ'}</th>
              <th>{'Комментарий'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="6" className="table__empty">{'В группе нет студентов'}</td></tr>}
            {rows.map(row => (
              <tr key={row.student_id} className={row.answer.status === 'submitted' ? 'table__row--homework-pending' : undefined}>
                <td>{row.full_name}</td>
                <td>
                  <div className="hw-files">
                    {row.task_ids.map(id => tasksById[id] && (
                      <button
                        key={id}
                        type="button"
                        className="link"
                        data-tip={tasksById[id].student_id ? 'Персональное задание — открыть' : 'Открыть задание'}
                        onClick={() => openTaskFile(tasksById[id]).catch(err => onError(extractErrorMessage(err, 'Не удалось открыть файл')))}
                      >
                        {tasksById[id].title}
                      </button>
                    ))}
                    <button type="button" className="btn btn--sm" onClick={() => setAddFor(row)} data-tip="Добавить домашнее задание этому студенту">
                      {'+ ДЗ'}
                    </button>
                  </div>
                </td>
                <td className="nowrap">
                  {row.answer.status !== 'none' && (
                    <DeadlineCell lessonId={lessonId} row={row} tasksById={tasksById} onChanged={onChanged} onError={onError} />
                  )}
                </td>
                <td>
                  <div className="hw-files">
                    {row.answer.files.length === 0 && <span className="text-muted">{'—'}</span>}
                    {row.answer.files.map(f => (
                      <button
                        key={f.id}
                        type="button"
                        className="link"
                        data-tip="Посмотреть ответ"
                        onClick={() => setPanel({ studentId: row.student_id, fileId: f.id })}
                      >
                        {f.original_filename}
                      </button>
                    ))}
                  </div>
                </td>
                <td>
                  <ReviewControls lessonId={lessonId} row={row} onChanged={onChanged} onError={onError} />
                </td>
                <td>
                  <DialogCell
                    lessonId={lessonId}
                    studentId={row.student_id}
                    studentName={row.full_name}
                    lastMessage={row.last_message}
                    count={row.messages_count}
                    onChanged={onChanged}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {addFor && (
        <HomeworkAddModal
          lessonId={lessonId}
          student={addFor}
          deadline={personalOrCommonDeadline(board, addFor.student_id)}
          onChanged={onChanged}
          onClose={() => setAddFor(null)}
        />
      )}

      {panel && (
        <ReviewPanel
          key={panel.studentId}
          lessonId={lessonId}
          rows={rows}
          queue={rows}
          toReviewCount={toReview.length}
          studentId={panel.studentId}
          fileId={panel.fileId}
          onNavigate={(studentId) => setPanel({ studentId, fileId: null })}
          onChanged={onChanged}
          onClose={() => setPanel(null)}
        />
      )}
    </>
  );
}

// Срок для окна персонального ДЗ: свой срок студента, иначе общий
export function personalOrCommonDeadline(board, studentId) {
  const own = board.tasks.find(t => t.student_id === studentId && t.deadline);
  const common = board.tasks.find(t => !t.student_id && t.deadline);
  return (own || common)?.deadline || null;
}

// Срок в строке проверки — клик открывает календарь. Есть персональные
// задания — меняется срок персональных заданий студента, иначе — общий
// срок урока (он один для всех).
function DeadlineCell({ lessonId, row, tasksById, onChanged, onError }) {
  const personal = row.task_ids.some(id => tasksById[id]?.student_id);
  const initial = row.answer.deadline ? new Date(row.answer.deadline) : null;
  const [value, setValue] = useState(initial);

  useEffect(() => { setValue(row.answer.deadline ? new Date(row.answer.deadline) : null); }, [row.answer.deadline]);

  const commit = async () => {
    if (!value || (initial && value.getTime() === initial.getTime())) return;
    try {
      await setScopeDeadline(lessonId, personal ? row.student_id : null, value);
      await onChanged();
    } catch (err) {
      onError(extractErrorMessage(err, 'Не удалось сменить срок'));
    }
  };

  return (
    <span
      className={`hw-deadline${row.answer.status === 'expired' ? ' hw-deadline--red' : ''}`}
      data-tip={personal ? 'Срок ДЗ этого студента — сменить' : 'Срок ДЗ для всех — сменить'}
    >
      <DateTimePicker value={value} onChange={setValue} onCommit={commit} hourOnly floating placeholder={'без срока'} />
    </span>
  );
}

// Итог ДЗ в строке: оценка (сохраняется при уходе из поля или по Enter), ✓ принять без оценки, ↺ вернуть
// suggested — { grade } от ИИ: подставляется в поле, сохраняется кнопкой «Сохранить» (или Enter)
function ReviewControls({ lessonId, row, onChanged, onError, suggested }) {
  const { answer } = row;
  const [grade, setGrade] = useState(answer.grade ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setGrade(answer.grade ?? ''); }, [answer.grade]);
  useEffect(() => { if (suggested) setGrade(suggested.grade); }, [suggested]);

  if (answer.status === 'none') return <span className="text-muted">{'ДЗ не выдано'}</span>;
  if (answer.status === 'pending') return <span className="text-muted">{'ждём ответ'}</span>;
  if (answer.status === 'expired') return <span className="chip chip--red">{'не сдано'}</span>;

  const send = async (payload) => {
    setBusy(true);
    try {
      await reviewHomework(lessonId, row.student_id, payload);
      await onChanged();
    } catch (err) {
      onError(extractErrorMessage(err, 'Не удалось сохранить'));
    } finally {
      setBusy(false);
    }
  };

  const num = grade === '' ? null : Number(grade);
  const valid = num !== null && Number.isInteger(num) && num >= 0 && num <= 100;
  // Сохранить введённую оценку, если она изменилась. Пустое поле — ничего не делаем
  // (снять оценку — кнопка ↺).
  const saveGrade = () => {
    if (busy) return;
    if (grade === '') { setGrade(answer.grade ?? ''); return; }
    if (!valid) { onError('Оценка — целое число от 0 до 100'); setGrade(answer.grade ?? ''); return; }
    if (num !== answer.grade) send({ grade: num });
  };
  const unsaved = valid && num !== answer.grade;

  return (
    <div className="hw-review">
      <input
        type="number"
        min="0"
        max="100"
        className={`input input--sm-num hw-review__grade${answer.status === 'submitted' || unsaved ? ' hw-review__grade--todo' : ''}`}
        value={grade}
        disabled={busy}
        data-tip="Оценка за ДЗ (0–100) — сохраняется сразу"
        onChange={e => setGrade(e.target.value)}
        onBlur={saveGrade}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      <button
        type="button"
        className={`hw-review__btn${answer.accepted ? ' hw-review__btn--on' : ''}`}
        data-tip="Принять без оценки"
        disabled={busy || answer.accepted}
        onClick={() => send({ accepted: true })}
      >
        {'✓'}
      </button>
      <button
        type="button"
        className="hw-review__btn hw-review__btn--undo"
        data-tip="Вернуть на доработку — снять оценку и «принято»"
        disabled={busy || !answer.accepted || answer.status === 'returned'}
        onClick={() => send({ grade: null, accepted: false })}
      >
        {'↺'}
      </button>
      {suggested && unsaved && (
        <button
          type="button"
          className="btn btn--sm"
          data-tip="Сохранить оценку"
          disabled={busy}
          onMouseDown={e => e.preventDefault()}
          onClick={saveGrade}
        >
          {'Сохранить'}
        </button>
      )}
    </div>
  );
}

// ---------- «Проверка с ИИ» ----------

// Подписи частей комментария — на языке сектора группы (комментарий читает ученик)
const AI_LABELS = {
  ru: ['Хорошо', 'Плохо'],
  az: ['Yaxşı', 'Pis'],
  en: ['Good', 'Bad'],
};

export function buildReviewPrompt(src) {
  const lang = LANG_NAMES[src.lang] || src.sector_name || src.lang || 'русский';
  const block = (f) => `=== ${f.filename}${f.truncated ? ' (текст сокращён)' : ''} ===\n${f.text}`;
  const taskText = src.files.filter(f => f.kind === 'task' && f.text !== null);
  const answerText = src.files.filter(f => f.kind === 'answer' && f.text !== null);
  const attached = src.files.filter(f => f.text === null);
  const work = src.mode === 'work';
  return [
    `Ты — преподаватель детской IT-академии (ученики 8–14 лет). Проверь ${work ? 'работу, которую ученик сделал и сдал на уроке' : 'домашнее задание ученика'}.`,
    '',
    ...(src.course ? [`Курс: ${src.course}.`] : []),
    `Урок: ${src.lesson_title}.`,
    `Язык комментария: ${lang}. Пиши "good" и "bad" только на этом языке.`,
    '',
    'Как проверять:',
    work
      ? '- Задание — в материалах урока и комментарии педагога ниже. Найди там, что ученик должен был сделать, и сравни с его работой: что выполнено, что нет, есть ли ошибки.'
      : '- Сравни ответ ученика с заданием: что выполнено, что нет, есть ли ошибки.',
    '- Пиши коротко, доброжелательно и понятно ребёнку, обращайся к ученику на «ты».',
    '- "good" — что получилось хорошо, 1–3 конкретные вещи.',
    '- "bad" — что плохо или не сделано и как это исправить. Готовое решение за ученика не пиши. Если замечаний нет — так и напиши.',
    '- "score" — целое число от 0 до 100: насколько полно и правильно выполнено задание.',
    '- Если ответа нет или он не относится к заданию — "score": 0, причину напиши в "bad".',
    ...(attached.length ? [`- К этому сообщению приложены файлы: ${attached.map(f => f.filename).join(', ')}. Это ${attached.every(f => f.kind === 'answer') ? 'файлы ответа ученика' : (work ? 'материалы урока и/или файлы работы ученика' : 'файлы задания и/или ответа ученика')} — учти их при проверке.`] : []),
    '',
    work ? 'МАТЕРИАЛЫ УРОКА:' : 'ЗАДАНИЕ:',
    ...(work && src.lesson_comment ? [`=== Комментарий педагога к уроку ===\n${src.lesson_comment}`] : []),
    ...(taskText.length ? taskText.map(block) : (work && src.lesson_comment ? [] : [attached.some(f => f.kind === 'task') ? '(в приложенных файлах)' : '(текст задания не дан — оцени по ответу и названию урока)'])),
    '',
    work ? 'РАБОТА УЧЕНИКА:' : 'ОТВЕТ УЧЕНИКА:',
    ...(answerText.length ? answerText.map(block) : [attached.some(f => f.kind === 'answer') ? '(в приложенных файлах)' : '(ученик ничего не прислал)']),
    '=== конец ===',
    '',
    'Ответь ТОЛЬКО одним JSON-объектом — без пояснений, без markdown и без ```. Строго в таком формате:',
    '{"good":"что получилось хорошо","bad":"что плохо и как исправить","score":85}',
  ].join('\n');
}

// Ответ ИИ → { good, bad, score } или { error }. ``` обёртку и текст вокруг JSON прощаем.
export function parseReviewJson(text) {
  let raw = (text || '').trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) return { error: 'В тексте не найден JSON' };
  let data;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch (e) {
    return { error: `JSON не читается: ${e.message}` };
  }
  const good = String(data?.good ?? '').trim();
  const bad = String(data?.bad ?? '').trim();
  const score = Math.round(Number(data?.score));
  if (!good && !bad) return { error: 'В JSON нет "good" и "bad"' };
  if (!Number.isFinite(score) || score < 0 || score > 100) return { error: '"score" — нужно число от 0 до 100' };
  return { good, bad, score };
}

// onFill({ grade, text }) — оценка в поле оценки, текст в поле сообщения диалога
// mode: homework — ответ на ДЗ | work — работа на уроке
function AiReviewBlock({ lessonId, studentId, onFill, mode = 'homework' }) {
  const [src, setSrc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [aiText, setAiText] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  // Окно копирования должно открываться по клику: данные собираем заранее
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    (mode === 'work' ? getWorkAiSource : getAiSource)(lessonId, studentId)
      .then(data => { if (!cancelled) setSrc(data); })
      .catch(err => { if (!cancelled) setError(extractErrorMessage(err, 'Не удалось собрать данные для промпта')); });
    return () => { cancelled = true; };
  }, [lessonId, studentId, mode]);

  const copyPrompt = async () => {
    if (!src) return;
    setError('');
    try {
      await copyText(buildReviewPrompt(src));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Не удалось скопировать промпт');
    }
  };

  const getFile = async (f) => {
    setError('');
    setBusy(true);
    try {
      if (f.kind === 'answer') {
        const file = { id: f.id, original_filename: f.filename, content_type: f.content_type };
        await (mode === 'work' ? downloadWorkFile : downloadAnswerFile)(lessonId, file);
      } else {
        await openTaskFile({ material_id: f.id, title: f.filename, content_type: f.content_type });
      }
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось получить файл'));
    } finally {
      setBusy(false);
    }
  };

  const fill = () => {
    setError('');
    setDone('');
    const res = parseReviewJson(aiText);
    if (res.error) { setError(res.error); return; }
    const [goodLabel, badLabel] = AI_LABELS[src?.lang] || AI_LABELS.ru;
    const text = [res.good && `${goodLabel}: ${res.good}`, res.bad && `${badLabel}: ${res.bad}`].filter(Boolean).join('\n\n');
    onFill({ grade: res.score, text });
    setDone('Заполнено: проверьте оценку и сообщение, затем «Сохранить» и «Отправить».');
    setAiText('');
    setPasteOpen(false);
  };

  const attached = src ? src.files.filter(f => f.text === null) : [];

  return (
    <div className="review-panel__ai">
      <div className="review-panel__ai-row">
        <button type="button" className="btn btn--sm btn--outline" onClick={copyPrompt} disabled={!src} data-tip="Скопировать промпт для проверки — вставьте его в любой ИИ">
          {copied ? 'Скопировано' : (src ? 'Промпт для ИИ' : 'Собираем промпт...')}
        </button>
        <button type="button" className="btn btn--sm btn--outline" onClick={() => setPasteOpen(v => !v)} data-tip="Вставить ответ ИИ (JSON) — заполнит оценку и сообщение">
          {'Вставить ответ ИИ'}
        </button>
      </div>
      {attached.length > 0 && (
        <div className="review-panel__ai-row">
          <span className="text-muted">{'Приложите к запросу в ИИ:'}</span>
          {attached.map(f => (
            <button
              key={`${f.kind}-${f.id}`}
              type="button"
              className="review-panel__tab"
              disabled={busy}
              data-tip={f.kind === 'answer' ? 'Файл ответа — скачать' : (mode === 'work' ? 'Материал урока — открыть (сохранить из вкладки)' : 'Файл задания — открыть (сохранить из вкладки)')}
              onClick={() => getFile(f)}
            >
              {f.kind === 'answer' ? `⬇ ${f.filename}` : `↗ ${f.filename}`}
            </button>
          ))}
        </div>
      )}
      {pasteOpen && (
        <>
          <textarea
            className="input quiz-helper__area"
            rows={5}
            value={aiText}
            onChange={e => setAiText(e.target.value)}
            placeholder={'Ответ ИИ (JSON)'}
          />
          <div className="review-panel__ai-row">
            <button type="button" className="btn btn--sm" onClick={fill} disabled={!aiText.trim() || !src}>{'Заполнить'}</button>
          </div>
        </>
      )}
      {error && <div className="error-text error-text--muted">{error}</div>}
      {done && <div className="hint-text">{done}</div>}
    </div>
  );
}

// Работа на уроке в панели проверки: оценка (= оценка за урок) и ✓ принять без оценки.
// locked — прошла полночь: оценку за урок менять нельзя (кроме админа), принять можно.
// suggested — { grade } от ИИ: подставляется в поле, сохраняется кнопкой «Сохранить» (или Enter)
function WorkReviewControls({ lessonId, row, locked, onChanged, onError, suggested }) {
  const { work } = row;
  const [grade, setGrade] = useState(work.score ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setGrade(work.score ?? ''); }, [work.score]);
  useEffect(() => { if (suggested && !locked) setGrade(suggested.grade); }, [suggested]); // eslint-disable-line

  const send = async (payload) => {
    setBusy(true);
    try {
      await reviewWork(lessonId, row.student_id, payload);
      await onChanged();
    } catch (err) {
      onError(extractErrorMessage(err, 'Не удалось сохранить'));
    } finally {
      setBusy(false);
    }
  };

  const num = grade === '' ? null : Number(grade);
  const valid = num !== null && Number.isInteger(num) && num >= 0 && num <= 100;
  const saveGrade = () => {
    if (busy) return;
    if (grade === '') { setGrade(work.score ?? ''); return; }
    if (!valid) { onError('Оценка — целое число от 0 до 100'); setGrade(work.score ?? ''); return; }
    if (num !== work.score || work.status === 'submitted') send({ grade: num });
  };
  const reviewed = work.status === 'accepted' || work.status === 'graded';
  const unsaved = valid && num !== work.score;

  return (
    <div className="hw-review">
      <span className="text-muted">{'Оценка за урок'}</span>
      <input
        type="number"
        min="0"
        max="100"
        className={`input input--sm-num hw-review__grade${work.status === 'submitted' || unsaved ? ' hw-review__grade--todo' : ''}`}
        value={grade}
        disabled={busy || locked}
        data-tip={locked ? 'Прошла полночь — оценку за урок менять нельзя' : 'Оценка за урок (0–100) — сохраняется сразу'}
        onChange={e => setGrade(e.target.value)}
        onBlur={saveGrade}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
      <button
        type="button"
        className={`hw-review__btn${reviewed ? ' hw-review__btn--on' : ''}`}
        data-tip={reviewed ? 'Проверено' : 'Принять без оценки'}
        disabled={busy || reviewed}
        onClick={() => send({ accepted: true })}
      >
        {'✓'}
      </button>
      {suggested && unsaved && !locked && (
        <button
          type="button"
          className="btn btn--sm"
          data-tip="Сохранить оценку"
          disabled={busy}
          onMouseDown={e => e.preventDefault()}
          onClick={saveGrade}
        >
          {'Сохранить'}
        </button>
      )}
    </div>
  );
}

// ---------- Панель проверки справа ----------

// mode: homework — ответ на ДЗ (row.answer); work — работа на уроке (row.work, оценка за урок).
const PANEL_MODES = {
  homework: {
    files: row => row.answer.files,
    viewUrl: answerFileViewUrl,
    open: openAnswerFile,
    download: downloadAnswerFile,
    submittedAt: row => row.answer.submitted_at,
    deadline: row => row.answer.deadline,
    empty: 'ответа нет',
  },
  work: {
    files: row => row.work.files,
    viewUrl: workFileViewUrl,
    open: openWorkFile,
    download: downloadWorkFile,
    submittedAt: row => row.work.submitted_at,
    deadline: () => null,
    empty: 'работу не сдал',
  },
};

// queue — все студенты группы по порядку таблицы (листаем по кругу, ради диалога тоже); toReviewCount — сколько ждут проверки
export function ReviewPanel({ lessonId, rows, queue, toReviewCount, studentId, fileId, onNavigate, onChanged, onClose, mode = 'homework', locked = false }) {
  const M = PANEL_MODES[mode];
  const row = rows.find(r => r.student_id === studentId);
  const files = row ? M.files(row) : [];
  const [activeId, setActiveId] = useState(fileId || files[0]?.id || null);
  const [view, setView] = useState(null); // { url, type, text }
  const [error, setError] = useState('');
  const [aiGrade, setAiGrade] = useState(null); // { grade } — оценка от ИИ в поле оценки
  const [aiDraft, setAiDraft] = useState(null); // { text } — комментарий ИИ в поле сообщения


  useEffect(() => {
    let revoked = null;
    let cancelled = false;
    setView(null);
    const f = files.find(x => x.id === activeId);
    if (!f) return undefined;
    M.viewUrl(lessonId, f)
      .then(async ({ url, type }) => {
        revoked = url;
        const text = type.startsWith('text/') ? await (await fetch(url)).text() : null;
        if (!cancelled) setView({ url, type, text });
      })
      .catch(err => setError(extractErrorMessage(err, 'Не удалось открыть файл')));
    return () => { cancelled = true; if (revoked) window.URL.revokeObjectURL(revoked); };
  }, [lessonId, activeId]); // eslint-disable-line

  if (!row) return null;
  const idx = queue.findIndex(r => r.student_id === studentId);
  const go = (delta) => {
    if (!queue.length) return;
    const from = idx === -1 ? (delta > 0 ? -1 : 0) : idx;
    const next = queue[(from + delta + queue.length) % queue.length];
    if (next) onNavigate(next.student_id);
  };
  const active = files.find(x => x.id === activeId) || null;

  return (
    <div className="review-panel__backdrop" onClick={onClose}>
      <aside className="review-panel" onClick={e => e.stopPropagation()}>
        <div className="review-panel__head">
          <h3 className="review-panel__name">{row.full_name}</h3>
          <button type="button" className="btn btn--sm" onClick={onClose} data-tip="Закрыть">{'✕'}</button>
        </div>
        <div className="text-muted review-panel__meta">
          {M.submittedAt(row) ? `сдано ${new Date(M.submittedAt(row)).toLocaleString('ru-RU')}` : M.empty}
          {M.deadline(row) ? ` · срок до ${formatDeadline(M.deadline(row))}` : ''}
        </div>

        <div className="review-panel__tabs">
          {files.map(f => (
            <button
              key={f.id}
              type="button"
              className={`review-panel__tab${f.id === activeId ? ' review-panel__tab--active' : ''}`}
              onClick={() => setActiveId(f.id)}
            >
              {f.original_filename}
            </button>
          ))}
          {active && (
            <button
              type="button"
              className="review-panel__tab"
              onClick={() => M.open(lessonId, active).catch(err => setError(extractErrorMessage(err, 'Не удалось открыть')))}
            >
              {'↗ в новой вкладке'}
            </button>
          )}
          {active && (
            <button
              type="button"
              className="review-panel__tab"
              onClick={() => M.download(lessonId, active).catch(err => setError(extractErrorMessage(err, 'Не удалось скачать')))}
            >
              {'⬇ Скачать'}
            </button>
          )}
        </div>

        <div className="review-panel__viewer">
          {error && <div className="error-text error-text--muted">{error}</div>}
          {!active && <p className="text-muted">{'Файлов нет'}</p>}
          {active && !view && !error && <p className="text-muted">{'Загрузка...'}</p>}
          {active && view && view.type.startsWith('image/') && <img src={view.url} alt={active.original_filename} />}
          {active && view && view.type === 'application/pdf' && <iframe src={view.url} title={active.original_filename} />}
          {active && view && view.text !== null && <pre>{view.text}</pre>}
          {active && view && !view.type.startsWith('image/') && view.type !== 'application/pdf' && view.text === null && (
            <p className="text-muted">{'Этот формат не показывается в панели — «↗ в новой вкладке» или «⬇ Скачать».'}</p>
          )}
        </div>

        {files.length > 0 && (
          <AiReviewBlock
            lessonId={lessonId}
            studentId={row.student_id}
            mode={mode}
            onFill={({ grade, text }) => { setAiGrade({ grade }); setAiDraft({ text }); }}
          />
        )}

        {mode === 'work'
          ? <WorkReviewControls lessonId={lessonId} row={row} locked={locked} onChanged={onChanged} onError={setError} suggested={aiGrade} />
          : <ReviewControls lessonId={lessonId} row={row} onChanged={onChanged} onError={setError} suggested={aiGrade} />}

        <div className="review-panel__dialog">
          <DialogThread lessonId={lessonId} studentId={row.student_id} onChanged={onChanged} draft={aiDraft} />
        </div>

        <div className="review-panel__nav">
          <button type="button" className="btn btn--sm" onClick={() => go(-1)} disabled={queue.length === 0 || (queue.length === 1 && idx === 0)}>{'← Предыдущий'}</button>
          <span className="text-muted">{toReviewCount ? `на проверке: ${toReviewCount}` : 'всё проверено'}</span>
          <button type="button" className="btn btn--sm" onClick={() => go(1)} disabled={queue.length === 0 || (queue.length === 1 && idx === 0)}>{'Следующий →'}</button>
        </div>
      </aside>
    </div>
  );
}
