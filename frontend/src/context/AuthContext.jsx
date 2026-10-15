import React, { createContext, useState, useContext, useEffect } from 'react';
import { getMe } from '../api/auth';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user,  setUser]  = useState(null);

  // Загружаем пользователя при наличии токена
  useEffect(() => {
    if (token) {
      getMe()
        .then(setUser)
        .catch(() => { logout(); });
    } else {
      setUser(null);
    }
  }, [token]);

  const login = (newToken) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  // Обновить данные пользователя (после сохранения профиля)
  const refreshUser = () => {
    if (token) getMe().then(setUser);
  };

  // Универсальная проверка роли — вместо user.role === 'admin' по всему
  // проекту. Работает для любой роли, включая будущие (экзаменатор,
  // консультант и т.д.) без изменений в самом контексте.
  const hasRole = (...roles) => !!user && roles.includes(user.role);
  // Права пользователя (backend/app/dependencies.py, ROLE_PERMISSIONS): меню и
  // кнопки показываем по праву, а не по имени роли
  const can = (perm) => !!user && (user.permissions || []).includes(perm);

  return (
    <AuthContext.Provider value={{ token, user, login, logout, refreshUser, hasRole, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}