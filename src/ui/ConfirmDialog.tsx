// 确认弹窗：delete / overwrite 类「二选一」的问询。
// 壳（遮罩 / 三段 / 动效 / Esc / Tab 循环 / 焦点归还）在 ui/Dialog，这里只剩这段问询本身：
// 标题负责问（含对象名）、正文只说后果、两个键二选一。
import { t } from '../i18n';
import ActionBtn from './ActionBtn';
import Dialog from './Dialog';

export default function ConfirmDialog({
  title, message, confirmLabel, onConfirm, onCancel,
}: {
  title: string;
  /** 正文。字符串里的 \n 按换行渲染（删除工程要多带一句已上传提示）。 */
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      role="alertdialog"
      size="sm"
      // 会开在谱面代码弹窗之上，层高再高一档
      raised
      title={title}
      description={message}
      onClose={onCancel}
      footer={(
        <>
          <ActionBtn onClick={onCancel}>{t('ui.cancel')}</ActionBtn>
          <ActionBtn variant="danger-solid" autoFocus onClick={onConfirm}>{confirmLabel}</ActionBtn>
        </>
      )}
    />
  );
}
