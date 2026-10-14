// «Помощник» редактора квиза — без трат на API: собирает готовый промпт,
// педагог сам отдаёт его любому ИИ, вставляет ответ (JSON) обратно, и
// квиз заполняется целиком (всегда «Заменить» — квиз делается заново).
import React, { useEffect, useState } from 'react';
import { getLessonItems } from '../api/lessons';
import { getMaterialText } from '../api/materials';

const LANG_NAMES = { ru: 'русский', az: 'азербайджанский', en: 'английский' };

// Файлы урока, из которых сервер умеет достать текст (backend app/text_extract.py)
const TEXT_EXT = /\.(docx|pptx|pdf|txt|md)$/i;
const MATERIALS_LIMIT = 40000; // всего символов материалов в промпте

const FORMATS = {
  flash: {
    kind: 'квиз «вопрос — ответ» для показа на проекторе: ведущий показывает вопрос, дети отвечают устно, затем показывается правильный ответ',
    rules: [
      'Ответ — короткий: слово, число или одна фраза (до 10 слов).',
    ],
    example: (t) => `{"title":"Название квиза","topic":"Тема","questions":[{"question":"Текст вопроса?","answer":"Короткий ответ","time":${t}}]}`,
  },
  live: {
    kind: 'квиз с выбором ответа (как Kahoot): у каждого вопроса ровно 4 варианта, правильный — один',
    rules: [
      'У каждого вопроса ровно 4 варианта в "options", все разные и правдоподобные.',
      '"correct_index" — номер правильного варианта: 0, 1, 2 или 3. Правильный ответ ставь в разные позиции.',
      'Варианты короткие — до 8 слов.',
    ],
    example: (t) => `{"title":"Название квиза","topic":"Тема","questions":[{"question":"Текст вопроса?","options":["Вариант 1","Вариант 2","Вариант 3","Вариант 4"],"correct_index":2,"time":${t}}]}`,
  },
};

export function buildQuizPrompt({ type, wish, count, time, lang, materials = [] }) {
  const f = FORMATS[type];
  const withMaterials = materials.length > 0;
  return [
    `Ты — методист детской IT-академии (ученики 8–14 лет). Составь ${f.kind}.`,
    '',
    `Задание от преподавателя: ${wish.trim() || '(тема не указана — придумай по названию курса)'}`,
    '',
    `Количество вопросов: ${count}.`,
    `Язык вопросов и ответов: ${LANG_NAMES[lang] || lang}.`,
    `Время на каждый вопрос: ${time} секунд (поле "time").`,
    '',
    'Требования:',
    '- Вопросы короткие и понятные ребёнку, без двусмысленности, каждый проверяет одну мысль.',
    ...f.rules.map(r => `- ${r}`),
    '- Если в задании уже даны вопросы и ответы — используй их (можно слегка поправить формулировки), недостающие придумай сам.',
    ...(withMaterials ? [
      '- Вопросы строй ТОЛЬКО по материалам урока ниже: проверяй главное, что ученик должен понять на этом уроке, а не мелкие детали.',
      '- Если в материалах есть готовый опросник с ответами — опирайся на него.',
    ] : []),
    '',
    ...(withMaterials ? [
      'МАТЕРИАЛЫ УРОКА:',
      ...materials.map(m => `=== ${m.filename}${m.truncated ? ' (текст сокращён)' : ''} ===\n${m.text}`),
      '=== конец материалов ===',
      '',
    ] : []),
    'Ответь ТОЛЬКО одним JSON-объектом — без пояснений, без markdown и без ```. Строго в таком формате:',
    f.example(time),
  ].join('\n');
}

// Разбор ответа ИИ: снимаем ``` обёртку, находим JSON в тексте, проверяем каждый вопрос.
// Возвращает { quiz, errors }: errors — замечания, каждое показывается отдельной
// строкой; если они есть, quiz не возвращается.
export function parseQuizJson(text, type, defaultTime) {
  let raw = (text || '').trim().replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '');
  const start = raw.search(/[[{]/);
  if (start < 0) return { errors: ['В тексте не найден JSON'] };
  const end = Math.max(raw.lastIndexOf('}'), raw.lastIndexOf(']'));
  raw = raw.slice(start, end + 1);
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { errors: [`JSON не читается: ${e.message}`] };
  }
  const list = Array.isArray(data) ? data : data.questions;
  if (!Array.isArray(list) || list.length === 0) return { errors: ['Нет списка вопросов ("questions")'] };

  const errors = [];
  const questions = list.map((q, i) => {
    const n = i + 1;
    const question = String(q?.question ?? '').trim();
    if (!question) errors.push(`вопрос ${n}: пустой текст вопроса`);
    let time = parseInt(q?.time, 10);
    if (Number.isNaN(time) || time < 5) time = defaultTime;
    if (type === 'live') {
      const options = Array.isArray(q?.options) ? q.options.map(o => String(o ?? '').trim()) : [];
      if (options.length !== 4 || options.some(o => !o)) errors.push(`вопрос ${n}: нужно ровно 4 непустых варианта`);
      const ci = Number(q?.correct_index);
      if (!Number.isInteger(ci) || ci < 0 || ci > 3) errors.push(`вопрос ${n}: нет правильного ответа (correct_index 0–3)`);
      return { question, time, options: options.slice(0, 4).concat(['', '', '', '']).slice(0, 4), correct_index: Number.isInteger(ci) ? ci : 0 };
    }
    const answer = String(q?.answer ?? '').trim();
    if (!answer) errors.push(`вопрос ${n}: нет ответа`);
    return { question, time, answer };
  });
  if (errors.length) return { errors };
  return {
    errors,
    quiz: {
      title: Array.isArray(data) ? '' : String(data.title ?? '').trim(),
      topic: Array.isArray(data) ? '' : String(data.topic ?? '').trim(),
      questions,
    },
  };
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}

function QuizHelper({ templateType, lang, lessonId, onFill }) {
  const [wish, setWish] = useState('');
  const [count, setCount] = useState(10);
  const [time, setTime] = useState(templateType === 'live' ? 30 : 60);
  const [qLang, setQLang] = useState(LANG_NAMES[lang] ? lang : 'ru');
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [aiText, setAiText] = useState('');
  // Замечания пользователю — списком, каждое отдельной строкой
  const [errors, setErrors] = useState([]);
  const [done, setDone] = useState('');
  // Файлы урока (квиз создаётся из урока): отмеченные попадут в промпт текстом
  const [lessonFiles, setLessonFiles] = useState([]);
  const [picked, setPicked] = useState({});
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    if (!lessonId) return;
    getLessonItems(lessonId)
      .then(items => {
        const files = items.filter(i => i.resource_type === 'material' && TEXT_EXT.test(i.title || ''));
        setLessonFiles(files);
        setPicked(Object.fromEntries(files.map(f => [f.resource_id, true])));
      })
      .catch(() => setLessonFiles([]));
  }, [lessonId]);

  const makePrompt = async () => {
    setErrors([]);
    setCopied(false);
    const chosen = lessonFiles.filter(f => picked[f.resource_id]);
    const materials = [];
    if (chosen.length) {
      setBuilding(true);
      const perFile = Math.floor(MATERIALS_LIMIT / chosen.length);
      const problems = [];
      for (const f of chosen) {
        try {
          const material = await getMaterialText(f.resource_id, perFile);
          if (material.text.trim()) materials.push(material);
          else problems.push(`«${f.title}»: текста нет (картинки/скан)`);
        } catch (err) {
          const detail = err?.response?.data?.detail;
          problems.push(detail ? `«${f.title}»: ${detail}` : `«${f.title}»: не прочитан`);
        }
      }
      setBuilding(false);
      if (problems.length) setErrors(['Не попали в промпт — такой файл приложите к ИИ вручную:', ...problems]);
    }
    setPrompt(buildQuizPrompt({ type: templateType, wish, count, time, lang: qLang, materials }));
  };

  const copy = async () => {
    try {
      await copyText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErrors(['Не удалось скопировать — выделите текст и скопируйте вручную']);
    }
  };

  const fill = () => {
    setErrors([]);
    setDone('');
    const { quiz, errors: found } = parseQuizJson(aiText, templateType, time);
    if (found.length) {
      setErrors(found);
      return;
    }
    onFill(quiz);
    setDone(`Готово: ${quiz.questions.length} вопросов. Проверьте и нажмите «Сохранить».`);
  };

  return (
    <div className="question-card quiz-helper">
      <h3 className="quiz-helper__title">{'Помощник'}</h3>
      <p className="hint-text">
        {'1) Опишите, что нужно, и соберите промпт. 2) Вставьте его в любой ИИ. 3) Ответ ИИ (JSON) вставьте ниже — квиз заполнится заново.'}
      </p>

      {lessonFiles.length > 0 && (
        <div className="quiz-helper__files">
          <span className="form-label">{'Материалы урока — текст отмеченных файлов войдёт в промпт'}</span>
          {lessonFiles.map(f => (
            <label key={f.resource_id} className="quiz-helper__file">
              <input
                type="checkbox"
                checked={!!picked[f.resource_id]}
                onChange={e => setPicked(prev => ({ ...prev, [f.resource_id]: e.target.checked }))}
              />
              {f.title}
            </label>
          ))}
        </div>
      )}

      <label className="form-label">{'Что нужно: тема, пожелания или готовые вопросы с ответами'}</label>
      <textarea className="input quiz-helper__area" rows={4} value={wish} onChange={e => setWish(e.target.value)} />

      <div className="quiz-helper__row">
        <label className="form-label">
          {'Вопросов'}
          <input type="number" min="1" max="50" className="input input--time" value={count}
            onChange={e => setCount(Math.max(1, parseInt(e.target.value, 10) || 1))} />
        </label>
        <label className="form-label">
          {'Секунд на вопрос'}
          <input type="number" min="5" className="input input--time" value={time}
            onChange={e => setTime(Math.max(5, parseInt(e.target.value, 10) || 5))} />
        </label>
        <label className="form-label">
          {'Язык'}
          <select className="input" value={qLang} onChange={e => setQLang(e.target.value)}>
            {Object.entries(LANG_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button type="button" className="btn" onClick={makePrompt} disabled={building}>
          {building ? 'Читаем файлы...' : 'Собрать промпт'}
        </button>
      </div>

      {prompt && (
        <>
          <label className="form-label">{'Промпт — скопируйте и вставьте в ИИ'}</label>
          <textarea className="input quiz-helper__area quiz-helper__prompt" rows={8} value={prompt} readOnly onFocus={e => e.target.select()} />
          <div>
            <button type="button" className="btn btn--outline" onClick={copy}>{copied ? 'Скопировано' : 'Скопировать'}</button>
          </div>

          <label className="form-label">{'Ответ ИИ (JSON)'}</label>
          <textarea className="input quiz-helper__area" rows={6} value={aiText} onChange={e => setAiText(e.target.value)} />
          <div>
            <button type="button" className="btn" onClick={fill} disabled={!aiText.trim()}>{'Заполнить квиз'}</button>
          </div>
        </>
      )}

      {errors.length > 0 && (
        <div className="error-text">
          {errors.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}
      {done && <div className="hint-text">{done}</div>}
    </div>
  );
}

export default QuizHelper;
