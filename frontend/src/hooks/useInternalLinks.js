import { useCallback } from 'react';
import { useNavigate } from 'react-router';

// Клик по ссылкам внутри HTML, отрисованного из Markdown (помощь, методика).
// Ссылки на разделы приложения — относительные пути (/dashboard/...):
// одинаково работают на деве и на проде; переход — без перезагрузки
// страницы. Внешние ссылки (http...) открываются в новой вкладке.
export function useInternalLinks() {
  const navigate = useNavigate();
  return useCallback((e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('/') && !href.startsWith('//')) {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(href);
    } else if (/^https?:/i.test(href)) {
      e.preventDefault();
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }, [navigate]);
}
