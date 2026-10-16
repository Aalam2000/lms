// Колокольчик у имени: человек разрешил уведомления (hooks/usePushUsers)
import React from 'react';
import { IconBell } from './CyberIcons';

function PushMark() {
  return (
    <span className="push-mark" data-tip="Уведомления включены">
      <IconBell className="push-mark__icon" />
    </span>
  );
}

export default PushMark;
