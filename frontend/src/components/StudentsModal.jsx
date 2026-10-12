import React, { useEffect, useState } from 'react';
import api from '../api/auth';
import {
  getGroupStudents, searchAvailableStudents, addGroupMember, expelGroupMember, restoreGroupMember,
  acceptGroupMember, declineGroupMember,
} from '../api/groups';
import StudentCardModal from './StudentCardModal';

// initialTab — 'pending', если окно открыли меткой «Новые» на странице группы
function StudentsModal({ groupId, groupName, onClose, initialTab = 'active', pendingCount = 0 }) {
  const [tab, setTab] = useState(initialTab); // active | pending (новые, ждут подтверждения) | archived
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showAdd, setShowAdd] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState([]);
  const [addLoading, setAddLoading] = useState(false);
  const [addingId, setAddingId] = useState(null);

  const [expellingId, setExpellingId] = useState(null);
  const [expelReason, setExpelReason] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [editingId, setEditingId] = useState(null); // открыта карточка ученика (StudentCardModal)

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await getGroupStudents(groupId, tab === 'archived' ? 'expelled' : tab);
      setStudents(res);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось загрузить учеников');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [groupId, tab]);

  // Поиск учеников для добавления — с задержкой, чтобы не дёргать бэк на
  // каждую букву.
  useEffect(() => {
    if (!showAdd) return;
    setAddLoading(true);
    const t = setTimeout(() => {
      searchAvailableStudents(groupId, addQuery)
        .then(setAddResults)
        .catch(() => setAddResults([]))
        .finally(() => setAddLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [groupId, showAdd, addQuery]);

  const handleAdd = async (studentId) => {
    setAddingId(studentId);
    setError('');
    try {
      await addGroupMember(groupId, studentId);
      setAddResults(prev => prev.filter(s => s.id !== studentId));
      if (tab === 'active') await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось добавить ученика');
    } finally {
      setAddingId(null);
    }
  };

  const handleExpelConfirm = async (studentId) => {
    const reason = expelReason.trim();
    if (!reason) return;
    setBusyId(studentId);
    setError('');
    try {
      await expelGroupMember(groupId, studentId, reason);
      setExpellingId(null);
      setExpelReason('');
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось отчислить');
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = (studentId) => { setExpellingId(null); setEditingId(studentId); };
  const closeEdit = () => setEditingId(null);

  // Новые ученики: принять — сразу в группе; отклонить — аккаунт удаляется, если других групп нет
  const handleAccept = async (studentId) => {
    setBusyId(studentId);
    setError('');
    try {
      await acceptGroupMember(groupId, studentId);
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось принять');
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (st) => {
    if (!window.confirm(`Отклонить «${st.full_name || st.username}»? Если ученик больше нигде не учится, его аккаунт будет удалён.`)) return;
    setBusyId(st.id);
    setError('');
    try {
      await declineGroupMember(groupId, st.id);
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось отклонить');
    } finally {
      setBusyId(null);
    }
  };

  const handleRestore = async (studentId) => {
    setBusyId(studentId);
    setError('');
    try {
      await restoreGroupMember(groupId, studentId);
      await load();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось восстановить');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <h3 style={s.title}>
          {'Ученики'} — {groupName}
        </h3>

        <div style={s.tabs}>
          <button
            className={`tab${tab === 'active' ? ' tab--active' : ''}`}
            onClick={() => setTab('active')}
          >
            {'Активные'}
          </button>
          <button
            className={`tab${tab === 'pending' ? ' tab--active' : ''}`}
            onClick={() => setTab('pending')}
          >
            {'Новые'}
            {(tab === 'pending' && !loading ? students.length : pendingCount) > 0 && (
              <span className="btn__count">{tab === 'pending' && !loading ? students.length : pendingCount}</span>
            )}
          </button>
          <button
            className={`tab${tab === 'archived' ? ' tab--active' : ''}`}
            onClick={() => setTab('archived')}
          >
            {'Архив'}
          </button>
          {tab === 'active' && (
            <button className="btn btn--outline" style={s.addToggle} onClick={() => setShowAdd(v => !v)}>
              {showAdd ? 'Скрыть поиск' : '+ Добавить ученика'}
            </button>
          )}
        </div>

        {tab === 'active' && showAdd && (
          <div style={s.addBox}>
            <input
              style={s.addInput}
              placeholder={'Имя или логин...'}
              value={addQuery}
              onChange={e => setAddQuery(e.target.value)}
              autoFocus
            />
            {addLoading && <p style={s.info}>{'Ищем...'}</p>}
            {!addLoading && addResults.length === 0 && (
              <p style={s.info}>{'Никого не нашли'}</p>
            )}
            {!addLoading && addResults.map(st => (
              <div key={st.id} style={s.addRow}>
                <span>{st.full_name || st.username} {st.full_name ? `(${st.username})` : ''}</span>
                <button
                  className="btn btn--secondary btn--compact"
                  disabled={addingId === st.id}
                  onClick={() => handleAdd(st.id)}
                >
                  {addingId === st.id ? '...' : 'Добавить'}
                </button>
              </div>
            ))}
          </div>
        )}

        {loading && <p style={s.info}>{'Загрузка...'}</p>}
        {error && <p style={s.error}>{error}</p>}

        {!loading && (
          <div className="table-scroll">
          <table className="table table--on-white">
            <thead>
              <tr>
                <th>{'Имя'}</th>
                <th>{'Логин'}</th>
                <th>{'Телефон'}</th>
                {tab !== 'archived' && <th>{'Дата регистрации'}</th>}
                {tab === 'archived' && <th>{'Причина'}</th>}
                {tab === 'archived' && <th>{'Дата отчисления'}</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {students.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#6B7280' }}>
                    {tab === 'active' ? 'Учеников пока нет' : tab === 'pending' ? 'Новых заявок нет' : 'Архив пуст'}
                  </td>
                </tr>
              )}
              {students.map(st => (
                <React.Fragment key={st.id}>
                  <tr>
                    <td>{st.full_name || '—'}</td>
                    <td>{st.username}</td>
                    {/* нет телефона — красный прочерк, чтобы пропуск было видно сразу */}
                    <td className="nowrap" style={{ color: st.phone ? undefined : '#B91C1C' }}>{st.phone || '—'}</td>
                    {tab !== 'archived' && (
                      <td>{st.created_at ? new Date(st.created_at).toLocaleDateString('ru-RU') : '—'}</td>
                    )}
                    {tab === 'archived' && <td>{st.expel_reason || '—'}</td>}
                    {tab === 'archived' && (
                      <td>{st.expelled_at ? new Date(st.expelled_at).toLocaleDateString('ru-RU') : '—'}</td>
                    )}
                    <td>
                      {tab === 'active' && expellingId !== st.id && (
                        <span style={s.rowActions}>
                          <button style={s.linkBtn} onClick={() => openEdit(st.id)}>
                            {'Изменить'}
                          </button>
                          <button
                            style={s.dangerLinkBtn}
                            onClick={() => { closeEdit(); setExpellingId(st.id); setExpelReason(''); }}
                          >
                            {'Отчислить'}
                          </button>
                        </span>
                      )}
                      {tab === 'archived' && (
                        <button
                          className="btn btn--secondary btn--compact"
                          disabled={busyId === st.id}
                          onClick={() => handleRestore(st.id)}
                        >
                          {busyId === st.id ? '...' : 'Вернуть'}
                        </button>
                      )}
                      {tab === 'pending' && (
                        <span className="pending-actions">
                          <button
                            className="btn btn--compact"
                            disabled={busyId === st.id}
                            onClick={() => handleAccept(st.id)}
                          >
                            {'Принять'}
                          </button>
                          <button
                            className="btn btn--danger btn--compact"
                            disabled={busyId === st.id}
                            onClick={() => handleDecline(st)}
                          >
                            {'Отклонить'}
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                  {tab === 'active' && expellingId === st.id && (
                    <tr>
                      <td colSpan={6} style={s.expelCell}>
                        <div style={s.expelBox}>
                          <textarea
                            style={s.expelTextarea}
                            placeholder={'Причина отчисления (обязательно) — например, не оплатил или закончил обучение'}
                            value={expelReason}
                            onChange={e => setExpelReason(e.target.value)}
                            autoFocus
                          />
                          <div style={s.expelActions}>
                            <button
                              className="btn btn--secondary btn--compact"
                              onClick={() => { setExpellingId(null); setExpelReason(''); }}
                            >
                              {'Отмена'}
                            </button>
                            <button
                              className="btn btn--danger btn--compact"
                              disabled={!expelReason.trim() || busyId === st.id}
                              onClick={() => handleExpelConfirm(st.id)}
                            >
                              {busyId === st.id ? '...' : 'Отчислить'}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {editingId && (
          <StudentCardModal
            studentId={editingId}
            onClose={closeEdit}
            onSaved={() => { closeEdit(); load(); }}
          />
        )}

        <div style={s.actions}>
          <button className="btn btn--secondary" onClick={onClose}>
            {'Закрыть'}
          </button>
        </div>
      </div>
    </div>
  );
}

const s = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  modal: { width: '100%', maxWidth: '760px', background: 'white', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 12px 32px rgba(0,0,0,0.2)', maxHeight: '85vh', overflowY: 'auto' },
  title: { margin: '0 0 1rem 0' },
  tabs: { display: 'flex', gap: '8px', marginBottom: '1rem', alignItems: 'center' },
  addToggle: { marginLeft: 'auto' },
  addBox: { background: '#f9fafb', borderRadius: '8px', padding: '10px 12px', marginBottom: '1rem' },
  addInput: { width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #e5e7eb', fontSize: '0.9rem', boxSizing: 'border-box' },
  addRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 2px', fontSize: '0.9rem' },
  info: { color: '#6B7280', textAlign: 'center', padding: '1rem' },
  error: { color: '#B91C1C', fontSize: '0.9rem', textAlign: 'center', padding: '1rem' },
  rowActions: { display: 'inline-flex', gap: '12px', whiteSpace: 'nowrap' },
  linkBtn: { background: 'none', border: 'none', color: '#111827', cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline', padding: 0 },
  dangerLinkBtn: { background: 'none', border: 'none', color: '#B91C1C', cursor: 'pointer', fontSize: '0.82rem', textDecoration: 'underline', padding: 0 },
  expelCell: { padding: '0 10px 10px 10px', borderBottom: '1px solid #e8f4f0' },
  expelBox: { background: '#FEF2F2', borderRadius: '8px', padding: '10px' },
  expelTextarea: { width: '100%', minHeight: '54px', padding: '8px', borderRadius: '6px', border: '1px solid #fecaca', fontSize: '0.85rem', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' },
  expelActions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' },
  actions: { marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end' },
};

export default StudentsModal;
