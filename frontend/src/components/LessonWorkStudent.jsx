// Работа на уроке со стороны ученика — вкладка «Работа на уроке» между
// «Материалы» и «ДЗ» (backend/app/routers/lesson_work.py). Поле загрузки
// (клик или перетащить файлы) и список сданного: клик открывает файл, ✕
// удаляет — пока педагог не проверил и не закончился день урока.
import React, { useRef, useState } from 'react';
import { uploadMyWorkFiles, deleteMyWorkFile, openWorkFile } from '../api/lessonWork';
import { extractErrorMessage } from '../utils/errors';

function statusChip(work) {
  switch (work.status) {
    case 'graded': return { label: `Оценка ${work.score}`, cls: 'chip chip--green' };
    case 'accepted': return { label: 'Принято', cls: 'chip chip--green' };
    case 'submitted': return { label: 'Ждёт проверки', cls: 'chip chip--amber' };
    default: return null;
  }
}

function LessonWorkStudent({ lessonId, work, onUpdated }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);

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

  const upload = (files) => {
    if (!files || !files.length || busy) return;
    run(() => uploadMyWorkFiles(lessonId, files), 'Не удалось загрузить файлы');
  };

  const onPick = async (e) => {
    await upload(e.target.files);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    upload(e.dataTransfer.files);
  };

  const remove = (f) => {
    if (!window.confirm(`Удалить файл «${f.original_filename}»?`)) return;
    run(() => deleteMyWorkFile(lessonId, f.id), 'Не удалось удалить файл');
  };

  const chip = statusChip(work);

  return (
    <div className="lesson-work">
      {error && <div className="error-text error-text--muted">{error}</div>}

      {!work.is_locked && (
        <button
          type="button"
          className={`lesson-work__drop${dragOver ? ' lesson-work__drop--over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          disabled={busy}
        >
          <span className="lesson-work__drop-title">{busy ? 'Загрузка...' : '📎 Загрузить файл'}</span>
          <span className="lesson-work__drop-hint">{'нажми или перетащи сюда — можно несколько файлов'}</span>
        </button>
      )}
      <input type="file" multiple ref={inputRef} onChange={onPick} hidden />

      {chip && (
        <div className="lesson-work__status">
          <span className={chip.cls}>{chip.label}</span>
        </div>
      )}

      {work.files.length === 0 && work.is_locked && (
        <p className="text-muted">{'На этом уроке работа не сдавалась'}</p>
      )}
      {work.files.map(f => (
        <div key={f.id} className="lesson-work__file">
          <button
            type="button"
            className="link lesson-work__name"
            data-tip="Открыть"
            onClick={() => openWorkFile(lessonId, f).catch(err => setError(extractErrorMessage(err, 'Не удалось открыть файл')))}
          >
            {f.original_filename}
          </button>
          <span className="text-muted nowrap">
            {f.uploaded_at ? new Date(f.uploaded_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}
          </span>
          {!work.is_locked && (
            <button type="button" className="answer-files__x" data-tip="Удалить файл" onClick={() => remove(f)} disabled={busy}>✕</button>
          )}
        </div>
      ))}

      {work.lock_reason === 'reviewed' && (
        <span className="hint-text">{'Педагог проверил работу — изменить нельзя.'}</span>
      )}
      {work.lock_reason === 'day_over' && work.files.length > 0 && (
        <span className="hint-text">{'День урока закончился — изменить работу нельзя.'}</span>
      )}
    </div>
  );
}

export default LessonWorkStudent;
