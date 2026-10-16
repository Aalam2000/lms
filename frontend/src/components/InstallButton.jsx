// Кнопка «На рабочий стол» в левом меню (между пунктами и «Помощью»).
// Chrome/Edge — окно установки браузера; iPhone/iPad и Safari на Mac — подсказка,
// как добавить значок вручную. Открыто со значка — кнопки нет.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Modal from './Modal';
import { IconInstall } from './CyberIcons';
import { canPrompt, isInstalled, onInstallChange, platform, promptInstall } from '../utils/install';

function InstallButton({ onDone }) {
  const [installed, setInstalled] = useState(isInstalled());
  const [hint, setHint] = useState(false);
  const [, rerender] = useState(0);

  useEffect(() => onInstallChange(() => {
    setInstalled(isInstalled());
    rerender(n => n + 1);
  }), []);

  if (installed) return null;

  const click = async () => {
    if (canPrompt()) {
      await promptInstall();
      if (onDone) onDone();
    } else {
      setHint(true);
    }
  };

  const where = platform();
  return (
    <>
      <button type="button" className="nav__link nav__install" onClick={click}
        data-tip="Положить значок платформы на рабочий стол">
        <IconInstall className="nav__icon" />
        <span>{'На рабочий стол'}</span>
      </button>
      {hint && createPortal(
        <Modal title="Значок на рабочий стол" onClose={() => setHint(false)}>
          {where === 'ios' && (
            <ol className="install-steps">
              <li>{'Откройте платформу в Safari.'}</li>
              <li>{'Нажмите «Поделиться» — квадрат со стрелкой вверх.'}</li>
              <li>{'Выберите «На экран "Домой"» и нажмите «Добавить».'}</li>
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
