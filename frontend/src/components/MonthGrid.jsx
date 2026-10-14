// Сетка дней месяца с переключением месяцев (неделя с понедельника). Общая
// для выбора даты урока (DateTimePicker) и календаря выходных педагога
// (DaysOffEditor). Что выделять и что делать по клику — решает вызывающий.
import React from 'react';
import { MONTH_NAMES } from '../utils/months';
import { WEEKDAY_LABELS } from '../utils/weekdays';

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function sameDay(a, b) {
  return !!a && !!b && startOfDay(a).getTime() === startOfDay(b).getTime();
}

// 6x7 сетка дней месяца, неделя начинается с понедельника.
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const firstWeekday = (first.getDay() + 6) % 7; // 0 = Пн
  const cells = [];
  for (let i = 0; i < 42; i++) {
    cells.push(new Date(year, month, 1 - firstWeekday + i));
  }
  return cells;
}

/**
 * viewDate — любой день показываемого месяца; onNav(delta) — листать на ±1 месяц.
 * dayClass(day) — дополнительные классы дня (например 'month-grid__day--selected').
 * isDayDisabled(day) — день не нажимается. onSelectDay(day) — клик по дню;
 * не задан — сетка только для просмотра (дни не кнопки).
 */
function MonthGrid({ viewDate, onNav, onSelectDay, dayClass, isDayDisabled }) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();

  return (
    <div className="month-grid">
      <div className="month-grid__header">
        <button type="button" className="month-grid__nav" onClick={() => onNav(-1)}>{'‹'}</button>
        <span>{MONTH_NAMES[month]} {year}</span>
        <button type="button" className="month-grid__nav" onClick={() => onNav(1)}>{'›'}</button>
      </div>

      <div className="month-grid__weekdays">
        {WEEKDAY_LABELS.map(w => <span key={w}>{w}</span>)}
      </div>

      <div className="month-grid__days">
        {buildMonthGrid(year, month).map((day) => {
          const classes = ['month-grid__day'];
          if (day.getMonth() !== month) classes.push('month-grid__day--muted');
          if (sameDay(day, today)) classes.push('month-grid__day--today');
          if (dayClass) classes.push(...dayClass(day));
          if (!onSelectDay) {
            return <span key={day.toISOString()} className={classes.join(' ')}>{day.getDate()}</span>;
          }
          return (
            <button
              type="button"
              key={day.toISOString()}
              className={classes.join(' ')}
              disabled={isDayDisabled ? isDayDisabled(day) : false}
              onClick={() => onSelectDay(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default MonthGrid;
