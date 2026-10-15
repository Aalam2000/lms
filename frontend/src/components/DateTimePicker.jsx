import React, { useEffect, useRef, useState } from 'react';
import DurationSelect from './DurationSelect';
import MonthGrid, { sameDay } from './MonthGrid';

const MINUTE_STEPS = [0, 10, 20, 30, 40, 50];

const pad = (n) => String(n).padStart(2, '0');

function formatDisplay(date) {
  if (!date) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Ближайшая допустимая «десятиминутка» не больше фактических минут.
function roundMinutesDown(minutes) {
  return MINUTE_STEPS.reduce((best, m) => (m <= minutes ? m : best), 0);
}

/**
 * Клик-поле с датой/временем: открывает попап-календарь (дни месяца +
 * часы/минуты с шагом 10). Сохранение — на вызывающей стороне, через
 * onCommit, срабатывающий при закрытии попапа (клик мимо).
 *
 * value: Date | null
 * onChange(date: Date): вызывается на каждое изменение (день/час/минута)
 * onCommit(): вызывается при закрытии попапа (клик вне поля)
 */
// hourOnly — выбор только часа (минуты всегда :00), напр. дедлайн ДЗ;
// placeholder — текст кнопки, пока значение не выбрано;
// floating — попап position:fixed (внутри таблицы со скроллом, чтобы не обрезался);
// iconOnly — вместо поля с датой маленькая кнопка 📅 с подсказкой tip;
// duration + onDurationChange — длительность урока (мин) рядом со временем
// начала, в той же строке попапа; сохраняется вместе с датой через onCommit.
function DateTimePicker({ value, onChange, onCommit, disabled, hourOnly, placeholder, floating, iconOnly, tip, duration, onDurationChange }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => value || new Date());
  const containerRef = useRef(null);
  // Всегда свежий onCommit: обработчик «клик мимо» вешается при открытии
  // попапа, и без ref он вызывал onCommit со старым значением даты —
  // вызывающий видел «ничего не изменилось» и не сохранял.
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    if (value) setViewDate(value);
  }, [value]);

  useEffect(() => {
    if (!open) return undefined;
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        if (commitRef.current) commitRef.current();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
    // eslint-disable-next-line
  }, [open]);

  const closeAndCommit = () => {
    setOpen(false);
    if (commitRef.current) commitRef.current();
  };

  const handleTriggerClick = () => {
    if (disabled) return;
    if (open) {
      closeAndCommit();
      return;
    }
    if (!value) {
      // Новый урок / пустое значение — по умолчанию минуты всегда 00.
      const now = new Date();
      now.setMinutes(0, 0, 0);
      setViewDate(now);
      onChange(now);
    }
    setOpen(true);
  };

  const selectDay = (day) => {
    const base = value || viewDate;
    const next = new Date(day);
    next.setHours(base.getHours(), hourOnly ? 0 : base.getMinutes(), 0, 0);
    onChange(next);
  };

  const changeHour = (h) => {
    const base = value || viewDate;
    const next = new Date(base);
    next.setHours(Number(h));
    if (hourOnly) next.setMinutes(0, 0, 0);
    onChange(next);
  };

  const changeMinute = (m) => {
    const base = value || viewDate;
    const next = new Date(base);
    next.setMinutes(Number(m));
    onChange(next);
  };

  const navMonth = (delta) => {
    setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  return (
    <div className="datetime-picker" ref={containerRef}>
      {iconOnly ? (
        <button
          type="button"
          className="datetime-picker__trigger datetime-picker__trigger--icon"
          onClick={handleTriggerClick}
          disabled={disabled}
          data-tip={tip}
        >
          <span className="datetime-picker__icon">📅</span>
        </button>
      ) : (
        <button
          type="button"
          className="datetime-picker__trigger"
          onClick={handleTriggerClick}
          disabled={disabled}
          data-tip={tip}
        >
          <span>{formatDisplay(value) || placeholder || 'Выбрать дату и время'}</span>
          <span className="datetime-picker__icon">📅</span>
        </button>
      )}

      {open && (
        <div className="datetime-picker__popover" style={floating ? floatingStyle(containerRef.current) : undefined}>
          <MonthGrid
            viewDate={viewDate}
            onNav={navMonth}
            onSelectDay={selectDay}
            dayClass={(day) => (sameDay(day, value) ? ['month-grid__day--selected'] : [])}
          />

          <div className="datetime-picker__time">
            <select
              className="input"
              value={value ? value.getHours() : 0}
              onChange={e => changeHour(e.target.value)}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{pad(h)}</option>
              ))}
            </select>
            <span>{':'}</span>
            {hourOnly ? <span>{'00'}</span> : (
              <select
                className="input"
                value={value ? roundMinutesDown(value.getMinutes()) : 0}
                onChange={e => changeMinute(e.target.value)}
              >
                {MINUTE_STEPS.map(m => (
                  <option key={m} value={m}>{pad(m)}</option>
                ))}
              </select>
            )}
            {onDurationChange && (
              <>
                <span className="datetime-picker__sep">{'·'}</span>
                <DurationSelect value={duration} onChange={onDurationChange} title={'Длительность урока'} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { formatDisplay as formatDateTime };
// Время урока по умолчанию: сегодня, следующий час, :00
export function nextHour() {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}


// Попап под полем, но в координатах окна; не вылезает за нижний край.
function floatingStyle(el) {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  const top = Math.min(r.bottom + 8, window.innerHeight - 340);
  return { position: 'fixed', top: Math.max(8, top), left: Math.min(r.left, window.innerWidth - 270), zIndex: 1000 };
}

export default DateTimePicker;
