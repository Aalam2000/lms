import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { login as loginRequest } from '../api/auth';
import LanguageSwitcher from '../components/LanguageSwitcher';
import Input from '../components/Input';
import Button from '../components/Button';
import { useAcademyName } from '../utils/academyName';

function Login() {
  const academyName = useAcademyName();
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [username, setUsername] = useState(location.state?.username || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const data = await loginRequest(username, password);
      login(data.access_token);
      navigate('/dashboard');
    } catch (err) {
      // Свои тексты, а не с сервера: их переводит autoi18n. Что именно неверно —
      // логин или пароль — не подсказываем.
      const status = err?.response?.status;
      setError(status === 401 ? 'Неверный логин или пароль'
        : status === 429 ? 'Слишком много попыток входа — попробуйте позже'
          : 'Ошибка соединения с сервером');
    }
  };

  return (
    <div className="centered-page">
      {/* Язык — до входа; выбор запоминается и остаётся после входа */}
      <div className="auth-lang"><LanguageSwitcher /></div>
      <div className="card">
        <img src="/assets/logo.svg" alt={academyName} width="200" height="66" />
        <form className="login-form" onSubmit={handleSubmit}>
          <Input
            className="input--lg"
            type="text"
            placeholder={'Логин'}
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
          />
          <Input
            className="input--lg"
            type="password"
            placeholder={'Пароль'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <Button className="btn--pill btn--lg" type="submit">{'Войти'}</Button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}

export default Login;
