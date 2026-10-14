// «Как тебе урок?» — ученик оценивает урок одним из трёх смайликов:
// зелёный (понравилось), жёлтый (нормально), красный (не понравилось).
// Оценить можно начавшийся урок, оценку можно поменять. Педагог отдельных
// оценок не видит — сводка идёт в отчёт по педагогу у админа.
import React, { useEffect, useState } from 'react';
import { getMyLessonFeedback, rateLesson } from '../api/lessons';

const FACES = [
  { rating: 3, cls: 'good', tip: 'Понравилось', mouth: 'M8 14c1.2 1.6 2.5 2.4 4 2.4s2.8-.8 4-2.4' },
  { rating: 2, cls: 'ok', tip: 'Нормально', mouth: 'M8 15h8' },
  { rating: 1, cls: 'bad', tip: 'Не понравилось', mouth: 'M8 16.4c1.2-1.6 2.5-2.4 4-2.4s2.8.8 4 2.4' },
];

function LessonFeedback({ lessonId }) {
  const [state, setState] = useState(null); // {rating, can_rate}
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyLessonFeedback(lessonId)
      .then(data => { if (alive) setState(data); })
      .catch(() => {});
    return () => { alive = false; };
  }, [lessonId]);

  if (!state || !state.can_rate) return null;

  const rate = async (rating) => {
    if (saving || rating === state.rating) return;
    setSaving(true);
    try {
      setState(await rateLesson(lessonId, rating));
    } catch {
      // не сохранилось — оставляем как было, ученик нажмёт ещё раз
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lesson-feedback">
      <span className="lesson-feedback__q">{'Как тебе урок?'}</span>
      <span className="lesson-feedback__faces">
        {FACES.map(f => (
          <button
            key={f.rating}
            type="button"
            className={`lesson-feedback__face lesson-feedback__face--${f.cls}${state.rating === f.rating ? ' lesson-feedback__face--active' : ''}`}
            data-tip={f.tip}
            aria-label={f.tip}
            aria-pressed={state.rating === f.rating}
            disabled={saving}
            onClick={() => rate(f.rating)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="9.5" />
              <circle cx="8.6" cy="9.6" r=".6" fill="currentColor" />
              <circle cx="15.4" cy="9.6" r=".6" fill="currentColor" />
              <path d={f.mouth} />
            </svg>
          </button>
        ))}
      </span>
    </div>
  );
}

export default LessonFeedback;
