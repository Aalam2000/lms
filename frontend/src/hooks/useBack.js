// Кнопка «Назад»: на предыдущую страницу платформы, как кнопка браузера.
// Страница открыта напрямую (по ссылке, в новой вкладке — истории внутри
// платформы нет) — на fallback: страницу выше по иерархии.
// location.key === 'default' — это первая страница вкладки, назад некуда.
//   const back = useBack();  …  onClick={() => back('/dashboard')}
import { useLocation, useNavigate } from 'react-router';

export function useBack() {
  const navigate = useNavigate();
  const { key } = useLocation();
  return (fallback) => (key === 'default' ? navigate(fallback) : navigate(-1));
}
