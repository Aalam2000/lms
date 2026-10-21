import React, { useState, useRef, useEffect } from 'react';

// Кастомный дропдаун — триггер в стиле подчёркнутого текста (как .tab--underline),
// панель показывает не больше ~7 строк, дальше появляется скролл.
// Опция с muted — мелким серым (не подходит под фильтр), перед первой такой — черта.
// variant="chip" — триггер чипом (фильтры Базы знаний, LibrarySearch.jsx):
// выбранное значение снимается ✕ на самом чипе.
function Dropdown({ value, onChange, options, placeholder, disabled, variant }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const current = options.find(o => String(o.value) === String(value));
  const label = current ? current.label : placeholder;

  const handleSelect = (v) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className={`${variant === 'chip'
          ? `dropdown__chip${value ? ' dropdown__chip--on' : ''}`
          : `tab tab--underline${value ? ' tab--active' : ''}`}${disabled ? ' dropdown__trigger--disabled' : ''}`}
        onClick={() => !disabled && setOpen(v => !v)}
        disabled={disabled}
      >
        {label}
        {variant === 'chip' && value ? (
          <span
            className="dropdown__clear"
            role="button"
            data-tip={'Снять'}
            onClick={(e) => { e.stopPropagation(); handleSelect(''); }}
          >
            {'✕'}
          </span>
        ) : (
          <span className="dropdown__caret">{'▾'}</span>
        )}
      </button>
      {open && (
        <div className="dropdown__panel">
          <button type="button" className="dropdown__option" onClick={() => handleSelect('')}>
            {placeholder}
          </button>
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              className={`dropdown__option${String(o.value) === String(value) ? ' dropdown__option--active' : ''}${o.muted ? ' dropdown__option--muted' : ''}${o.muted && i > 0 && !options[i - 1].muted ? ' dropdown__option--split' : ''}`}
              onClick={() => handleSelect(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default Dropdown;
