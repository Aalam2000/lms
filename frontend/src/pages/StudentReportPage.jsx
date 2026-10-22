// Отчёт по ученику за период — для родителей («Студенты» → имя ученика;
// из урока — имя ученика в журнале). Устроен как отчёт по педагогу: вывод одной
// фразой, период в цифрах, показатели с оценкой, главное и уроки. Цифры, статусы и
// нормы считает бэкенд (backend/app/student_report.py), формулировки — здесь.
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { getStudentReport } from '../api/students';
import { extractErrorMessage } from '../utils/errors';
import Avatar from '../components/Avatar';
import { ReportPeriod, ReportToolbar, Status, defaultPeriod, periodParams, withSign } from '../components/ReportParts';

const pad = (n) => String(n).padStart(2, '0');
// «05.09» — день и месяц урока
const shortDate = (value) => {
  const d = new Date(value);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
};
const datesOf = (lessons) => lessons.map(l => shortDate(l.date)).join(', ');

// Строки «Как идут дела»: вопрос, пояснение, значение «сейчас» и ориентир
function indicatorRow(ind, norms, lessons) {
  switch (ind.key) {
    case 'attendance': {
      const missed = lessons.filter(l => l.attendance === 'absent');
      return {
        q: 'Ходит ли на уроки?',
        hint: missed.length > 0
          ? <>{'Пропущены уроки'}: {datesOf(missed)}</>
          : 'Пропуски по уважительной причине и закрытые дополнительным уроком не считаются',
        value: ind.total ? <>{ind.present} {'из'} {ind.total}</> : '—',
        norm: 'без пропусков',
      };
    }
    case 'late':
      return {
        q: 'Приходит ли вовремя?',
        hint: 'Сколько раз за период опоздал',
        value: ind.status === 'none' ? '—' : ind.count > 0 ? <>{'опозданий'}: {ind.count}</> : 'опозданий нет',
        norm: 'без опозданий',
      };
    case 'lesson_score':
      return {
        q: 'Как работает на уроке?',
        hint: 'Средняя оценка педагога за работу на уроке, от 0 до 100',
        value: ind.avg ?? '—',
        norm: <>{'от'} {norms.lesson_score}</>,
      };
    case 'hw_submitted': {
      const missed = lessons.filter(l => l.hw_status === 'expired');
      const returned = lessons.filter(l => l.hw_status === 'returned');
      return {
        q: 'Сдаёт ли домашние задания?',
        hint: missed.length > 0
          ? <>{'Не сдано, срок прошёл'}: {datesOf(missed)}</>
          : returned.length > 0
            ? <>{'Вернули на доработку'}: {datesOf(returned)}</>
            : 'Задания, срок которых ещё не прошёл, не считаются',
        value: ind.total ? <>{ind.done} {'из'} {ind.total}</> : '—',
        norm: 'все сданы',
      };
    }
    case 'hw_score':
      return {
        q: 'Как выполняет домашние задания?',
        hint: 'Средняя оценка за проверенные задания, от 0 до 100',
        value: ind.avg ?? '—',
        norm: <>{'от'} {norms.hw_score}</>,
      };
    case 'exam':
      return {
        q: 'Как сдаёт экзамены?',
        hint: <>{'Средний балл экзаменов за период.'}{ind.prev != null && <> {'В прошлом месяце было'} {ind.prev}</>}</>,
        value: ind.avg != null ? <>{ind.avg}{ind.delta != null && <> ({withSign(ind.delta)})</>}</> : '—',
        norm: <>{'от'} {norms.exam}</>,
      };
    default:
      return null;
  }
}

// Посещение урока: точка и подпись
function Attendance({ lesson }) {
  const status = lesson.attendance;
  if (!status) return <span className="text-muted">{'—'}</span>;
  const dot = status === 'absent' ? 'bad' : (status === 'excused' || status === 'made_up') ? 'none' : 'good';
  return (
    <>
      <span className={`report__dot report__dot--${dot}`} />
      {status === 'in_person' ? 'был' : status === 'online' ? 'онлайн' : status === 'excused' ? 'уважительная причина' : status === 'made_up' ? 'пропуск закрыт доп. уроком' : 'пропуск'}
      {lesson.is_late && <>{', '}{'опоздал'}</>}
    </>
  );
}

// Домашнее задание урока: что с ним сейчас
function Homework({ lesson }) {
  switch (lesson.hw_status) {
    case 'graded': return <>{'оценка'} {lesson.hw_grade}</>;
    case 'accepted': return <>{'принято'}</>;
    case 'submitted': return <>{'на проверке'}</>;
    case 'returned': return <><span className="report__dot report__dot--warn" />{'вернули на доработку'}</>;
    case 'expired': return <><span className="report__dot report__dot--bad" />{'не сдано'}</>;
    case 'pending': return <span className="text-muted">{'срок не прошёл'}</span>;
    default: return <span className="text-muted">{'не задано'}</span>;
  }
}

function StudentReportPage() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  // Откуда пришли (журнал урока передаёт свой адрес) — туда и «Назад»
  const backTo = useLocation().state?.from || '/dashboard/students';
  const [period, setPeriod] = useState(defaultPeriod);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    getStudentReport(studentId, periodParams(period))
      .then(data => { if (alive) setReport(data); })
      .catch(err => { if (alive) setError(extractErrorMessage(err, 'Не удалось построить отчёт')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [studentId, period]);

  const isMonth = report?.period?.kind === 'month'; // у месячного отчёта свои формулировки
  const lessons = report?.lessons || [];
  const byKey = Object.fromEntries((report?.indicators || []).map(i => [i.key, i]));
  const weak = (report?.indicators || []).filter(i => i.status === 'warn' || i.status === 'bad');
  const hasExams = lessons.some(l => l.exam_score != null);

  // Главное за период — собирается из тех же данных, что и таблицы
  const threeStars = lessons.filter(l => l.stars === 3);
  const absent = lessons.filter(l => l.attendance === 'absent');
  const hwExpired = lessons.filter(l => l.hw_status === 'expired');
  const hwReturned = lessons.filter(l => l.hw_status === 'returned');
  const examUp = byKey.exam?.delta > 0;
  const noAbsences = byKey.attendance?.total > 0 && byKey.attendance.absent === 0;
  const noLate = byKey.late && byKey.late.status !== 'none' && byKey.late.count === 0;
  const allHomework = byKey.hw_submitted?.total > 0 && byKey.hw_submitted.done === byKey.hw_submitted.total;
  const lateCount = byKey.late?.count || 0;
  const hasProud = examUp || threeStars.length > 0 || noAbsences || noLate || allHomework;
  const hasAttention = absent.length > 0 || hwExpired.length > 0 || hwReturned.length > 0 || lateCount > 0;

  return (
    <div className="page">
      <ReportToolbar
        onBack={() => navigate(backTo)}
        period={period}
        onPeriod={setPeriod}
        allLabel={'С начала обучения'}
        canPrint={!loading && !!report}
      />

      {error && <div className="error-text error-text--muted">{error}</div>}
      {loading && <div className="text-muted">{'Загрузка...'}</div>}

      {!loading && report && (
        <div className="report">
          <div className="report__head">
            <div>
              <div className="report__name person">
                <Avatar userId={report.student.id} photoUrl={report.student.photo_url} name={report.student.full_name} size="md" />
                {report.student.full_name}
              </div>
              {report.groups.map(g => (
                <div key={g.name} className="report__meta">
                  {'Группа'}: {g.name}{g.course && <> · {'Курс'}: {g.course}</>}{g.teacher && <> · {'Педагог'}: {g.teacher}</>}
                </div>
              ))}
            </div>
            <div className="report__meta">
              <ReportPeriod period={report.period} />
              {report.is_current_month && <div>{'Месяц ещё идёт — данные на сегодня'}</div>}
            </div>
          </div>

          {report.empty ? (
            <div className="text-muted">{'У ученика нет активных групп'}</div>
          ) : (
            <>
              {/* Вывод одной фразой */}
              <div className={`report__verdict report__verdict--${report.level}`}>
                <div className="report__verdict-title">
                  {report.level === 'excellent' ? (isMonth ? 'Месяц прошёл отлично' : 'Период прошёл отлично')
                    : report.level === 'good' ? (isMonth ? 'Месяц прошёл хорошо' : 'Период прошёл хорошо')
                    : report.level === 'problems' ? 'Нужна помощь родителей'
                    : 'За этот период уроков не было — оценивать нечего'}
                  {report.level !== 'none' && <>: {'в норме'} {report.good} {'из'} {report.rated}</>}
                </div>
                {report.level !== 'none' && weak.length > 0 && (
                  <div>
                    {'Стоит обратить внимание'}: {weak.map((i, idx) => (
                      <span key={i.key}>{idx > 0 && ', '}{indicatorRow(i, report.norms, lessons).q}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Период в цифрах */}
              <h3 className="report__h">{isMonth ? 'Месяц в цифрах' : 'Период в цифрах'}</h3>
              <div className="report__tiles">
                <div className="report__tile">
                  <b>{byKey.attendance.present} <small>{'из'} {byKey.attendance.total}</small></b>
                  <span>{'уроков посещено'}</span>
                </div>
                <div className="report__tile">
                  <b>{byKey.hw_submitted.done} <small>{'из'} {byKey.hw_submitted.total}</small></b>
                  <span>{'домашних заданий сдано'}</span>
                </div>
                <div className="report__tile">
                  <b>{report.stars} <i className="report__stars">{'★'}</i></b>
                  <span>{'звёзд получено за период'}</span>
                </div>
                <div className="report__tile">
                  <b>{byKey.lesson_score.avg ?? '—'}</b>
                  <span>{'средняя оценка за уроки'}</span>
                </div>
              </div>

              {/* Как идут дела */}
              <h3 className="report__h">{'Как идут дела'}</h3>
              <div className="table-scroll">
                <table className="table table--on-white">
                  <thead>
                    <tr><th>{'Вопрос'}</th><th>{'Сейчас'}</th><th>{'Хорошо, если'}</th><th>{'Оценка'}</th></tr>
                  </thead>
                  <tbody>
                    {report.indicators.map(ind => {
                      const row = indicatorRow(ind, report.norms, lessons);
                      if (!row) return null;
                      return (
                        <tr key={ind.key}>
                          <td>
                            <div className="report__q">{row.q}</div>
                            <div className="report__hint">{row.hint}</div>
                          </td>
                          <td className="nowrap report__value">{row.value}</td>
                          <td className="nowrap report__norm">{row.norm}</td>
                          <td className="nowrap"><Status status={ind.status} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Главное за период */}
              {(hasProud || hasAttention) && (
                <>
                  <h3 className="report__h">{'Главное за период'}</h3>
                  <div className="report__two">
                    {hasProud && (
                      <div className="report__note report__note--good">
                        <b>{'Чем можно гордиться'}</b>
                        <ul>
                          {examUp && (
                            <li>{'Экзамен сдан лучше, чем в прошлом месяце'}: {byKey.exam.avg} ({withSign(byKey.exam.delta)})</li>
                          )}
                          {threeStars.length > 0 && <li>{'Три звезды из трёх на уроках'}: {datesOf(threeStars)}</li>}
                          {noAbsences && <li>{'Ни одного пропуска'}</li>}
                          {noLate && <li>{'Ни одного опоздания'}</li>}
                          {allHomework && <li>{'Все домашние задания сданы'}</li>}
                        </ul>
                      </div>
                    )}
                    {hasAttention && (
                      <div className="report__note report__note--warn">
                        <b>{'На что обратить внимание'}</b>
                        <ul>
                          {absent.length > 0 && <li>{'Пропущены уроки'}: {datesOf(absent)}</li>}
                          {hwExpired.length > 0 && <li>{'Не сданы домашние задания к урокам'}: {datesOf(hwExpired)}</li>}
                          {hwReturned.length > 0 && <li>{'Домашнее задание вернули на доработку'}: {datesOf(hwReturned)}</li>}
                          {lateCount > 0 && <li>{'Опозданий'}: {lateCount}</li>}
                        </ul>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Уроки периода */}
              <h3 className="report__h">{'Уроки за период'}</h3>
              <div className="table-scroll">
                <table className="table table--on-white">
                  <thead>
                    <tr>
                      <th>{'Дата'}</th>
                      <th>{'Урок'}</th>
                      <th>{'Посещение'}</th>
                      <th>{'Оценка'}</th>
                      {hasExams && <th>{'Экзамен'}</th>}
                      <th>{'Домашнее задание'}</th>
                      <th>{'Звёзды'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lessons.length === 0 && (
                      <tr><td colSpan={hasExams ? 7 : 6} className="table__empty">{'Нет данных'}</td></tr>
                    )}
                    {lessons.map(l => (
                      <tr key={l.id}>
                        <td className="nowrap">{shortDate(l.date)}</td>
                        <td>{l.is_personal && <>{'👤'} </>}{l.title}</td>
                        <td className="nowrap"><Attendance lesson={l} /></td>
                        <td className="report__value">{l.score ?? '—'}</td>
                        {hasExams && <td className="report__value">{l.exam_score ?? '—'}</td>}
                        <td className="nowrap"><Homework lesson={l} /></td>
                        <td className="nowrap report__stars">{l.stars > 0 ? '★'.repeat(l.stars) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="report__foot">
                <p>{'Цвет: зелёный — всё в порядке, жёлтый — небольшое отклонение, красный — нужна помощь родителей, серый — данных пока нет.'}</p>
                {report.groups.filter(g => g.teacher).map(g => (
                  <p key={g.name}>
                    {'Вопросы по отчёту — педагогу'}: {g.teacher}{g.teacher_phone && <>, {g.teacher_phone}</>}
                  </p>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default StudentReportPage;
