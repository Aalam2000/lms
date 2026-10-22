import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useLang } from '../hooks/useLang';
import Button from '../components/Button';
import { getQuizForEdit, createQuiz, updateQuiz } from '../api/quizzes';
import { attachLessonItem } from '../api/lessons';
import QuizHelper from '../components/QuizHelper';

const blankFlashQuestion = () => ({ question: '', time: 60, answer: '' });
const blankLiveQuestion = () => ({ question: '', time: 60, options: ['', '', '', ''], correct_index: 0 });

function blankQuestionFor(templateType) {
  return templateType === 'live' ? blankLiveQuestion() : blankFlashQuestion();
}

function AddQuizPage() {
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [templateType, setTemplateType] = useState('flash');
  const [questions, setQuestions] = useState([blankFlashQuestion()]);
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();
  const { id } = useParams();
  // Новый квиз (особенно из урока) — Помощник открыт сразу; при правке — свёрнут
  const [helperOpen, setHelperOpen] = useState(!id);
  const [searchParams] = useSearchParams();
  const lessonId = searchParams.get('lessonId');
  const { lang } = useLang();

  // Куда возвращаться после сохранения/отмены: если пришли из урока — назад
  // в урок (квиз уже будет привязан), иначе — в «Базу знаний» (страница
  // «Квизы» больше не используется, всё собрано там).
  const returnPath = lessonId ? `/dashboard/lessons/${lessonId}` : '/dashboard/materials';

  // console.log('🌐 Текущий язык в AddQuizPage:', lang);

  useEffect(() => {
    if (id) {
      const fetchQuiz = async () => {
        try {
          const quiz = await getQuizForEdit(id);
          setTitle(quiz.title);
          setTopic(quiz.topic || '');
          const loadedType = quiz.template_type || 'flash';
          setTemplateType(loadedType);
          if (quiz.questions && quiz.questions.length > 0) {
            const loadedQuestions = quiz.questions.map(q => ({
              ...q,
              time: typeof q.time === 'number' ? q.time : parseInt(q.time, 10) || 60
            }));
            setQuestions(loadedQuestions);
          } else {
            setQuestions([blankQuestionFor(loadedType)]);
          }
        } catch (err) {
          alert('Ошибка загрузки квиза');
          navigate('/dashboard/materials');
        }
      };
      fetchQuiz();
    }
  }, [id, navigate]);

  const handleTemplateTypeChange = (value) => {
    setTemplateType(value);
    setQuestions([blankQuestionFor(value)]);
  };

  const addQuestion = () => {
    setQuestions([...questions, blankQuestionFor(templateType)]);
  };

  const removeQuestion = (index) => {
    if (questions.length === 1) return;
    setQuestions(questions.filter((_, i) => i !== index));
  };

  const handleQuestionChange = (index, field, value) => {
    setQuestions(prev => {
      const updated = [...prev];
      if (field === 'time') {
        const num = parseInt(value, 10);
        updated[index] = { ...updated[index], time: isNaN(num) ? 60 : num };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  };

  const handleOptionChange = (qIndex, optIndex, value) => {
    setQuestions(prev => {
      const updated = [...prev];
      const options = [...updated[qIndex].options];
      options[optIndex] = value;
      updated[qIndex] = { ...updated[qIndex], options };
      return updated;
    });
  };

  const handleCorrectIndexChange = (qIndex, optIndex) => {
    setQuestions(prev => {
      const updated = [...prev];
      updated[qIndex] = { ...updated[qIndex], correct_index: optIndex };
      return updated;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) { alert('Введите название'); return; }
    if (templateType === 'live') {
      if (questions.some(q => !q.question.trim() || (q.options || []).some(o => !o.trim()))) {
        alert('Все вопросы и все 4 варианта ответа должны быть заполнены');
        return;
      }
    } else if (questions.some(q => !q.question.trim() || !(q.answer || '').trim())) {
      alert('Все вопросы и ответы должны быть заполнены');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        title,
        topic,
        template_type: templateType,
        questions,
        lang,  // <-- передаём текущий язык
      };

      if (id) {
        await updateQuiz(id, payload);
      } else {
        const created = await createQuiz(payload);
        // Привязка к уроку — отдельным шагом через lesson_resources
        // (у квиза больше нет собственного lesson_id, см. resources.py).
        if (lessonId) {
          await attachLessonItem(lessonId, 'quiz', created.id);
        }
      }
      navigate(returnPath);
    } catch (err) {
      console.error('❌ Ошибка сохранения:', err.response?.data || err.message);
      alert('Ошибка сохранения');
      setLoading(false);
    }
  };

  return (
    <div className="page page--wide">
      <h1 className="page-title">{id ? 'Редактировать квиз' : 'Создать новый квиз'}</h1>
      {!id && lessonId && (
        <p className="hint-text">{'Квиз будет автоматически привязан к этому уроку.'}</p>
      )}
      <form onSubmit={handleSubmit} className="form-stack">
        <label className="form-label">{'Название'}</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="input input--lg" required />

        <label className="form-label">{'Тема'}</label>
        <input type="text" value={topic} onChange={e => setTopic(e.target.value)} className="input input--lg" />

        <label className="form-label">Тип квиза</label>
        <select value={templateType} onChange={e => handleTemplateTypeChange(e.target.value)} className="input input--lg">
          <option value="flash">Flash (вопрос-ответ)</option>
          <option value="live">Live (голосование)</option>
        </select>

        <div>
          <Button type="button" onClick={() => setHelperOpen(v => !v)} variant="secondary" className="btn--pill">
            {helperOpen ? 'Скрыть помощника' : '🪄 Помощник'}
          </Button>
        </div>
        {helperOpen && (
          <QuizHelper
            key={templateType}
            templateType={templateType}
            lang={lang}
            lessonId={lessonId}
            onFill={({ title: t, topic: tp, questions: qs }) => {
              // Всегда «Заменить»: квиз собирается заново из ответа ИИ
              if (t) setTitle(t);
              if (tp) setTopic(tp);
              setQuestions(qs);
            }}
          />
        )}

        <div className="questions-header">
          <h3>{'Вопросы'}</h3>
          <Button type="button" onClick={addQuestion} className="btn--pill">+ {'Добавить вопрос'}</Button>
        </div>

        {templateType === 'live' ? (
          questions.map((q, index) => (
            <div key={index} className="question-card">
              <div className="question-row">
                <input
                  type="text"
                  placeholder={'Вопрос'}
                  value={q.question}
                  onChange={(e) => handleQuestionChange(index, 'question', e.target.value)}
                  className="input input--lg input--grow"
                  required
                />
                <input
                  type="number"
                  placeholder={'Время (сек)'}
                  value={q.time}
                  onChange={(e) => handleQuestionChange(index, 'time', e.target.value)}
                  className="input input--lg input--time"
                  min="5"
                  required
                />
                <Button type="button" onClick={() => removeQuestion(index)} variant="danger" className="btn--icon-circle">✕</Button>
              </div>
              <div className="question-options-grid">
                {(q.options || ['', '', '', '']).map((opt, optIndex) => (
                  <label key={optIndex} className="question-option-row">
                    <input
                      type="radio"
                      name={`correct-${index}`}
                      checked={q.correct_index === optIndex}
                      onChange={() => handleCorrectIndexChange(index, optIndex)}
                    />
                    <input
                      type="text"
                      placeholder={`Вариант ${optIndex + 1}`}
                      value={opt}
                      onChange={(e) => handleOptionChange(index, optIndex, e.target.value)}
                      className="input input--lg input--grow"
                      required
                    />
                  </label>
                ))}
              </div>
            </div>
          ))
        ) : (
          questions.map((q, index) => (
            <div key={index} className="question-card">
              <div className="question-row">
                <input
                  type="text"
                  placeholder={'Вопрос'}
                  value={q.question}
                  onChange={(e) => handleQuestionChange(index, 'question', e.target.value)}
                  className="input input--lg input--grow"
                  required
                />
                <input
                  type="number"
                  placeholder={'Время (сек)'}
                  value={q.time}
                  onChange={(e) => handleQuestionChange(index, 'time', e.target.value)}
                  className="input input--lg input--time"
                  min="5"
                  required
                />
                <input
                  type="text"
                  placeholder={'Ответ'}
                  value={q.answer}
                  onChange={(e) => handleQuestionChange(index, 'answer', e.target.value)}
                  className="input input--lg input--grow"
                  required
                />
                <Button type="button" onClick={() => removeQuestion(index)} variant="danger" className="btn--icon-circle">✕</Button>
              </div>
            </div>
          ))
        )}

        <div className="form-actions">
          <Button type="submit" className="btn--pill" disabled={loading}>
            {loading ? 'Сохранение...' : 'Сохранить'}
          </Button>
          <Button type="button" onClick={() => navigate(returnPath)} variant="secondary" className="btn--pill">
            {'Отмена'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default AddQuizPage;
