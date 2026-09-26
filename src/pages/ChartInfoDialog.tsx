// 谱面信息对话框（chart-projects 04 / 05）：新增可贴谱面代码（Apply 闸门在调用方）；已上传只读。
import { useState } from 'react';
import type { ChartDifficulty, ChartProject, ProjectChart } from '../chart/project/ChartProject';
import { DIFF_NAMES } from '../chart/project/projectCatalog';
import { t } from '../i18n';
import { displayProjectName } from './projectUi';

function parseLevel(raw: string): number | null {
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
    <div className="pp-dialog__scrim" onMouseDown={onClose}>
      <div className="pp-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{chart ? t('projects.editChartTitle') : t('projects.newChartTitle')}</h3>
        {locked && <p className="pp-muted">{t('projects.uploadedReadonly')}</p>}
        <label className="pp-field">
          <span>{t('projects.chartName')}</span>
          <input value={title} placeholder={displayProjectName(project)} disabled={locked} onChange={(e) => setTitle(e.target.value)} />
          <small>{t('projects.chartNameHint', { name: displayProjectName(project) })}</small>
        </label>
        <div className="pp-field-row">
          <label className="pp-field">
            <span>{t('projects.diff')}</span>
            <select value={diff} disabled={locked} onChange={(e) => setDiff(Number(e.target.value) as ChartDifficulty)}>
              {DIFF_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
          <label className="pp-field">
            <span>{t('projects.level')}</span>
            <input value={level} placeholder={t('projects.levelLater')} disabled={locked} inputMode="numeric" onChange={(e) => setLevel(e.target.value)} />
          </label>
        </div>
        {!chart && (
          <label className="pp-field">
            <span>{t('projects.chartCode')}</span>
            <textarea rows={4} value={code} placeholder={t('projects.chartCodePlaceholder')} onChange={(e) => setCode(e.target.value)} />
            <small>{t('projects.chartCodeHint')}</small>
          </label>
        )}
        <div className="pp-dialog__actions">
          <button type="button" className="pp-btn" onClick={onClose}>{t('projects.cancel')}</button>
          {!locked && <button type="button" className="pp-btn pp-btn--primary" onClick={save}>{chart ? t('projects.save') : t('projects.add')}</button>}
        </div>
      </div>
    </div>
  );
}
