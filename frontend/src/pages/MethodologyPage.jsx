import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { getMethodologyTree, getMethodologyDoc } from '../api/methodology';
import { useLang } from '../hooks/useLang';
import { useInternalLinks } from '../hooks/useInternalLinks';

// «Методика» — методические материалы для педагогов и администраторов.
// Разделы и материалы — папки и .md в backend/templates/methodology
// (см. backend/app/routers/methodology.py); переводы делает autoi18n,
// бэкенд отдаёт нужную языковую версию.
// /dashboard/methodology — список: заголовок и названия материалов
// (синие ссылки во всю ширину страницы, по разделам; пустые разделы не
// показываются). /dashboard/methodology/<раздел>/<материал> — сам материал
// на всю страницу с кнопкой «Назад», которая остаётся наверху при прокрутке.
// На адрес материала можно ссылаться из других материалов и из помощи.
function MethodologyPage() {
  const { section, slug } = useParams();
  const { lang } = useLang();
  const handleLinkClick = useInternalLinks();
  const [tree, setTree] = useState([]);
  const [treeError, setTreeError] = useState('');
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTreeError('');
    getMethodologyTree(lang)
      .then(data => setTree(data.sections || []))
      .catch(err => setTreeError(err?.response?.data?.detail || 'Не удалось загрузить разделы'));
  }, [lang]);

  useEffect(() => {
    if (!section || !slug) {
      setDoc(null);
      return;
    }
    setLoading(true);
    setError('');
    getMethodologyDoc(section, slug, lang)
      .then(setDoc)
      .catch(err => setError(err?.response?.data?.detail || 'Не удалось загрузить материал'))
      .finally(() => setLoading(false));
  }, [section, slug, lang]);

  const filledSections = tree.filter(s => s.materials.length > 0);

  // Материал — на всю страницу; «Назад» прилипает к верху области прокрутки
  if (section && slug) {
    return (
      <div className="page methodology">
        <div className="methodology__back">
          <Link to="/dashboard/methodology" className="btn btn--outline">{'Назад'}</Link>
        </div>
        {loading && <div className="table__empty">{'Загрузка...'}</div>}
        {error && <div className="error-text error-text--muted">{error}</div>}
        {!loading && !error && doc && (
          <article
            className="help-content methodology__content"
            onClick={handleLinkClick}
            dangerouslySetInnerHTML={{ __html: doc.html }}
          />
        )}
      </div>
    );
  }

  // Список материалов
  return (
    <div className="page methodology">
      <h2 className="methodology__heading">{'Методические материалы'}</h2>
      {treeError && <div className="error-text error-text--muted">{treeError}</div>}
      {!treeError && filledSections.length === 0 && (
        <p className="text-muted">{'Материалов пока нет'}</p>
      )}
      {filledSections.map(s => (
        <div key={s.slug} className="methodology__section">
          <div className="methodology__section-title">{s.title}</div>
          <div className="methodology__list">
            {s.materials.map(m => (
              <Link key={m.slug} to={`/dashboard/methodology/${s.slug}/${m.slug}`} className="methodology__link">
                {m.title}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default MethodologyPage;
