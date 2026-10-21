// Фото пользователя в кружке; фото нет — инициалы на светлом фоне.
// Фото отдаётся только с токеном (GET /auth/photo/{id}), поэтому грузится как
// blob (api/auth.js → getPhotoSrc). Готовые адреса держатся в памяти по
// photo_url: в списках одно фото не грузится дважды, а новое фото (у него
// другой photo_url) подтягивается само.
// size: xs — строки таблиц и бейджи, sm — шапка, md — карточки, lg — профиль.
import React, { useEffect, useState } from 'react';
import { getPhotoSrc } from '../api/auth';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

function Avatar({ userId, photoUrl, name, size = 'md', className = '' }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (userId && photoUrl) {
      getPhotoSrc(userId, photoUrl).then(url => { if (alive) setSrc(url); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [userId, photoUrl]);

  const cls = `avatar avatar--${size}${className ? ` ${className}` : ''}`;
  if (src) return <img className={cls} src={src} alt={name || ''} />;
  return <span className={`${cls} avatar--initials`} aria-label={name || ''}>{initials(name)}</span>;
}

export default Avatar;
