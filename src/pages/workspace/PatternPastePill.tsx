// 画布左上角的片段粘贴胶囊（issue 186 / ADR-0023 §2「两个模式」，照 180 Q15 曲线胶囊）：
// 只在**片段粘贴持工具态**出现（点卡片进态），显示当前模式；点开 = 两档选择（含 BPM / 不含 BPM）。
// 切走工具即消失（工具态本身就没了）；选择落 settings.patternPaste.withBpm，下次沿用。
//
// 文案口径（186 二轮定案）：`含 BPM (120 → 180)` / `不含 BPM` —— 直接显示会带过去的速度跨度，
// 不再写"含 BPM 变化 · n"（那条计数既读不懂、也不回答"会带什么速度"）。
// 片段是哪一条由画布上的幽灵预览回答（含即将写入的 BPM 虚线），故胶囊不显示片段名。
import { memo } from 'react';
import { ChevronDown } from 'lucide-react';
import { useUI } from '../../app/ProviderTree';
import { patternBpmRange } from '../../chart/patterns/library';
import { t } from '../../i18n';
import BpmRange, { formatBpmRange } from './BpmRange';
import { useCanvasCapsule } from './useCanvasCapsule';
import './CanvasCapsule.css';
import './PatternPastePill.css';

export default memo(function PatternPastePill() {
  const { armedTool, patternPaste, patternPasteWithBpm, setPatternPasteWithBpm } = useUI();
  const visible = armedTool === 'paste' && patternPaste !== null;
  const { open, toggle, dismiss, rootRef, pillRef } = useCanvasCapsule(visible);

  if (!visible || !patternPaste) return null;

  const range = patternBpmRange(patternPaste);
  // 读屏名必须带模式：可见文本被 `aria-label` 盖掉的话，屏幕阅读器只听到"片段粘贴"（模式才是这枚胶囊的全部意义）
  const modeText = patternPasteWithBpm
    ? `${t('patternPaste.withBpm')} (${formatBpmRange(range)})`
    : t('patternPaste.withoutBpm');
  // 两档的完整文案同时用于胶囊摘要与弹层选项：一处措辞、两处出现（弹层里选的就是胶囊上显示的）
  const withBpmLabel = (
    <>
      {t('patternPaste.withBpm')} (<BpmRange start={range.start} peak={range.peak} />)
    </>
  );

  return (
    <div className={`ccap ppp${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        ref={pillRef}
        type="button"
        className="ccap__pill"
        aria-label={`${t('patternPaste.title')}：${modeText}`}
        aria-expanded={open}
        title={t('patternPaste.title')}
        onClick={toggle}
      >
        <span className="ccap__tag">{t('tool.paste')}</span>
        <span className="ccap__sum">{patternPasteWithBpm ? withBpmLabel : t('patternPaste.withoutBpm')}</span>
        <ChevronDown size={13} className="ccap__chev" />
      </button>

      {open && (
        <div className="ccap__body ppp__body" role="group" aria-label={t('patternPaste.title')}>
          <div className="ppp__modes">
            <button
              type="button"
              className={`ppp__chip${patternPasteWithBpm ? ' is-active' : ''}`}
              aria-pressed={patternPasteWithBpm}
              onClick={() => {
                setPatternPasteWithBpm(true);
                dismiss();
              }}
            >
              {withBpmLabel}
            </button>
            <button
              type="button"
              className={`ppp__chip${patternPasteWithBpm ? '' : ' is-active'}`}
              aria-pressed={!patternPasteWithBpm}
              onClick={() => {
                setPatternPasteWithBpm(false);
                dismiss();
              }}
            >
              {t('patternPaste.withoutBpm')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});
