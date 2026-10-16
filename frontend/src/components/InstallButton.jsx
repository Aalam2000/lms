// Кнопка в левом меню (между пунктами и «Помощью»).
// В браузере — «На рабочий стол»: Chrome/Edge — окно установки браузера;
// iPhone/iPad и Safari на Mac — подсказка, как добавить значок вручную.
// Заодно спрашивает разрешение на уведомления (где браузер это умеет).
// Открыто со значка — «Включить уведомления», пока разрешение не спрашивали;
// дальше кнопки нет.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal';
import { IconInstall, IconBell } from './CyberIcons';
import {
  canPrompt, enablePush, isInstalled, onInstallChange, platform, promptInstall, pushPermission, refreshPush,
} from '../utils/install';

function InstallButton({ onDone }) {
  const [, rerender] = useState(0);
  const [hint, setHint] = useState(false);

  useEffect(() => onInstallChange(() => rerender(n => n + 1)), []);
  // Разрешение уже есть — освежить запись устройства на сервере
  useEffect(() => { refreshPush().catch(() => {}); }, []);

  const installed = isInstalled();
  const askPush = pushPermission() === 'default';
  if (installed && !askPush) return null;

  const click = async () => {
    if (installed) {
      await enablePush().catch(() => {});
      rerender(n => n + 1);
      return;
    }
    if (canPrompt()) {
      // Сначала установка; уведомления спросим в приложении (кнопка сменится)
      await promptInstall();
      if (onDone) onDone();
      return;
    }
    // Окна установки нет — подсказка; разрешение спрашиваем сразу, пока клик «свежий»
    const push = askPush ? enablePush().catch(() => {}) : null;
    setHint(true);
    await push;
  };

  const where = platform();
  return (
    <>
      {installed ? (
        <button type="button" className="nav__link nav__install" onClick={click}
          data-tip="Сообщения платформы: несданное ДЗ, уроки">
          <IconBell className="nav__icon" />
          <span>{'Включить уведомления'}</span>
        </button>
      ) : (
        <button type="button" className="nav__link nav__install" onClick={click}
          data-tip="Положить значок платформы на рабочий стол">
          <IconInstall className="nav__icon" />
          <span>{'На рабочий стол'}</span>
        </button>
      )}
      {hint && createPortal(
        <Modal title="Значок на рабочий стол" onClose={() => setHint(false)}>
          {where === 'ios' && (
            <ol className="install-steps">
              <li>{'Откройте платформу в Safari.'}</li>
              <li>{'Нажмите «Поделиться» — квадрат со стрелкой вверх.'}</li>
              <li>{'Выберите «На экран "Домой"» и нажмите «Добавить».'}</li>
              <li>{'Откройте платформу со значка и включите уведомления.'}</li>
            </ol>
          )}
          {where === 'mac-safari' && (
            <ol className="install-steps">
              <li>{'В меню Safari откройте «Файл».'}</li>
              <li>{'Выберите «Добавить в Dock» и нажмите «Добавить».'}</li>
            </ol>
          )}
          {where === 'other' && (
            <ol className="install-steps">
              <li>{'Откройте меню браузера (⋮ или ⋯).'}</li>
              <li>{'Выберите «Установить приложение» или «Добавить на главный экран».'}</li>
              <li>{'Если такого пункта нет — откройте платформу в Chrome или Edge.'}</li>
            </ol>
          )}
        </Modal>,
        document.body,
      )}
    </>
  );
}

export default InstallButton;
