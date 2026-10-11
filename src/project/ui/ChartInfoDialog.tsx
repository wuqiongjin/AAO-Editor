// 谱面信息对话框（chart-projects 04 / 05）：新增可贴谱面代码（Apply 闸门在调用方）；已上传只读。
// 壳走 ui/Dialog（通用弹窗壳）—— 与新建 / 编辑工程信息、删除确认同一张脸（issue 16）。
import { useState } from 'react';
import type { ChartDifficulty, ChartProject, ProjectChart } from '../ChartProject';
import { DIFF_NAMES } from '../projectCatalog';
import { t } from '../../i18n';
import ActionBtn from '../../ui/ActionBtn';
import Dialog from '../../ui/Dialog';
import { displayProjectName } from './projectUi';

/** 等级输入解析（空 → null；非有限数 → null）。难度/等级徽标就地编辑与弹窗共用。 */
export function parseLevel(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function ChartInfoDialog({
  project, chart, defaultDiff = 3, onClose, onAdd, onUpdate,
}: {
  project: ChartProject;
  chart: ProjectChart | null;
  defaultDiff?: ChartDifficulty;
  onClose: () => void;
  onAdd: (input: { title: string | null; diff: ChartDifficulty; level: number | null; codeText: string }) => void;
  onUpdate: (patch: { title: string | null; diff: ChartDifficulty; level: number | null }) => void;
}) {
  const locked = !!chart?.upload;
  const [title, setTitle] = useState(chart?.title ?? '');
  const [diff, setDiff] = useState<ChartDifficulty>(chart?.diff ?? defaultDiff);
  const [level, setLevel] = useState(chart?.level != null ? String(chart.level) : '');
  const [code, setCode] = useState('');
  const save = () => {
    const parsed = parseLevel(level);
    if (chart) {
      onUpdate({ title: title.trim() || null, diff, level: parsed });
      return;
    }
    onAdd({ title: title.trim() || null, diff, level: parsed, codeText: code });
  };
  return (
    <Dialog
      title={chart ? t('projects.editChartTitle') : t('projects.newChartTitle')}
      onClose={onClose}
      footer={(
        <>
          <ActionBtn onClick={onClose}>{t('projects.cancel')}</ActionBtn>
          {!locked && (
            <ActionBtn variant="primary" onClick={save}>{chart ? t('projects.save') : t('projects.add')}</ActionBtn>
          )}
        </>
      )}
    >
      {locked && <p className="dialog__message">{t('projects.uploadedReadonly')}</p>}
      <label className="dialog-field">
        <span>{t('projects.chartName')}</span>
        <input value={title} placeholder={displayProjectName(project)} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="dialog-field-row">
        <label className="dialog-field">
          <span>{t('projects.diff')}</span>
          <select value={diff} disabled={locked} onChange={(e) => setDiff(Number(e.target.value) as ChartDifficulty)}>
            {DIFF_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </label>
        <label className="dialog-field">
          <span>{t('projects.level')}</span>
          <input value={level} placeholder={t('projects.levelLater')} disabled={locked} inputMode="numeric" onChange={(e) => setLevel(e.target.value)} />
        </label>
      </div>
      {!chart && (
        <label className="dialog-field">
          <span>{t('projects.chartCode')}</span>
          <textarea rows={4} value={code} placeholder={t('projects.chartCodePlaceholder')} onChange={(e) => setCode(e.target.value)} />
        </label>
      )}
    </Dialog>
  );
}
