// Кнопка-значок в стиле «HUD-контур»: белый квадрат с чернильной рамкой,
// при наведении заливается (обычная — чёрным, warn — янтарным, danger —
// красным). Подпись — только в мгновенной подсказке (data-tip, см. Tooltip.jsx).
//
// <IconButton icon="archive" tip="Отправить в архив" variant="warn" onClick={...} />
import React from 'react';

const svgProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
  className: 'icon-btn__svg',
};

const ICONS = {
  // Заполнить расписание (действие) — календарь с плюсом. Нарочно не похож
  // на значок вида «Календарь» (calendarView): там сетка дней, здесь «+».
  schedule: (
    <svg {...svgProps}>
      <rect x="3" y="5" width="18" height="16" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="8" y1="3" x2="8" y2="7" />
      <line x1="16" y1="3" x2="16" y2="7" />
      <line x1="12" y1="12.5" x2="12" y2="18.5" />
      <line x1="9" y1="15.5" x2="15" y2="15.5" />
    </svg>
  ),
  // Вид «Таблица» — строки списка
  tableView: (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="16" />
      <line x1="3" y1="9.5" x2="21" y2="9.5" />
      <line x1="3" y1="14.5" x2="21" y2="14.5" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  ),
  // Вид «Календарь» — месяц: сетка дней 3×2 под шапкой
  calendarView: (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="17" />
      <line x1="3" y1="8.5" x2="21" y2="8.5" />
      <rect x="6" y="11" width="2.5" height="2.5" />
      <rect x="10.75" y="11" width="2.5" height="2.5" />
      <rect x="15.5" y="11" width="2.5" height="2.5" />
      <rect x="6" y="15.5" width="2.5" height="2.5" />
      <rect x="10.75" y="15.5" width="2.5" height="2.5" />
      <rect x="15.5" y="15.5" width="2.5" height="2.5" />
    </svg>
  ),
  // Открыть уроки — раскрытый замок
  unlock: (
    <svg {...svgProps}>
      <rect x="4" y="11" width="16" height="10" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
      <line x1="12" y1="15" x2="12" y2="17" />
    </svg>
  ),
  // В архив — ящик
  archive: (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="5" />
      <path d="M5 9v11h14V9" />
      <line x1="10" y1="13" x2="14" y2="13" />
    </svg>
  ),
  // Вернуть из архива — ящик со стрелкой вверх
  restore: (
    <svg {...svgProps}>
      <rect x="3" y="4" width="18" height="5" />
      <path d="M5 9v11h14V9" />
      <polyline points="9.5,16 12,13.5 14.5,16" />
      <line x1="12" y1="13.5" x2="12" y2="18" />
    </svg>
  ),
  // Редактировать — карандаш
  edit: (
    <svg {...svgProps}>
      <path d="M4 20l1-5L16 4l4 4L9 19z" />
      <line x1="13.5" y1="6.5" x2="17.5" y2="10.5" />
    </svg>
  ),
  // Сменить пароль — ключ
  key: (
    <svg {...svgProps}>
      <circle cx="8" cy="15" r="4" />
      <line x1="11" y1="12" x2="20" y2="3" />
      <line x1="17" y1="6" x2="20" y2="9" />
      <line x1="14" y1="9" x2="16" y2="11" />
    </svg>
  ),
  // Сменить роль — две встречные стрелки
  role: (
    <svg {...svgProps}>
      <line x1="4" y1="8" x2="19" y2="8" />
      <polyline points="15.5,4.5 19,8 15.5,11.5" />
      <line x1="20" y1="16" x2="5" y2="16" />
      <polyline points="8.5,12.5 5,16 8.5,19.5" />
    </svg>
  ),
  // Настройки — шестерёнка
  settings: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
    </svg>
  ),
  // QR для регистрации — три угловых квадрата и точки
  qr: (
    <svg {...svgProps}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <path d="M14 14h3v3h-3zM20 14v3M17 20h4M14 20v1" />
    </svg>
  ),
  // Ученики — два человечка
  students: (
    <svg {...svgProps}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M17.5 14.3A4 4 0 0 1 21 18v2" />
    </svg>
  ),
  // Удалить навсегда — корзина
  delete: (
    <svg {...svgProps}>
      <line x1="4" y1="6" x2="20" y2="6" />
      <path d="M9 6V3h6v3" />
      <path d="M6 6l1 15h10l1-15" />
      <line x1="10" y1="10" x2="10" y2="17" />
      <line x1="14" y1="10" x2="14" y2="17" />
    </svg>
  ),
};

// label — короткая подпись рядом со значком (например, число учеников)
function IconButton({ icon, tip, variant, active, disabled, onClick, label, type = 'button' }) {
  const classes = ['icon-btn'];
  if (label !== undefined && label !== null) classes.push('icon-btn--labeled');
  if (variant) classes.push(`icon-btn--${variant}`);
  if (active) classes.push('icon-btn--active');
  return (
    <button
      type={type}
      className={classes.join(' ')}
      data-tip={tip}
      aria-label={tip}
      aria-pressed={active === undefined ? undefined : !!active}
      disabled={disabled}
      onClick={onClick}
    >
      {ICONS[icon]}
      {label !== undefined && label !== null && <span className="icon-btn__label">{label}</span>}
    </button>
  );
}

export default IconButton;
