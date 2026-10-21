// Главная куратора: педагог — из списка (от него сектор и курсы), его календарь
// уроков и кнопка «Добавить ученика» (карточка нового ученика: курс обязателен,
// педагог и группа — по желанию, галочка — сразу доп. урок в группе).
// Свой урок (созданный куратором) — клик в календаре: перенести, открыть/закрыть.
// Данные — существующие эндпоинты; доступ — права куратора
// (backend/app/dependencies.py, ROLE_PERMISSIONS).
import React, { useEffect, useMemo, useState } from 'react';
import Calendar, { GROUP_COLORS } from '../components/Calendar';
import Dropdown from '../components/Dropdown';
import StudentCardModal from '../components/StudentCardModal';
import Modal from '../components/Modal';
import DateTimePicker from '../components/DateTimePicker';
import { useAuth } from '../context/AuthContext';
import { extractErrorMessage } from '../utils/errors';
import Avatar from '../components/Avatar';
import { getSectors } from '../api/academy';
import { getCourses } from '../api/groups';
import { getGroups } from '../api/admin';
import { getMyLessons, updateOwnLesson } from '../api/lessons';
import { useDaysOff } from '../hooks/useDaysOff';

// Флаги секторов (код сектора = язык); нет флага — код буквами
const FLAGS = {
  ru: (
    <svg viewBox="0 0 9 6"><rect width="9" height="2" y="0" fill="#fff" /><rect width="9" height="2" y="2" fill="#0039a6" /><rect width="9" height="2" y="4" fill="#d52b1e" /></svg>
  ),
  az: (
    <svg viewBox="0 0 12 8">
      <rect width="12" height="8" fill="#00b5e2" /><rect width="12" height="2.67" y="2.67" fill="#ef3340" /><rect width="12" height="2.67" y="5.33" fill="#509e2f" />
      <circle cx="5.7" cy="4" r="1.1" fill="#fff" /><circle cx="6" cy="4" r="0.9" fill="#ef3340" /><circle cx="7" cy="4" r="0.35" fill="#fff" />
    </svg>
  ),
  en: (
    <svg viewBox="0 0 60 30">
      <rect width="60" height="30" fill="#012169" /><path d="M0,0 60,30 M60,0 0,30" stroke="#fff" strokeWidth="6" />
      <path d="M0,0 60,30 M60,0 0,30" stroke="#c8102e" strokeWidth="2" /><path d="M30,0v30M0,15h60" stroke="#fff" strokeWidth="10" />
      <path d="M30,0v30M0,15h60" stroke="#c8102e" strokeWidth="6" />
    </svg>
  ),
};

function SectorFlags({ sectors, value, onChange }) {
  return (
    <div className="sector-flags">
      {sectors.map(s => (
        <button key={s.code} type="button" data-tip={s.name}
          className={`sector-flag${value === s.code ? ' sector-flag--active' : ''}`}
          onClick={() => onChange(value === s.code ? '' : s.code)}>
          {FLAGS[s.code] || <span className="sector-flag__code">{s.code.toUpperCase()}</span>}
        </button>
      ))}
    </div>
  );
}

// Выбор кнопками в ряд; повторный клик снимает выбор
function ChoiceRow({ items, value, onChange }) {
  return (
    <div className="button-row">
      {items.map(it => (
        <button key={it.id} type="button" className={`tab${value === it.id ? ' tab--active' : ''}`}
          onClick={() => onChange(value === it.id ? '' : it.id)}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

// Свой урок: перенести и открыть/закрыть (внутрь урока куратор не заходит)
function OwnLessonModal({ lesson, onClose, onSaved }) {
  const [when, setWhen] = useState(lesson.date ? new Date(lesson.date) : null);
  const [isOpen, setIsOpen] = useState(!!lesson.is_open);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!when) { setError('Укажите дату и время'); return; }
    setBusy(true);
    setError('');
    try {
      await updateOwnLesson(lesson.id, { date: when.toISOString(), is_open: isOpen });
      onSaved();
    } catch (err) {
      setError(extractErrorMessage(err, 'Не удалось сохранить'));
      setBusy(false);
    }
  };
  return (
    <Modal
      title={<>{lesson.group_name}: {lesson.title}</>}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>{'Отмена'}</button>
          <button type="button" className="btn" onClick={save} disabled={busy}>{'Сохранить'}</button>
        </>
      )}
    >
      <div className="form-stack">
        <DateTimePicker value={when} onChange={setWhen} floating />
        <label className="checkbox-row">
          <input type="checkbox" checked={isOpen} onChange={e => setIsOpen(e.target.checked)} />
          {'Урок открыт ученикам'}
        </label>
        {error && <div className="form-field__error">{error}</div>}
      </div>
    </Modal>
  );
}

function CuratorHome() {
  const { user } = useAuth();
  const [ownLesson, setOwnLesson] = useState(null); // свой урок в окне «перенести / открыть»
  const [reloadKey, setReloadKey] = useState(0);
  const [sectors, setSectors] = useState([]);
  const [courses, setCourses] = useState([]);
  const [groups, setGroups] = useState([]);
  const [sector, setSector] = useState('');
  const [courseId, setCourseId] = useState('');
  const [teacherId, setTeacherId] = useState(null);
  const [lessons, setLessons] = useState([]);
  const [adding, setAdding] = useState(false);
  const [cardStudentId, setCardStudentId] = useState(null);

  useEffect(() => {
    getSectors().then(setSectors).catch(() => {});
    getCourses().then(setCourses).catch(() => {});
    getGroups().then(list => setGroups(list.filter(g => g.status === 'active'))).catch(() => {});
  }, []);

  // Педагоги в списке — всегда все; подходящие под сектор и курс — сверху,
  // остальные ниже мелким серым. Флаг сектора выбирает первого педагога сектора,
  // курс — первого, кто его ведёт (если выбранный не ведёт). Выбор педагога
  // настраивает остальное: флаг — если сектор у него один, курс — если он один.
  const allTeachers = useMemo(() => {
    const map = new Map();
    groups.forEach(g => {
      if (!map.has(g.teacher_id)) map.set(g.teacher_id, { id: g.teacher_id, name: g.teacher_name || `#${g.teacher_id}`, photoUrl: g.teacher_photo_url, sectors: new Set() });
      map.get(g.teacher_id).sectors.add(g.sector);
    });
    return Array.from(map.values()).sort((x, y) => x.name.localeCompare(y.name));
  }, [groups]);
  const inSector = (g, sec) => !sec || g.sector === sec;
  const teaches = (tid, sec, cid) => groups.some(g => g.teacher_id === tid && inSector(g, sec) && (!cid || g.course_id === cid));
  const coursesOf = (tid, sec) => new Set(groups.filter(g => g.teacher_id === tid && inSector(g, sec)).map(g => g.course_id));

  const pickTeacher = (id) => {
    if (!id) return;
    const t = allTeachers.find(x => x.id === id);
    const sec = t && t.sectors.size === 1 ? [...t.sectors][0] : '';
    const own = coursesOf(id, sec);
    setTeacherId(id);
    setSector(sec);
    setCourseId(own.size === 1 ? [...own][0] : (own.has(courseId) ? courseId : ''));
  };
  const pickSector = (code) => {
    setSector(code);
    if (courseId && !groups.some(g => g.course_id === courseId && inSector(g, code))) setCourseId('');
    if (code && !teaches(teacherId, code, '')) {
      const first = allTeachers.find(t => t.sectors.has(code));
      if (first) setTeacherId(first.id);
    }
  };
  const pickCourse = (cid) => {
    setCourseId(cid);
    if (cid && !teaches(teacherId, sector, cid)) {
      const first = allTeachers.find(t => teaches(t.id, sector, cid));
      if (first) setTeacherId(first.id);
    }
  };
  // При открытии — первый педагог по алфавиту
  useEffect(() => {
    if (!teacherId && allTeachers.length) pickTeacher(allTeachers[0].id);
  }, [allTeachers]); // eslint-disable-line react-hooks/exhaustive-deps

  // Курсы — все курсы сектора (без сектора — все курсы)
  const sectorGroups = groups.filter(g => inSector(g, sector));
  const sectorCourseIds = new Set(sectorGroups.map(g => g.course_id));
  const sectorCourses = courses.filter(c => sectorCourseIds.has(c.id));
  const course = courseId;
  const fits = (t) => teaches(t.id, sector, course);
  const teacherOptions = [...allTeachers.filter(fits), ...allTeachers.filter(t => !fits(t))]
    .map(t => ({ value: t.id, label: t.name, muted: !fits(t) }));
  const sectorTeachers = allTeachers.filter(t => !sector || t.sectors.has(sector));
  const shownTeacher = teacherId || '';
  const shownTeacherInfo = allTeachers.find(t => t.id === teacherId);

  useEffect(() => {
    if (!shownTeacher) { setLessons([]); return; }
    getMyLessons({ teacher_id: shownTeacher }).then(setLessons).catch(() => setLessons([]));
  }, [shownTeacher, reloadKey]);
  const isDayOff = useDaysOff({ teacherId: shownTeacher || null });

  const groupIds = useMemo(() => groups.map(g => g.id), [groups]);
  const calendarLessons = lessons.map(l => ({ ...l, group_name: groups.find(g => g.id === l.group_id)?.name }));
  const getEventColor = (l) => GROUP_COLORS[Math.max(0, groupIds.indexOf(l.group_id)) % GROUP_COLORS.length];

  return (
    <div className="page">
      <div className="toolbar">
        <div className="curator-head">
          <h2 className="toolbar__title">{'Главная'}</h2>
          <SectorFlags sectors={sectors} value={sector} onChange={pickSector} />
        </div>
        <button type="button" className="btn" onClick={() => setAdding(true)}>{'+ Добавить ученика'}</button>
      </div>

      <div className="toolbar">
        <ChoiceRow items={sectorCourses.map(c => ({ id: c.id, label: c.title }))} value={course} onChange={pickCourse} />
        <span className="person">
          {/* Фото выбранного педагога */}
          {shownTeacherInfo && (
            <Avatar userId={shownTeacherInfo.id} photoUrl={shownTeacherInfo.photoUrl} name={shownTeacherInfo.name} size="sm" />
          )}
          <Dropdown
            value={shownTeacher || ''}
            onChange={v => pickTeacher(Number(v))}
            placeholder={allTeachers.length ? 'Педагог' : 'Нет педагогов'}
            options={teacherOptions}
          />
        </span>
      </div>

      {shownTeacher && (
        <Calendar
          lessons={calendarLessons}
          getEventColor={getEventColor}
          onSelectLesson={(l) => { if (l.created_by === user?.id) setOwnLesson(l); }}
          isDayOff={isDayOff}
          dayOffTeacher={allTeachers.find(t => t.id === shownTeacher)?.name}
        />
      )}

      {ownLesson && (
        <OwnLessonModal
          lesson={ownLesson}
          onClose={() => setOwnLesson(null)}
          onSaved={() => { setOwnLesson(null); setReloadKey(k => k + 1); }}
        />
      )}
      {adding && (
        <StudentCardModal
          groups={sectorGroups}
          courses={sectorCourses}
          teachers={sectorTeachers}
          defaults={{ course_id: course, sector, teacher_id: shownTeacher }}
          onClose={() => setAdding(false)}
          onSaved={(saved) => { setAdding(false); setReloadKey(k => k + 1); if (saved?.id) setCardStudentId(saved.id); }}
        />
      )}
      {cardStudentId && (
        <StudentCardModal
          studentId={cardStudentId}
          onClose={() => setCardStudentId(null)}
          onSaved={() => setCardStudentId(null)}
        />
      )}
    </div>
  );
}

export default CuratorHome;
