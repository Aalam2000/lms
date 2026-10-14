import React, { useEffect, useState } from 'react';
import { getHelp } from '../api/help';
import { useLang } from '../hooks/useLang';

// Панель справа с инструкцией для текущей роли пользователя (см.
// backend/app/routers/help.py — файл выбирается по current_user.role,
// текст лежит в backend/templates/help/*.md; перевод — готовый файл
// рядом с исходником (teacher.en.md), бэкенд отдаёт его как HTML).
function HelpPanel({ onClose }) {
  const { lang } = useLang();
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
    <div className="help-panel-backdrop" onClick={onClose}>
      <div className="help-panel" onClick={e => e.stopPropagation()}>
        <div className="help-panel__header">
          <h3 className="modal-title">{'Помощь'}</h3>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onClose}>
            {'Закрыть'}
          </button>
        </div>
        {loading && <div className="table__empty">{'Загрузка...'}</div>}
        {error && <div className="error-text error-text--muted">{error}</div>}
        {!loading && !error && (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}

export default HelpPanel;
