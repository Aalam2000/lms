// Полоса под шапкой у студента: есть несданные ДЗ. Оранжевая — ДЗ выдано и не
// сдано (или возвращено на доработку), красная — срок сдачи прошёл. Всё сдано —
// полосы нет. Правило — backend/app/homework_status.py (student_homework_debts).
// Обновляется при переходе между страницами, раз в 15 секунд и сразу после
// загрузки или удаления файла ответа (hooks/useHomeworkRefresh.js).
import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { getMyHomeworkDebts } from '../api/lessons';
import { useHomeworkRefresh } from '../hooks/useHomeworkRefresh';

const pad = (n) => String(n).padStart(2, '0');
const formatDeadline = (iso) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function StudentHomeworkStrip({ user }) {
  const [debts, setDebts] = useState(null);
  const { pathname } = useLocation();
  const isStudent = user?.role === 'student';
  const load = () => { getMyHomeworkDebts().then(setDebts).catch(() => { /* полоса не критична */ }); };

  useEffect(() => {
    if (isStudent) load();
    // eslint-disable-next-line
  }, [isStudent, pathname]);
  useHomeworkRefresh(load, isStudent);

  if (!isStudent || !debts || !debts.count) return null;
  return (
    <div className={`hw-strip${debts.overdue ? ' hw-strip--overdue' : ''}`}>
      <b>
        {debts.overdue ? (
          <>{'Срок сдачи ДЗ прошёл'}{': '}{debts.lesson_title}</>
        ) : (
          <>
            {'Не сдано ДЗ'}{': '}{debts.lesson_title}
            {debts.deadline && <>{', '}{'срок до'} {formatDeadline(debts.deadline)}</>}
          </>
        )}
        {debts.count > 1 && <>{'. '}{'Всего не сдано'}{': '}{debts.count}</>}
      </b>
      <Link className="link" to={`/dashboard/student-lessons/${debts.lesson_id}?tab=homework`}>{'Открыть урок'}{' →'}</Link>
    </div>
  );
}

export default StudentHomeworkStrip;
