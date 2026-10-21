import React, { useEffect, useState } from 'react';
import { getLibraryItems } from '../api/library';
import { getSectors } from '../api/academy';
import { getCourses } from '../api/groups';
import { attachLessonItem } from '../api/lessons';
import { useAuth } from '../context/AuthContext';
import { resourceKey } from '../utils/libraryItems';
import LibrarySearch, { EMPTY_FILTERS } from './LibrarySearch';
import Modal from './Modal';

// Окно выбора файла/квиза/ссылки из «Базы знаний» для урока — тот же поиск,
// что на странице «База знаний» (components/LibrarySearch.jsx), плюс кнопка
// «Добавить в урок» (и Enter). Уже привязанные к уроку не показываются.
// Открывается на секторе и курсе группы урока; материалы этого урока
// (lessonNo) — первой группой.
//
// onPick(item) — вместо привязки к материалам урока отдать выбранный
// элемент вызывающему (так ДЗ берёт файл из БЗ); onlyType — показывать
// только один тип (для ДЗ — только файлы).
function LibraryPickerModal({ lessonId, attachedKeys, onAttached, onClose, onPick, onlyType, title, sector, courseId, lessonNo }) {
  const { user } = useAuth();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sectors, setSectors] = useState([]);
  const [courses, setCourses] = useState([]);
  const [filters, setFilters] = useState({
    ...EMPTY_FILTERS,
    sector: sector || '',
    course: sector && courseId ? String(courseId) : '',
    type: onlyType || '',
  });
  const [attachingKey, setAttachingKey] = useState(null);
  const [justAttached, setJustAttached] = useState(() => new Set());

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        setItems(await getLibraryItems(onlyType ? { type: onlyType } : {}));
      } catch (err) {
        setError(err?.response?.data?.detail || 'Не удалось загрузить базу знаний');
      } finally {
        setLoading(false);
      }
    };
    load();
    getSectors().then(setSectors).catch(() => setSectors([]));
    getCourses().then(setCourses).catch(() => setCourses([]));
  }, [onlyType]);

  const handleAttach = async (item) => {
    const key = resourceKey(item.resource_type, item.id);
    if (attachingKey) return;
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

  const preferredPath = sector && courseId && lessonNo ? `${sector}/${courseId}/L${lessonNo}` : null;

  return (
    <Modal title={title || 'Добавить из базы знаний'} onClose={onClose} size="xwide">
      {error && <div className="error-text error-text--muted">{error}</div>}
      <LibrarySearch
        items={visibleItems}
        loading={loading}
        filters={filters}
        onFiltersChange={setFilters}
        sectors={sectors}
        courses={courses}
        userId={user?.id}
        preferredPath={preferredPath}
        lockType={!!onlyType}
        autoFocus
        onActivate={handleAttach}
        activateHint={'добавить в урок'}
        renderActions={(item) => (
          <button
            type="button"
            className="btn"
            onClick={() => handleAttach(item)}
            disabled={attachingKey === resourceKey(item.resource_type, item.id)}
          >
            {attachingKey === resourceKey(item.resource_type, item.id) ? 'Добавляем...' : 'Добавить в урок'}
          </button>
        )}
      />
    </Modal>
  );
}

export default LibraryPickerModal;
