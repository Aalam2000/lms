import React from 'react';

// Поле хранит либо юзернейм публичной группы (@name), либо ссылку-приглашение
// приватной группы (t.me/+xxxxx или t.me/joinchat/xxxxx, либо целиком с https://) —
// у приватной группы в Telegram нет @юзернейма, только invite-ссылка.
export function telegramHref(value) {
  const v = (value || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^t\.me\//i.test(v)) return `https://${v}`;
  return `https://t.me/${v.replace(/^@/, '')}`;
}

// Поле хранит либо номер телефона (личный чат — wa.me принимает только
// цифры), либо готовую ссылку: приглашение в группу
// (https://chat.whatsapp.com/…) или wa.me/… — её открываем как есть.
// Раньше из ссылки вырезались одни цифры и получался несуществующий «номер».
export function whatsappHref(value) {
  const v = (value || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(chat\.whatsapp\.com|wa\.me|api\.whatsapp\.com)\//i.test(v)) return `https://${v}`;
  let digits = v.replace(/\D/g, '');
  // wa.me нужен номер с кодом страны. Старые записи могли сохраниться в местном
  // виде — приводим так же, как бэкенд (backend/app/phones.py): 0XXXXXXXXX →
  // Азербайджан (+994), 8XXXXXXXXXX → Россия (+7).
  if (/^0\d{9}$/.test(digits)) digits = `994${digits.slice(1)}`;
  else if (/^8\d{10}$/.test(digits)) digits = `7${digits.slice(1)}`;
  return digits ? `https://wa.me/${digits}` : null;
}

// Видеоконференция группы — постоянная ссылка (Google Meet и т.п.), открываем как есть.
export function videoHref(value) {
  const v = (value || '').trim();
  return /^https?:\/\//i.test(v) ? v : null;
}

// Один значок контакта: цветной и кликабельный, если значение задано,
// серый с подсказкой «не указан» — если пусто. type: video | telegram | whatsapp | email.
const CONTACT_TYPES = {
  // Залитая видеокамера на синем — чтобы не путалась с зелёным WhatsApp и голубым Telegram
  video: {
    href: videoHref,
    label: 'Видеоконференция',
    emptyTip: 'Видеоконференция не указана',
    className: 'row-icon--video',
    svg: (
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
        <path d="M4.5 6h9A2.5 2.5 0 0 1 16 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 2 15.5v-7A2.5 2.5 0 0 1 4.5 6Zm13 4.3 3.4-2.4c.5-.3 1.1 0 1.1.6v7c0 .6-.6.9-1.1.6l-3.4-2.4v-3.4Z" />
      </svg>
    ),
  },
  telegram: {
    href: telegramHref,
    label: 'Telegram',
    emptyTip: 'Telegram не указан',
    className: 'row-icon--tg',
    svg: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M21.5 3.5 2.7 10.9c-.9.36-.9 1.63.02 1.96l4.53 1.62 1.73 5.6c.24.76 1.22.96 1.74.35l2.55-2.98 4.6 3.5c.7.53 1.7.14 1.87-.73l3.29-15.9c.18-.87-.7-1.55-1.53-1.22Z" />
    </svg>
    ),
  },
  whatsapp: {
    href: whatsappHref,
    label: 'WhatsApp',
    emptyTip: 'WhatsApp не указан',
    className: 'row-icon--wa',
    svg: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
      <path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.5A10 10 0 1 0 12 2Zm4.9 14.1c-.5.6-1.6 1.2-1.8 1.2-.5.1-.9.3-3.1-.6-2.6-1-4.3-3.7-4.4-3.8-.1-.2-1-1.4-1-2.6 0-1.2.7-1.8.9-2.1.2-.3.5-.3.7-.3.2 0 .4 0 .6.5.3.5.8 1.9.9 2 .1.1.1.3 0 .4-.1.1-.1.3-.2.4l-.4.5c-.1.1-.3.3-.1.6.1.3.7 1.2 1.5 1.9 1 .9 1.9 1.3 2.2 1.4.3.2.5.1.6 0 .1-.1.6-.7.8-1 .2-.2.3-.2.6-.1.3.1 1.6.8 1.9.9.3.2.5.3.6.4 0 .1 0 .6-.2 1.2Z" />
    </svg>
    ),
  },
  // Почта — серый конверт, клик открывает письмо (mailto:)
  email: {
    href: (v) => { const x = (v || '').trim(); return x.includes('@') ? `mailto:${x}` : null; },
    label: 'Email',
    emptyTip: 'Email не указан',
    className: 'row-icon--mail',
    svg: (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="14" rx="1" />
        <path d="m3 6 9 7 9-7" />
      </svg>
    ),
  },
};

export function ContactIcon({ type, value }) {
  const meta = CONTACT_TYPES[type];
  const href = meta.href(value);
  if (!href) {
    return (
      <span className={`row-icon ${meta.className} row-icon--disabled`} data-tip={meta.emptyTip}>
        {meta.svg}
      </span>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`row-icon ${meta.className}`}
      data-tip={meta.label}
      aria-label={meta.label}
      onClick={e => e.stopPropagation()}
    >
      {meta.svg}
    </a>
  );
}

// Три значка группы в ряд: видеоконференция, Telegram, WhatsApp — на
// странице группы и урока (педагог, админ) и в плашке группы у ученика.
export function GroupContactIcons({ video, telegram, whatsapp }) {
  return (
    <div className="table__icons">
      <ContactIcon type="video" value={video} />
      <ContactIcon type="telegram" value={telegram} />
      <ContactIcon type="whatsapp" value={whatsapp} />
    </div>
  );
}

// Готовая пара иконок Telegram/WhatsApp для строки таблицы студента —
// ContactIcon сам решает кликабельно или нет.
// WhatsApp ученика — по его телефону: телефон обязателен, значит WhatsApp есть
// у каждого. Отдельное поле «WhatsApp» важнее, если оно заполнено (другой номер).
export function StudentContactIcons({ telegram, whatsapp, phone }) {
  return (
    <div className="table__icons">
      <ContactIcon type="telegram" value={telegram} />
      <ContactIcon type="whatsapp" value={whatsapp || phone} />
    </div>
  );
}
