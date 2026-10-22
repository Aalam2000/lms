// Общая кнопка удаления с контролем использования (один механизм на всю
// систему — см. backend app/usages.py).
//
// <DeleteButton entity="course" id={c.id} name={c.title}
//   onDelete={() => deleteCourse(c.id)} onDeleted={loadCourses} />
//
// По клику: спрашивает сервер, где используется объект.
//  - нигде — подтверждение «Удалить навсегда?» → onDelete → onDeleted;
//  - где-то — окно «Нельзя удалить» со списком мест (сгруппировано, ссылки).
// Если объект успели привязать, пока висело подтверждение, сервер ответит
// 409 со списком — покажется то же окно.
//
// forceable — админу можно удалить и используемый объект: окно показывает,
// ЧТО удалится вместе с ним, и кнопку «Удалить всё равно» → onDelete({ force: true }).
import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { getUsages } from '../api/usages';
import IconButton from './IconButton';
import Modal from './Modal';
import { extractErrorMessage } from '../utils/errors';

const SHOW_PER_KIND = 20;

function DeleteButton({ entity, id, name, onDelete, onDeleted, onError, tip = 'Удалить', forceable = false }) {
  const [usages, setUsages] = useState(null);
  const [blockMessage, setBlockMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const reportError = (err, fallback) => {
    const msg = extractErrorMessage(err, fallback);
    if (onError) onError(msg); else window.alert(msg);
  };

  const handleClick = async (e) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      let found;
      try {
        found = await getUsages(entity, id);
      } catch (err) {
        // Сервер запретил удаление в принципе (например, «Нельзя удалить
        // самого себя») — показываем это в том же окне, а не мельком сверху.
        if (err?.response?.status === 400) {
          setBlockMessage(extractErrorMessage(err, 'Удалить нельзя'));
          setUsages([]);
          return;
        }
        throw err;
      }
      if (found.usages.length > 0) {
        setUsages(found.usages);
        return;
      }
      if (!window.confirm(`Удалить «${name}» навсегда? Это действие нельзя отменить.`)) return;
      try {
        await onDelete();
      } catch (err) {
        const detail = err?.response?.data?.detail;
        if (err?.response?.status === 409 && detail?.usages) {
          setUsages(detail.usages);
          return;
        }
        throw err;
      }
      if (onDeleted) await onDeleted();
    } catch (err) {
      reportError(err, 'Не удалось удалить');
    } finally {
      setBusy(false);
    }
  };

  const forceDelete = async () => {
    try {
      await onDelete({ force: true });
      setUsages(null);
      if (onDeleted) await onDeleted();
    } catch (err) {
      setUsages(null);
      reportError(err, 'Не удалось удалить');
    }
  };

  // Обёртка гасит всплытие кликов: кнопка и окно обычно стоят внутри
  // кликабельной строки таблицы, клик по ним не должен открывать её.
  return (
    <span className="delete-btn" onClick={e => e.stopPropagation()}>
      <IconButton icon="delete" tip={tip} variant="danger" disabled={busy} onClick={handleClick} />
      {usages && (
        <UsagesModal
          name={name}
          usages={usages}
          message={blockMessage}
          onForce={forceable && !blockMessage ? forceDelete : null}
          onClose={() => { setUsages(null); setBlockMessage(''); }}
        />
      )}
    </span>
  );
}

function UsagesModal({ name, usages, message, onForce, onClose }) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState({});
  const [forcing, setForcing] = useState(false);

  const byKind = [];
  usages.forEach(u => {
    let group = byKind.find(g => g.kind === u.kind);
    if (!group) { group = { kind: u.kind, items: [] }; byKind.push(group); }
    group.items.push(u);
  });

  const open = (url) => { onClose(); navigate(url); };

  return (
    <Modal
      title={onForce ? `Удалить «${name}» вместе с данными?` : `Нельзя удалить «${name}»`}
      onClose={onClose}
      size="wide"
      footer={onForce ? (
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose} disabled={forcing}>{'Отмена'}</button>
          <button
            type="button"
            className="btn btn--danger"
            disabled={forcing}
            onClick={async () => { setForcing(true); await onForce(); }}
          >
            {forcing ? 'Удаление...' : 'Удалить всё равно'}
          </button>
        </>
      ) : undefined}
    >
      <div>
        {onForce ? (
          <p className="error-text">
            {'Вместе с ним будет безвозвратно удалено всё перечисленное ниже (из групп — только его участие, сами группы и уроки останутся). Отменить нельзя.'}
          </p>
        ) : (
          <p className="text-muted">
            {message || 'Объект используется в следующих местах. Сначала уберите его оттуда.'}
          </p>
        )}
        <div className="usages">
          {byKind.map(g => {
            const all = !!expanded[g.kind];
            const shown = all ? g.items : g.items.slice(0, SHOW_PER_KIND);
            return (
              <div key={g.kind} className="usages__group">
                <div className="usages__kind">{`${g.kind} (${g.items.length})`}</div>
                <ul className="usages__list">
                  {shown.map((u, i) => (
                    <li key={i}>
                      {u.url
                        ? <button type="button" className="link" onClick={() => open(u.url)}>{u.title}</button>
                        : u.title}
                    </li>
                  ))}
                </ul>
                {!all && g.items.length > SHOW_PER_KIND && (
                  <button type="button" className="link" onClick={() => setExpanded(prev => ({ ...prev, [g.kind]: true }))}>
                    {`…и ещё ${g.items.length - SHOW_PER_KIND}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

export default DeleteButton;
