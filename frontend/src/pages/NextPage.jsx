// /dashboard/next — сюда ведёт нажатие на любое уведомление платформы (public/sw.js).
// Сервер говорит, с какого урока начинать сейчас (самое давнее необработанное,
// backend/app/notify.py); переход без записи в историю браузера.
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { getNextPath } from '../api/push';

function NextPage() {
  const navigate = useNavigate();
  useEffect(() => {
    let alive = true;
    getNextPath()
      .then(path => { if (alive) navigate(path, { replace: true }); })
      .catch(() => { if (alive) navigate('/dashboard', { replace: true }); });
    return () => { alive = false; };
  }, [navigate]);
  return <p className="text-muted">{'Загрузка...'}</p>;
}

export default NextPage;
