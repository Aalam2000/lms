import React, { useEffect, useState } from 'react';
import { getHelp } from '../api/help';
import { useLang } from '../hooks/useLang';
import { useInternalLinks } from '../hooks/useInternalLinks';

// «Помощь» — обычная страница в правой части, как остальные разделы.
// Инструкция по роли пользователя: backend/app/routers/help.py выбирает
// файл по current_user.role, текст в backend/templates/help/*.md,
// переводится на бэкенде (lang).
function HelpPage() {
  const { lang } = useLang();
  const handleLinkClick = useInternalLinks();
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    getHelp(lang)
      .then(data => setHtml(data.html))
      .catch(err => setError(err?.response?.data?.detail || 'Не удалось загрузить инструкцию'))
      .finally(() => setLoading(false));
  }, [lang]);

  return (
    <div className="page help-page">
      {loading && <div className="table__empty">{'Загрузка...'}</div>}
      {error && <div className="error-text error-text--muted">{error}</div>}
      {!loading && !error && <div className="help-content" onClick={handleLinkClick} dangerouslySetInnerHTML={{ __html: html }} />}
    </div>
  );
}

export default HelpPage;
