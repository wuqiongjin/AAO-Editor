// 工程管理页的两个表单弹窗：新建（空白 / 复制）/ 编辑工程信息。
import { useState } from 'react';
import { Copy, FolderPlus } from 'lucide-react';
import type { ChartDifficulty, ChartProject, SongSource } from '../../../project/ChartProject';
import { DIFF_NAMES, type updateProjectInfo } from '../../../project/projectCatalog';
import { displayProjectName, untitledProjectLabel } from '../../../project/ui/projectUi';
import ActionBtn from '../../../ui/ActionBtn';
import CoverField, { useCoverUrl, type CoverValue } from '../../../ui/CoverField';
import Dialog from '../../../ui/Dialog';
import { t } from '../../../i18n';
import { parseSource } from '../projectFormat';

export type NewSource = 'blank' | 'copy';

export function NewProjectDialog({
  initialSource, projects, onClose, onCreate, onCopy,
}: {
  initialSource: NewSource;
  projects: ChartProject[];
  onClose: () => void;
  onCreate: (input: { name: string; artist: string; diff: ChartDifficulty }) => void;
  onCopy: (projectId: string) => void;
}) {
  const [source, setSource] = useState<NewSource>(initialSource);
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [diff, setDiff] = useState<ChartDifficulty>(3);
  const [copyFrom, setCopyFrom] = useState(projects[0]?.id ?? '');

  return (
    <Dialog
      title={t('projects.newDialogTitle')}
      hint={t('projects.newHint')}
      onClose={onClose}
      footer={(
        <>
          <ActionBtn onClick={onClose}>{t('projects.cancel')}</ActionBtn>
          <ActionBtn
            variant="primary"
            disabled={source === 'copy' && !copyFrom}
            onClick={() => (source === 'copy' ? onCopy(copyFrom) : onCreate({ name, artist, diff }))}
          >
            {source === 'copy' ? t('projects.copyAction') : t('projects.createOpen')}
          </ActionBtn>
        </>
      )}
    >
      <div className="dialog-tabs">
        <button type="button" className={source === 'blank' ? 'is-active' : ''} onClick={() => setSource('blank')}>
          <FolderPlus size={14} />{t('projects.newBlank')}
        </button>
        <button type="button" className={source === 'copy' ? 'is-active' : ''} onClick={() => setSource('copy')} disabled={projects.length === 0}>
          <Copy size={14} />{t('projects.newCopy')}
        </button>
      </div>
      {source === 'copy' ? (
        <label className="dialog-field">
          <span>{t('projects.copyWhich')}</span>
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{t('projects.copyCharts', { name: displayProjectName(p), count: p.charts.length })}</option>
            ))}
          </select>
          <small>{t('projects.copyHint')}</small>
        </label>
      ) : (
        <>
          <div className="dialog-field-row">
            <label className="dialog-field"><span>{t('projects.name')}</span><input value={name} placeholder={untitledProjectLabel()} onChange={(e) => setName(e.target.value)} /></label>
            <label className="dialog-field"><span>{t('projects.artist')}</span><input value={artist} placeholder={t('projects.artistLater')} onChange={(e) => setArtist(e.target.value)} /></label>
          </div>
          <label className="dialog-field">
            <span>{t('projects.firstDiff')}</span>
            <select value={diff} onChange={(e) => setDiff(Number(e.target.value) as ChartDifficulty)}>
              {DIFF_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
            </select>
          </label>
        </>
      )}
    </Dialog>
  );
}

export function EditInfoDialog({ project, onClose, onSave }: {
  project: ChartProject;
  onClose: () => void;
  onSave: (patch: Parameters<typeof updateProjectInfo>[1]) => void;
}) {
  const [name, setName] = useState(project.name ?? '');
  const [artist, setArtist] = useState(project.artist ?? '');
  const [sourceType, setSourceType] = useState(project.source.type);
  const [sourceId, setSourceId] = useState(project.source.type === 'custom' ? '' : String(project.source.id));
  // 封面三态：null 沿用既有 / File 新选 / 'clear' 清除（保存时按此推导 patch 出参）
  const [cover, setCover] = useState<CoverValue>(null);
  // 只管既有封面的 URL：新选的 File 由 CoverField 自己开，同一张图不建两次 objectURL。
  const existingPreview = useCoverUrl(project.coverBlob);

  return (
    <Dialog
      title={t('projects.editTitle')}
      hint={t('projects.coverHint')}
      onClose={onClose}
      footer={(
        <>
          <ActionBtn onClick={onClose}>{t('projects.cancel')}</ActionBtn>
          <ActionBtn
            variant="primary"
            onClick={() => onSave({
              name,
              artist,
              source: parseSource(sourceType, sourceId),
              coverName: cover instanceof File ? cover.name : undefined,
              coverBlob: cover instanceof File ? cover : undefined,
              clearCover: cover === 'clear',
            })}
          >
            {t('projects.save')}
          </ActionBtn>
        </>
      )}
    >
      {/* 封面在左：它是工程在启动台的门面，不该缩成字段流里的一小块 */}
      <div className="dialog-edit-grid">
        <CoverField
          label={t('projects.cover')}
          value={cover}
          previewUrl={existingPreview}
          onChange={setCover}
        />
        <div className="dialog-edit-fields">
          <div className="dialog-field-row">
            <label className="dialog-field"><span>{t('projects.name')}</span><input value={name} placeholder={untitledProjectLabel()} onChange={(e) => setName(e.target.value)} /></label>
            <label className="dialog-field"><span>{t('projects.artist')}</span><input value={artist} onChange={(e) => setArtist(e.target.value)} /></label>
          </div>
          <label className="dialog-field">
            <span>{t('projects.source')}</span>
            <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SongSource['type'])}>
              <option value="custom">{t('projects.sourceCustom')}</option>
              <option value="bandori">{t('projects.sourceBandori')}</option>
              <option value="llsif">{t('projects.sourceLlsif')}</option>
            </select>
          </label>
          {sourceType !== 'custom' && (
            <label className="dialog-field">
              <span>{t('projects.sourceId')}</span>
              <input value={sourceId} inputMode="numeric" onChange={(e) => setSourceId(e.target.value)} />
            </label>
          )}
        </div>
      </div>
    </Dialog>
  );
}
