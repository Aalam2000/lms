// Телефон: «+994 50 123 45 67» / «050 123 45 67» (Азербайджан),
// «+7 916 037 15 37» / «8 916 037 15 37» (Россия) или любой номер с «+» и
// кодом страны. Пробелы, скобки и дефисы допускаются. Та же проверка — на
// бэкенде (backend/app/phones.py), там же запрет повторов.
export const PHONE_PLACEHOLDER = '+994 50 123 45 67';

export function isValidPhone(raw) {
  const s = (raw || '').replace(/[\s\-()]/g, '');
  return /^\+\d{8,15}$/.test(s) || /^0\d{9}$/.test(s) || /^8\d{10}$/.test(s);
}

// Текст ошибки регистрации по ответу сервера
export function registerErrorText(err, fallback) {
  const status = err?.response?.status;
  if (status === 400) return 'Пользователь с таким логином уже существует';
  if (status === 404) return 'Приглашение недействительно';
  if (status === 409) return 'Этот телефон уже зарегистрирован. Войдите под своим логином или обратитесь к педагогу';
  // 422 — такого номера не бывает, 429 — слишком много регистраций: текст приходит с сервера
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (status === 422) return 'Такого номера не существует — проверьте код страны, код оператора и количество цифр';
  return fallback;
}
