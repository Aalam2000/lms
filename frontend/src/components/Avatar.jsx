// Фото пользователя в кружке; фото нет — инициалы на светлом фоне.
// Фото отдаётся только с токеном (GET /auth/photo/{id}), поэтому грузится как
// blob (api/auth.js → getPhotoSrc). Готовые адреса держатся в памяти по
// photo_url: в списках одно фото не грузится дважды, а новое фото (у него
// другой photo_url) подтягивается само.
// size: xs — строки таблиц и бейджи, sm — шапка, md — карточки, lg — профиль.
// Наведение мышью на фото (не lg, не инициалы, только где есть мышь) — через
// ZOOM_DELAY рядом всплывает увеличенная копия (--avatar-zoom). Она выводится
// поверх страницы (portal в body), поэтому таблицы с прокруткой и окна её не
// обрезают; у края экрана встаёт с другой стороны.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPhotoSrc } from '../api/auth';

const ZOOM_DELAY = 300;  // мс — чтобы при движении мыши по таблице фото не мигали
const ZOOM_GAP = 8;      // px — отступ копии от фото и от краёв экрана

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

const canHover = () => window.matchMedia?.('(hover: hover)').matches;

function AvatarZoom({ src, anchor }) {
  const ref = useRef(null);

  // Место копии: справа от фото, по центру по высоте; не влезает — слева;
  // по высоте прижимается к экрану. Координаты — CSS-переменными.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = anchor.getBoundingClientRect();
    const size = el.getBoundingClientRect().width;
    let left = r.right + ZOOM_GAP;
    if (left + size > window.innerWidth - ZOOM_GAP) left = r.left - ZOOM_GAP - size;
    const top = Math.min(
      Math.max(r.top + r.height / 2 - size / 2, ZOOM_GAP),
      window.innerHeight - ZOOM_GAP - size,
    );
    el.style.setProperty('--zoom-left', `${Math.max(left, ZOOM_GAP)}px`);
    el.style.setProperty('--zoom-top', `${top}px`);
    el.classList.add('avatar-zoom--shown');
  }, [anchor]);

  return createPortal(<img ref={ref} className="avatar-zoom" src={src} alt="" />, document.body);
}

function Avatar({ userId, photoUrl, name, size = 'md', className = '' }) {
  const [src, setSrc] = useState(null);
  const [zoomAnchor, setZoomAnchor] = useState(null);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (userId && photoUrl) {
      getPhotoSrc(userId, photoUrl).then(url => { if (alive) setSrc(url); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [userId, photoUrl]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const cls = `avatar avatar--${size}${className ? ` ${className}` : ''}`;
  if (!src) return <span className={`${cls} avatar--initials`} aria-label={name || ''}>{initials(name)}</span>;

  const zoomable = size !== 'lg';
  const onEnter = (e) => {
    if (!zoomable || !canHover()) return;
    const el = e.currentTarget;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setZoomAnchor(el), ZOOM_DELAY);
  };
  const onLeave = () => {
    clearTimeout(timer.current);
    setZoomAnchor(null);
  };

  return (
    <>
      <img className={cls} src={src} alt={name || ''} onMouseEnter={onEnter} onMouseLeave={onLeave} />
      {zoomAnchor && <AvatarZoom src={src} anchor={zoomAnchor} />}
    </>
  );
}

export default Avatar;
