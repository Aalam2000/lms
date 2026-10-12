import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAcademyName } from '../utils/academyName';
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
} from './CyberIcons';

function Navigation({ user, isOpen, onClose }) {
  const academyName = useAcademyName();
  const { pathname } = useLocation();
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
        {user?.role !== 'student' && (
          <li className="nav__item">
            <NavLink to="/dashboard/materials" className={() => activeClass(materialsActive)} onClick={handleLinkClick}>
              <IconKnowledge className="nav__icon" />
              <span>{'База знаний'}</span>
            </NavLink>
          </li>
        )}
        {user?.role !== 'student' && (
          <li className="nav__item">
            <NavLink to="/dashboard/students" className={linkClass} onClick={handleLinkClick}>
              <IconStudents className="nav__icon" />
              <span>{'Студенты'}</span>
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
            только из локальной сети). Не маршрут React — обычная ссылка в новой вкладке. */}
        {user?.role === 'admin' && (
          <li className="nav__item">
            <a href="/netdiag/" target="_blank" rel="noopener noreferrer" className="nav__link" onClick={handleLinkClick}>
              <IconNetwork className="nav__icon" />
              <span>{'Отчёт о сети'}</span>
            </a>
          </li>
        )}
      </ul>
      {/* «Методика» — методические материалы (педагоги и админы), прижата к низу
          над «Помощью»; оранжевый значок «?!» горит всегда, чтобы пункт выделялся */}
      {user && user.role !== 'student' && (
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