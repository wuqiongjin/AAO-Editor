// 片段导入确认弹层（issue 189）：解析成功后、落盘前把冲突清单与三种动作摆给用户。
//
// 口径（189 定案 + 2026-10-31 用户修订）：
// - 默认「跳过」；覆盖只换名字、保留本地身份；「保留两者」各自新 id；
// - 取消 / 关闭（含 Esc / 点遮罩）= 不写盘（说明收进标题右侧的「?」）；
// - 只和本地库判重；文件内部同内容条目各自保留；
// - 同名但内容不同不是冲突，只在清单下方提示一句；
// - 没有重复条目时整块隐藏策略区（三选一没有意义）。
import { useState } from 'react';
import type { PatternImportPreview, PatternImportStrategy } from '../../patterns/importConflict';
import { t, type MessageKey } from '../../i18n';
import ActionBtn from '../../ui/ActionBtn';
import Dialog from '../../ui/Dialog';
import HelpHint from '../../ui/HelpHint';
import './PatternImportDialog.css';

const STRATEGIES: ReadonlyArray<{
  value: PatternImportStrategy;
  label: MessageKey;
  hint: MessageKey;
}> = [
  { value: 'skip', label: 'patternLibrary.import.strategy.skip', hint: 'patternLibrary.import.strategy.skipHint' },
  { value: 'overwrite', label: 'patternLibrary.import.strategy.overwrite', hint: 'patternLibrary.import.strategy.overwriteHint' },
  { value: 'keep-both', label: 'patternLibrary.import.strategy.keepBoth', hint: 'patternLibrary.import.strategy.keepBothHint' },
];

interface PatternImportDialogProps {
  preview: PatternImportPreview;
  /** 取消 / 关闭：不写盘 */
  onCancel: () => void;
  /** 确认：按选中的全局策略合并落盘 */
  onConfirm: (strategy: PatternImportStrategy) => void;
}

export default function PatternImportDialog({
  preview, onCancel, onConfirm,
}: PatternImportDialogProps) {
  const [strategy, setStrategy] = useState<PatternImportStrategy>('skip');
  const hasDuplicates = preview.duplicateCount > 0;

  return (
    <Dialog
      size="md"
      head={(
        <div className="pid-head">
          <h3 className="dialog__title">{t('patternLibrary.import.title')}</h3>
          <HelpHint text={t('patternLibrary.import.dialogHint')} placement="down" />
        </div>
      )}
      onClose={onCancel}
      footer={(
        <>
          <ActionBtn onClick={onCancel}>{t('ui.cancel')}</ActionBtn>
          <ActionBtn variant="primary" autoFocus onClick={() => onConfirm(strategy)}>
            {t('patternLibrary.import.confirm')}
          </ActionBtn>
        </>
      )}
    >
      <div className="pid-stats">
        <span className="pid-stat pid-stat--total">
          {t('patternLibrary.import.stat.total', { count: preview.total })}
        </span>
        <span className={`pid-stat pid-stat--new${preview.newCount === 0 ? ' is-zero' : ''}`}>
          {t('patternLibrary.import.stat.new', { count: preview.newCount })}
        </span>
        <span className={`pid-stat pid-stat--duplicate${preview.duplicateCount === 0 ? ' is-zero' : ''}`}>
          {t('patternLibrary.import.stat.duplicate', { count: preview.duplicateCount })}
        </span>
        <span className={`pid-stat pid-stat--invalid${preview.invalidCount === 0 ? ' is-zero' : ''}`}>
          {t('patternLibrary.import.stat.invalid', { count: preview.invalidCount })}
        </span>
      </div>

      {preview.targets.length > 0 && (
        <section className="pid-conflicts" aria-label={t('patternLibrary.import.duplicatesTitle')}>
          <h4 className="pid-conflicts__title">{t('patternLibrary.import.duplicatesTitle')}</h4>
          <ul className="pid-conflicts__list">
            {preview.targets.map((target, index) => (
              <li className="pid-conflict" key={`${target.importIndex}-${index}`}>
                <span className="pid-conflict__names">
                  {t('patternLibrary.import.conflictRow', {
                    importName: target.importName,
                    targetName: target.targetName,
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {preview.sameNameDifferentContent > 0 && (
        <p className="pid-note">
          {t('patternLibrary.import.sameNameDifferent', { count: preview.sameNameDifferentContent })}
        </p>
      )}

      {hasDuplicates && (
        <fieldset className="pid-strategies">
          <legend className="pid-strategies__legend">{t('patternLibrary.import.strategy')}</legend>
          {STRATEGIES.map((option) => (
            <label
              key={option.value}
              className={`pid-strategy${strategy === option.value ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name="pattern-import-strategy"
                value={option.value}
                checked={strategy === option.value}
                onChange={() => setStrategy(option.value)}
              />
              <span className="pid-strategy__text">
                <b>{t(option.label)}</b>
                <small>{t(option.hint)}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </Dialog>
  );
}
