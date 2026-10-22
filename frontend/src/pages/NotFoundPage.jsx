// Страница «404 / доступа нет» — показывается и для несуществующих
// маршрутов, и когда роль пользователя не соответствует запрошенной
// странице (зеркалит проверку роли, которая уже есть на бэкенде).
import React from 'react';
import { Link } from 'react-router';
import Button from '../components/Button';

function NotFoundPage() {
  return (
    <div className="notfound">
      <h1 className="notfound__code">{'404'}</h1>
      <p className="notfound__text">{'Страница не найдена или недоступна для вашей роли'}</p>
      <Link to="/dashboard" className="no-underline">
        <Button>{'На главную'}</Button>
      </Link>
    </div>
  );
}

export default NotFoundPage;
