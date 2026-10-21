import React, { createContext, useState, useContext, useEffect, useRef, useCallback } from 'react';
import { getMe, updatePrefs } from '../api/auth';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user,  setUser]  = useState(null);

  // Загружаем пользователя при наличии токена
  useEffect(() => {
    if (token) {
      getMe()
        .then((me) => { setUser(me); applyProfileLang(me); })
        .catch(() => { logout(); });
    } else {
      setUser(null);
    }
  }, [token]);

  // Настройки пользователя (users.ui_prefs) — всё, что он выбирает в
  // интерфейсе. Читать и менять — через хук hooks/usePref.js. На экране
  // значение меняется сразу; на сервер изменения уходят одним запросом через
  // полсекунды после последнего (щёлканье фильтров не плодит запросы).
  const userRef = useRef(null);
  userRef.current = user;
  const pendingPrefs = useRef({});
  // Пока язык из профиля не применён, смену языка в профиль не пишем — иначе
  // рантайм, загрузившись с языком браузера, перетёр бы язык профиля
  const langReady = useRef(false);
  const prefsTimer = useRef(null);

  const setPref = useCallback((key, value) => {
    const current = userRef.current;
    if (!current) return;
    if ((current.ui_prefs || {})[key] === value) return;
    setUser((u) => (u ? { ...u, ui_prefs: { ...(u.ui_prefs || {}), [key]: value } } : u));
    pendingPrefs.current[key] = value;
    clearTimeout(prefsTimer.current);
    prefsTimer.current = setTimeout(() => {
      const patch = pendingPrefs.current;
      pendingPrefs.current = {};
      updatePrefs(patch).catch(() => { /* не сохранилось — на экране выбор остаётся */ });
    }, 500);
  }, []);

  // Язык интерфейса хранится в профиле (ключ lang); копия в браузере
  // (autoI18nLang) нужна только странице входа. После входа главный — профиль.
  useEffect(() => {
    const onLangChange = (e) => {
      const lang = e && e.detail && e.detail.lang;
      if (lang && langReady.current) setPref('lang', lang);
    };
    window.addEventListener('autoi18nlangchange', onLangChange);
    return () => window.removeEventListener('autoi18nlangchange', onLangChange);
  }, [setPref]);

  function applyProfileLang(me) {
    const lang = me && me.ui_prefs && me.ui_prefs.lang;
    if (!lang) { langReady.current = true; return; }
    const apply = () => {
      const current = (window.autoI18n && window.autoI18n.currentLang) || localStorage.getItem('autoI18nLang') || 'ru';
      if (current !== lang) {
        localStorage.setItem('autoI18nLang', lang);
        if (window.autoI18n && typeof window.autoI18n.setLanguage === 'function') {
          window.autoI18n.setLanguage(lang);
        }
      }
      langReady.current = true;
    };
    if (window.autoI18n) {
      apply();
    } else {
      // Рантайм autoi18n ещё грузится (index.jsx) — применим, когда загрузится
      const script = document.getElementById('autoi18n-runtime');
      if (script) script.addEventListener('load', apply, { once: true });
      else apply();
    }
  }

  const login = (newToken) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  };

  const logout = () => {
    langReady.current = false;
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
    <AuthContext.Provider value={{ token, user, login, logout, refreshUser, hasRole, can, setPref }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}