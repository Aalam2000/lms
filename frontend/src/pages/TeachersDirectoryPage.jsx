import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTeacherDirectory } from '../api/admin';
import Avatar from '../components/Avatar';

function TeachersDirectoryPage() {
  const navigate = useNavigate();
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    setError('');
    getTeacherDirectory()
      .then(setTeachers)
      .catch(err => setError(err?.response?.data?.detail || 'Не удалось загрузить справочник'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <div className="toolbar toolbar--start">
        <h1 className="page-title">{'Преподаватели'}</h1>
      </div>

      {error && <div className="error-text error-text--muted">{error}</div>}

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>{'Имя'}</th>
              <th>{'Групп'}</th>
              <th>{'Студентов'}</th>
              <th data-tip={'Урок открыт, и на нём был хотя бы один студент'}>{'Проведено уроков'}</th>
              <th>{'Посещаемость'}</th>
              <th>{'Средний балл'}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="table__empty">{'Загрузка...'}</td></tr>
            ) : teachers.length === 0 ? (
              <tr><td colSpan={6} className="table__empty">{'Преподов не найдено'}</td></tr>
            ) : (
              teachers.map(t => (
                <tr
                  key={t.id}
                  className="table__row--clickable"
                  data-tip="Открыть отчёт по педагогу"
                  onClick={() => navigate(`/dashboard/teachers/${t.id}/report`)}
                >
                  <td>
                    <span className="person">
                      <Avatar userId={t.id} photoUrl={t.photo_url} name={t.full_name} size="xs" />
                      <span className="link">{t.full_name}</span>
                    </span>
                  </td>
                  <td>{t.group_count}</td>
                  <td>{t.student_count}</td>
                  <td>{t.lessons_held ?? 0}</td>
                  <td>{t.attendance_pct != null ? `${t.attendance_pct}%` : '—'}</td>
                  <td>{t.avg_score ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default TeachersDirectoryPage;
