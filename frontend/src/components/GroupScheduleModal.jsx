// Расписание группы — право schedule.edit (админ). Одно окно для страницы
// группы и вкладки «Группы» в админке:
//   уроков нет        → генератор серии (дата и время, дни недели, сколько уроков,
//                       с какого номера начать, материалы);
//   уроки уже есть    → выбор: удалить и создать заново, аудитории по дням недели,
//                       дозаполнить материалами (если передан onFill).
//   <GroupScheduleModal group groups onFill? onClose(changed) />
// groups — группы для «Материалы из другой группы».
import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import DurationSelect from './DurationSelect';
import DateTimePicker, { nextHour } from './DateTimePicker';
import { DEFAULT_DURATION_MIN } from '../utils/lessonTime';
import { WEEKDAY_LABELS } from '../utils/weekdays';
import {
  getGroupLessons, generateSchedule, deleteGroupLessons, getGroupRoomDays, setGroupRoomDay, previewScheduleRooms,
  getGroupPlan, previewGroupPlan, applyGroupPlan,
} from '../api/lessons';
import { createGroup, updateGroup, assignGroupTeacher } from '../api/admin';
import { extractErrorMessage } from '../utils/errors';

// Выбор аудитории на день недели — кнопками: номер, мест, свободна / какой группой
// занята. Мест меньше, чем учеников, — жёлтым; занятую выбрать можно (бывают исключения).
function RoomChips({ day, groupSize, value, disabled, onPick }) {
  return (
    <div className="room-chips">
      {day.rooms.map(r => {
        const busy = r.busy_count > 0;
        return (
          <button
            key={r.id}
            type="button"
            disabled={disabled}
            className={`room-chip-btn${busy ? ' room-chip-btn--busy' : ''}${r.id === value ? ' room-chip-btn--on' : ''}`}
            onClick={() => onPick(r.id)}
          >
            <b>{`А${r.number}`}</b>
            <span className={r.capacity < groupSize ? 'room-chip-btn__over' : undefined}>{`${r.capacity} мест`}</span>
            <span className="room-chip-btn__state">
              {busy
                ? <>{'занята'}{`: ${r.busy_with.join(', ')}`}{r.busy_count < day.lesson_count ? ` (${r.busy_count}/${day.lesson_count})` : ''}</>
                : 'свободна'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function GroupScheduleModal({ group, groups = [], onFill, onClose }) {
  const gid = group.id;
  const [step, setStep] = useState('loading'); // loading | choice | generate | rooms
  const [error, setError] = useState('');
  const changed = useRef(false); // уроки менялись — странице нужно перечитать данные
  const close = () => onClose(changed.current);

  // Генератор серии
  const [genStart, setGenStart] = useState(nextHour);
  const [genWeekdays, setGenWeekdays] = useState([]); // 0..6
  const [genLessonCount, setGenLessonCount] = useState('');
  const [genStartOrder, setGenStartOrder] = useState('1'); // номер первого урока серии
  const [genDuration, setGenDuration] = useState(group.lesson_duration_min || DEFAULT_DURATION_MIN);
  const [genFillSource, setGenFillSource] = useState(''); // '' | template | group
  const [genFillGroupId, setGenFillGroupId] = useState('');
  // Серия попадает на выходные педагога: бэкенд предупредил (428), повторное
  // нажатие с теми же параметрами создаёт уроки (backend/app/days_off.py)
  const [genDaysOffWarned, setGenDaysOffWarned] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRecreating, setIsRecreating] = useState(false);
  // Аудитории новой серии: подсказка по выбранным дням и времени и выбор {день недели: id}
  const [genRoomDays, setGenRoomDays] = useState(null);
  const [genRooms, setGenRooms] = useState({});

  // «Аудитории по дням недели»: аудитория на каждый день недели — во все будущие уроки этого дня
  const [roomDays, setRoomDays] = useState({ group_size: 0, days: [] });
  const [roomDaysBusy, setRoomDaysBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getGroupLessons(gid)
      // Персональные уроки в расписание группы не входят
      .then(list => { if (alive) setStep(list.some(l => l.group_id === gid && !l.is_personal) ? 'choice' : 'generate'); })
      .catch(err => { if (alive) { setError(err?.response?.data?.detail || 'Не удалось загрузить уроки группы'); setStep('choice'); } });
    return () => { alive = false; };
  }, [gid]);

  // Подсказка аудиторий пересчитывается при смене даты, времени, дней, числа уроков и длительности
  const genStartKey = genStart ? genStart.getTime() : 0;
  useEffect(() => {
    if (step !== 'generate' || !genStart || genWeekdays.length === 0 || !(parseInt(genLessonCount, 10) > 0)) {
      setGenRoomDays(null);
      return undefined;
    }
    let alive = true;
    const timer = setTimeout(() => {
      previewScheduleRooms(basePayload())
        .then(data => { if (alive) setGenRoomDays(data); })
        .catch(() => { if (alive) setGenRoomDays(null); });
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [step, genStartKey, genWeekdays.join(','), genLessonCount, genDuration]); // eslint-disable-line

  const toggleGenWeekday = (day) => {
    setGenWeekdays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const handleRecreate = async () => {
    setIsRecreating(true);
    setError('');
    try {
      await deleteGroupLessons(gid);
      changed.current = true;
      setStep('generate');
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось удалить уроки группы');
    } finally {
      setIsRecreating(false);
    }
  };

  const loadRoomDays = () => getGroupRoomDays(gid)
    .then(setRoomDays)
    .catch(err => setError(err?.response?.data?.detail || 'Не удалось загрузить аудитории'));

  const handleChooseRooms = () => {
    setError('');
    setStep('rooms');
    loadRoomDays();
  };

  const handleSetRoomDay = async (weekday, roomId) => {
    if (!roomId) return;
    setRoomDaysBusy(true);
    setError('');
    try {
      await setGroupRoomDay(gid, weekday, Number(roomId));
      changed.current = true;
      await loadRoomDays();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось сохранить аудиторию');
    } finally {
      setRoomDaysBusy(false);
    }
  };

  const basePayload = () => ({
    group_id: gid,
    start_date: `${genStart.getFullYear()}-${String(genStart.getMonth() + 1).padStart(2, '0')}-${String(genStart.getDate()).padStart(2, '0')}`,
    start_time: `${String(genStart.getHours()).padStart(2, '0')}:${String(genStart.getMinutes()).padStart(2, '0')}`,
    weekdays: genWeekdays,
    lesson_count: parseInt(genLessonCount, 10),
    duration_min: genDuration,
  });

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!genStart || genWeekdays.length === 0 || !genLessonCount) {
      setError('Заполните дату начала, время, дни недели и количество уроков');
      return;
    }
    if (genFillSource === 'group' && !genFillGroupId) {
      setError('Выберите группу-источник материалов');
      return;
    }

    const rooms = Object.fromEntries(Object.entries(genRooms).filter(([wd]) => genWeekdays.includes(Number(wd))));
    const payload = { ...basePayload(), start_order: parseInt(genStartOrder, 10) || 1, rooms };
    if (genFillSource) {
      payload.fill_source = genFillSource;
      if (genFillSource === 'group') payload.fill_group_id = parseInt(genFillGroupId, 10);
    }
    const payloadKey = JSON.stringify(payload);

    setIsGenerating(true);
    setError('');
    try {
      await generateSchedule({ ...payload, confirm_days_off: genDaysOffWarned === payloadKey });
      changed.current = true;
      close();
    } catch (err) {
      if (err?.response?.status === 428) setGenDaysOffWarned(payloadKey);
      setError(err?.response?.data?.detail || 'Не удалось сгенерировать расписание');
      setIsGenerating(false);
    }
  };

  const errorText = error && <div className="form-field__error">{error}</div>;

  if (step === 'loading') {
    return (
      <Modal title={'Расписание группы'} onClose={close}>
        <div className="text-muted">{'Загрузка...'}</div>
      </Modal>
    );
  }

  if (step === 'choice') {
    return (
      <Modal
        title={'В группе уже есть уроки'}
        onClose={close}
        footer={(
          <button type="button" className="btn btn--secondary" onClick={close}>{'Отмена'}</button>
        )}
      >
        <div className="form-stack">
          <p>{'Что сделать с уже существующим расписанием этой группы?'}</p>
          <button type="button" className="btn" onClick={handleRecreate} disabled={isRecreating}>
            {isRecreating ? 'Удаление...' : 'Удалить и создать заново'}
          </button>
          {onFill && (
            <button type="button" className="btn btn--outline" onClick={onFill}>
              {'Оставить даты — дозаполнить материалами'}
            </button>
          )}
          <button type="button" className="btn btn--outline" onClick={handleChooseRooms}>
            {'Аудитории по дням недели'}
          </button>
          {errorText}
        </div>
      </Modal>
    );
  }

  if (step === 'rooms') {
    return (
      <Modal
        title={'Аудитории по дням недели'}
        onClose={close}
        footer={(
          <button type="button" className="btn btn--secondary" onClick={close}>{'Закрыть'}</button>
        )}
      >
        <div className="form-stack">
          <p className="text-muted">{'Аудитория записывается во все будущие уроки группы в этот день недели. Прошедшие уроки не меняются.'}</p>
          {errorText}
          {roomDays.days.length === 0 && !error && (
            <p className="text-muted">{'У группы нет будущих уроков.'}</p>
          )}
          {roomDays.days.map(d => (
            <div key={d.weekday} className="field-label">
              <span>
                {WEEKDAY_LABELS[d.weekday]}{` · ${d.times.join(', ')} · `}{'уроков'}{`: ${d.lesson_count}`}
                {!d.room_id && <span className="error-text">{d.mixed ? ' — аудитории разные' : ' — аудитория не выбрана'}</span>}
              </span>
              <RoomChips day={d} groupSize={roomDays.group_size} value={d.room_id}
                disabled={roomDaysBusy} onPick={id => handleSetRoomDay(d.weekday, id)} />
            </div>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={'Заполнить расписание'}
      onClose={close}
      footer={(
        <>
          <button type="button" className="btn btn--secondary" onClick={close}>{'Отмена'}</button>
          <button type="submit" form="generate-schedule-form" className="btn" disabled={isGenerating}>
            {isGenerating ? 'Создание...' : 'Создать уроки'}
          </button>
        </>
      )}
    >
      <form id="generate-schedule-form" onSubmit={handleGenerate} className="form-stack">
        <div className="field-label">
          {'Дата первого урока и время (одно на все уроки)'}
          <div>
            <DateTimePicker value={genStart} onChange={setGenStart} floating />
          </div>
        </div>
        <label className="field-label">
          {'Длительность (одна на все уроки)'}
          <DurationSelect value={genDuration} onChange={setGenDuration} />
        </label>
        <div className="field-label">
          {'Дни недели'}
          <div className="button-row">
            {WEEKDAY_LABELS.map((label, day) => (
              <button
                type="button"
                key={day}
                className={`tab${genWeekdays.includes(day) ? ' tab--active' : ''}`}
                onClick={() => toggleGenWeekday(day)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="field-label">
          {'Количество уроков'}
          <input
            type="number"
            min="1"
            max="200"
            className="input input--sm-num"
            value={genLessonCount}
            onChange={e => setGenLessonCount(e.target.value)}
            required
          />
        </label>
        {genRoomDays && genRoomDays.days.length > 0 && (
          <div className="field-label">
            {'Аудитории'}
            <span className="text-muted">{'Свободные в это время — белые, занятые — серые. Выбор — для всех уроков этого дня недели.'}</span>
            {genRoomDays.days.map(d => (
              <div key={d.weekday} className="room-day">
                <span>
                  <b>{WEEKDAY_LABELS[d.weekday]}</b>{` · ${d.times.join(', ')} · `}{'уроков'}{`: ${d.lesson_count}`}
                  {!genRooms[d.weekday] && <span className="error-text">{' — аудитория не выбрана'}</span>}
                </span>
                <RoomChips day={d} groupSize={genRoomDays.group_size} value={genRooms[d.weekday]}
                  onPick={id => setGenRooms(prev => ({ ...prev, [d.weekday]: id }))} />
              </div>
            ))}
          </div>
        )}
        <label className="field-label">
          {'Начать с урока №'}
          <input
            type="number"
            min="1"
            max="500"
            className="input input--sm-num"
            value={genStartOrder}
            onChange={e => setGenStartOrder(e.target.value)}
            required
          />
        </label>
        <label className="field-label">
          {'Материалы'}
          <select className="input" value={genFillSource} onChange={e => setGenFillSource(e.target.value)}>
            <option value="">{'Не заполнять сейчас'}</option>
            <option value="template">{'Из шаблона курса группы'}</option>
            <option value="group">{'Из другой группы'}</option>
          </select>
        </label>
        {genFillSource === 'group' && (
          <label className="field-label">
            {'Группа-источник'}
            <select className="input" value={genFillGroupId} onChange={e => setGenFillGroupId(e.target.value)}>
              <option value="">{'— Группа —'}</option>
              {groups.filter(g => g.id !== gid).map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </label>
        )}
        {errorText}
      </form>
    </Modal>
  );
}

// ═════════════════════════════════════════════════════════════════════
// «Настройка группы» у админа — одно окно и для новой группы, и для
// существующей (клик по строке в таблице «Группы»). Разделы сверху вниз:
// Группа → Связь → Расписание. Расписание — неделя: любые дни (1–7), у каждого
// дня своё время и аудитория (выбор из списка: свободна / чьими уроками занята);
// «+ Вторая неделя» — если по чередованию недель меняются время или аудитория.
// Группа с уроками: прошедшие не меняются, будущие перестраиваются с
// ближайшего урока (backend: PUT /lessons/group/{id}/plan).
// Педагог: пока у группы не было уроков — просто выбор; после — «Сменить»
// (с сегодняшнего дня) или «Добавить временного» на период «с … по» включительно.
//   <GroupAdminModal group? groups courses sectors teachers onClose(changed) />
// ═════════════════════════════════════════════════════════════════════

const pad2 = (n) => String(n).padStart(2, '0');
// Время урока — шагом 10 минут (правило платформы для всех окон уроков)
const TIME_OPTIONS = Array.from({ length: (23 - 7) * 6 }, (_, i) => `${pad2(7 + Math.floor(i / 6))}:${pad2((i % 6) * 10)}`);
const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ruDate = (iso) => (iso ? iso.split('-').reverse().join('.') : '');
const emptyWeek = () => Array.from({ length: 7 }, () => ({ on: false, start: '10:00', end: '12:00', room_id: '' }));
const weekFromSlots = (slots) => {
  const w = emptyWeek();
  slots.forEach(s => { w[s.weekday] = { on: true, start: s.start, end: s.end, room_id: s.room_id ? String(s.room_id) : '' }; });
  return w;
};
const slotsOfWeek = (w) => w.map((d, weekday) => (d.on
  ? { weekday, start: d.start, end: d.end, room_id: d.room_id ? Number(d.room_id) : null }
  : null)).filter(Boolean);
const minutesOf = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

function TimeSelect({ value, onChange }) {
  return (
    <select className="input week-plan__select-time" value={value} onChange={e => onChange(e.target.value)}>
      {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

function WeekPlan({ weeks, setWeeks, rooms, groupSize, firstWeekHint }) {
  const update = (wi, day, patch) => setWeeks(prev => prev.map((w, i) => (i !== wi ? w
    : w.map((d, j) => (j === day ? { ...d, ...patch } : d)))));
  return (
    <>
      {weeks.map((w, wi) => (
        <div key={wi} className="week-plan">
          <div className="week-plan__head">
            <b>{weeks.length > 1 ? `Неделя ${wi + 1}` : 'Неделя'}</b>
            <span className="text-muted">{`дней: ${w.filter(d => d.on).length}`}</span>
            {wi === 1 && (
              <button type="button" className="link week-plan__remove" onClick={() => setWeeks(prev => prev.slice(0, 1))}>
                {'убрать вторую неделю'}
              </button>
            )}
          </div>
          {w.map((d, day) => {
            const info = rooms[`${wi}-${day}`];
            return (
              <div key={day} className={`week-plan__day${d.on ? '' : ' week-plan__day--off'}`}>
                <label className="week-plan__name">
                  <input type="checkbox" checked={d.on} onChange={e => update(wi, day, { on: e.target.checked })} />
                  {WEEKDAY_LABELS[day]}
                </label>
                {d.on ? (
                  <>
                    <span className="week-plan__time">
                      <TimeSelect value={d.start} onChange={v => update(wi, day, { start: v })} />
                      {'–'}
                      <TimeSelect value={d.end} onChange={v => update(wi, day, { end: v })} />
                    </span>
                    <span className="week-plan__room">
                      <select className={`input${d.room_id ? '' : ' week-plan__room-empty'}`} value={d.room_id}
                        data-tip={d.room_id ? undefined : 'Аудитория не выбрана'}
                        onChange={e => update(wi, day, { room_id: e.target.value })}>
                        <option value="">{'— аудитория —'}</option>
                        {(info?.rooms || []).map(r => (
                          <option key={r.id} value={r.id}>
                            {r.busy_count > 0
                              ? `А${r.number} · ${r.capacity} мест · занята: ${r.busy_with.join(', ')}`
                              : `А${r.number} · ${r.capacity} мест · свободна`}
                          </option>
                        ))}
                      </select>
                      {d.room_id && (info?.rooms || []).some(r => String(r.id) === d.room_id && r.capacity < groupSize) && (
                        <span className="week-plan__over">{`мест меньше, чем учеников (${groupSize})`}</span>
                      )}
                    </span>
                  </>
                ) : <span className="text-muted">{'нет занятий'}</span>}
              </div>
            );
          })}
          {wi === 1 && (
            <div className="week-plan__note">{'Недели чередуются: 1-я, 2-я, 1-я, 2-я…'}{' '}{firstWeekHint}</div>
          )}
        </div>
      ))}
      {weeks.length === 1 && (
        <button type="button" className="btn btn--secondary" onClick={() => setWeeks(prev => [prev[0], prev[0].map(d => ({ ...d }))])}>
          {'+ Вторая неделя (чередование)'}
        </button>
      )}
    </>
  );
}

export function GroupAdminModal({ group, groups = [], courses = [], sectors = [], teachers = [], onClose }) {
  const [gid, setGid] = useState(group?.id || null);   // у новой группы — после первого сохранения
  const isNew = !group;
  const changed = useRef(false);
  const close = () => onClose(changed.current);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!isNew);

  const [form, setForm] = useState({
    name: group?.name || '',
    course_id: group?.course_id ? String(group.course_id) : '',
    sector: group?.sector || '',
    teacher_id: group?.teacher_id ? String(group.teacher_id) : '',
    telegram_chat_id: group?.telegram_chat_id || '',
    whatsapp: group?.whatsapp || '',
    video_url: group?.video_url || '',
  });
  const setField = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  // Педагог: после прошедших уроков — «сменить» или «временный» на период
  const [groupLessons, setGroupLessons] = useState([]);
  const hasPast = groupLessons.some(l => !l.is_personal && l.date && new Date(l.date) < new Date());
  const [teacherMode, setTeacherMode] = useState(null);   // null | ask | change | temp
  const [temp, setTemp] = useState({ teacher_id: '', from: isoDate(new Date()), to: isoDate(new Date()) });

  // Расписание
  const [plan, setPlan] = useState({ exists: false });
  const [startDate, setStartDate] = useState(isoDate(new Date()));
  const [lessonCount, setLessonCount] = useState('');
  const [startOrder, setStartOrder] = useState('1');
  const [weeks, setWeeksRaw] = useState([emptyWeek()]);
  const [planDirty, setPlanDirty] = useState(false);
  const setWeeks = (fn) => { setPlanDirty(true); setWeeksRaw(fn); };
  const [fillSource, setFillSource] = useState('');
  const [fillGroupId, setFillGroupId] = useState('');
  const [roomInfo, setRoomInfo] = useState({ group_size: 0, slots: [] });

  useEffect(() => {
    if (isNew) return undefined;
    let alive = true;
    Promise.all([getGroupPlan(group.id), getGroupLessons(group.id)])
      .then(([p, list]) => {
        if (!alive) return;
        setPlan(p);
        setGroupLessons(list);
        if (p.exists) {
          setLessonCount(String(p.lesson_count));
          setStartOrder(String(p.start_order));
          if (p.first_date) setStartDate(p.first_date);
          if (p.weeks.length) setWeeksRaw(p.weeks.map(weekFromSlots));
        }
      })
      .catch(err => { if (alive) setError(extractErrorMessage(err, 'Не удалось загрузить расписание группы')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []); // eslint-disable-line

  const planPayload = () => ({
    group_id: gid,
    start_date: startDate || null,
    lesson_count: parseInt(lessonCount, 10) || 0,
    start_order: parseInt(startOrder, 10) || 1,
    weeks: weeks.map(slotsOfWeek),
  });
  const hasDays = weeks.some(w => w.some(d => d.on));

  // Подсказка аудиторий — при каждом изменении плана
  const planKey = JSON.stringify([startDate, lessonCount, weeks.map(slotsOfWeek).map(w => w.map(x => [x.weekday, x.start, x.end]))]);
  useEffect(() => {
    if (loading || !hasDays || !(parseInt(lessonCount, 10) > 0)) { setRoomInfo({ group_size: 0, slots: [] }); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      previewGroupPlan(planPayload())
        .then(data => { if (alive) setRoomInfo(data); })
        .catch(() => {});
    }, 300);
    return () => { alive = false; clearTimeout(timer); };
  }, [planKey, loading, gid]); // eslint-disable-line
  const rooms = Object.fromEntries(roomInfo.slots.map(sl => [`${sl.week}-${sl.weekday}`, sl]));

  const teacherName = (id) => {
    const t = teachers.find(u => String(u.id) === String(id));
    return t ? (t.full_name || t.username) : '—';
  };

  const validate = () => {
    if (!form.name.trim() || !form.course_id || !form.sector || !form.teacher_id) return 'Заполните название, курс, сектор и педагога';
    if (form.video_url.trim() && !/^https:\/\//i.test(form.video_url.trim())) return 'Ссылка на видеоконференцию должна начинаться с https://';
    for (const w of weeks) {
      for (const d of w) {
        if (d.on && minutesOf(d.end) - minutesOf(d.start) < 30) return 'Время окончания урока должно быть позже начала (от 30 минут)';
      }
    }
    if (hasDays && !(parseInt(lessonCount, 10) > 0)) return 'Укажите, сколько уроков';
    if (hasDays && !plan.exists && !startDate) return 'Укажите дату первого урока';
    if (plan.exists && (parseInt(lessonCount, 10) || 0) < plan.past_count) return `Уроков не может быть меньше, чем уже прошло: ${plan.past_count}`;
    if (teacherMode === 'temp' && (!temp.teacher_id || !temp.from || !temp.to || temp.to < temp.from)) return 'Укажите временного педагога и период';
    if (fillSource === 'group' && !fillGroupId) return 'Выберите группу-источник материалов';
    return '';
  };

  const save = async () => {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSaving(true);
    setError('');
    try {
      const firstSlot = weeks.flatMap(slotsOfWeek)[0];
      const base = {
        name: form.name.trim(),
        course_id: parseInt(form.course_id, 10),
        teacher_id: parseInt(form.teacher_id, 10),
        telegram_chat_id: form.telegram_chat_id.trim(),
        whatsapp: form.whatsapp.trim(),
        video_url: form.video_url.trim() || null,
        sector: form.sector,
      };
      let id = gid;
      if (!id) {
        const created = await createGroup({
          ...base,
          lesson_duration_min: firstSlot ? minutesOf(firstSlot.end) - minutesOf(firstSlot.start) : 120,
        });
        id = created.id;
        setGid(id);
      } else {
        await updateGroup(id, base);
      }
      changed.current = true;

      if (hasDays && (planDirty || !plan.exists || String(plan.lesson_count) !== lessonCount)) {
        const payload = { ...planPayload(), group_id: id };
        if (!plan.exists && fillSource) {
          payload.fill_source = fillSource;
          if (fillSource === 'group') payload.fill_group_id = parseInt(fillGroupId, 10);
        }
        await applyGroupPlan(id, payload);
      }

      if (teacherMode === 'temp') {
        const list = await getGroupLessons(id);
        const inRange = list
          .filter(l => l.date && isoDate(new Date(l.date)) >= temp.from && isoDate(new Date(l.date)) <= temp.to)
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        if (!inRange.length) throw new Error('В этот период у группы нет уроков');
        await assignGroupTeacher(id, {
          teacher_id: parseInt(temp.teacher_id, 10),
          from_lesson_id: inRange[0].id,
          to_lesson_id: inRange[inRange.length - 1].id,
        });
      }
      close();
    } catch (err) {
      setError(err?.message && !err.response ? err.message : extractErrorMessage(err, 'Не удалось сохранить группу'));
    } finally {
      setSaving(false);
    }
  };

  const teacherSelect = (value, onChange) => (
    <select className="input" value={value} onChange={onChange}>
      <option value="">{'— Педагог —'}</option>
      {teachers.map(t => <option key={t.id} value={t.id}>{t.full_name || t.username}</option>)}
    </select>
  );

  let teacherField;
  if (!hasPast || teacherMode === 'change') {
    teacherField = teacherSelect(form.teacher_id, setField('teacher_id'));
  } else if (teacherMode === 'ask') {
    teacherField = (
      <div className="button-row">
        <button type="button" className="btn btn--secondary" onClick={() => setTeacherMode('change')}>{'Сменить педагога'}</button>
        <button type="button" className="btn btn--secondary" onClick={() => setTeacherMode('temp')}>{'Добавить временного'}</button>
        <button type="button" className="link" onClick={() => setTeacherMode(null)}>{'Отмена'}</button>
      </div>
    );
  } else {
    teacherField = (
      <button type="button" className="input group-form__teacher" onClick={() => setTeacherMode(teacherMode === 'temp' ? 'temp' : 'ask')}
        data-tip={'Уроки уже были: можно сменить педагога или добавить временного'}>
        {teacherName(form.teacher_id)}
      </button>
    );
  }

  return (
    <Modal
      title={isNew && !gid ? 'Новая группа' : 'Настройка группы'}
      size="wide"
      onClose={close}
      footer={(
        <>
          <button type="button" className="btn btn--secondary" onClick={close}>{'Отмена'}</button>
          <button type="button" className="btn" onClick={save} disabled={saving || loading}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </>
      )}
    >
      {loading ? <div className="text-muted">{'Загрузка...'}</div> : (
        <div className="group-form">
          <div className="group-form__section">{'Группа'}</div>
          <div className="group-form__grid">
            <label className="field-label">{'Название *'}
              <input className="input" autoComplete="off" value={form.name} onChange={setField('name')} />
            </label>
            <div className="field-label">{'Педагог *'}{teacherField}</div>
            <label className="field-label">
              <span>{'Курс *'}{!isNew && <span className="text-muted">{' · после создания не меняется'}</span>}</span>
              <select className="input" value={form.course_id} onChange={setField('course_id')} disabled={!isNew}>
                <option value="">{'— Курс —'}</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </label>
            <label className="field-label">
              <span>{'Сектор *'}{!isNew && <span className="text-muted">{' · после создания не меняется'}</span>}</span>
              <select className="input" value={form.sector} onChange={setField('sector')} disabled={!isNew}>
                <option value="">{'— Сектор —'}</option>
                {sectors.map(sc => <option key={sc.code} value={sc.code}>{sc.name}</option>)}
              </select>
            </label>
          </div>
          {teacherMode === 'temp' && (
            <div className="group-form__temp">
              <span>{'Временный педагог'}</span>
              {teacherSelect(temp.teacher_id, e => setTemp(t => ({ ...t, teacher_id: e.target.value })))}
              <span>{'с'}</span>
              <input type="date" className="input" value={temp.from} onChange={e => setTemp(t => ({ ...t, from: e.target.value }))} />
              <span>{'по'}</span>
              <input type="date" className="input" value={temp.to} onChange={e => setTemp(t => ({ ...t, to: e.target.value }))} />
              <span className="text-muted">{'включительно'}</span>
              <button type="button" className="link" onClick={() => setTeacherMode(null)}>{'убрать'}</button>
            </div>
          )}

          <div className="group-form__section">{'Связь'}</div>
          <div className="group-form__grid">
            <label className="field-label">{'Telegram'}
              <input className="input" autoComplete="off" placeholder={'юзернейм или ссылка-приглашение'} value={form.telegram_chat_id} onChange={setField('telegram_chat_id')} />
            </label>
            <label className="field-label">{'WhatsApp'}
              <input className="input" autoComplete="off" value={form.whatsapp} onChange={setField('whatsapp')} />
            </label>
            <label className="field-label group-form__wide">{'Видеоконференция'}
              <input className="input" autoComplete="off" placeholder="https://meet.google.com/…" value={form.video_url} onChange={setField('video_url')} />
            </label>
          </div>

          <div className="group-form__section">{'Расписание'}</div>
          {plan.exists && (
            <p className="text-muted">
              {`Прошло уроков: ${plan.past_count}. Изменения применяются к будущим урокам — с ближайшего${plan.next_date ? ` (${ruDate(plan.next_date)})` : ''}.`}
            </p>
          )}
          <div className="group-form__grid group-form__grid--3">
            <label className="field-label">{'Дата первого урока'}
              <input type="date" className="input" value={startDate} disabled={plan.exists}
                onChange={e => { setPlanDirty(true); setStartDate(e.target.value); }} />
            </label>
            <label className="field-label">{'Уроков'}
              <input type="number" min={plan.exists ? plan.past_count : 1} max="500" className="input" value={lessonCount}
                onChange={e => { setPlanDirty(true); setLessonCount(e.target.value); }} />
            </label>
            <label className="field-label">{'Начать с урока №'}
              <input type="number" min="1" max="500" className="input" value={startOrder} disabled={plan.exists}
                onChange={e => setStartOrder(e.target.value)} />
            </label>
          </div>
          <WeekPlan
            weeks={weeks}
            setWeeks={setWeeks}
            rooms={rooms}
            groupSize={roomInfo.group_size}
            firstWeekHint={plan.exists ? 'Первая — неделя ближайшего урока.' : 'Первая — неделя первого урока.'}
          />
          {!plan.exists && (
            <div className="group-form__grid">
              <label className="field-label">{'Материалы'}
                <select className="input" value={fillSource} onChange={e => setFillSource(e.target.value)}>
                  <option value="">{'Не заполнять сейчас'}</option>
                  <option value="template">{'Из шаблона курса группы'}</option>
                  <option value="group">{'Из другой группы'}</option>
                </select>
              </label>
              {fillSource === 'group' && (
                <label className="field-label">{'Группа-источник'}
                  <select className="input" value={fillGroupId} onChange={e => setFillGroupId(e.target.value)}>
                    <option value="">{'— Группа —'}</option>
                    {groups.filter(g => g.id !== gid).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
          {error && <div className="form-field__error">{error}</div>}
        </div>
      )}
    </Modal>
  );
}

export default GroupScheduleModal;
