// 谱面信息对话框（chart-projects 04 / 05；票 79 补谱师署名）：新增可贴谱面代码（Apply 闸门在调用方）。
// 壳走 ui/Dialog（通用弹窗壳）—— 与新建 / 编辑工程信息、删除确认同一张脸（issue 16）。
//
// 票 79：谱师署名是**谱面级元数据**。已上传谱面的本体只读（谱面名称 / 难度 / 等级仍禁用），
// 但署名与难度 / 等级 / 标签同档、可改 ⇒ 保存按钮在只读态也保留，父级用
// `applyChartInfoPatch`（updateChartInfo 跳过已上传 + 谱师署名一律可写）各管各的。
import { useState } from 'react';
import type { ChartDifficulty, ChartSummary, ProjectChart } from '../ChartProject';
import { POST_LEVEL_MAX, POST_LEVEL_MIN } from '../../community/bestdori/endpoints';
import { defaultCharterCredit } from '../charterCredit';
import { t } from '../../i18n';
import ActionBtn from '../../ui/ActionBtn';
import Dialog from '../../ui/Dialog';
import { displayProjectName } from './projectUi';
import DifficultyLevelField from './DifficultyLevelField';

/** 等级输入解析（空 / 非整数 → null）。难度/等级徽标就地编辑与弹窗共用。 */
export function parseLevel(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isInteger(n) ? n : null;
}

/**
 * 空 → 可落盘 null；平台发帖区间（POST_LEVEL_MIN–MAX，实测 1 可通过、0 / 36 拒）内的整数可落盘；
 * 0 / 负数 / 36+ / 非整数不写。票 43：发布弹窗、谱面信息、难度徽标同一套。
 */
export function readChartLevelInput(raw: string):
  { persist: true; level: number | null } | { persist: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { persist: true, level: null };
  const n = parseLevel(raw);
  if (n == null || n < POST_LEVEL_MIN || n > POST_LEVEL_MAX) return { persist: false };
  return { persist: true, level: n };
}

export interface ChartInfoPatch {
  title: string | null;
  diff: ChartDifficulty;
  level: number | null;
  /** 谱师署名（票 79）：自由文本，联合创作由作者自己写分隔符 */
  charterCredit: string | null;
}

/**
 * 新增谱面：已登录时输入框直接预填账号名；**没编辑过且为空**才不把字段递下去，
 * 让 `addChartToProject` 再兜一次默认值（会话可能刚校验完）；手动清空是显式空值，不回落。
 */
export interface ChartInfoAddInput extends Omit<ChartInfoPatch, 'charterCredit'> {
  charterCredit?: string | null;
  codeText: string;
}

export function ChartInfoDialog({
  project, chart, defaultDiff = 3, onClose, onAdd, onUpdate,
}: {
  project: { name: string | null };
  chart: ChartSummary | ProjectChart | null;
  defaultDiff?: ChartDifficulty;
  onClose: () => void;
  onAdd: (input: ChartInfoAddInput) => void;
  onUpdate: (patch: ChartInfoPatch) => void;
}) {
  const locked = !!(chart?.upload || chart?.pendingPublish);
  const [title, setTitle] = useState(chart?.title ?? '');
  const [diff, setDiff] = useState<ChartDifficulty>(chart?.diff ?? defaultDiff);
  const [level, setLevel] = useState(chart?.level != null ? String(chart.level) : '');
  const [code, setCode] = useState('');
  const [charterCredit, setCharterCredit] = useState(() => (
    chart ? (chart.charterCredit ?? '') : (defaultCharterCredit() ?? '')
  ));
  const [creditTouched, setCreditTouched] = useState(false);
  const levelInput = readChartLevelInput(level);
  const save = () => {
    if (!levelInput.persist) return;
    const base = { title: title.trim() || null, diff, level: levelInput.level };
    const credit = charterCredit.trim();
    if (chart) {
      onUpdate({ ...base, charterCredit: credit || null });
      return;
    }
    // 票 79：手动填写 > 登录账号名 > 空。预填过的值原样落盘；未编辑留空交给创建侧兜底。
    const shouldPassCredit = credit !== '' || creditTouched;
    onAdd({ ...base, codeText: code, ...(shouldPassCredit ? { charterCredit: credit } : {}) });
  };
  return (
    <Dialog
      title={chart ? t('projects.editChartTitle') : t('projects.newChartTitle')}
      onClose={onClose}
      footer={(
        <>
          <ActionBtn onClick={onClose}>{t('projects.cancel')}</ActionBtn>
          <ActionBtn variant="primary" onClick={save} disabled={!levelInput.persist}>
            {chart ? t('projects.save') : t('projects.add')}
          </ActionBtn>
        </>
      )}
    >
      <label className="dialog-field">
        <span>{t('projects.chartName')}</span>
        <input value={title} placeholder={displayProjectName(project)} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className={`dialog-field${levelInput.persist ? '' : ' is-missing'}`}>
        <span>{t('projects.diff')} / {t('projects.level')}</span>
        <DifficultyLevelField
          diff={diff}
          onDiffChange={setDiff}
          level={level}
          onLevelChange={setLevel}
          levelInvalid={!levelInput.persist}
          disabled={locked}
        />
      </div>
      {/* 票 79：谱师署名不随「已上传只读」禁用 —— 它是导出画面用的元数据 */}
      <label className="dialog-field">
        <span>{t('projects.credit.charter')}</span>
        <input
          value={charterCredit}
          placeholder={t('projects.credit.charterPlaceholder')}
          onChange={(e) => {
            setCharterCredit(e.target.value);
            setCreditTouched(true);
          }}
        />
      </label>
      {!chart && (
        <label className="dialog-field">
          <span>{t('projects.chartCode')}</span>
          <textarea rows={4} value={code} placeholder={t('projects.chartCodePlaceholder')} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
    </Dialog>
  );
}
