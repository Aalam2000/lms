// Обёртка над react-big-calendar — общий календарь уроков (Месяц/Неделя/
// День, как в Google Calendar). Внешний вид переопределён в
// ../styles/calendar.css под токены Log Academy.
//
// Компонент ничего не знает про «группы» — только рисует события. Кто
// вызывает (GroupPage — уроки одной группы, GroupsPage — все уроки
// препода сразу) сам решает, откуда взялись уроки и как их красить
// (getEventColor), и сам показывает список групп для выбора рядом —
// это не забота календаря.
import React, { useMemo, useEffect, useState } from 'react';
import { Calendar as BigCalendar, momentLocalizer } from 'react-big-calendar';
// moment — из ESM-сборки (moment/dist): локали из moment/locale/* (UMD)
// под Vite регистрируются не в тот экземпляр moment, и календарь молча
// остаётся английским. Локали и сам moment должны браться из dist/.
import moment from 'moment/dist/moment';
import 'moment/dist/locale/ru';
import 'moment/dist/locale/az';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import '../styles/calendar.css';
import { useLang } from '../hooks/useLang';
import { lessonEnd } from '../utils/lessonTime';

// Локаль moment завязана на текущий язык интерфейса (useLang) — иначе
// названия месяцев/дней в сетке календаря (их рисует сам moment, а не
// autoi18n) всегда оставались бы русскими независимо от переключателя языка.
const MOMENT_LOCALE_BY_LANG = { ru: 'ru', az: 'az', en: 'en' };
const localizer = momentLocalizer(moment);

// MESSAGES передаётся как проп в react-big-calendar (не JSX-текст), поэтому
// autoi18n-сканер его в принципе не видит — переводим вручную, по языку.
// Слов немного и они фиксированные, так что платный AI-перевод тут ни к
// чему; az-варианты — стандартные календарные подписи (как в Google Calendar).
const MESSAGES_BY_LANG = {
  ru: {
    month: 'Месяц',
    week: 'Неделя',
    day: 'День',
    today: 'Сегодня',
    previous: 'Назад',
    next: 'Вперёд',
    noEventsInRange: 'Уроков нет',
    showMore: (count) => `ещё ${count}`,
    dayOff: (name) => (name ? `У учителя ${name} выходной` : 'У учителя выходной'),
  },
  az: {
    month: 'Ay',
    week: 'Həftə',
    day: 'Gün',
    today: 'Bu gün',
    previous: 'Geri',
    next: 'İrəli',
    noEventsInRange: 'Dərs yoxdur',
    showMore: (count) => `daha ${count}`,
    dayOff: (name) => (name ? `Müəllim ${name} istirahət günündədir` : 'Müəllimin istirahət günüdür'),
  },
  en: {
    month: 'Month',
    week: 'Week',
    day: 'Day',
    today: 'Today',
    previous: 'Back',
    next: 'Next',
    noEventsInRange: 'No lessons',
    showMore: (count) => `+${count} more`,
    dayOff: (name) => (name ? `Teacher ${name} is off` : 'Teacher is off'),
  },
};

// Общая палитра для раскраски «по группе» — используется здесь через
// getEventColor и отдельно на GroupsPage.jsx для списка групп рядом с
// календарём, чтобы цвета совпадали.
export const GROUP_COLORS = ['#EC3013', '#2E5FA3', '#3B6D11', '#C026D3', '#0891B2', '#f59e0b', '#605D5D', '#059669'];

// lessons: [{id, group_id, group_name?, title, date}]
// getEventColor(lesson) => css-цвет; не задан — все события фирменным красным.
// highlight(lesson) => значок-префикс ('' — не подсвечивать). По умолчанию —
// урок педагога с непроверенными ДЗ; у студента своё (StudentHome.jsx).
const TEACHER_HIGHLIGHT = (l) => (l.has_unreviewed_homework || l.has_unreviewed_work ? '📥 ' : '');

// isLight(lesson) — урок рисуется светлым вариантом цвета группы. По
// умолчанию (педагог) — урок открыт ученикам. У студента передаётся null:
// там открытые = кликабельные, а закрытые и так бледные через isDisabled.
const TEACHER_LIGHT = (l) => !!l.is_open;

// Видимые часы в режимах «Неделя»/«День»: по умолчанию 08:00–22:00, но
// раздвигаются, если есть уроки раньше/позже — урок не должен обрезаться.
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;

function visibleHours(events) {
  let from = DAY_START_HOUR;
  let to = DAY_END_HOUR;
  events.forEach(e => {
    from = Math.min(from, e.start.getHours());
    const endHour = e.end.getHours() + (e.end.getMinutes() ? 1 : 0);
    // Урок через полночь (end на следующий день) — сетку до 24:00
    to = Math.max(to, e.end.getDate() !== e.start.getDate() ? 24 : endHour);
  });
  return {
    min: new Date(1970, 0, 1, from, 0),
    max: to >= 24 ? new Date(1970, 0, 1, 23, 59) : new Date(1970, 0, 1, to, 0),
  };
}

// Телефон (та же граница, что в styles/media.css): шапка календаря компактная —
// месяц сокращён («Окт. 2026»), вместо «Назад/Вперёд» стрелки. Сокращения
// месяцев и дней берутся из локали moment (ru/az/en), а не из autoi18n.
const MOBILE_QUERY = '(max-width: 768px)';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isMobile;
}

const MOBILE_FORMATS = {
  monthHeaderFormat: 'MMM YYYY',
  dayHeaderFormat: 'dd, D MMM',
  dayRangeHeaderFormat: ({ start, end }, culture, loc) =>
    `${loc.format(start, 'D MMM', culture)} – ${loc.format(end, 'D MMM', culture)}`,
};
const MOBILE_NAV = { previous: '‹', next: '›' };

const personalNames = (l) => (l.is_personal && l.participants?.length ? `${l.participants.map(p => p.full_name).join(', ')} — ` : '');

// isDisabled(lesson) — урок показан, но не открывается (у студента: закрыт педагогом)
// isDayOff(date) — выходной педагога: день заливается (hooks/useDaysOff.js)
// dayOffTeacher — имя педагога для подсказки «У учителя … выходной» над таким днём
function Calendar({ lessons, onSelectLesson, getEventColor, defaultView = 'month', highlight = TEACHER_HIGHLIGHT, isDisabled, isLight = TEACHER_LIGHT, isDayOff, dayOffTeacher }) {
  const { lang } = useLang();
  const momentLocale = MOMENT_LOCALE_BY_LANG[lang] || 'ru';
  const isMobile = useIsMobile();
  const messages = useMemo(() => {
    const base = MESSAGES_BY_LANG[momentLocale] || MESSAGES_BY_LANG.ru;
    return isMobile ? { ...base, ...MOBILE_NAV } : base;
  }, [momentLocale, isMobile]);

  useEffect(() => {
    moment.locale(momentLocale);
  }, [momentLocale]);

  const events = useMemo(() => lessons
    .filter(l => l.date)
    .map(l => {
      return {
        id: l.id,
        // 👤 — персональный урок (у педагога — с именами участников перед названием);
        // в конце — кто ведёт урок, если это не основной педагог группы
        // А2 — аудитория урока (номер), первым
        title: `${l.room_number ? `А${l.room_number} ` : ''}${highlight(l)}${l.is_personal ? '👤 ' : ''}${l.group_name ? `${l.group_name}: ` : ''}${personalNames(l)}${l.title}${l.teacher_name ? ` · ${l.teacher_name}` : ''}`,
        start: new Date(l.date),
        end: lessonEnd(l), // реальная длительность — растягивается в «Неделе»/«Дне»
        resource: l,
      };
    }), [lessons, highlight]);

  const { min, max } = useMemo(() => visibleHours(events), [events]);

  // Подсказка над выходным: фон дня (месяц) и ячейки времени (неделя, день).
  // Слой событий пропускает мышь к фону (calendar.css, .la-calendar--days-off).
  const dayOffTip = (MESSAGES_BY_LANG[momentLocale] || MESSAGES_BY_LANG.ru).dayOff(dayOffTeacher);
  const components = useMemo(() => {
    if (!isDayOff) return undefined;
    const wrap = ({ value, children }) => (isDayOff(value)
      ? React.cloneElement(React.Children.only(children), { 'data-tip': dayOffTip })
      : children);
    return { dateCellWrapper: wrap, timeSlotWrapper: wrap };
  }, [isDayOff, dayOffTip]);

  const eventClassName = (lesson) => [
    'la-calendar__event',
    highlight(lesson) && 'la-calendar__event--homework',
    isLight && isLight(lesson) && 'la-calendar__event--light',
    isDisabled && isDisabled(lesson) && 'la-calendar__event--disabled',
  ].filter(Boolean).join(' ');

  return (
    <div className={`la-calendar${isDayOff ? ' la-calendar--days-off' : ''}`}>
      <BigCalendar
        localizer={localizer}
        events={events}
        views={['month', 'week', 'day']}
        defaultView={defaultView}
        messages={messages}
        formats={isMobile ? MOBILE_FORMATS : undefined}
        culture={momentLocale}
        popup
        min={min}
        max={max}
        scrollToTime={min}
        step={30}
        timeslots={2}
        dayPropGetter={isDayOff ? (date) => (isDayOff(date) ? { className: 'la-calendar__day--off' } : {}) : undefined}
        components={components}
        eventPropGetter={(event) => ({
          className: eventClassName(event.resource),
          style: { '--la-event-color': getEventColor ? getEventColor(event.resource) : 'var(--color-primary)' },
        })}
        onSelectEvent={(event) => {
          if (isDisabled && isDisabled(event.resource)) return;
          if (onSelectLesson) onSelectLesson(event.resource);
        }}
      />
    </div>
  );
}

export default Calendar;
