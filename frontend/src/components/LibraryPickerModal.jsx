import React, { useEffect, useState } from 'react';
import { getLibraryItems } from '../api/library';
import { attachLessonItem } from '../api/lessons';
import { useAuth } from '../context/AuthContext';
import { TYPE_META, subtypeLabel, resourceKey } from '../utils/libraryItems';
import Modal from './Modal';

// Модалка выбора файла/квиза/ссылки из «Базы знаний» для привязки к
// уроку — та же лента с фильтрами, что и на странице «База знаний»
// (KnowledgeBasePage.jsx), но без удаления и с кнопкой «+» вместо
// строки на удаление. Уже привязанные к уроку элементы не показываются.
//
// onPick(item) — вместо привязки к материалам урока отдать выбранный
// элемент вызывающему (так ДЗ берёт файл из БЗ); onlyType — показывать
// только один тип (для ДЗ — только файлы, без вкладок типов).
function LibraryPickerModal({ lessonId, attachedKeys, onAttached, onClose, onPick, onlyType, title }) {
  const { user } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState(onlyType || '');
  const [onlyMine, setOnlyMine] = useState(false);
  const [sort, setSort] = useState('date');
  const [attachingKey, setAttachingKey] = useState(null);
  const [justAttached, setJustAttached] = useState(() => new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = { sort };
        if (typeFilter) params.type = typeFilter;
        if (onlyMine && user) params.uploader = user.id;
        setItems(await getLibraryItems(params));
      } catch (err) {
        setError(err?.response?.data?.detail || 'Не удалось загрузить базу знаний');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [typeFilter, onlyMine, sort, user]);

  const handleAttach = async (item) => {
    const key = resourceKey(item.resource_type, item.id);
    setAttachingKey(key);
    setError('');
    try {
      if (onPick) {
        await onPick(item);
      } else {
        await attachLessonItem(lessonId, item.resource_type, item.id);
      }
      setJustAttached(prev => new Set(prev).add(key));
      if (onAttached) onAttached();
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось привязать');
    } finally {
      setAttachingKey(null);
    }
  };

  const visibleItems = items.filter(item => {
    const key = resourceKey(item.resource_type, item.id);
    return !(attachedKeys && attachedKeys.has(key)) && !justAttached.has(key);
  });

  return (
    <Modal title={title || 'Добавить из базы знаний'} onClose={onClose} size="xwide">
      <div className="toolbar">
        {!onlyType ? (
          <div className="toolbar__filters">
            <button type="button" className={`tab${typeFilter === '' ? ' tab--active' : ''}`} onClick={() => setTypeFilter('')}>
              {'Все'}
            </button>
            <button type="button" className={`tab${typeFilter === 'material' ? ' tab--active' : ''}`} onClick={() => setTypeFilter('material')}>
              {'Файлы'}
            </button>
            <button type="button" className={`tab${typeFilter === 'link' ? ' tab--active' : ''}`} onClick={() => setTypeFilter('link')}>
              {'Ссылки'}
            </button>
            <button type="button" className={`tab${typeFilter === 'quiz' ? ' tab--active' : ''}`} onClick={() => setTypeFilter('quiz')}>
              {'Квизы'}
            </button>
          </div>
        ) : <div />}
        <div className="toolbar__filters">
          <button type="button" className={`tab${onlyMine ? ' tab--active' : ''}`} onClick={() => setOnlyMine(v => !v)}>
            {'Моё'}
          </button>
          <select className="input" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="date">{'По дате'}</option>
            <option value="title">{'По названию'}</option>
          </select>
        </div>
      </div>

      {error && <div className="error-text error-text--muted">{error}</div>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{'Тип'}</th>
              <th>{'Название'}</th>
              <th>{'Дата'}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="table__empty">{'Загрузка...'}</td></tr>
            ) : visibleItems.length === 0 ? (
              <tr><td colSpan={4} className="table__empty">{'Ничего не найдено'}</td></tr>
            ) : (
              visibleItems.map(item => {
                const meta = TYPE_META[item.resource_type];
                const key = resourceKey(item.resource_type, item.id);
                return (
                  <tr key={key} className={`table__row--${item.resource_type}`}>
                    <td>
                      <span className={`type-badge type-badge--${item.resource_type}`}>
                        {meta.icon} {subtypeLabel(item)}
                      </span>
                    </td>
                    <td>{item.title}</td>
                    <td className="nowrap">{new Date(item.created_at).toLocaleDateString('ru-RU')}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--sm"
                        onClick={() => handleAttach(item)}
                        disabled={attachingKey === key}
                        data-tip="Добавить к уроку"
                      >
                        {attachingKey === key ? '...' : '+'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

export default LibraryPickerModal;
