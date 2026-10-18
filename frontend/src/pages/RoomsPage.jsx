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

const emptyRoom = { number: '', capacity: '' };

// Целое число больше нуля из поля ввода; иначе null
const toPositiveInt = (v) => {
  const n = Number(String(v).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── Печатная форма «Расписание занятий» ──
// Открывается кнопкой «Печать» на странице «Аудитории». Неделя листается
// стрелками; на листе — по таблице на каждый день, в который есть уроки
// (как бумажное расписание): группа и педагог, время, учеников, аудитория.
// Учеников больше, чем мест, — жёлтым (часть занимается удалённо);
// урок без аудитории — красным.

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
const DAY_NAMES = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

function RoomsPrint({ rooms, onBack }) {
  const [week, setWeek] = useState(() => mondayOf(new Date()));
  const [lessons, setLessons] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    getRoomsReport(week, addDays(week, 7))
      .then(data => setLessons(data.map(l => {
        const start = new Date(l.date);
        return { ...l, start, end: new Date(start.getTime() + l.duration_min * 60000) };
      })))
      .catch(err => setError(extractErrorMessage(err, 'Не удалось загрузить расписание')));
  }, [week]);

  const roomById = useMemo(() => {
    const m = {};
    rooms.forEach((r, i) => { m[r.id] = { ...r, color: i % ROOM_COLORS }; });
    return m;
  }, [rooms]);

  // Дни недели, в которые есть уроки
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

  return (
    <div className="page">
      <div className="toolbar toolbar--start rooms-print__controls">
        <button type="button" className="btn btn--secondary" onClick={onBack}>{'Назад'}</button>
        <button type="button" className="btn btn--secondary" onClick={() => setWeek(addDays(week, -7))}>{'‹'}</button>
        <span className="rooms-print__week">{`${dm(week)} – ${dm(addDays(week, 6))}`}</span>
        <button type="button" className="btn btn--secondary" onClick={() => setWeek(addDays(week, 7))}>{'›'}</button>
        <Button onClick={() => window.print()} disabled={days.length === 0}>{'Печать'}</Button>
      </div>
      {error && <div className="error-text error-text--muted">{error}</div>}

      <div className="rooms-print">
        <h1 className="rooms-print__title">{`Расписание занятий · ${dm(week)} – ${dm(addDays(week, 6))}`}</h1>
        {!error && days.length === 0 && <p className="text-muted">{'На этой неделе уроков нет'}</p>}
        {days.map(d => {
          const total = d.items.reduce((s, l) => s + l.people, 0);
          return (
            <div key={dayKey(d.date)} className="rooms-print__day">
              <h2 className="rooms-print__day-title">{`${DAY_NAMES[(d.date.getDay() + 6) % 7]}, ${dm(d.date)}`}</h2>
              <table className="rooms-print__table">
                <thead>
                  <tr>
                    <th>{'Группа'}</th>
                    <th>{'Время'}</th>
                    <th>{'Учеников'}</th>
                    <th>{'Аудитория'}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map(l => {
                    const r = roomById[l.room_id];
                    const over = r && l.people > r.capacity;
                    return (
                      <tr key={l.id} className={r ? undefined : 'rooms-print__row--none'}>
                        <td>
                          <b>{l.group_name}</b>
                          {l.teacher_name && <small>{l.teacher_name}</small>}
                        </td>
                        <td>{`${hm(l.start)}–${hm(l.end)}`}</td>
                        <td className={over ? 'rooms-print__over' : undefined}>
                          {r ? `${l.people} / ${r.capacity}` : l.people}
                        </td>
                        <td className={r ? `rooms-print__room room-color-${r.color}` : 'rooms-print__room rooms-print__room--none'}>
                          {r ? `А${r.number}` : 'не назначена'}
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
      </div>
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
