import React, { useState, useEffect } from 'react';
import { PersonalBadge } from '../components/PersonalLesson';
import { useNavigate } from 'react-router-dom';
import api from '../api/auth';
import Calendar from '../components/Calendar';
import StudentGroupsBar from '../components/StudentGroupsBar';
import { getStudentGroups, getMyPendingGroups } from '../api/groups';

// Главная студента: «Мои уроки» — Таблица | Календарь (как в группе у педагога).
// Урок, где что-то не закрыто, подсвечивается и там и там:
//   hw_todo 'pending' — ДЗ надо сдать; 'returned' — вернули на доработку;
//   new_messages — новые реплики педагога в диалоге.

const isToday = (d) => !!d && new Date(d).toDateString() === new Date().toDateString();

const isOpenItem = (l) => !!l.hw_todo || l.new_messages > 0;

// Значок в календаре
const studentHighlight = (l) => {
  if (!l.is_open) return ''; // закрытый урок не открыть — и не подсвечиваем
  if (l.hw_todo === 'returned') return '↺ ';
  if (l.hw_todo === 'pending') return '📝 ';
  if (l.new_messages > 0) return '💬 ';
  return '';
};

function readViewMode() {
  try {
    return localStorage.getItem('la_student_viewmode') || 'table';
  } catch {
    return 'table';
  }
}

function StudentHome() {
  const navigate = useNavigate();
  const [lessons, setLessons] = useState([]);
  const [groups, setGroups] = useState([]);
  const [pendingGroups, setPendingGroups] = useState([]); // записался по QR, педагог ещё не принял
  const [viewMode, setViewMode] = useState(readViewMode); // table | calendar

  useEffect(() => {
    // Все уроки (и закрытые) — для календаря; таблица показывает только открытые
    api.get('/lessons/student', { params: { include_closed: 1 } }).then(r => setLessons(r.data));
    getStudentGroups().then(setGroups).catch(() => setGroups([]));
    getMyPendingGroups().then(setPendingGroups).catch(() => setPendingGroups([]));
  }, []);

  useEffect(() => {
    try { localStorage.setItem('la_student_viewmode', viewMode); } catch { /* нет хранилища — не страшно */ }
  }, [viewMode]);

  const open = (l) => navigate(`/dashboard/student-lessons/${l.id}`);
  const openLessons = lessons.filter(l => l.is_open);

  return (
    <div className="page">
      {/* Заголовок и узкие плашки групп (вход в видеоконференцию) — в одну строку */}
      <div className="student-home__head">
        <h2>{'Мои уроки'}</h2>
        <StudentGroupsBar groups={groups} />
      </div>

      {pendingGroups.map(g => (
        <div key={g.id} className="pending-note">
          {'Вы записались в группу'} <b>{g.name}</b>{'. Ждём, когда педагог подтвердит, — после этого здесь появятся уроки.'}
        </div>
      ))}

      <div className="toolbar__filters">
        <button type="button" className={`tab${viewMode === 'table' ? ' tab--active' : ''}`} onClick={() => setViewMode('table')}>
          {'Таблица'}
        </button>
        <button type="button" className={`tab${viewMode === 'calendar' ? ' tab--active' : ''}`} onClick={() => setViewMode('calendar')}>
          {'Календарь'}
        </button>
      </div>

      {viewMode === 'calendar' ? (
        <Calendar lessons={lessons} onSelectLesson={open} highlight={studentHighlight} isDisabled={l => !l.is_open} isLight={null} />
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{'Дата'}</th>
                <th>{'Тема'}</th>
              </tr>
            </thead>
            <tbody>
              {openLessons.length === 0 && (
                <tr><td colSpan={2} className="table__empty">{'Уроков нет'}</td></tr>
              )}
              {openLessons.map(l => {
                const today = isToday(l.date);
                return (
                  <tr
                    key={l.id}
                    className={`table__row--clickable${today ? ' table__row--today' : ''}${isOpenItem(l) ? ' table__row--homework-pending' : ''}`}
                    onClick={() => open(l)}
                  >
                    <td>
                      {l.date ? new Date(l.date).toLocaleDateString('ru-RU') : '—'}
                      {today && <span className="badge badge--today badge--inline">{'Сегодня'}</span>}
                    </td>
                    <td>
                      {l.title}
                      <PersonalBadge lesson={l} />
                      {l.hw_todo === 'returned' && (
                        <span className="badge badge--admin badge--inline" data-tip={'Педагог вернул ответ на доработку'}>{'ДЗ: доработать'}</span>
                      )}
                      {l.hw_todo === 'pending' && (
                        <span className="badge badge--homework-pending badge--inline" data-tip={'Домашнее задание ещё не сдано'}>{'ДЗ: сдать'}</span>
                      )}
                      {l.new_messages > 0 && (
                        <span className="badge badge--teacher badge--inline" data-tip={'Новые сообщения от педагога'}>{`Сообщения: ${l.new_messages}`}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default StudentHome;
