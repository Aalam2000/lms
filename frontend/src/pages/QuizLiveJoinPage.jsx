import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { getLiveRoster, getLivePlayerState, joinLiveQuiz, answerLiveQuestion } from '../api/quizLive';
import { QUIZ_LIVE_OPTION_STYLES } from '../utils/quizLiveColors';

const POLL_MS = 1500;

function tokenKey(code) {
  return `quizLiveToken:${code}`;
}

function QuizLiveJoinPage() {
  // Оформление в стиле слайдшоу уроков — см. .quiz-theme в components.css
  useEffect(() => {
    document.body.classList.add('quiz-theme');
    return () => document.body.classList.remove('quiz-theme');
  }, []);

  const { code } = useParams();
  const [token, setToken] = useState(() => localStorage.getItem(tokenKey(code)));
  const [roster, setRoster] = useState(null);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [answering, setAnswering] = useState(false);
  const timerRef = useRef(null);

  // Без токена — грузим список ещё не зарегистрированных учеников группы.
  useEffect(() => {
    if (token) return;
    let cancelled = false;
    getLiveRoster(code)
      .then(data => { if (!cancelled) setRoster(data); })
      .catch(err => { if (!cancelled) setError(err?.response?.data?.detail || 'Игра не найдена'); });
    return () => { cancelled = true; };
  }, [code, token]);

  // С токеном (свежим или из localStorage — «автоматом выбирается он же»
  // при перезагрузке вкладки) — опрашиваем своё состояние.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await getLivePlayerState(code, token);
        if (!cancelled) {
          setState(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) {
          localStorage.removeItem(tokenKey(code));
          setError(err?.response?.data?.detail || 'Сессия недействительна');
        }
      }
    };
    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
    };
  }, [code, token]);

  const handleJoin = async (studentId) => {
    setError('');
    try {
      const { token: newToken } = await joinLiveQuiz(code, studentId);
      localStorage.setItem(tokenKey(code), newToken);
      setToken(newToken);
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось зарегистрироваться');
    }
  };

  const handleAnswer = async (optionIndex) => {
    if (answering || !state || state.status !== 'question') return;
    setAnswering(true);
    try {
      await answerLiveQuestion(code, token, state.current_question, optionIndex);
      setState({ ...state, status: 'answered' });
    } catch (err) {
      setError(err?.response?.data?.detail || 'Не удалось ответить');
    } finally {
      setAnswering(false);
    }
  };

  if (error && !state) {
    return <div className="centered-page"><div className="card"><p className="error-text">{error}</p></div></div>;
  }

  if (!token) {
    if (!roster) return <div className="centered-page">{'Загрузка...'}</div>;
    return (
      <div className="centered-page">
        <div className="card">
          <h2 className="card__title">{roster.title}</h2>
          {roster.topic && <p className="card__meta">{roster.topic}</p>}
          <p className="hint-text">{'Выберите своё имя из списка'}</p>
          <div className="quiz-live-roster">
            {roster.available.length === 0 && <p className="text-muted">{'Все уже зарегистрированы'}</p>}
            {roster.available.map(s => (
              <button key={s.id} type="button" className="btn btn--pill" onClick={() => handleJoin(s.id)}>
                {s.full_name}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!state) {
    return <div className="centered-page">{'Загрузка...'}</div>;
  }

  if (state.status === 'waiting') {
    return <div className="centered-page"><div className="card"><p>{'Ожидайте начала...'}</p></div></div>;
  }

  if (state.status === 'answered') {
    return <div className="centered-page"><div className="card"><p>{'Ответ принят, ждите следующий вопрос'}</p></div></div>;
  }

  if (state.status === 'question') {
    return (
      <div className="quiz-live-student-question">
        <p className="text-muted quiz-live-student-question__timer">{`${state.time_left} сек`}</p>
        <p className="quiz-live-student-question__text">{state.question}</p>
        <div className="quiz-live-answer-grid">
          {(state.options || []).map((opt, i) => (
            <button
              key={i}
              type="button"
              className="quiz-live-answer-cell"
              style={{ background: QUIZ_LIVE_OPTION_STYLES[i].color }}
              onClick={() => handleAnswer(i)}
              disabled={answering}
            >
              <span className="quiz-live-option__num">{QUIZ_LIVE_OPTION_STYLES[i].number}</span>
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // finished — личный разбор по каждому вопросу
  return (
    <div className="page">
      <h1 className="page-title">{`Итог: ${state.correct_count} / ${state.total_questions}`}</h1>
      <div className="quiz-live-review">
        {state.review.map(r => (
          <div key={r.index} className={`quiz-live-review-row ${r.correct ? 'quiz-live-review-row--correct' : 'quiz-live-review-row--wrong'}`}>
            <div className="quiz-live-review-row__q">{`${r.index + 1}. ${r.question}`}</div>
            <div className="quiz-live-review-row__a">{r.correct_option}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default QuizLiveJoinPage;
