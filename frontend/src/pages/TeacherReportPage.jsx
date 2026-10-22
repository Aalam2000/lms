// Отчёт по педагогу за период — для руководителя (админ: «Учителя» → педагог).
// Сколько отработано (уроки, часы) и как — показатели, которые педагог не
// выставляет себе сам. Цифры, статусы и нормы считает бэкенд
// (backend/app/teacher_report.py), формулировки — здесь.
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { getTeacherReport } from '../api/admin';
import { extractErrorMessage } from '../utils/errors';
import Avatar from '../components/Avatar';
import {
  ReportPeriod, ReportToolbar, Status, defaultPeriod, formatDate, periodParams, withSign,
} from '../components/ReportParts';

// Строки «Как отработано»: вопрос, пояснение, значение «сейчас» и норма
function indicatorRow(ind, norms) {
  switch (ind.key) {
    case 'attendance':
      return {
        q: <>{'Ходят ли дети на уроки?'}</>,
        hint: <>{'Доля посещённых уроков; пропуски по уважительной причине не считаются'}</>,
        value: ind.pct != null ? `${ind.pct}%` : '—',
        norm: <>{'от'} {norms.attendance}%</>,
      };
    case 'retention':
      return {
        q: <>{'Остаются ли ученики?'}</>,
        hint: <>{'Сколько учеников было за период и сколько осталось'}</>,
        value: ind.total ? <>{ind.stayed} {'из'} {ind.total}</> : '—',
        norm: <>{'все остались'}</>,
      };
    case 'journal':
      return {
        q: <>{'Заполняется ли журнал вовремя?'}</>,
        hint: <>{'В скольких проведённых уроках посещаемость отмечена в день урока'}</>,
        value: ind.total ? <>{ind.done} {'из'} {ind.total}</> : '—',
        norm: <>{'от'} {norms.journal}%</>,
      };
    case 'hw_assigned':
      return {
        q: <>{'Задаются ли домашние задания?'}</>,
        hint: <>{'В скольких проведённых уроках было задание'}</>,
        value: ind.total ? <>{ind.done} {'из'} {ind.total}</> : '—',
        norm: <>{'от'} {norms.hw_assigned}%</>,
      };
    case 'hw_review_days':
      return {
        q: <>{'Быстро ли проверяются домашние задания?'}</>,
        hint: <>{'Среднее время от сдачи работы до проверки. Сейчас ждут проверки'}: {ind.queue}</>,
        value: ind.days != null ? <>{ind.days} {'дн.'}</> : '—',
        norm: <>{'до'} {norms.hw_review_days} {'дн.'}</>,
      };
    case 'exams':
      return {
        q: <>{'Растут ли знания?'}</>,
        hint: <>{'Средний балл экзаменов в live-квизе, его считает система.'}{ind.prev != null && <> {'В прошлом месяце было'} {ind.prev}</>}</>,
        value: ind.avg != null ? <>{ind.avg}{ind.delta != null && <> ({withSign(ind.delta)})</>}</> : '—',
        norm: <>{'не падает'}</>,
      };
    case 'platform':
      return {
        q: <>{'Пользуются ли ученики платформой?'}</>,
        hint: <>{'Сколько учеников заходили в платформу за последнюю неделю периода'}</>,
        value: ind.total ? <>{ind.done} {'из'} {ind.total}</> : '—',
        norm: <>{'от'} {norms.platform}%</>,
      };
    case 'feedback':
      return {
        q: <>{'Нравятся ли детям уроки?'}</>,
        hint: <>{'Как ученики оценили уроки смайликами. Педагог отдельных оценок не видит'}</>,
        value: (ind.green + ind.yellow + ind.red) > 0 ? (
          <span className="report__faces">
            <span className="report__face report__face--good">{ind.green}</span>
            <span className="report__face report__face--warn">{ind.yellow}</span>
            <span className="report__face report__face--bad">{ind.red}</span>
          </span>
        ) : '—',
        norm: <>{'от'} {norms.feedback}% {'зелёных'}</>,
      };
    default:
      return null;
  }
}

function TeacherReportPage() {
  const { teacherId } = useParams();
  const navigate = useNavigate();
  const [period, setPeriod] = useState(defaultPeriod);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    getTeacherReport(teacherId, periodParams(period))
      .then(data => { if (alive) setReport(data); })
      .catch(err => { if (alive) setError(extractErrorMessage(err, 'Не удалось построить отчёт')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [teacherId, period]);

  const isMonth = report?.period?.kind === 'month'; // у месячного отчёта свои формулировки вывода
  const attention = report?.attention;
  const hasAttention = attention && (
    attention.hw_queue.count > 0 || attention.at_risk.length > 0 || attention.left.length > 0 || attention.not_held.length > 0
  );
  const weak = (report?.indicators || []).filter(i => i.status === 'warn' || i.status === 'bad');

  return (
    <div className="page">
      <ReportToolbar
        onBack={() => navigate('/dashboard/teachers')}
        period={period}
        onPeriod={setPeriod}
        allLabel={'С начала преподавания'}
        canPrint={!loading && !!report}
      />

      {error && <div className="error-text error-text--muted">{error}</div>}
      {loading && <div className="text-muted">{'Загрузка...'}</div>}

      {!loading && report && (
        <div className="report">
          <div className="report__head">
            <div>
              <div className="report__name person">
                <Avatar userId={report.teacher.id} photoUrl={report.teacher.photo_url} name={report.teacher.full_name} size="md" />
                {report.teacher.full_name}
              </div>
              {!report.empty && (
                <div className="report__meta">
                  {'Группы'}: {report.groups.join(', ') || '—'} · {'учеников'}: {report.students}
                </div>
              )}
            </div>
            <div className="report__meta">
              <ReportPeriod period={report.period} />
              {report.is_current_month && <div>{'Месяц ещё идёт — данные на сегодня'}</div>}
            </div>
          </div>

          {report.empty ? (
            <div className="text-muted">{'У этого педагога нет групп'}</div>
          ) : (
            <>
              {/* Вывод одной фразой */}
              <div className={`report__verdict report__verdict--${report.level}`}>
                <div className="report__verdict-title">
                  {report.level === 'excellent' ? (isMonth ? 'Месяц отработан отлично' : 'Период отработан отлично')
                    : report.level === 'good' ? (isMonth ? 'Месяц отработан хорошо' : 'Период отработан хорошо')
                    : report.level === 'problems' ? 'Есть проблемы — нужен разговор с педагогом'
                    : 'За этот период уроков не было — оценивать нечего'}
                  {report.level !== 'none' && <>: {'в норме'} {report.good} {'из'} {report.rated}</>}
                </div>
                {report.level !== 'none' && weak.length > 0 && (
                  <div>
                    {'Требуют внимания'}: {weak.map((i, idx) => (
                      <span key={i.key}>{idx > 0 && ', '}{indicatorRow(i, report.norms).q}</span>
                    ))}
                  </div>
                )}
              </div>

              {/* Сколько отработано */}
              <h3 className="report__h">{'Сколько отработано'}</h3>
              <div className="report__tiles">
                <div className="report__tile">
                  <b>{report.work.planned_held} <small>{'из'} {report.work.planned_due}</small></b>
                  <span>{'уроков по расписанию проведено'}</span>
                </div>
                <div className="report__tile"><b>{report.work.personal_held}</b><span>{'персональных уроков проведено'}</span></div>
                <div className="report__tile"><b>{report.work.hours}</b><span>{'часов занятий всего'}</span></div>
                <div className="report__tile"><b>{report.work.not_held}</b><span>{'уроков по расписанию не состоялось'}</span></div>
              </div>

              {/* Как отработано */}
              <h3 className="report__h">
                {'Как отработано'}
                <small>{'показатели, которые педагог не выставляет себе сам'}</small>
              </h3>
              <div className="table-scroll">
                <table className="table table--on-white">
                  <thead>
                    <tr><th>{'Вопрос'}</th><th>{'Сейчас'}</th><th>{'Норма'}</th><th>{'Оценка'}</th></tr>
                  </thead>
                  <tbody>
                    {report.indicators.map(ind => {
                      const row = indicatorRow(ind, report.norms);
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

              {/* По группам */}
              <h3 className="report__h">{'По группам'}</h3>
              <div className="table-scroll">
                <table className="table table--on-white">
                  <thead>
                    <tr>
                      <th>{'Группа'}</th>
                      <th>{'Учеников'}</th>
                      <th>{'Уроков проведено'}</th>
                      <th>{'Персональных'}</th>
                      <th>{'Посещаемость'}</th>
                      <th>{'Экзамены'}</th>
                      <th>{'Ушло'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.by_group.length === 0 && (
                      <tr><td colSpan={7} className="table__empty">{'Нет данных'}</td></tr>
                    )}
                    {report.by_group.map(g => (
                      <tr key={g.id}>
                        <td>{g.name}</td>
                        <td>{g.students}</td>
                        <td>{g.held} {'из'} {g.planned}</td>
                        <td>{g.personal}</td>
                        <td>{g.attendance_pct != null ? `${g.attendance_pct}%` : '—'}</td>
                        <td>{g.exam_avg != null ? <>{g.exam_avg}{g.exam_delta != null && <> ({withSign(g.exam_delta)})</>}</> : '—'}</td>
                        <td>{g.left}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* На что обратить внимание */}
              <h3 className="report__h">{'На что обратить внимание'}</h3>
              {!hasAttention ? (
                <div className="text-muted">{'Замечаний нет'}</div>
              ) : (
                <div className="report__attention">
                  <ul>
                    {attention.hw_queue.count > 0 && (
                      <li>
                        <b>{'Проверка ДЗ'}.</b> {'Ждут проверки работ'}: {attention.hw_queue.count}
                        {attention.hw_queue.oldest_days != null && (
                          <>; {'самая старая сдана дней назад'}: {attention.hw_queue.oldest_days} ({attention.hw_queue.group})</>
                        )}
                      </li>
                    )}
                    {attention.at_risk.length > 0 && (
                      <li>
                        <b>{'Риск ухода'}.</b> {'Три пропуска подряд'}: {attention.at_risk.map(s => `${s.name} (${s.group})`).join(', ')}
                      </li>
                    )}
                    {attention.left.map((s, i) => (
                      <li key={`left-${i}`}>
                        <b>{'Ушёл ученик'}.</b> {s.name} ({s.group}), {formatDate(s.date)}{s.reason && <>; {'причина'}: «{s.reason}»</>}
                      </li>
                    ))}
                    {attention.not_held.map((l, i) => (
                      <li key={`nh-${i}`}>
                        <b>{'Урок не состоялся'}.</b> {l.title} ({l.group}), {formatDate(l.date)}: {'урок не открыт или на нём никого не было'}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="report__foot">
                <p>{'Оценки за урок и звёзды в отчёт не входят: их выставляет сам педагог, поэтому по ним нельзя судить о качестве его работы.'}</p>
                <p>{'Проведённым считается открытый урок, на котором был хотя бы один ученик.'}</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default TeacherReportPage;
