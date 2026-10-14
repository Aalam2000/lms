// Выходные педагога (правила — backend/app/days_off.py): полоски дней недели
// (несколько полосок чередуются по неделям) и маленький календарь отдельных
// дней. Админ правит и сохраняет (вкладка «Админ» → педагоги), педагог видит
// то же самое у себя в профиле только для просмотра (readOnly).
// Какие дни выходные, считает бэкенд: у админа — предпросмотр несохранённых
// настроек, у педагога — сохранённые даты. Правило здесь не повторяется.
import React, { useEffect, useState } from 'react';
import IconButton from './IconButton';
import MonthGrid from './MonthGrid';
import { getTeacherDaysOffSettings, previewTeacherDaysOff, saveTeacherDaysOffSettings } from '../api/admin';
import { getMyDaysOffSettings } from '../api/auth';
import { getTeacherDaysOff } from '../api/lessons';
import { addDays, isoDate } from '../utils/dates';
import { WEEKDAY_LABELS } from '../utils/weekdays';

const MAX_WEEKS = 4;

function DaysOffEditor({ teacherId, readOnly, onSaved }) {
  const [settings, setSettings] = useState(null); // { weeks, dates }
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [preview, setPreview] = useState({ dates: new Set(), pattern: new Set() });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (readOnly ? getMyDaysOffSettings() : getTeacherDaysOffSettings(teacherId))
      .then(data => setSettings({ weeks: data.weeks.length ? data.weeks : [[]], dates: data.dates }))
      .catch(err => setError(err?.response?.data?.detail || 'Не удалось загрузить выходные'));
  }, [teacherId, readOnly]);

  useEffect(() => {
    if (!settings || !calendarOpen) return undefined;
    const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    let alive = true;
    const from = isoDate(addDays(monthStart, -7));
    const to = isoDate(addDays(monthStart, 44));
    const request = readOnly
      ? getTeacherDaysOff(teacherId, from, to).then(dates => ({ dates, pattern: [] }))
      : previewTeacherDaysOff(teacherId, settings, from, to);
    request
      .then(data => { if (alive) setPreview({ dates: new Set(data.dates), pattern: new Set(data.pattern) }); })
      .catch(err => { if (alive) setError(err?.response?.data?.detail || 'Не удалось показать календарь'); });
    return () => { alive = false; };
  }, [teacherId, readOnly, settings, calendarOpen, viewDate]);

  if (!settings) return error ? <div className="banner banner--error">{error}</div> : <p className="text-muted">{'Загрузка...'}</p>;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const setWeeks = (weeks) => setSettings(prev => ({ ...prev, weeks }));
  const toggleDay = (index, day) => setWeeks(settings.weeks.map((week, i) => (
    i !== index ? week : week.includes(day) ? week.filter(d => d !== day) : [...week, day].sort()
  )));

  // Клик по дню меняет его на противоположный: отметка нужна, только если
  // результат расходится с полосками («выходной» в обычный день или «рабочий»
  // в постоянный выходной); совпало с полосками — отметку убираем.
  const toggleDate = (day) => {
    const key = isoDate(day);
    const wantOff = !preview.dates.has(key);
    const dates = { ...settings.dates };
    if (wantOff === preview.pattern.has(key)) delete dates[key];
    else dates[key] = wantOff ? 'off' : 'work';
    setSettings(prev => ({ ...prev, dates }));
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const saved = await saveTeacherDaysOffSettings(teacherId, settings);
      setSettings({ weeks: saved.weeks.length ? saved.weeks : [[]], dates: saved.dates });
      if (onSaved) onSaved();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось сохранить выходные');
    } finally {
      setSaving(false);
    }
  };

  const several = settings.weeks.length > 1;

  return (
    <div className="days-off">
      {settings.weeks.map((week, index) => (
        <div className="days-off__week" key={index}>
          {several && <span className="days-off__week-label">{'Неделя'} {index + 1}</span>}
          {WEEKDAY_LABELS.map((label, day) => (
            <label className="checkbox-row" key={label}>
              <input
                type="checkbox"
                checked={week.includes(day)}
                disabled={readOnly}
                onChange={() => toggleDay(index, day)}
              />
              {label}
            </label>
          ))}
          {!readOnly && several && (
            <IconButton icon="delete" tip="Убрать неделю" onClick={() => setWeeks(settings.weeks.filter((_, i) => i !== index))} />
          )}
        </div>
      ))}

      <p className="hint-text">
        {several
          ? 'Недели чередуются по кругу: неделя 1 — та, в которую выходные сохранены, дальше неделя 2 и так далее.'
          : 'Отмеченные дни — выходные каждую неделю. «+» добавляет ещё одну неделю, и недели начинают чередоваться (например, выходной через неделю).'}
      </p>

      <div className="days-off__actions">
        {!readOnly && settings.weeks.length < MAX_WEEKS && (
          <button type="button" className="btn btn--secondary" data-tip={'Добавить неделю для чередования'} onClick={() => setWeeks([...settings.weeks, []])}>
            {'+'}
          </button>
        )}
        <button type="button" className="btn btn--secondary" onClick={() => setCalendarOpen(v => !v)}>
          {'Календарь'}
        </button>
        {!readOnly && (
          <button type="button" className="btn" onClick={save} disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        )}
      </div>

      {calendarOpen && (
        <div className="days-off__calendar">
          <MonthGrid
            viewDate={viewDate}
            onNav={(delta) => setViewDate(prev => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))}
            onSelectDay={readOnly ? undefined : toggleDate}
            isDayDisabled={(day) => day < today}
            dayClass={(day) => (preview.dates.has(isoDate(day)) ? ['month-grid__day--off'] : [])}
          />
          {!readOnly && <p className="hint-text">{'Нажмите на день, чтобы сделать его выходным или рабочим. Прошедшие дни не меняются.'}</p>}
        </div>
      )}

      {error && <div className="banner banner--error">{error}</div>}
    </div>
  );
}

export default DaysOffEditor;
