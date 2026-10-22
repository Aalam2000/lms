// Звёзды студента в шапке кабинета: «У тебя уже есть 6 ★» — янтарная
// плашка с бегущим бликом и мерцающей звездой (стили — .student-stars в
// components.css). Сумма всех звёзд за уроки за всё время. Пока звёзд нет —
// ничего не показываем. Обновляется при переходе между страницами.
import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { getMyStars } from '../api/lessons';

function StudentStars({ user }) {
  const [stars, setStars] = useState(0);
  const { pathname } = useLocation();
  const isStudent = user?.role === 'student';

  useEffect(() => {
    if (!isStudent) return;
    getMyStars().then(r => setStars(r.stars)).catch(() => { /* звёзды не критичны */ });
  }, [isStudent, pathname]);

  if (!isStudent || !stars) return null;
  return (
    <span className="student-stars">
      <span className="student-stars__text">{'У тебя уже есть'}</span>
      <span className="student-stars__num">{stars}</span>
      <svg className="student-stars__icon" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id="student-stars-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fde68a" />
            <stop offset=".5" stopColor="#f59e0b" />
            <stop offset="1" stopColor="#b45309" />
          </linearGradient>
        </defs>
        <path
          d="M12 2.2l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.3 5.9 20.6l1.4-6.7-5-4.7 6.8-.8z"
          fill="url(#student-stars-gold)" stroke="#b45309" strokeWidth="1"
        />
      </svg>
    </span>
  );
}

export default StudentStars;
