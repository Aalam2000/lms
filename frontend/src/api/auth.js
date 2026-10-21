// Аутентификация
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.REACT_APP_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
});

// Перехватчик для добавления токена
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export default api;

// --- Роутер /auth (backend/app/routers/auth.py) ---

export function login(username, password) {
  return api.post('/auth/login', { username, password }).then(res => res.data);
}

export function getMe() {
  return api.get('/auth/me').then(res => res.data);
}

// Свои выходные педагога — только просмотр: { weeks, dates }
export function getMyDaysOffSettings() {
  return api.get('/auth/me/days-off').then(res => res.data);
}

// Настройки пользователя (users.ui_prefs): меняются только переданные ключи,
// null — удалить ключ. Возвращает все настройки.
export function updatePrefs(patch) {
  return api.patch('/auth/me/prefs', patch).then(res => res.data);
}

export function updateMe(data) {
  return api.put('/auth/me', data).then(res => res.data);
}

// --- Фото профиля (routers/auth.py) ---
// Своё фото: файл или снимок с камеры (Blob). Сервер сам обрезает в квадрат
// и облегчает. Возвращает обновлённого пользователя (новый photo_url).
export function uploadMyPhoto(file) {
  const formData = new FormData();
  formData.append('file', file, file.name || 'photo.jpg');
  return api.put('/auth/me/photo', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(res => res.data);
}

export function deleteMyPhoto() {
  return api.delete('/auth/me/photo').then(res => res.data);
}

// Адрес фото для <img> (components/Avatar.jsx). Кэш по photo_url — он новый
// при каждой загрузке, поэтому устаревшее фото из кэша не покажется.
const photoCache = new Map();
export function getPhotoSrc(userId, photoUrl) {
  if (!photoCache.has(photoUrl)) {
    const p = api.get(`/auth/photo/${userId}`, { responseType: 'blob' })
      .then(res => window.URL.createObjectURL(res.data))
      .catch(err => { photoCache.delete(photoUrl); throw err; });
    photoCache.set(photoUrl, p);
  }
  return photoCache.get(photoUrl);
}

export function registerStudent(data) {
  return api.post('/auth/register/student', data).then(res => res.data);
}
