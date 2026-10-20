// «Аудитории» — справочник аудиторий академии: номер (только число, не
// повторяется) и количество мест для учеников. Пункт меню у админа и куратора
// (право rooms.edit). Клик по строке открывает календарь аудитории, «Печать» — печатное расписание недели.
import React, { useEffect, useMemo, useState } from 'react';
import Button from '../components/Button';
import Modal from '../components/Modal';
import IconButton from '../components/IconButton';
import DeleteButton from '../components/DeleteButton';
import Calendar from '../components/Calendar';
import { getRooms, createRoom, updateRoom, deleteRoom, getRoomLessons, getRoomsReport } from '../api/admin';
import { extractErrorMessage } from '../utils/errors';
import { useAcademyName } from '../utils/academyName';
import { useLang } from '../hooks/useLang';

const emptyRoom = { number: '', capacity: '' };

// Целое число больше нуля из поля ввода; иначе null
const toPositiveInt = (v) => {
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── Печатный отчёт «Расписание аудиторий» ──
// Открывается кнопкой «Печать» на странице «Аудитории». Период — неделя
// (стрелками) или произвольный (две даты); панель выбора не печатается.
// На листе: итог за период и по маленькому блоку на каждый день, в который
// есть уроки: по горизонтали часы, по вертикали аудитории, в уроке — группа и
// «учеников/мест». Учеников больше, чем мест, — жёлтым (часть удалённо);
// уроки без аудитории — отдельной красной строкой.

const ROOM_COLORS = 6; // классы room-color-0..5 в components.css

const mondayOf = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const pad = (n) => String(n).padStart(2, '0');
const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dm = (d) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = (v) => { const [y, m, d] = v.split('-').map(Number); return new Date(y, m - 1, d); };
const hoursOf = (d) => d.getHours() + d.getMinutes() / 60;
const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

// «По группам» — копия бумажного расписания: по таблице на день (Курс, Время,
// Кол-во человек, Кабинет), «Всего: N чел.» и примечание внизу. Группа считается
// новой, если её первый урок был не раньше чем за 30 дней до этого дня.
const NEW_GROUP_DAYS = 30;

function GroupsSheet({ days, roomById, longPeriod }) {
  const academyName = useAcademyName();
  const { lang } = useLang();
  const longDate = (d) => d.toLocaleDateString(lang || 'ru', { day: 'numeric', month: 'long' });
  const isNew = (l, day) => l.group_start && (day - new Date(l.group_start)) < NEW_GROUP_DAYS * 86400000;

  // Примечание: с какого числа занимаются новые группы и одинаковы ли кабинеты во все дни
  const newStarts = [...new Set(days.flatMap(d => d.items.filter(l => isNew(l, d.date))
    .map(l => longDate(new Date(l.group_start)))))];
  const roomsByGroup = {};
  days.forEach(d => d.items.forEach(l => {
    (roomsByGroup[l.group_name] = roomsByGroup[l.group_name] || new Set()).add(l.room_id || 0);
  }));
  const sameRooms = days.length > 1 && Object.values(roomsByGroup).every(set => set.size === 1);

  return (
    <div className="groups-print">
      <h1 className="groups-print__title">{academyName}{' — '}{'Расписание занятий'}</h1>
      {days.map(d => {
        const total = d.items.reduce((s, l) => s + l.people, 0);
        return (
          <div key={dayKey(d.date)} className="groups-print__day">
            <h2 className="groups-print__day-title">
              {DAY_NAMES[(d.date.getDay() + 6) % 7]}{longPeriod ? `, ${dm(d.date)}` : ''}
            </h2>
            <table className="groups-print__table">
              <thead>
                <tr>
                  <th>{'Курс'}</th>
                  <th>{'Время'}</th>
                  <th>{'Кол-во человек'}</th>
                  <th>{'Кабинет'}</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map(l => {
                  const r = roomById[l.room_id];
                  return (
                    <tr key={l.id}>
                      <td>
                        <b>{l.group_name}</b>
                        {isNew(l, d.date) && (
                          <small>{'новая группа · с '}{longDate(new Date(l.group_start))}</small>
                        )}
                      </td>
                      <td>{`${hm(l.start)}–${hm(l.end)}`}</td>
                      <td>{l.people}</td>
                      <td className={r ? `groups-print__room room-color-${r.color}` : 'groups-print__room groups-print__room--none'}>
                        {r ? `Кабинет ${r.number}` : 'не назначен'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>{`Всего: ${total} чел.`}</td></tr>
              </tfoot>
            </table>
          </div>
        );
      })}
      {(newStarts.length > 0 || sameRooms) && (
        <p className="groups-print__note">
          {newStarts.length > 0 && <>{'Новые группы занимаются с '}{newStarts.join(', ')}{'. '}</>}
          {sameRooms && (days.length === 2 ? 'Кабинеты одинаковы в оба дня.' : 'Кабинеты одинаковы во все дни.')}
        </p>
      )}
    </div>
  );
}

function RoomsPrint({ rooms, onBack }) {
  const [view, setView] = useState('groups');               // groups — «По группам» | rooms — «По залам»
  const [mode, setMode] = useState('week');                 // week | custom
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [customFrom, setCustomFrom] = useState(() => isoDay(mondayOf(new Date())));
  const [customTo, setCustomTo] = useState(() => isoDay(addDays(mondayOf(new Date()), 6)));
  const [lessons, setLessons] = useState([]);
  const [error, setError] = useState('');

  // Период: [from, to) — to не включительно
  const from = mode === 'week' ? week : fromIso(customFrom);
  const to = mode === 'week' ? addDays(week, 7) : addDays(fromIso(customTo), 1);
  const periodLabel = `${dm(from)} – ${dm(addDays(to, -1))}.${addDays(to, -1).getFullYear()}`;

  useEffect(() => {
    if (!(to > from)) { setLessons([]); return; }
    setError('');
    getRoomsReport(from, to)
      .then(data => setLessons(data.map(l => {
        const start = new Date(l.date);
        return { ...l, start, end: new Date(start.getTime() + l.duration_min * 60000) };
      })))
      .catch(err => setError(extractErrorMessage(err, 'Не удалось загрузить расписание')));
  }, [from.getTime(), to.getTime()]); // eslint-disable-line

  const roomById = useMemo(() => {
    const m = {};
    rooms.forEach((r, i) => { m[r.id] = { ...r, color: i % ROOM_COLORS }; });
    return m;
  }, [rooms]);

  // Дни, в которые есть уроки
  const days = useMemo(() => {
    const map = new Map();
    lessons.forEach(l => {
      const k = dayKey(l.start);
      if (!map.has(k)) map.set(k, { date: new Date(l.start.getFullYear(), l.start.getMonth(), l.start.getDate()), items: [] });
      map.get(k).items.push(l);
    });
    const roomNo = (l) => roomById[l.room_id]?.number ?? 1e9;
    return [...map.values()]
      .sort((a, b) => a.date - b.date)
      .map(d => ({ ...d, items: d.items.sort((a, b) => a.start - b.start || roomNo(a) - roomNo(b)) }));
  }, [lessons, roomById]);

  // Ось часов: 10–20, раздвигается под уроки периода
  const h0 = Math.min(10, ...lessons.map(l => Math.floor(hoursOf(l.start))));
  const h1 = Math.max(20, ...lessons.map(l => Math.ceil(hoursOf(l.end) || 24)));
  const hours = h1 - h0;

  const unassigned = lessons.filter(l => !roomById[l.room_id]).length;
  const people = lessons.reduce((s, l) => s + l.people, 0);
  const loadPct = (r) => (days.length ? Math.round(
    lessons.filter(l => l.room_id === r.id).reduce((s, l) => s + (l.end - l.start) / 3600000, 0) / (days.length * hours) * 100,
  ) : 0);

  const block = (l) => {
    const r = roomById[l.room_id];
    const over = r && l.people > r.capacity;
    const a = hoursOf(l.start) - h0;
    const len = (hoursOf(l.end) || 24) - hoursOf(l.start);
    return (
      <div key={l.id} className={`rooms-tl__event${r ? ` room-color-${r.color}` : ' rooms-tl__event--none'}`}
        style={{ '--a': a, '--l': len }}
        data-tip={`${l.group_name} · ${l.title} · ${hm(l.start)}–${hm(l.end)}${l.teacher_name ? ` · ${l.teacher_name}` : ''}`}>
        <b>{l.group_name}</b>{' '}
        <span className={over ? 'rooms-tl__seat--over' : 'rooms-tl__seat'}>{r ? `${l.people}/${r.capacity}` : l.people}</span>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="toolbar toolbar--start rooms-print__controls">
        <button type="button" className="btn btn--secondary" onClick={onBack}>{'Назад'}</button>
        <button type="button" className={`btn${view === 'groups' ? '' : ' btn--secondary'}`} onClick={() => setView('groups')}>{'По группам'}</button>
        <button type="button" className={`btn${view === 'rooms' ? '' : ' btn--secondary'}`} onClick={() => setView('rooms')}>{'По залам'}</button>
        <span className="rooms-print__sep" />
        <button type="button" className={`btn${mode === 'week' ? '' : ' btn--secondary'}`} onClick={() => setMode('week')}>{'Неделя'}</button>
        {mode === 'week' && (
          <>
            <button type="button" className="btn btn--secondary" onClick={() => setWeek(addDays(week, -7))}>{'‹'}</button>
            <span className="rooms-print__week">{`${dm(week)} – ${dm(addDays(week, 6))}`}</span>
            <button type="button" className="btn btn--secondary" onClick={() => setWeek(addDays(week, 7))}>{'›'}</button>
          </>
        )}
        <button type="button" className={`btn${mode === 'custom' ? '' : ' btn--secondary'}`} onClick={() => setMode('custom')}>{'Произвольный'}</button>
        {mode === 'custom' && (
          <>
            <input type="date" className="input" value={customFrom} onChange={e => e.target.value && setCustomFrom(e.target.value)} />
            <span>{'–'}</span>
            <input type="date" className="input" value={customTo} onChange={e => e.target.value && setCustomTo(e.target.value)} />
          </>
        )}
        <Button onClick={() => window.print()} disabled={days.length === 0}>{'Печать'}</Button>
      </div>
      {error && <div className="error-text error-text--muted">{error}</div>}

      {view === 'groups' && days.length > 0 && (
        <GroupsSheet days={days} roomById={roomById} longPeriod={(to - from) > 7 * 86400000} />
      )}
      {view === 'groups' && !error && days.length === 0 && <p className="text-muted">{'За этот период уроков нет'}</p>}

      {view === 'rooms' && <div className="rooms-print">
        <h1 className="rooms-print__title">{'Расписание аудиторий'}</h1>
        <div className="text-muted">{`${periodLabel} · дней с уроками: ${days.length}`}</div>
        {!error && days.length === 0 && <p className="text-muted">{'За этот период уроков нет'}</p>}

        {days.length > 0 && (
          <div className="rooms-print__sum">
            <div className="rooms-kpi"><b>{lessons.length}</b><span>{'уроков за период'}</span></div>
            <div className="rooms-kpi"><b>{people}</b><span>{'учеников на уроках'}</span></div>
            <div className={`rooms-kpi${unassigned ? ' rooms-kpi--bad' : ''}`}><b>{unassigned}</b><span>{'без аудитории'}</span></div>
            <div className="rooms-kpi">
              <span>{`Загрузка за период (дни с уроками, ${pad(h0)}:00–${pad(h1)}:00)`}</span>
              {rooms.map(r => (
                <div key={r.id} className="rooms-kpi__load">
                  {`А${r.number}`}
                  <div className="rooms-kpi__bar"><i className={`room-color-${roomById[r.id].color}`} style={{ '--pct': loadPct(r) }} /></div>
                  {`${loadPct(r)}%`}
                </div>
              ))}
            </div>
          </div>
        )}

        {days.map(d => {
          const none = d.items.filter(l => !roomById[l.room_id]);
          return (
            <div key={dayKey(d.date)} className="rooms-print__day">
              <h2 className="rooms-print__day-title">
                {DAY_NAMES[(d.date.getDay() + 6) % 7]}{`, ${dm(d.date)}`}
                <small>{` уроков: ${d.items.length} · учеников: ${d.items.reduce((s, l) => s + l.people, 0)}`}</small>
                {none.length > 0 && <span className="rooms-print__bad">{` без аудитории: ${none.length}`}</span>}
              </h2>
              <div className="rooms-tl" style={{ '--h': hours }}>
                <div className="rooms-tl__axis">
                  {Array.from({ length: hours }, (_, i) => <div key={i}>{`${pad(h0 + i)}:00`}</div>)}
                </div>
                {rooms.map(r => (
                  <React.Fragment key={r.id}>
                    <div className="rooms-tl__room">{`А${r.number}`}<small>{`${r.capacity} мест`}</small></div>
                    <div className="rooms-tl__lane">{d.items.filter(l => l.room_id === r.id).map(block)}</div>
                  </React.Fragment>
                ))}
                {none.length > 0 && (
                  <>
                    <div className="rooms-tl__room rooms-tl__room--none">{'Без ауд.'}</div>
                    <div className="rooms-tl__lane">{none.map(block)}</div>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {days.length > 0 && (
          <p className="text-muted">{'«9/14» — учеников / мест. Жёлтым — учеников больше, чем мест (часть занимается удалённо). Красная строка «Без ауд.» — уроки без аудитории.'}</p>
        )}
      </div>}
    </div>
  );
}

function RoomsPage() {
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newRoom, setNewRoom] = useState(emptyRoom);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(emptyRoom);
  const [openRoom, setOpenRoom] = useState(null);       // аудитория, чей календарь открыт
  const [roomLessons, setRoomLessons] = useState([]);
  const [printOpen, setPrintOpen] = useState(false);   // печатная форма расписания

  const openCalendar = (r) => {
    setOpenRoom(r);
    setRoomLessons([]);
    setError('');
    getRoomLessons(r.id)
      .then(setRoomLessons)
      .catch(err => setError(extractErrorMessage(err, 'Не удалось загрузить календарь аудитории')));
  };

  const load = () => getRooms()
    .then(setRooms)
    .catch(err => setError(extractErrorMessage(err, 'Не удалось загрузить аудитории')))
    .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const parse = (room) => {
    const number = toPositiveInt(room.number);
    const capacity = toPositiveInt(room.capacity);
    if (!number || !capacity) {
      setError('Номер аудитории и количество мест — целые числа больше нуля');
      return null;
    }
    return { number, capacity };
  };

  const addRoom = async () => {
    const data = parse(newRoom);
    if (!data) return;
    setBusy(true);
    setError('');
    try {
      await createRoom(data);
      setIsAddOpen(false);
      setNewRoom(emptyRoom);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось добавить аудиторию'));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r) => {
    setEditingId(r.id);
    setDraft({ number: String(r.number), capacity: String(r.capacity) });
    setError('');
  };

  const saveEdit = async () => {
    const data = parse(draft);
    if (!data) return;
    setBusy(true);
    setError('');
    try {
      await updateRoom(editingId, data);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось сохранить аудиторию'));
    } finally {
      setBusy(false);
    }
  };

  const numberInput = (value, onChange, placeholder) => (
    <input
      className="input"
      type="number"
      min="1"
      step="1"
      inputMode="numeric"
      size={6}
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  );

  if (printOpen) {
    return <RoomsPrint rooms={rooms} onBack={() => setPrintOpen(false)} />;
  }

  if (openRoom) {
    return (
      <div className="page">
        <div className="toolbar toolbar--start">
          <button type="button" className="btn btn--secondary" onClick={() => setOpenRoom(null)}>{'Назад'}</button>
          <h1 className="page-title">{`Аудитория ${openRoom.number}`}</h1>
          <span className="text-muted">{`Мест: ${openRoom.capacity}`}</span>
        </div>
        {error && <div className="error-text error-text--muted">{error}</div>}
        {/* В календаре аудитории: группа и сколько в ней учеников */}
        <Calendar
          lessons={roomLessons.map(l => ({ ...l, title: `${l.group_size} чел.` }))}
          onSelectLesson={() => {}}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="toolbar toolbar--start">
        <h1 className="page-title">{'Аудитории'}</h1>
        <Button onClick={() => { setNewRoom(emptyRoom); setIsAddOpen(true); setError(''); }}>
          {'+ Добавить аудиторию'}
        </Button>
        <button type="button" className="btn btn--secondary" onClick={() => setPrintOpen(true)} disabled={rooms.length === 0}>
          {'Печать'}
        </button>
      </div>

      {error && <div className="error-text error-text--muted">{error}</div>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{'Аудитория'}</th>
              <th data-tip={'Сколько учеников помещается в аудитории'}>{'Мест'}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="table__empty">{'Загрузка...'}</td></tr>
            ) : rooms.length === 0 ? (
              <tr><td colSpan={3} className="table__empty">{'Аудиторий пока нет'}</td></tr>
            ) : (
              rooms.map(r => (
                <tr
                  key={r.id}
                  className={editingId === r.id ? undefined : 'table__row--clickable'}
                  data-tip={editingId === r.id ? undefined : 'Открыть календарь аудитории'}
                  onClick={() => { if (editingId !== r.id && !busy) openCalendar(r); }}
                >
                  <td>
                    {editingId === r.id
                      ? numberInput(draft.number, v => setDraft({ ...draft, number: v }), 'Номер')
                      : r.number}
                  </td>
                  <td>
                    {editingId === r.id
                      ? numberInput(draft.capacity, v => setDraft({ ...draft, capacity: v }), 'Мест')
                      : r.capacity}
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {editingId === r.id ? (
                      <div className="button-row">
                        <button type="button" className="btn btn--sm" onClick={saveEdit} disabled={busy}>
                          {'Сохранить'}
                        </button>
                        <button type="button" className="btn btn--sm btn--secondary" onClick={() => setEditingId(null)} disabled={busy}>
                          {'Отмена'}
                        </button>
                      </div>
                    ) : (
                      <div className="button-row">
                        <IconButton icon="edit" tip={'Изменить аудиторию'} disabled={busy} onClick={() => startEdit(r)} />
                        <DeleteButton
                          entity="room"
                          id={r.id}
                          name={`Аудитория ${r.number}`}
                          tip={'Удалить аудиторию'}
                          onDelete={() => deleteRoom(r.id)}
                          onDeleted={load}
                          onError={setError}
                        />
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isAddOpen && (
        <Modal title={'Новая аудитория'} onClose={() => setIsAddOpen(false)} footer={(
          <>
            <button className="btn btn--secondary" onClick={() => setIsAddOpen(false)}>{'Отмена'}</button>
            <Button onClick={addRoom} disabled={busy || !newRoom.number || !newRoom.capacity}>{'Добавить'}</Button>
          </>
        )}>
          <div className="form-stack">
            <label className="field-label">
              {'Номер аудитории'}
              {numberInput(newRoom.number, v => setNewRoom({ ...newRoom, number: v }), '')}
            </label>
            <label className="field-label">
              {'Количество мест для учеников'}
              {numberInput(newRoom.capacity, v => setNewRoom({ ...newRoom, capacity: v }), '')}
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default RoomsPage;
