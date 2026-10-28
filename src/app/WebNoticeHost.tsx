import { useState } from 'react';
import { t } from '../i18n';
import ActionBtn from '../ui/ActionBtn';
import Dialog from '../ui/Dialog';
import WebVersionNote from './WebVersionNote';
import { dismissWebNotice, shouldShowWebNotice } from './webNotice';

/**
 * 在线版首访说明（票 04）：挂在应用壳一次，只在「没有桌面桥 + 这台浏览器没看过」时出现。
 * 禁点遮罩关闭（closeOnScrim={false}，确保用户知晓受限）；关掉即记账（按钮 / Esc）；之后想看完整说明走 设置 › 关于。
 */
export default function WebNoticeHost() {
  const [open, setOpen] = useState(shouldShowWebNotice);

  if (!open) return null;

  const close = () => {
    dismissWebNotice();
    setOpen(false);
  };

  return (
    <Dialog
      size="sm"
      title={t('web.notice.title')}
      onClose={close}
      closeOnScrim={false}
      footer={(
        <>
          <span className="web-note__more">{t('web.notice.more')}</span>
          <ActionBtn variant="primary" autoFocus onClick={close}>
            {t('web.notice.ack')}
          </ActionBtn>
        </>
      )}
    >
      <WebVersionNote />
    </Dialog>
  );
}
