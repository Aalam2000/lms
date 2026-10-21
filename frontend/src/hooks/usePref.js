// Настройка пользователя из профиля (users.ui_prefs) — как useState, но
// выбор сохраняется на сервере и одинаков на всех устройствах.
// Ключ — «страница.настройка»: usePref('groups.view', 'table').
import { useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export function usePref(key, defaultValue) {
  const { user, setPref } = useAuth();
  const stored = user && user.ui_prefs ? user.ui_prefs[key] : undefined;
  const value = stored === undefined ? defaultValue : stored;
  const setValue = useCallback(
    (next) => setPref(key, typeof next === 'function' ? next(value) : next),
    [key, value, setPref],
  );
  return [value, setValue];
}
