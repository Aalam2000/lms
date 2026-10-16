// Кто разрешил уведомления (значок колокольчика в списках людей).
// Set id пользователей; ошибка — пустой Set, списки работают как раньше.
import { useEffect, useState } from 'react';
import { getPushUsers } from '../api/push';

export function usePushUsers() {
  const [ids, setIds] = useState(() => new Set());
  useEffect(() => {
    getPushUsers().then(list => setIds(new Set(list))).catch(() => {});
  }, []);
  return ids;
}
