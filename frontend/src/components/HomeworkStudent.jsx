// ДЗ со стороны студента — вкладка «ДЗ» на странице урока. Задания —
// таблицей, клик скачивает. Ответ один на всё ДЗ:
// «+ Файл» добавляет файлы, ✕ удаляет свой файл — пока не прошёл срок и
// педагог не принял/не оценил.
import React, { useRef, useState } from 'react';
import { uploadMyAnswerFiles, deleteMyAnswerFile, downloadTaskFile, openAnswerFile } from '../api/homework';
import { formatDeadline } from './DeadlinePicker';
import { extractErrorMessage } from '../utils/errors';

function statusChip(answer) {
  switch (answer.status) {
    case 'graded': return { label: `Оценка ${answer.grade}`, cls: 'chip chip--green' };
    case 'accepted': return { label: 'Принято', cls: 'chip chip--green' };
    case 'submitted': return { label: 'Ждёт проверки', cls: 'chip chip--grey' };
    case 'returned': return { label: 'Вернули на доработку', cls: 'chip chip--red' };
    case 'expired': return { label: 'Не сдано, срок истёк', cls: 'chip chip--red' };
    default: return { label: 'Не сдано', cls: 'chip chip--grey' };
  }
}

function StudentHomework({ lessonId, homework, onUpdated }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { tasks, answer } = homework;

  if (tasks.length === 0) {
    return <p className="text-muted">{'К этому уроку домашних заданий нет'}</p>;
  }

  const run = async (fn, fallback) => {
    setBusy(true);
    setError('');
    try {
      onUpdated(await fn());
    } catch (err) {
      setError(extractErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const upload = async (e) => {
    const files = e.target.files;
    if (!files || !files.length) return;
    await run(() => uploadMyAnswerFiles(lessonId, files), 'Не удалось загрузить файлы');
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (f) => {
    if (!window.confirm(`Удалить файл «${f.original_filename}»?`)) return;
    run(() => deleteMyAnswerFile(lessonId, f.id), 'Не удалось удалить файл');
  };

  const chip = statusChip(answer);

  return (
    <>
      {error && <div className="error-text error-text--muted">{error}</div>}
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{'Задание'}</th>
              <th>{'Срок'}</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map(task => (
              <tr key={task.id}>
                <td>
                  <button
                    type="button"
                    className="link"
                    data-tip="Скачать задание"
                    onClick={() => downloadTaskFile(task).catch(err => setError(extractErrorMessage(err, 'Не удалось скачать файл')))}
                  >
                    {task.title}
                  </button>
                  {task.student_id && <span className="text-muted">{' (для вас)'}</span>}
                </td>
                <td className="nowrap">
                  {task.deadline
                    ? <span className={task.is_expired ? 'chip chip--red' : 'chip chip--amber'}>{`до ${formatDeadline(task.deadline)}`}</span>
                    : <span className="text-muted">{'без срока'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="my-answer">
        <div className="my-answer__head">
          <b>{'Мой ответ'}</b>
          <span className={chip.cls}>{chip.label}</span>
        </div>
        <div className="answer-files">
          {answer.files.length === 0 && <span className="text-muted">{'Файлов пока нет'}</span>}
          {answer.files.map(f => (
            <span key={f.id} className="answer-files__item">
              <button
                type="button"
                className="link"
                data-tip="Открыть"
                onClick={() => openAnswerFile(lessonId, f).catch(err => setError(extractErrorMessage(err, 'Не удалось открыть файл')))}
              >
                {f.original_filename}
              </button>
              {!answer.is_locked && (
                <button type="button" className="answer-files__x" data-tip="Удалить файл" onClick={() => remove(f)} disabled={busy}>✕</button>
              )}
            </span>
          ))}
          {!answer.is_locked && (
            <>
              <input type="file" multiple ref={inputRef} onChange={upload} hidden />
              <button type="button" className="btn btn--sm" onClick={() => inputRef.current?.click()} disabled={busy}>
                {busy ? 'Загрузка...' : '+ Файл'}
              </button>
            </>
          )}
        </div>
        {answer.status === 'returned' && (
          <span className="hint-text">{'Педагог вернул ответ на доработку — исправьте и загрузите новый файл. Подробности — в «Диалоге».'}</span>
        )}
        {answer.is_locked && (answer.status === 'graded' || answer.status === 'accepted') && (
          <span className="hint-text">{'Педагог проверил ответ — изменить нельзя. Если нужно исправить, напишите в «Диалоге».'}</span>
        )}
      </div>
    </>
  );
}

export default StudentHomework;
