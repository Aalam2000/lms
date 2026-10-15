// Проверка роли на уровне маршрута — зеркалит то, что уже проверяет
// бэкенд (require_admin/require_teacher), только раньше: до того как
// страница успеет дёрнуть API и сломаться на ошибке 401/403. Без роли
// в бэкенде эта проверка ничего не защищает сама по себе — данные и так
// защищены там; здесь только про то, что видит пользователь на экране.
import React from 'react';
import { useAuth } from '../context/AuthContext';
import NotFoundPage from '../pages/NotFoundPage';

// perm — право вместо списка ролей (backend/app/dependencies.py, ROLE_PERMISSIONS)
function RoleRoute({ roles, perm, children }) {
  const { hasRole, can } = useAuth();
  if (roles && roles.length && !hasRole(...roles)) {
    return <NotFoundPage />;
  }
  if (perm && !can(perm)) {
    return <NotFoundPage />;
  }
  return children;
}

export default RoleRoute;
