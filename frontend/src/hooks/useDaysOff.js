// Выходные для заливки дней в календаре уроков (components/Calendar.jsx,
// проп isDayOff). teacherId — выходные этого педагога; student — выходные
// педагогов групп текущего ученика. Ни того, ни другого — выходных нет.
// Период — месяц назад и год вперёд (выходные действуют с даты установки,
// важны в основном будущие дни).
import { useCallback, useEffect, useState } from 'react';
import { getStudentDaysOff, getTeacherDaysOff } from '../api/lessons';
import { addDays, isoDate } from '../utils/dates';

const DAYS_BACK = 31;
const DAYS_AHEAD = 365;

export function useDaysOff({ teacherId, student } = {}) {
  const [days, setDays] = useState(() => new Set());

  useEffect(() => {
    if (!teacherId && !student) {
      setDays(new Set());
      return undefined;
    }
    const today = new Date();
    const from = isoDate(addDays(today, -DAYS_BACK));
    const to = isoDate(addDays(today, DAYS_AHEAD));
    let alive = true;
    const request = student ? getStudentDaysOff(from, to) : getTeacherDaysOff(teacherId, from, to);
    request
      .then(dates => { if (alive) setDays(new Set(dates)); })
      .catch(() => { if (alive) setDays(new Set()); });
    return () => { alive = false; };
  }, [teacherId, student]);

  return useCallback((date) => days.has(isoDate(date)), [days]);
}
