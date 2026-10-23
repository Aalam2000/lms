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
import { Calendar as BigCalendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, startOfWeek, getDay } from 'date-fns';
import { ru, az, enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import '../styles/calendar.css';
import { useLang } from '../hooks/useLang';
import { lessonEnd } from '../utils/lessonTime';
import Modal from './Modal';

// Названия месяцев и дней в сетке календаря рисует date-fns по локали
// (culture = язык интерфейса из useLang), а не autoi18n. Первый день недели
// — понедельник на всех языках (в en-локали по умолчанию воскресенье).
const DATE_LOCALES = { ru, az, en: enUS };
const mondayStartOfWeek = (date, options) => startOfWeek(date, { ...options, weekStartsOn: 1 });
const localizer = dateFnsLocalizer({ format, startOfWeek: mondayStartOfWeek, getDay, locales: DATE_LOCALES });

// Форматы дат календаря. Формат date-fns: LLLL — месяц в именительном падеже
// («октябрь 2026», а не «октября 2026»), p — время по локали (ru «8:05»).
// День недели по-русски — «чт» (EEEEEE), а не «чтв» (ccc).
const fmt = (pattern) => (date, culture, loc) => loc.format(date, pattern, culture);
const weekdayShort = (date, culture, loc) => loc.format(date, culture === 'ru' ? 'EEEEEE' : 'ccc', culture);
const timeRange = ({ start, end }, culture, loc) => `${loc.format(start, 'p', culture)} – ${loc.format(end, 'p', culture)}`;
const FORMATS = {
  dayFormat: (date, culture, loc) => `${loc.format(date, 'dd', culture)} ${weekdayShort(date, culture, loc)}`,
  weekdayFormat: weekdayShort,
  selectRangeFormat: timeRange,
  eventTimeRangeFormat: timeRange,
  eventTimeRangeStartFormat: ({ start }, culture, loc) => `${loc.format(start, 'p', culture)} – `,
  eventTimeRangeEndFormat: ({ end }, culture, loc) => ` – ${loc.format(end, 'p', culture)}`,
  monthHeaderFormat: fmt('LLLL yyyy'),
  dayRangeHeaderFormat: ({ start, end }, culture, loc) =>
    `${loc.format(start, 'LLLL dd', culture)} – ${loc.format(end, start.getMonth() === end.getMonth() ? 'dd' : 'LLLL dd', culture)}`,
};

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
    room: 'А',
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
    room: 'A',
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
    room: 'A',
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
// месяцев и дней берутся из локали date-fns (ru/az/en), а не из autoi18n.
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
  ...FORMATS,
  monthHeaderFormat: fmt('LLL yyyy'),
  dayHeaderFormat: fmt('EEEEEE, d MMM'),
  dayRangeHeaderFormat: ({ start, end }, culture, loc) =>
    `${loc.format(start, 'd MMM', culture)} – ${loc.format(end, 'd MMM', culture)}`,
};
const MOBILE_NAV = { previous: '‹', next: '›' };

const personalNames = (l) => (l.is_personal && l.participants?.length ? `${l.participants.map(p => p.full_name).join(', ')} — ` : '');

// isDisabled(lesson) — урок показан, но не открывается (у студента: закрыт педагогом)
// isDayOff(date) — выходной педагога: день заливается (hooks/useDaysOff.js)
// dayOffTeacher — имя педагога для подсказки «У учителя … выходной» над таким днём
function Calendar({ lessons, onSelectLesson, getEventColor, defaultView = 'month', highlight = TEACHER_HIGHLIGHT, isDisabled, isLight = TEACHER_LIGHT, isDayOff, dayOffTeacher }) {
  const { lang } = useLang();
  const culture = DATE_LOCALES[lang] ? lang : 'ru';
  const isMobile = useIsMobile();
  // «ещё N» в клетке месяца: окно со скрытыми уроками дня ({ date, events } или null)
  const [more, setMore] = useState(null);
  const messages = useMemo(() => {
    const base = MESSAGES_BY_LANG[culture] || MESSAGES_BY_LANG.ru;
    return isMobile ? { ...base, ...MOBILE_NAV } : base;
  }, [culture, isMobile]);

  // Буква аудитории перед номером («А2») — по языку, из словаря выше
  const roomLetter = (MESSAGES_BY_LANG[culture] || MESSAGES_BY_LANG.ru).room;
  const events = useMemo(() => lessons
    .filter(l => l.date)
    .map(l => {
      return {
        id: l.id,
        // 👤 — персональный урок (у педагога — с именами участников перед названием);
        // в конце — кто ведёт урок, если это не основной педагог группы
        // А2 — аудитория урока (номер), первым
        title: `${l.room_number ? `${roomLetter}${l.room_number} ` : ''}${highlight(l)}${l.is_personal ? '👤 ' : ''}${l.group_name ? `${l.group_name}: ` : ''}${personalNames(l)}${l.title}${l.teacher_name ? ` · ${l.teacher_name}` : ''}`,
        start: new Date(l.date),
        end: lessonEnd(l), // реальная длительность — растягивается в «Неделе»/«Дне»
        resource: l,
      };
    }), [lessons, highlight, roomLetter]);

  const { min, max } = useMemo(() => visibleHours(events), [events]);

  // Подсказка над выходным: фон дня (месяц) и ячейки времени (неделя, день).
  // Слой событий пропускает мышь к фону (calendar.css, .la-calendar--days-off).
  const dayOffTip = (MESSAGES_BY_LANG[culture] || MESSAGES_BY_LANG.ru).dayOff(dayOffTeacher);
  // «ещё N» — своя кнопка вместо встроенного попапа календаря (флаг popup,
  // он работает на заброшенной react-overlays). Календарь сам отдаёт
  // remainingEvents — ровно те уроки, что не поместились в клетку.
  const components = useMemo(() => {
    const showMore = ({ slotDate, count, remainingEvents }) => (
      <button
        type="button"
        className="rbc-button-link rbc-show-more"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMore({ date: slotDate, events: remainingEvents });
        }}
      >
        {messages.showMore(count)}
      </button>
    );
    if (!isDayOff) return { showMore };
    const wrap = ({ value, children }) => (isDayOff(value)
      ? React.cloneElement(React.Children.only(children), { 'data-tip': dayOffTip })
      : children);
    return { showMore, dateCellWrapper: wrap, timeSlotWrapper: wrap };
  }, [isDayOff, dayOffTip, messages]);

  const eventClassName = (lesson) => [
    'la-calendar__event',
    highlight(lesson) && 'la-calendar__event--homework',
    isLight && isLight(lesson) && 'la-calendar__event--light',
    isDisabled && isDisabled(lesson) && 'la-calendar__event--disabled',
  ].filter(Boolean).join(' ');
  // Цвет группы — переменная CSS у каждого урока (и в сетке, и в окне «ещё N»)
  const eventStyle = (event) => ({ '--la-event-color': getEventColor ? getEventColor(event.resource) : 'var(--color-primary)' });

  const selectLesson = (lesson) => {
    if (isDisabled && isDisabled(lesson)) return;
    if (onSelectLesson) onSelectLesson(lesson);
  };

  return (
    <div className={`la-calendar${isDayOff ? ' la-calendar--days-off' : ''}`}>
      <BigCalendar
        localizer={localizer}
        events={events}
        views={['month', 'week', 'day']}
        defaultView={defaultView}
        messages={messages}
        formats={isMobile ? MOBILE_FORMATS : FORMATS}
        culture={culture}
        min={min}
        max={max}
        scrollToTime={min}
        step={30}
        timeslots={2}
        dayPropGetter={isDayOff ? (date) => (isDayOff(date) ? { className: 'la-calendar__day--off' } : {}) : undefined}
        components={components}
        eventPropGetter={(event) => ({
          className: eventClassName(event.resource),
          style: eventStyle(event),
        })}
        onSelectEvent={(event) => selectLesson(event.resource)}
      />
      {more && (
        <Modal title={localizer.format(more.date, 'd MMMM, EEEE', culture)} onClose={() => setMore(null)}>
          <div className="la-calendar__more-list">
            {more.events.map(event => (
              <button
                key={event.id}
                type="button"
                className={`rbc-event ${eventClassName(event.resource)}`}
                style={eventStyle(event)}
                onClick={() => {
                  if (isDisabled && isDisabled(event.resource)) return;
                  setMore(null);
                  selectLesson(event.resource);
                }}
              >
                {event.title}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

export default Calendar;
