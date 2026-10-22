import React, { useEffect, useState } from 'react';
import { getNewStudentsCount } from '../api/students';
import { useHomeworkRefresh } from '../hooks/useHomeworkRefresh';
import { useAuth } from '../context/AuthContext';
import { NavLink, useLocation } from 'react-router';
import { useAcademyName } from '../utils/academyName';
import InstallButton from './InstallButton';
import {
  IconDashboard,
  IconKnowledge,
  IconStudents,
  IconTeachers,
  IconProfile,
  IconAdmin,
  IconPerformance,
  IconHelp,
  IconActivity,
  IconBook,
  IconNetwork,
  IconRooms,
} from './CyberIcons';

// Сайт открыт по адресу локальной сети (192.168.x.x, 10.x.x.x, 172.16–31.x.x,
// localhost на деве), а не по внешнему домену. Только для показа пунктов меню,
// которые работают лишь изнутри сети; на остальную работу платформы не влияет.
const IS_LOCAL_NETWORK = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
  .test(window.location.hostname);

function Navigation({ user, isOpen, onClose }) {
  const { can } = useAuth();
  const academyName = useAcademyName();
  // Пункты только педагога и админа (База знаний, Методика)
  const isStaff = user?.role === 'teacher' || user?.role === 'admin';
  const { pathname } = useLocation();
  // NEW у «Студентов»: ученики без единого посещённого урока; раз в 15 с и при переходах
  const canStudents = can('students.view');
  const [newCount, setNewCount] = useState(0);
  useEffect(() => {
    if (canStudents) getNewStudentsCount().then(setNewCount).catch(() => {});
  }, [canStudents, pathname]);
  useHomeworkRefresh(() => getNewStudentsCount().then(setNewCount).catch(() => {}), canStudents);
  const linkClass = ({ isActive }) => `nav__link${isActive ? ' nav__link--active' : ''}`;

  // Вложенные страницы подсвечивают свой раздел меню: группа и урок открываются
  // из «Главной», редактор квиза — из «Базы знаний». Без этого выделение
  // пропадало, стоило уйти с первой страницы раздела.
  const under = (...prefixes) => prefixes.some(p => pathname === p || pathname.startsWith(p + '/'));
  const homeActive = pathname === '/dashboard' || pathname === '/dashboard/'
    || under('/dashboard/groups', '/dashboard/lessons', '/dashboard/student-lessons');
  const materialsActive = under('/dashboard/materials', '/dashboard/add-quiz');
  const activeClass = (active) => `nav__link${active ? ' nav__link--active' : ''}`;

  const handleLinkClick = () => {
    // На мобильном клик по ссылке должен закрывать сайдбар.
    // На десктопе onClose тоже вызовется, но там isOpen не используется —
    // сайдбар всегда виден через CSS, ничего не сломается.
    if (onClose) onClose();
  };

  return (
    <nav className={`nav${isOpen ? ' nav--open' : ''}`}>
      <div className="nav__logo">
        <img src="/assets/logo.svg" alt={academyName} width="120" height="40" />
      </div>
      <ul className="nav__list">
        <li className="nav__item">
          <NavLink to="/dashboard" end className={() => activeClass(homeActive)} onClick={handleLinkClick}>
            <IconDashboard className="nav__icon" />
            <span>{'Главная'}</span>
          </NavLink>
        </li>
        {user?.role === 'student' && (
          <li className="nav__item">
            <NavLink to="/dashboard/performance" className={linkClass} onClick={handleLinkClick}>
              <IconPerformance className="nav__icon" />
              <span>{'Успеваемость'}</span>
            </NavLink>
          </li>
        )}
        {isStaff && (
          <li className="nav__item">
            <NavLink to="/dashboard/materials" className={() => activeClass(materialsActive)} onClick={handleLinkClick}>
              <IconKnowledge className="nav__icon" />
              <span>{'База знаний'}</span>
            </NavLink>
          </li>
        )}
        {can('students.view') && (
          <li className="nav__item">
            <NavLink to="/dashboard/students" className={linkClass} onClick={handleLinkClick}>
              <IconStudents className="nav__icon" />
              <span>{'Студенты'}</span>
              {newCount > 0 && <span className="new-badge" data-tip="Новые ученики — ещё не были на уроке">{'NEW'} {newCount}</span>}
            </NavLink>
          </li>
        )}
        {user?.role === 'admin' && (
          <li className="nav__item">
            <NavLink to="/dashboard/teachers" className={linkClass} onClick={handleLinkClick}>
              <IconTeachers className="nav__icon" />
              <span>{'Учителя'}</span>
            </NavLink>
          </li>
        )}
        {can('rooms.edit') && (
          <li className="nav__item">
            <NavLink to="/dashboard/rooms" className={linkClass} onClick={handleLinkClick}>
              <IconRooms className="nav__icon" />
              <span>{'Аудитории'}</span>
            </NavLink>
          </li>
        )}
        {user?.role === 'admin' && (
          <li className="nav__item">
            <NavLink to="/dashboard/activity" className={linkClass} onClick={handleLinkClick}>
              <IconActivity className="nav__icon" />
              <span>{'Посещения'}</span>
            </NavLink>
          </li>
        )}
        <li className="nav__item">
          <NavLink to="/dashboard/profile" className={linkClass} onClick={handleLinkClick}>
            <IconProfile className="nav__icon" />
            <span>{'Профиль'}</span>
          </NavLink>
        </li>
        {user?.role === 'admin' && (
          <li className="nav__item">
            <NavLink to="/dashboard/admin" className={linkClass} onClick={handleLinkClick}>
              <IconAdmin className="nav__icon" />
              <span>{'Админ'}</span>
            </NavLink>
          </li>
        )}
        {/* Отчёт NetDiag — отдельный сервис на том же сервере (nginx: /netdiag/,
            только из локальной сети). Не маршрут React — обычная ссылка в новой вкладке.
            Показывается, только если сайт открыт по адресу локальной сети. */}
        {user?.role === 'admin' && IS_LOCAL_NETWORK && (
          <li className="nav__item">
            <a href="/netdiag/" target="_blank" rel="noopener noreferrer" className="nav__link" onClick={handleLinkClick}>
              <IconNetwork className="nav__icon" />
              <span>{'Отчёт о сети'}</span>
            </a>
          </li>
        )}
      </ul>
      {/* «На рабочий стол» — посередине между пунктами меню и «Методикой»/«Помощью» */}
      <InstallButton onDone={handleLinkClick} />
      {/* «Методика» — методические материалы (педагоги и админы), прижата к низу
          над «Помощью»; оранжевый значок «?!» горит всегда, чтобы пункт выделялся */}
      {isStaff && (
        <NavLink
          to="/dashboard/methodology"
          className={({ isActive }) => `nav__link nav__method${isActive ? ' nav__link--active' : ''}`}
          onClick={handleLinkClick}
        >
          <IconBook className="nav__icon" />
          <span>{'Методика'}</span>
          <span className="nav__method-mark" aria-hidden="true">?!</span>
        </NavLink>
      )}
      {/* «Помощь» — страница в правой части, как остальные разделы; кнопка прижата к низу */}
      <NavLink
        to="/dashboard/help"
        className={({ isActive }) => `nav__link nav__help${isActive ? ' nav__link--active' : ''}`}
        onClick={handleLinkClick}
      >
        <IconHelp className="nav__icon" />
        <span>{'Помощь'}</span>
      </NavLink>
    </nav>
  );
}

export default Navigation;