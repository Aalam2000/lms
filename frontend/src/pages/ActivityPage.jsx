// «Посещения» (только админ, claude/presence-plan.md): кто сейчас в системе
// (пульс за последние 2 мин, вкладку не закрыл) и отчёт — кто когда заходил и сколько времени провёл. Данные —
// из пульса открытых вкладок (hooks/usePresencePing.js), правила — на
// бэкенде (app/routers/presence.py).
import React, { useEffect, useMemo, useState } from 'react';
import Dropdown from '../components/Dropdown';
import { getOnlineUsers, getPresenceReport } from '../api/presence';
import { getMyGroups } from '../api/groups';
import { extractErrorMessage } from '../utils/errors';
import { formatDuration } from '../utils/lessonTime';

const ONLINE_REFRESH_MS = 30 * 1000;
const ROLE_OPTIONS = [
  { value: 'teacher', label: 'Педагоги' },
  { value: 'student', label: 'Студенты' },
  { value: 'admin', label: 'Админы' },
  { value: 'curator', label: 'Кураторы' },
];
const ROLE_LABELS = { admin: 'Админ', teacher: 'Педагог', student: 'Студент', curator: 'Куратор' };

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };
const PERIODS = [
  { key: 'today', label: 'Сегодня', from: () => daysAgo(0) },
  { key: 'week', label: '7 дней', from: () => daysAgo(6) },
  { key: 'month', label: '30 дней', from: () => daysAgo(29) },
];

const formatTime = (value) => (value
  ? new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  : '—');
const formatDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU');
const formatDateTime = (value) => (value ? `${new Date(value).toLocaleDateString('ru-RU')} ${formatTime(value)}` : '—');

function RoleBadge({ role }) {
  return <span className={`badge badge--role badge--inline badge--${role}`}>{ROLE_LABELS[role] || role}</span>;
}

function ActivityPage() {
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [dateFrom, setDateFrom] = useState(daysAgo(6));
  const [dateTo, setDateTo] = useState(daysAgo(0));
  const [role, setRole] = useState('');
  const [groupId, setGroupId] = useState('');
  const [view, setView] = useState('totals'); // totals | days
  const [report, setReport] = useState({ days: [], totals: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // «Сейчас в системе» — обновляется сам, пока страница открыта
  useEffect(() => {
    const load = () => getOnlineUsers().then(setOnlineUsers).catch(() => {});
    load();
    const timer = setInterval(load, ONLINE_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    getMyGroups().then(gs => setGroups(gs.filter(g => g.status === 'active'))).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    setError('');
    const params = { date_from: dateFrom, date_to: dateTo };
    if (role) params.role = role;
    if (groupId) params.group_id = groupId;
    getPresenceReport(params)
      .then(setReport)
      .catch(err => setError(extractErrorMessage(err, 'Не удалось загрузить отчёт')))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, role, groupId]);

  const activePeriod = useMemo(
    () => (dateTo === daysAgo(0) ? PERIODS.find(p => p.from() === dateFrom)?.key : null),
    [dateFrom, dateTo],
  );
  const selectPeriod = (p) => { setDateFrom(p.from()); setDateTo(daysAgo(0)); };

  const rows = view === 'totals' ? report.totals : report.days;

  return (
    <div className="page">
      <div className="toolbar toolbar--start">
        <h1 className="page-title">{'Посещения'}</h1>
      </div>

      {/* Сейчас в системе: только кто онлайн — пульс за последние 2 мин и вкладку не закрыл.
          Кто был сегодня — в отчёте ниже, период «Сегодня» */}
      <section className="activity-online">
        <div className="activity-online__title">
          {'Сейчас в системе'}: <b>{onlineUsers.length}</b>
        </div>
        {onlineUsers.length === 0 ? (
          <div className="activity-online__empty">{'Сейчас никого нет'}</div>
        ) : (
          <div className="activity-online__list">
            {onlineUsers.map(u => (
              <span key={u.user_id} className="activity-online__user">
                <span className="activity-online__dot activity-online__dot--online" />
                {u.full_name} <RoleBadge role={u.role} />
                <span className="activity-online__since">{`с ${formatTime(u.since)}`}</span>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Фильтры отчёта */}
      <div className="toolbar toolbar--underline-row">
        <div className="toolbar__filters">
          {PERIODS.map(p => (
            <button
              key={p.key}
              type="button"
              className={`tab tab--underline${activePeriod === p.key ? ' tab--active' : ''}`}
              onClick={() => selectPeriod(p)}
            >
              {p.label}
            </button>
          ))}
          <input type="date" className="input" value={dateFrom} max={dateTo} onChange={e => e.target.value && setDateFrom(e.target.value)} />
          <span>{'—'}</span>
          <input type="date" className="input" value={dateTo} min={dateFrom} onChange={e => e.target.value && setDateTo(e.target.value)} />
        </div>
        <div className="toolbar__filters">
          <Dropdown value={role} onChange={setRole} placeholder={'Роль — все'} options={ROLE_OPTIONS} />
          <Dropdown
            value={groupId}
            onChange={setGroupId}
            placeholder={'Группа — все'}
            options={groups.map(g => ({ value: g.id, label: g.name }))}
          />
        </div>
      </div>

      <div className="toolbar__filters">
        <button type="button" className={`tab${view === 'totals' ? ' tab--active' : ''}`} onClick={() => setView('totals')}>
          {'Итого за период'}
        </button>
        <button type="button" className={`tab${view === 'days' ? ' tab--active' : ''}`} onClick={() => setView('days')}>
          {'По дням'}
        </button>
      </div>

      {error && <div className="error-text error-text--muted">{error}</div>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            {view === 'totals' ? (
              <tr>
                <th>{'Пользователь'}</th>
                <th>{'Роль'}</th>
                <th>{'Дней заходил'}</th>
                <th>{'Время в системе'}</th>
                <th>{'Последняя активность'}</th>
              </tr>
            ) : (
              <tr>
                <th>{'Дата'}</th>
                <th>{'Пользователь'}</th>
                <th>{'Роль'}</th>
                <th>{'Первый вход'}</th>
                <th>{'Последняя активность'}</th>
                <th>{'Время в системе'}</th>
              </tr>
            )}
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="table__empty">{'Загрузка...'}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="table__empty">{'Нет данных за период'}</td></tr>
            ) : view === 'totals' ? (
              report.totals.map(t => (
                <tr key={t.user_id} className={t.minutes === 0 ? 'activity-row--idle' : undefined}>
                  <td>{t.full_name}</td>
                  <td><RoleBadge role={t.role} /></td>
                  <td>{t.days}</td>
                  <td>{t.minutes ? formatDuration(t.minutes) : '—'}</td>
                  <td>{formatDateTime(t.last_seen)}</td>
                </tr>
              ))
            ) : (
              report.days.map(d => (
                <tr key={`${d.user_id}-${d.date}`}>
                  <td>{formatDate(d.date)}</td>
                  <td>{d.full_name}</td>
                  <td><RoleBadge role={d.role} /></td>
                  <td>{formatTime(d.first_seen)}</td>
                  <td>{formatTime(d.last_seen)}</td>
                  <td>{formatDuration(d.minutes)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default ActivityPage;
