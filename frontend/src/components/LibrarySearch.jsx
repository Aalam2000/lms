// Поиск по Базе знаний — общий для страницы «База знаний» (KnowledgeBasePage)
// и окна «Добавить из базы знаний» в уроке и ДЗ (LibraryPickerModal).
// Строка поиска + чипы-фильтры (сектор, курс, урок, тип, «Моё»), результаты
// сгруппированы по папкам («Урок N», «Общее», «Для всех»), справа — просмотр
// выбранного материала и где он используется. ↑ ↓ — выбор, Enter — onActivate
// (в уроке — добавить, на странице — открыть), Ctrl+K — к строке поиска.
// Папки считаются в utils/libraryItems.js (folderPaths).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Dropdown from './Dropdown';
import { getMaterialFile, getMaterialViewUrl } from '../api/materials';
import { getQuizViewUrl } from '../api/quizzes';
import {
  ALL_FOLDER, folderPaths, courseTitleFromItems, leafLabel, leafOrder, subtypeLabel, resourceKey, formatSize,
  needsPdfPreview,
} from '../utils/libraryItems';
import { IconBadgeFile, IconBadgeQuiz, IconBadgeLink } from './TypeBadgeIcons';

// sector: '' | 'all' | код; course: '' | 'mine' | id; lesson: '' | 'common' | 'L7'
export const EMPTY_FILTERS = { sector: '', course: '', lesson: '', type: '', mine: false };

const PREVIEW_MAX_BYTES = 30 * 1024 * 1024; // больше — без автопросмотра

function pathParts(path) {
  if (path === ALL_FOLDER) return { sector: ALL_FOLDER, course: null, leaf: null };
  const [sector, course, leaf] = path.split('/');
  return { sector, course, leaf };
}

// Подходит ли путь папки под фильтры (skip — фильтр, который не учитываем:
// так считаются числа в пунктах самого фильтра)
function pathOk(path, f, myPairs, skip) {
  const p = pathParts(path);
  if (skip !== 'sector' && f.sector && p.sector !== f.sector) return false;
  if (skip !== 'course' && f.course) {
    if (f.course === 'mine') {
      if (p.sector !== ALL_FOLDER && !(myPairs && myPairs.has(`${p.sector}/${p.course}`))) return false;
    } else if (p.course !== String(f.course)) return false;
  }
  if (skip !== 'lesson' && f.lesson && p.leaf !== f.lesson) return false;
  return true;
}

function itemOk(item, f, query, userId) {
  if (f.type && item.resource_type !== f.type) return false;
  if (f.mine && item.uploaded_by !== userId) return false;
  if (query) {
    const hay = `${item.title || ''} ${item.url || ''} ${item.topic || ''}`.toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

function TypeThumb({ item }) {
  const Icon = item.resource_type === 'quiz' ? IconBadgeQuiz : item.resource_type === 'link' ? IconBadgeLink : IconBadgeFile;
  return (
    <span className={`kbs__thumb kbs__thumb--${item.resource_type}`}>
      <Icon className="kbs__thumb-icon" />
    </span>
  );
}

// Название с подсвеченным совпадением
function Highlight({ text, query }) {
  if (!query) return text;
  const i = text.toLowerCase().indexOf(query);
  if (i < 0) return text;
  return (
    <>
      {text.slice(0, i)}
      <mark className="kbs__mark">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

function formatDay(value) {
  return value ? new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '';
}

// Просмотр самого файла: HTML и квизы — в изолированной рамке (без доступа к
// платформе), PDF и docx/xlsx/pptx (через PDF) — рамкой, картинки, видео, звук
function Preview({ item }) {
  const [view, setView] = useState({ kind: 'loading' });
  const key = resourceKey(item.resource_type, item.id);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    setView({ kind: 'loading' });
    const timer = setTimeout(async () => {
      try {
        if (item.resource_type === 'link') {
          setView({ kind: 'link' });
          return;
        }
        if (item.resource_type === 'quiz') {
          // квиз и HTML — изолированный просмотр по ссылке (api/view.js)
          const url = await getQuizViewUrl(item.id);
          if (!cancelled) setView({ kind: 'frame', url });
          return;
        }
        const ct = item.content_type || '';
        const big = (item.size_bytes || 0) > PREVIEW_MAX_BYTES;
        const pdfLike = ct.includes('pdf') || needsPdfPreview(ct);
        const media = ct.startsWith('image/') || ct.startsWith('video/') || ct.startsWith('audio/');
        const textLike = ct.includes('html') || ct.startsWith('text/');
        if (big || !(pdfLike || media || textLike)) {
          setView({ kind: 'none' });
          return;
        }
        if (ct.includes('html')) {
          const url = await getMaterialViewUrl(item.id);
          if (!cancelled) setView({ kind: 'frame', url });
          return;
        }
        const { blob, type } = await getMaterialFile(item.id, ct);
        if (cancelled) return;
        if (textLike) {
          const text = await blob.text();
          if (!cancelled) setView({ kind: 'text', text });
          return;
        }
        objectUrl = window.URL.createObjectURL(blob);
        const kind = type.startsWith('image/') ? 'image' : type.startsWith('video/') ? 'video'
          : type.startsWith('audio/') ? 'audio' : 'pdf';
        setView({ kind, url: objectUrl });
      } catch {
        if (!cancelled) setView({ kind: 'error' });
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line
  }, [key]);

  if (view.kind === 'frame') return <iframe className="kbs__frame" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" allowFullScreen src={view.url} title={item.title} />;
  if (view.kind === 'pdf') return <iframe className="kbs__frame" src={`${view.url}#navpanes=0&toolbar=0`} title={item.title} />;
  if (view.kind === 'image') return <div className="kbs__frame kbs__frame--center"><img className="kbs__frame-img" src={view.url} alt={item.title} /></div>;
  if (view.kind === 'video') return <div className="kbs__frame kbs__frame--center"><video className="kbs__frame-img" src={view.url} controls /></div>;
  if (view.kind === 'audio') return <div className="kbs__frame kbs__frame--center"><audio src={view.url} controls /></div>;
  if (view.kind === 'text') return <pre className="kbs__frame kbs__frame--text">{view.text}</pre>;
  return (
    <div className="kbs__frame kbs__frame--center kbs__frame--empty">
      <TypeThumb item={item} />
      <span>
        {view.kind === 'loading' ? 'Загрузка...'
          : view.kind === 'link' ? item.url
          : view.kind === 'error' ? 'Не удалось показать файл'
          : 'Просмотр недоступен — откройте файл'}
      </span>
    </div>
  );
}

function LibrarySearch({
  items, loading, filters, onFiltersChange, sectors = [], courses = [], myPairs = null, userId,
  preferredPath = null, lockType = false, autoFocus = false,
  onActivate, activateHint, renderActions, renderExtra, emptyText,
}) {
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState(null);
  const inputRef = useRef(null);
  const rowRefs = useRef({});
  const q = query.trim().toLowerCase();
  const f = filters;
  const setFilter = (patch) => onFiltersChange({ ...f, ...patch });

  // Ctrl+K — к строке поиска откуда угодно
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const pathsByItem = useMemo(() => new Map(items.map(item => [item, folderPaths(item)])), [items]);
  const sectorName = (code) => sectors.find(s => s.code === code)?.name || code || 'Без сектора';
  const courseTitle = (id) => courses.find(c => String(c.id) === String(id))?.title || courseTitleFromItems(items, id);

  // Числа в пунктах фильтра: учитываются все остальные фильтры и поиск
  const facetCounts = (facet, valueOf) => {
    const counts = new Map();
    for (const item of items) {
      if (!itemOk(item, f, q, userId)) continue;
      const values = new Set();
      for (const p of pathsByItem.get(item)) {
        if (pathOk(p, f, myPairs, facet)) {
          const v = valueOf(p);
          if (v) values.add(v);
        }
      }
      for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return counts;
  };

  const sectorCounts = facetCounts('sector', p => pathParts(p).sector);
  const sectorOptions = [...sectorCounts.entries()]
    .sort(([a], [b]) => (a === ALL_FOLDER ? 1 : b === ALL_FOLDER ? -1 : sectorName(a).localeCompare(sectorName(b))))
    .map(([code, count]) => ({ value: code, label: code === ALL_FOLDER ? `Для всех (${count})` : `${sectorName(code)} (${count})` }));

  const courseCounts = facetCounts('course', p => pathParts(p).course);
  const courseOptions = [...courseCounts.entries()]
    .map(([id, count]) => ({ value: id, label: `${courseTitle(id)} (${count})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (myPairs) courseOptions.unshift({ value: 'mine', label: 'Мои курсы' });

  const lessonCounts = facetCounts('lesson', p => pathParts(p).leaf);
  const lessonOptions = [...lessonCounts.entries()]
    .sort(([a], [b]) => leafOrder(a) - leafOrder(b))
    .map(([leaf, count]) => ({
      value: leaf,
      label: leaf === 'common' ? `Общее (${count})` : `Урок ${leaf.slice(1)} (${count})`,
    }));

  const typeOptions = [
    { value: 'material', label: 'Файлы' },
    { value: 'link', label: 'Ссылки' },
    { value: 'quiz', label: 'Квизы' },
  ];

  // Результаты: каждый материал — один раз, в первой подходящей папке
  // (в окне урока — в папке этого урока, если он там есть)
  const groupRank = (path) => {
    if (path === preferredPath) return [0, '', '', 0];
    if (path === ALL_FOLDER) return [2, '', '', 0];
    const p = pathParts(path);
    return [1, sectorName(p.sector), courseTitle(p.course), leafOrder(p.leaf)];
  };
  const compareRank = (a, b) => {
    const ra = groupRank(a);
    const rb = groupRank(b);
    for (let i = 0; i < ra.length; i += 1) {
      if (ra[i] < rb[i]) return -1;
      if (ra[i] > rb[i]) return 1;
    }
    return 0;
  };

  const groups = new Map();
  for (const item of items) {
    if (!itemOk(item, f, q, userId)) continue;
    const ok = pathsByItem.get(item).filter(p => pathOk(p, f, myPairs, null));
    if (!ok.length) continue;
    const path = ok.sort(compareRank)[0];
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push(item);
  }
  const groupList = [...groups.entries()].sort(([a], [b]) => compareRank(a, b));
  for (const [, list] of groupList) list.sort((a, b) => a.title.localeCompare(b.title));
  const courseSet = new Set(groupList.map(([p]) => (p === ALL_FOLDER ? null : p.split('/').slice(0, 2).join('/'))).filter(Boolean));
  const showCourseInGroup = courseSet.size > 1;
  const flat = groupList.flatMap(([, list]) => list);
  const total = flat.length;

  const selected = flat.find(item => resourceKey(item.resource_type, item.id) === selectedKey) || flat[0] || null;
  const selKey = selected ? resourceKey(selected.resource_type, selected.id) : null;

  useEffect(() => {
    const el = selKey && rowRefs.current[selKey];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selKey]);

  const onKeyDown = (e) => {
    if (!flat.length) return;
    const i = Math.max(0, flat.indexOf(selected));
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = flat[Math.min(flat.length - 1, i + 1)];
      setSelectedKey(resourceKey(next.resource_type, next.id));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = flat[Math.max(0, i - 1)];
      setSelectedKey(resourceKey(prev.resource_type, prev.id));
    } else if (e.key === 'Enter' && selected && onActivate && !e.target.closest('.kbs__actions, .kbs__filters, .kbs__info')) {
      e.preventDefault();
      onActivate(selected);
    }
  };

  const groupTitle = (path) => {
    if (path === ALL_FOLDER) return <span>{'Для всех'}</span>;
    const p = pathParts(path);
    return (
      <>
        <span>{leafLabel(p.leaf)}</span>
        {showCourseInGroup && <span className="kbs__group-sub"><span>{courseTitle(p.course)}</span><span>{sectorName(p.sector)}</span></span>}
      </>
    );
  };

  return (
    <div className="kbs" onKeyDown={onKeyDown}>
      <div className="kbs__search">
        <span className="kbs__search-icon">{'⌕'}</span>
        <input
          ref={inputRef}
          className="kbs__input"
          type="search"
          value={query}
          placeholder={'Поиск по названию'}
          onChange={e => { setQuery(e.target.value); setSelectedKey(null); }}
        />
        <span className="kbs__kbd">{'Ctrl K'}</span>
      </div>

      <div className="kbs__filters">
        <Dropdown variant="chip" value={f.sector} placeholder={'Сектор: все'} options={sectorOptions}
          onChange={v => setFilter({ sector: v, course: v === ALL_FOLDER ? '' : f.course, lesson: '' })} />
        <Dropdown variant="chip" value={f.course} placeholder={'Курс: все'} options={courseOptions}
          disabled={f.sector === ALL_FOLDER} onChange={v => setFilter({ course: v, lesson: '' })} />
        <Dropdown variant="chip" value={f.lesson} placeholder={'Урок: все'} options={lessonOptions}
          disabled={f.sector === ALL_FOLDER} onChange={v => setFilter({ lesson: v })} />
        {!lockType && (
          <Dropdown variant="chip" value={f.type} placeholder={'Тип: все'} options={typeOptions}
            onChange={v => setFilter({ type: v })} />
        )}
        <button type="button" className={`dropdown__chip${f.mine ? ' dropdown__chip--on' : ''}`} onClick={() => setFilter({ mine: !f.mine })}>
          {'Моё'}
        </button>
        <span className="kbs__found">{`Найдено: ${total}`}</span>
      </div>

      <div className="kbs__body">
        <div className="kbs__list">
          {loading ? (
            <div className="kbs__empty">{'Загрузка...'}</div>
          ) : total === 0 ? (
            <div className="kbs__empty">{emptyText || 'Ничего не найдено'}</div>
          ) : groupList.map(([path, list]) => (
            <div key={path}>
              <div className="kbs__group">
                <span className="kbs__group-title">{groupTitle(path)}</span>
                <span>{list.length}</span>
              </div>
              {list.map(item => {
                const key = resourceKey(item.resource_type, item.id);
                return (
                  <button
                    key={key}
                    type="button"
                    ref={el => { rowRefs.current[key] = el; }}
                    className={`kbs__row${key === selKey ? ' kbs__row--active' : ''}`}
                    onClick={() => setSelectedKey(key)}
                    onDoubleClick={() => onActivate && onActivate(item)}
                  >
                    <TypeThumb item={item} />
                    <span className="kbs__row-main">
                      <span className="kbs__row-title"><Highlight text={item.title} query={q} /></span>
                      <span className="kbs__row-sub">
                        <span>{subtypeLabel(item)}</span>
                        {item.resource_type === 'material' && <span>{formatSize(item.size_bytes || 0)}</span>}
                        {item.attached_lessons_count > 0 && <span>{`в уроках: ${item.attached_lessons_count}`}</span>}
                      </span>
                    </span>
                    {key === selKey && onActivate && <span className="kbs__kbd">{'Enter'}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="kbs__preview">
          {selected ? (
            <>
              <Preview item={selected} />
              <div className="kbs__info">
                <h3 className="kbs__info-title">{selected.title}</h3>
                <div className="kbs__row-sub">
                  <span>{subtypeLabel(selected)}</span>
                  {selected.resource_type === 'material' && <span>{formatSize(selected.size_bytes || 0)}</span>}
                  <span>{selected.uploaded_by_name || '—'}</span>
                  <span>{formatDay(selected.created_at)}</span>
                </div>
                {renderExtra && renderExtra(selected)}
                <div className="kbs__places">
                  <div className="kbs__places-title">{'Где используется'}</div>
                  {(selected.places || []).length === 0 ? (
                    <div className="kbs__row-sub">{'Пока нигде'}</div>
                  ) : selected.places.map(place => (
                    <div key={place.lesson_id} className="kbs__place">
                      <span>{place.group_name}</span>
                      <span>{place.lesson_no ? `Урок ${place.lesson_no}` : 'Доп. урок'}</span>
                      {place.homework && <span className="badge badge--homework badge--inline">{'ДЗ'}</span>}
                      <span className="kbs__place-date">{formatDay(place.date)}</span>
                    </div>
                  ))}
                </div>
                {renderActions && <div className="kbs__actions">{renderActions(selected)}</div>}
              </div>
            </>
          ) : (
            <div className="kbs__empty">{'Выберите материал слева'}</div>
          )}
        </div>
      </div>

      <div className="kbs__hint">
        <span><span className="kbs__kbd">{'↑ ↓'}</span> {'выбор'}</span>
        {onActivate && <span><span className="kbs__kbd">{'Enter'}</span> {activateHint}</span>}
        <span><span className="kbs__kbd">{'Ctrl K'}</span> {'поиск'}</span>
      </div>
    </div>
  );
}

export default LibrarySearch;
