// Телефон: «+994 50 123 45 67» / «050 123 45 67» (Азербайджан),
// «+7 916 037 15 37» / «8 916 037 15 37» (Россия) или любой номер с «+» и
// кодом страны. Пробелы, скобки и дефисы допускаются. Та же проверка — на
// бэкенде (backend/app/phones.py), там же запрет повторов.
export const PHONE_PLACEHOLDER = '+994 50 123 45 67';

// Тексты ошибок про телефон — здесь, а не с сервера: так их переводит autoi18n
// (тексты ошибок бэкенда приходят по-русски)
export const PHONE_FORMAT_TEXT = 'Введите номер с кодом страны, например +994 50 123 45 67';
export const PHONE_INVALID_TEXT = 'Такого номера не существует — проверьте код страны, код оператора и количество цифр';
export const PHONE_TAKEN_TEXT = 'Этот телефон уже зарегистрирован. Войдите под своим логином или обратитесь к педагогу';

export function isValidPhone(raw) {
  const s = (raw || '').replace(/[\s\-()]/g, '');
  return /^\+\d{8,15}$/.test(s) || /^0\d{9}$/.test(s) || /^8\d{10}$/.test(s);
}

// Текст ошибки регистрации по коду ответа сервера (backend/app/routers/auth.py)
export function registerErrorText(err, fallback) {
  const status = err?.response?.status;
  if (status === 400) return 'Пользователь с таким логином уже существует';
  if (status === 404) return 'Приглашение недействительно';
  if (status === 409) return PHONE_TAKEN_TEXT;
  if (status === 422) return PHONE_INVALID_TEXT;
  if (status === 429) return 'Слишком много регистраций в эту группу — попробуйте позже';
  return fallback;
}
