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
  getGroupLessons, generateSchedule, deleteGroupLessons, getGroupRoomDays, setGroupRoomDay,
} from '../api/lessons';

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

    const payload = {
      group_id: gid,
      start_date: `${genStart.getFullYear()}-${String(genStart.getMonth() + 1).padStart(2, '0')}-${String(genStart.getDate()).padStart(2, '0')}`,
      start_time: `${String(genStart.getHours()).padStart(2, '0')}:${String(genStart.getMinutes()).padStart(2, '0')}`,
      weekdays: genWeekdays,
      lesson_count: parseInt(genLessonCount, 10),
      start_order: parseInt(genStartOrder, 10) || 1,
      duration_min: genDuration,
    };
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
            <label key={d.weekday} className="field-label">
              <span>
                {WEEKDAY_LABELS[d.weekday]}{` · ${d.times.join(', ')} · `}{'уроков'}{`: ${d.lesson_count}`}
                {!d.room_id && <span className="error-text">{d.mixed ? ' — аудитории разные' : ' — аудитория не выбрана'}</span>}
              </span>
              <select
                className="input"
                value={d.room_id || ''}
                disabled={roomDaysBusy}
                onChange={e => handleSetRoomDay(d.weekday, e.target.value)}
              >
                <option value="">{'— выберите аудиторию —'}</option>
                {d.rooms.map(r => (
                  <option key={r.id} value={r.id}>
                    {`${r.number} · мест ${r.capacity}`
                      + (r.capacity < roomDays.group_size ? ` (в группе ${roomDays.group_size})` : '')
                      + (r.busy_count > 0 ? ` · занята: ${r.busy_count} из ${d.lesson_count}` : ' · свободна')}
                  </option>
                ))}
              </select>
            </label>
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

export default GroupScheduleModal;
