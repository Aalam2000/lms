import React, { useEffect, useMemo, useState } from 'react';
import { getLibraryItems } from '../api/library';
import { getSectors } from '../api/academy';
import { attachLessonItem } from '../api/lessons';
import { useAuth } from '../context/AuthContext';
import {
  TYPE_META, subtypeLabel, resourceKey, ALL_FOLDER, folderPaths, inFolder, courseTitleFromItems, leafOrder,
} from '../utils/libraryItems';
import Modal from './Modal';

// Модалка выбора файла/квиза/ссылки из «Базы знаний» для привязки к
// уроку — та же лента с фильтрами, что и на странице «База знаний»
// (KnowledgeBasePage.jsx), но без удаления и с кнопкой «+» вместо
// строки на удаление. Уже привязанные к уроку элементы не показываются.
//
// onPick(item) — вместо привязки к материалам урока отдать выбранный
// элемент вызывающему (так ДЗ берёт файл из БЗ); onlyType — показывать
// только один тип (для ДЗ — только файлы, без вкладок типов).
// Папки БЗ — три списка «Сектор / Курс / Урок» (utils/libraryItems.js);
// sector и courseId — группы урока: окно открывается на них.
function LibraryPickerModal({ lessonId, attachedKeys, onAttached, onClose, onPick, onlyType, title, sector, courseId }) {
  const { user } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [typeFilter, setTypeFilter] = useState(onlyType || '');
  const [onlyMine, setOnlyMine] = useState(false);
  const [sort, setSort] = useState('date');
  const [attachingKey, setAttachingKey] = useState(null);
  const [justAttached, setJustAttached] = useState(() => new Set());
  const [sectors, setSectors] = useState([]);
  const [fSector, setFSector] = useState(sector || '');
  const [fCourse, setFCourse] = useState(sector && courseId ? String(courseId) : '');
  const [fLesson, setFLesson] = useState('');

  useEffect(() => {
    getSectors().then(setSectors).catch(() => setSectors([]));
  }, []);

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

  const notAttached = items.filter(item => {
    const key = resourceKey(item.resource_type, item.id);
    return !(attachedKeys && attachedKeys.has(key)) && !justAttached.has(key);
  });
  const pathsOf = useMemo(() => new Map(items.map(item => [item, folderPaths(item)])), [items]);

  // Пункты списка уровня depth внутри папки parent — с числом ресурсов;
  // выбранное значение остаётся в списке, даже если там пусто
  const folderOptions = (parent, depth, selected) => {
    const counts = new Map();
    for (const item of notAttached) {
      const values = new Set();
      for (const p of pathsOf.get(item) || []) {
        if (p === ALL_FOLDER) { if (depth === 0) values.add(ALL_FOLDER); continue; }
        if (inFolder([p], parent)) values.add(p.split('/')[depth]);
      }
      for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    }
    if (selected && !counts.has(selected)) counts.set(selected, 0);
    return [...counts.entries()];
  };
  const sectorName = (code) => sectors.find(sec => sec.code === code)?.name || code || 'Без сектора';
  const sectorOptions = folderOptions('', 0, fSector)
    .sort(([a], [b]) => (a === ALL_FOLDER ? -1 : b === ALL_FOLDER ? 1 : sectorName(a).localeCompare(sectorName(b))));
  const courseOptions = fSector && fSector !== ALL_FOLDER
    ? folderOptions(fSector, 1, fCourse)
      .map(([id, count]) => [id, count, courseTitleFromItems(items, id)])
      .sort((a, b) => a[2].localeCompare(b[2]))
    : [];
  const lessonOptions = fCourse
    ? folderOptions(`${fSector}/${fCourse}`, 2, fLesson).sort(([a], [b]) => leafOrder(a) - leafOrder(b))
    : [];

  const folder = fSector === ALL_FOLDER ? ALL_FOLDER : [fSector, fCourse, fLesson].filter(Boolean).join('/');
  const visibleItems = notAttached.filter(item => inFolder(pathsOf.get(item) || [], folder));
  const totalCount = notAttached.length;

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
          <select className="input" value={fSector} onChange={e => { setFSector(e.target.value); setFCourse(''); setFLesson(''); }}>
            <option value="">{`Сектор: все (${totalCount})`}</option>
            {sectorOptions.map(([code, count]) => (
              <option key={code} value={code}>{code === ALL_FOLDER ? `Для всех (${count})` : `${sectorName(code)} (${count})`}</option>
            ))}
          </select>
          <select className="input" value={fCourse} disabled={!courseOptions.length} onChange={e => { setFCourse(e.target.value); setFLesson(''); }}>
            <option value="">{'Курс: все'}</option>
            {courseOptions.map(([id, count, label]) => (
              <option key={id} value={id}>{`${label} (${count})`}</option>
            ))}
          </select>
          <select className="input" value={fLesson} disabled={!lessonOptions.length} onChange={e => setFLesson(e.target.value)}>
            <option value="">{'Урок: все'}</option>
            {lessonOptions.map(([leaf, count]) => (
              <option key={leaf} value={leaf}>{leaf === 'common' ? `Общее (${count})` : `Урок ${leaf.slice(1)} (${count})`}</option>
            ))}
          </select>
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
