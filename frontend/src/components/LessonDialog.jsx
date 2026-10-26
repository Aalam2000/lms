// Диалог педагог ↔ студент в строке студента урока (вместо комментария).
// Только добавление сообщений; править можно лишь своё последнее, пока на
// него не ответили (сервер это тоже проверяет).
import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { getMessages, sendMessage, editMessage } from '../api/homework';
import { extractErrorMessage } from '../utils/errors';
import { notifyHomeworkChanged } from '../hooks/useHomeworkRefresh';

const fmt = (v) => (v ? new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

// draft — { text } снаружи (ответ ИИ): кладётся в поле сообщения, не отправляется
// readOnly — только чтение переписки (ученик отчислен из группы, урок из архива)
export function DialogThread({ lessonId, studentId, onChanged, draft, readOnly = false }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    getMessages(lessonId, studentId)
      .then(setMessages)
      .catch(err => setError(extractErrorMessage(err, 'Не удалось загрузить диалог')))
      .finally(() => setLoading(false));
  }, [lessonId, studentId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages]);

  useEffect(() => {
    if (!draft) return;
    setEditingId(null);
    setText(draft.text);
  }, [draft]);

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = editingId
        ? await editMessage(lessonId, studentId, editingId, text)
        : await sendMessage(lessonId, studentId, text);
      setMessages(res);
      setText('');
      setEditingId(null);
      if (onChanged) onChanged();
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось отправить'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog">
      <div className="dialog__messages">
        {loading && <p className="text-muted">{'Загрузка...'}</p>}
        {!loading && messages.length === 0 && <p className="text-muted">{'Сообщений пока нет'}</p>}
        {messages.map(m => (
          <div key={m.id} className={`dialog__msg${m.is_mine ? ' dialog__msg--mine' : ''}`}>
            <div className="dialog__meta">
              {m.author_name} · {fmt(m.created_at)}{m.edited_at ? ' · изменено' : ''}
            </div>
            <div className="dialog__text">{m.text}</div>
            {m.can_edit && !readOnly && editingId !== m.id && (
              <button type="button" className="link dialog__edit" onClick={() => { setEditingId(m.id); setText(m.text); }}>
                {'Изменить'}
              </button>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {error && <div className="error-text error-text--muted">{error}</div>}
      {!readOnly && (
      <>
      <textarea
        className="input input--textarea"
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={editingId ? 'Исправьте сообщение' : 'Написать сообщение'}
        disabled={busy}
      />
      <div className="button-row">
        <button type="button" className="btn" onClick={submit} disabled={busy || !text.trim()}>
          {editingId ? 'Сохранить' : 'Отправить'}
        </button>
        {editingId && (
          <button type="button" className="btn btn--secondary" onClick={() => { setEditingId(null); setText(''); }} disabled={busy}>
            {'Отмена'}
          </button>
        )}
      </div>
      </>
      )}
    </div>
  );
}

// Ячейка «Комментарий» в строке студента (педагог): последняя реплика, клик — диалог.
// unread — сколько сообщений ученика педагог не прочитал (красное число в начале).
// Закрыли окно — диалог прочитан: перечитываются строка и флаг «Сообщения» в шапке.
export function DialogCell({ lessonId, studentId, studentName, lastMessage, count, unread = 0, onChanged }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="dialog-cell" onClick={() => setOpen(true)}>
        {unread > 0 && <span className="dialog-cell__unread" data-tip={'Непрочитанные сообщения'}>{unread}</span>}
        {lastMessage ? (
          <>
            <span className={`dialog-cell__who${lastMessage.from_teacher ? '' : ' dialog-cell__who--student'}`}>
              {lastMessage.from_teacher ? 'Педагог:' : 'Студент:'}
            </span>{' '}
            <span className="dialog-cell__text">{lastMessage.text}</span>
            {count > 1 && <span className="text-muted">{` (${count})`}</span>}
          </>
        ) : <span className="text-muted">{'Написать…'}</span>}
      </button>
      {open && (
        <Modal title={`Диалог: ${studentName}`} onClose={() => { setOpen(false); if (onChanged) onChanged(); notifyHomeworkChanged(); }} size="wide">
          <DialogThread lessonId={lessonId} studentId={studentId} />
        </Modal>
      )}
    </>
  );
}
