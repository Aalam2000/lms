// Read-only страница урока для студента — открытые уроки его группы.
// Не переиспользует LessonPage.jsx (та завязана на редактирование
// урока/выставление оценок учителем) — отдельный лёгкий компонент на
// том же API-слое. См. claude/student-lesson-view-plan.md.
import React, { useEffect, useState } from 'react';
import { PersonalBadge } from '../components/PersonalLesson';
import LessonFeedback from '../components/LessonFeedback';
import Avatar from '../components/Avatar';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useBack } from '../hooks/useBack';
import { TYPE_META, formatSize, subtypeLabel, resourceKey, needsPdfPreview, isPresentation, openSlides } from '../utils/libraryItems';
import { extractErrorMessage } from '../utils/errors';
import { useAuth } from '../context/AuthContext';
import StudentHomework from '../components/HomeworkStudent';
import LessonWorkStudent from '../components/LessonWorkStudent';
import StudentGroupsBar from '../components/StudentGroupsBar';
import { DialogThread } from '../components/LessonDialog';
import { getMyHomework, getMessages } from '../api/homework';
import { getMyWork } from '../api/lessonWork';
import { getLesson, getLessonItems } from '../api/lessons';
import { openPendingTab, showMaterialInTab } from '../api/materials';
import { getLessonLiveQuiz } from '../api/quizLive';
import { useHomeworkRefresh } from '../hooks/useHomeworkRefresh';

function StudentLessonPage() {
  const { lessonId } = useParams();
  const navigate = useNavigate();
  const back = useBack();
  const { user } = useAuth();

  const [lesson, setLesson] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Вкладки: Материалы | Работа на уроке | ДЗ | Диалог. Отметки за урок
  // (посещаемость, оценки, звёзды) ученик смотрит в разделе «Успеваемость».
  const [tab, setTab] = useState('materials');
  // Ссылка «Открыть урок» из полосы несданных ДЗ ведёт сразу на вкладку ДЗ (?tab=homework).
  // location.key меняется при каждом переходе — срабатывает и когда урок уже открыт.
  const location = useLocation();
  useEffect(() => {
    const want = new URLSearchParams(location.search).get('tab');
    if (want === 'homework' || want === 'work') setTab(want);
  }, [location.key, location.search]);
  const [items, setItems] = useState([]);
  const [homework, setHomework] = useState({ tasks: [], answer: { status: 'none', files: [] } });
  const [work, setWork] = useState({ status: 'none', files: [], is_locked: false });
  const [newMessages, setNewMessages] = useState(0);
  const [itemsError, setItemsError] = useState('');
  const [openingKey, setOpeningKey] = useState(null);
  // Живой квиз, который педагог запустил в этом уроке: { code, title } или null
  const [liveQuiz, setLiveQuiz] = useState(null);

  // Пока урок открыт — раз в 5 с спрашиваем, не запущен ли квиз: кнопка
  // «Войти в квиз» появляется при запуске и пропадает, когда квиз закрыт
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      getLessonLiveQuiz(lessonId)
        .then(data => { if (!cancelled) setLiveQuiz(data || null); })
        .catch(() => { if (!cancelled) setLiveQuiz(null); });
    };
    check();
    const timer = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [lessonId]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      setItemsError('');
      try {
        const [lessonData, itemsData, hwRes, workRes] = await Promise.all([
          getLesson(lessonId),
          getLessonItems(lessonId),
          getMyHomework(lessonId),
          getMyWork(lessonId),
        ]);
        setLesson(lessonData);
        setItems(itemsData);
        setHomework(hwRes);
        setWork(workRes);
      } catch (err) {
        setError(extractErrorMessage(err, 'Не удалось загрузить урок'));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [lessonId]);

  // Работа на уроке: статус и оценка подтягиваются сами, когда педагог проверит
  useHomeworkRefresh(() => { getMyWork(lessonId).then(setWork).catch(() => {}); });

  // Счётчик на вкладке «Диалог»: сообщения педагога после моего последнего
  const refreshMessagesCount = async () => {
    if (!user) return;
    try {
      const msgs = await getMessages(lessonId, user.id);
      let n = 0;
      for (let i = msgs.length - 1; i >= 0 && !msgs[i].is_mine; i--) n += 1;
      setNewMessages(n);
    } catch {
      setNewMessages(0);
    }
  };

  useEffect(() => {
    refreshMessagesCount();
    // eslint-disable-next-line
  }, [lessonId, user]);

  const pendingHw = ['pending', 'returned'].includes(homework.answer.status) ? 1 : 0;

  // Та же логика открытия файла/ссылки, что в LessonPage.jsx (blob + JWT
  // для файлов, синхронный window.open по клику, чтобы браузер не считал
  // это всплывающим окном не по действию пользователя) — квизы студенту
  // не приходят, бэкенд их уже отфильтровал.
  const handleOpenItem = async (item) => {
    setItemsError('');

    if (item.resource_type === 'link') {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      return;
    }

    if (item.resource_type === 'material' && isPresentation(item.content_type)) {
      openSlides(item.resource_id, item.title);
      return;
    }

    const key = resourceKey(item.resource_type, item.resource_id);
    setOpeningKey(key);
    const win = openPendingTab(needsPdfPreview(item.content_type));
    try {
      await showMaterialInTab(win, item.resource_id, item.content_type);
    } catch (err) {
      if (win) win.close();
      setItemsError(extractErrorMessage(err, 'Не удалось открыть'));
    } finally {
      setOpeningKey(null);
    }
  };

  if (loading) {
    return <div className="page">{'Загрузка...'}</div>;
  }

  if (!lesson) {
    return (
      <div className="page">
        {error || 'Урок не найден'}
      </div>
    );
  }

  const TABS = [
    { key: 'materials', label: 'Материалы', count: 0 },
    { key: 'work', label: 'Работа на уроке', count: work.files.length },
    { key: 'homework', label: 'ДЗ', count: pendingHw },
    { key: 'dialog', label: 'Диалог', count: newMessages },
  ];

  return (
    <div className="page">
      <div className="toolbar">
        <div className="lesson-toolbar__info">
          <button className="btn btn--outline" onClick={() => back('/dashboard')}>
            {'Назад'}
          </button>
          {lesson.group_name && (
            <StudentGroupsBar groups={[{ id: lesson.group_id, name: lesson.group_name, video_url: lesson.group_video_url, telegram_chat_id: lesson.group_telegram, whatsapp: lesson.group_whatsapp }]} />
          )}
          <span className="lesson-toolbar__group">
            <span className="lesson-toolbar__title">{lesson.title}</span>
            {lesson.date ? ` — ${new Date(lesson.date).toLocaleString('ru-RU')}` : ''}
            <PersonalBadge lesson={lesson} />
          </span>
          {/* Педагог, который ведёт урок (GET /lessons/{id} отдаёт его ученику) */}
          {lesson.teacher_name && (
            <span className="person" data-tip={'Урок ведёт этот педагог'}>
              <Avatar userId={lesson.teacher_id} photoUrl={lesson.teacher_photo_url} name={lesson.teacher_name} size="sm" />
              {lesson.teacher_name}
            </span>
          )}
        </div>
        {/* «Как тебе урок?» — три смайлика в строке с «Назад», появляются после начала урока */}
        <LessonFeedback lessonId={lessonId} />
      </div>

      {error && <div className="error-text error-text--muted">{error}</div>}
      {lesson.read_only && (
        <div className="hint-text">{'Вы отчислены из этой группы — урок открыт только для просмотра'}</div>
      )}

      {liveQuiz && !lesson.read_only && (
        <div className="live-quiz-call">
          <span className="live-quiz-call__text">
            <span>{'Педагог запустил квиз'}</span>
            <span className="live-quiz-call__title">{liveQuiz.title}</span>
          </span>
          <button type="button" className="btn btn--pill btn--lg" onClick={() => navigate(`/quiz-live/${liveQuiz.code}`)}>
            {'Войти в квиз'}
          </button>
        </div>
      )}

      <div className="lesson-tabs">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            className={`lesson-tabs__tab${tab === t.key ? ' lesson-tabs__tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count > 0 && <span className="lesson-tabs__count">{t.count}</span>}
          </button>
        ))}
      </div>

      <div className="lesson-tabs__pane">
        {tab === 'materials' && (
          <>
            {itemsError && <div className="error-text error-text--muted">{itemsError}</div>}
            {items.length === 0 ? (
              <p className="text-muted">{'К уроку ничего не привязано'}</p>
            ) : (
              <div className="material-list">
                {items.map(item => {
                  const meta = TYPE_META[item.resource_type];
                  const key = resourceKey(item.resource_type, item.resource_id);
                  return (
                    <div key={key} className={`material-list__row table__row--${item.resource_type}`}>
                      <span className={`type-badge type-badge--${item.resource_type}`}>
                        {meta.icon} {subtypeLabel(item)}
                      </span>
                      {/* Материал просто открывается в новой вкладке */}
                      <button
                        type="button"
                        className="link material-list__title"
                        data-tip="Открыть в новой вкладке"
                        onClick={() => handleOpenItem(item)}
                        disabled={openingKey === key}
                      >
                        {openingKey === key ? `${item.title} — открываем...` : item.title}
                      </button>
                      {item.resource_type === 'material' && (
                        <span className="text-muted nowrap">{formatSize(item.size_bytes || 0)}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {lesson.comment && (
              <div className="lesson-note">
                <b>{'Заметки педагога: '}</b>{lesson.comment}
              </div>
            )}
          </>
        )}

        {tab === 'work' && (
          <LessonWorkStudent lessonId={lessonId} work={work} onUpdated={setWork} />
        )}

        {tab === 'homework' && (
          <StudentHomework lessonId={lessonId} homework={homework} onUpdated={setHomework} />
        )}

        {tab === 'dialog' && user && (
          <DialogThread lessonId={lessonId} studentId={user.id} onChanged={refreshMessagesCount} readOnly={lesson.read_only} />
        )}
      </div>
    </div>
  );
}

export default StudentLessonPage;
