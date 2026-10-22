import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App';
import './styles/global.css';
import './utils/install'; // ловит окно установки «На рабочий стол» и регистрирует sw.js

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

// Клиентский рантайм autoi18n — подключается один раз в точке входа,
// без единой правки кода компонентов (см. README autoi18n). После загрузки
// он сам проходит по уже отрисованному React-ом DOM и следит за его
// изменениями через MutationObserver.
(function loadAutoI18nRuntime() {
  const apiUrl = import.meta.env.REACT_APP_API_URL || 'http://localhost:8000';
  const lang = localStorage.getItem('autoI18nLang') || 'ru';
  const script = document.createElement('script');
  // Кэш-бастинг параметром: /i18n/runtime.js отдаётся с Cache-Control:
  // no-store (см. backend/app/routers/i18n.py), но это касается только
  // НОВЫХ ответов — то, что Cloudflare уже успела закэшировать на каком-то
  // из edge-узлов ДО этого фикса, само не пропадёт (у неё нет доступа к
  // дашборду, чтобы почистить руками). Метка _=Date.now() делает урл
  // каждый раз новым, ранее не виденным — кэшу просто неоткуда взять
  // старую копию, независимо от того, какой edge-узел обслуживает запрос.
  script.src = `${apiUrl}/i18n/runtime.js?lang=${encodeURIComponent(lang)}&_=${Date.now()}`;
  script.id = 'autoi18n-runtime'; // по нему AuthContext ждёт загрузки, чтобы применить язык из профиля
  script.async = true;
  document.head.appendChild(script);
})();
