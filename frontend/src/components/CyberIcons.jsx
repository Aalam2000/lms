// CyberIcons.jsx — кибер-панк SVG-иконки для сайдбара (Navigation).
// Монохром: stroke="currentColor", поэтому цвет наследуется от текста
// ссылки — чёрный в обычном состоянии, красный у активного пункта.
// Все иконки: viewBox 24x24, strokeWidth 1.8, острые углы (linecap/linejoin
// square/miter) — стиль Log Academy.
//
// Размер задаётся через CSS-класс .nav__icon в components.css, а не через
// атрибуты width/height — чтобы можно было менять централизованно.

const baseProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'square',
  strokeLinejoin: 'miter',
};

// 1. Главная — сетка с диагоналями (HUD-grid)
export function IconDashboard(props) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <line x1="10" y1="10" x2="14" y2="14" />
      <line x1="14" y1="10" x2="10" y2="14" />
    </svg>
  );
}

// 2. База знаний — серверный стек
export function IconKnowledge(props) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="4" y="4" width="16" height="6" />
      <rect x="4" y="14" width="16" height="6" />
      <line x1="7" y1="7" x2="9" y2="7" />
      <line x1="7" y1="17" x2="9" y2="17" />
    </svg>
  );
}

// 3. Студенты — группа в шестиугольнике
export function IconStudents(props) {
  return (
    <svg {...baseProps} {...props}>
      <polygon points="12,2 21,7 21,17 12,22 3,17 3,7" />
      <circle cx="9" cy="11" r="1.3" />
      <circle cx="15" cy="11" r="1.3" />
      <path d="M6.5 16 C6.5 14 7.5 13 9 13 C10.5 13 11.5 14 11.5 16" />
      <path d="M12.5 16 C12.5 14 13.5 13 15 13 C16.5 13 17.5 14 17.5 16" />
    </svg>
  );
}

// Помощь — круг со знаком вопроса
export function IconHelp(props) {
  return (
    <svg {...baseProps} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5 C9.5 7.5 10.5 7 12 7 C13.5 7 14.5 8 14.5 9.3 C14.5 10.8 13 11.2 12.3 12 C12 12.4 12 12.8 12 13.3" />
      <line x1="12" y1="16.2" x2="12" y2="16.3" />
    </svg>
  );
}

// 3a. Методика — раскрытая книга
export function IconBook(props) {
  return (
    <svg {...baseProps} {...props}>
      <path d="M12 6 L12 20" />
      <path d="M12 6 L4 4 L4 18 L12 20 L20 18 L20 4 Z" />
      <line x1="6.5" y1="8" x2="9.5" y2="8.8" />
      <line x1="6.5" y1="11" x2="9.5" y2="11.8" />
      <line x1="14.5" y1="8.8" x2="17.5" y2="8" />
      <line x1="14.5" y1="11.8" x2="17.5" y2="11" />
    </svg>
  );
}

// 4a. Успеваемость (студент) — столбики по возрастанию
export function IconPerformance(props) {
  return (
    <svg {...baseProps} {...props}>
      <line x1="3" y1="21" x2="21" y2="21" />
      <rect x="5" y="14" width="4" height="7" />
      <rect x="11" y="9" width="4" height="12" />
      <rect x="17" y="4" width="4" height="17" />
    </svg>
  );
}

// 4. Преподы — указка + силуэт в рамке
export function IconTeachers(props) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="4" y="4" width="16" height="16" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="M6 15 C6 12 7.5 11 9 11 C10.5 11 12 12 12 15" />
      <line x1="13" y1="13" x2="19" y2="13" />
    </svg>
  );
}

// 5. Профиль — ID-карта с чипом
export function IconProfile(props) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3" y="5" width="18" height="14" />
      <circle cx="9" cy="11" r="2" />
      <path d="M6 16 C6 14 7.5 13 9 13 C10.5 13 12 14 12 16" />
      <line x1="14" y1="9" x2="19" y2="9" />
      <line x1="14" y1="12" x2="19" y2="12" />
      <line x1="14" y1="15" x2="17" y2="15" />
    </svg>
  );
}

// 6. Админ — терминал с курсором
export function IconAdmin(props) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3" y="4" width="18" height="16" />
      <polyline points="7,9 10,12 7,15" />
      <line x1="12" y1="15" x2="17" y2="15" />
    </svg>
  );
}
// Посещения — пульс в рамке (кто в системе и сколько)
export function IconActivity(props) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="3" y="4" width="18" height="16" />
      <polyline points="5,13 9,13 11,8 13,17 15,11 19,11" />
    </svg>
  );
}

// Сеть: три узла, соединённые линиями (пункт «Отчёт о сети»)
export function IconNetwork(props) {
  return (
    <svg {...baseProps} {...props}>
      <rect x="9" y="3" width="6" height="5" />
      <rect x="3" y="16" width="6" height="5" />
      <rect x="15" y="16" width="6" height="5" />
      <polyline points="12,8 12,12 6,12 6,16" />
      <polyline points="12,12 18,12 18,16" />
    </svg>
  );
}
