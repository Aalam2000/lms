// Пульс присутствия (claude/presence-plan.md): пока вкладка открыта и
// видна, раз в минуту сообщаем серверу «я здесь». Свёрнутая / скрытая
// вкладка пульс не шлёт — это время в отчёт не попадает. Правила склейки
// сессий и подсчёта времени — на бэкенде (app/routers/presence.py).
import { useEffect } from 'react';
import { sendPresencePing } from '../api/presence';

const PING_INTERVAL_MS = 60 * 1000;

export function usePresencePing(user) {
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return undefined;
    const ping = () => {
      if (document.visibilityState === 'visible') {
        sendPresencePing().catch(() => { /* пульс не критичен — молча пропускаем */ });
      }
    };
    ping();
    const timer = setInterval(ping, PING_INTERVAL_MS);
    document.addEventListener('visibilitychange', ping);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', ping);
    };
  }, [userId]);
}
