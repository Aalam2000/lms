import React, { useState, useEffect } from 'react';
import { getMyMarks, getMyGrades } from '../api/lessons';
import Modal from '../components/Modal';

// Три вида оценок — у каждой своя средняя (claude/homework-plan.md, «Оценки»).
// Клик по плитке — окно со списком «дата — оценка».
const GRADE_KINDS = [
  { key: 'lesson', label: 'За уроки' },
  { key: 'homework', label: 'За домашние задания' },
  { key: 'exam', label: 'Экзамены' },
];

// Метка "по факту" для пропуска — та же логика, что status_label на
// бэкенде (routers/lessons.py, _build_status_label), но тут нужны только
// два случая: сам пропуск (absent) и уважительная причина (excused).
// Остальные статусы (был/онлайн/ничего не отмечено) в "Пропуски" не входят.
const ABSENCE_LABELS = {
  absent: 'Пропуск',
  excused: 'По уважительной причине',
  made_up: 'Пропуск закрыт дополнительным уроком',
};

function StudentPerformancePage() {
  const [marks, setMarks] = useState([]);
  const [tab, setTab] = useState('grades'); // grades | absences
  const [grades, setGrades] = useState(null);
  const [openKind, setOpenKind] = useState(null);

  useEffect(() => {
    getMyMarks().then(setMarks);
    getMyGrades().then(setGrades);
  }, []);

  const absenceRows = marks.filter(m => ABSENCE_LABELS[m.attendance_status]);

  return (
    <div className="page">
      <h2>{'Успеваемость'}</h2>

      {grades && (
        <div className="grade-tiles">
          {GRADE_KINDS.map(k => (
            <button
              key={k.key}
              type="button"
              className="grade-tile"
              onClick={() => setOpenKind(k)}
              data-tip="Показать все оценки"
            >
              <span className="grade-tile__value">{grades[k.key].avg ?? '—'}</span>
              <span className="grade-tile__label">{k.label}</span>
              <span className="grade-tile__sub">
                {grades[k.key].items.length ? `оценок: ${grades[k.key].items.length} · макс. ${grades[k.key].max}` : 'оценок пока нет'}
              </span>
            </button>
          ))}
        </div>
      )}

      {openKind && grades && (
        <Modal title={`Оценки: ${openKind.label.toLowerCase()}`} onClose={() => setOpenKind(null)} size="wide">
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{'Дата'}</th>
                  <th>{'Урок'}</th>
                  <th>{'Оценка'}</th>
                </tr>
              </thead>
              <tbody>
                {grades[openKind.key].items.length === 0 ? (
                  <tr><td colSpan={3} className="table__empty">{'Оценок пока нет'}</td></tr>
                ) : grades[openKind.key].items.map((g, i) => (
                  <tr key={i}>
                    <td className="nowrap">{g.date ? new Date(g.date).toLocaleDateString('ru-RU') : '—'}</td>
                    <td>{g.lesson_title}{g.title ? ` — ${g.title}` : ''}</td>
                    <td>{g.grade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
      <div className="toolbar__filters">
        <button
          type="button"
          className={`tab tab--underline${tab === 'grades' ? ' tab--active' : ''}`}
          onClick={() => setTab('grades')}
        >
          {'Оценки'}
        </button>
        <button
          type="button"
          className={`tab tab--underline${tab === 'absences' ? ' tab--active' : ''}`}
          onClick={() => setTab('absences')}
        >
          {'Пропуски'}
        </button>
      </div>

      {tab === 'grades' ? (
        // 3 колонки оценок (урок / ДЗ / экзамен) + 2 колонки посещаемости
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>{'Дата'}</th>
                <th>{'Урок'}</th>
                <th>{'За урок'}</th>
                <th>{'За ДЗ'}</th>
                <th>{'Экзамен'}</th>
                <th>{'Посещаемость'}</th>
                <th>{'Опоздание'}</th>
              </tr>
            </thead>
            <tbody>
              {marks.length === 0 && (
                <tr><td colSpan={7} className="table__empty">{'Оценок нет'}</td></tr>
              )}
              {marks.map(m => (
                <tr key={m.lesson_id}>
                  <td className="nowrap">{m.date ? new Date(m.date).toLocaleDateString('ru-RU') : '—'}</td>
                  <td>{m.lesson_title}</td>
                  <td>{m.score ?? '—'}</td>
                  <td>{m.hw_grades && m.hw_grades.length ? m.hw_grades.join(' / ') : '—'}</td>
                  <td>{m.exam_score ?? '—'}</td>
                  <td>{m.status_label || '—'}</td>
                  <td>{m.is_late ? 'Да' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>{'Дата'}</th>
              <th>{'Статус'}</th>
            </tr>
          </thead>
          <tbody>
            {absenceRows.length === 0 && (
              <tr><td colSpan={2} className="table__empty">{'Пропусков нет'}</td></tr>
            )}
            {absenceRows.map(m => (
              <tr key={m.lesson_id}>
                <td>{m.date ? new Date(m.date).toLocaleDateString('ru-RU') : '—'}</td>
                <td>{ABSENCE_LABELS[m.attendance_status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default StudentPerformancePage;
