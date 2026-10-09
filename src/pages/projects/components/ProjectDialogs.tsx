// 工程管理页的两个表单弹窗：新建（四项来源）/ 编辑工程信息。
//
// 四项来源（票 12 归类，界面按这个说话）：空白创建 / 从本地谱面导入 / 从官方谱面导入 / 从社区谱面导入。
// 官方这一支（票 08）实做在 OfficialSongPanel + officialImport；社区那一支留 09，这里只摆位。
import { useCallback, useState } from 'react';
import { AlertTriangle, Copy, FolderPlus, Music4, Users } from 'lucide-react';
import type { ChartDifficulty, ChartProject, SongSource } from '../../../project/ChartProject';
import { DIFF_NAMES, type updateProjectInfo } from '../../../project/projectCatalog';
import { displayProjectName, untitledProjectLabel } from '../../../project/ui/projectUi';
import ActionBtn from '../../../ui/ActionBtn';
import CoverField, { useCoverUrl, type CoverValue } from '../../../ui/CoverField';
import Dialog from '../../../ui/Dialog';
import type { CommunityTransport } from '../../../community/transport';
import { t, type MessageKey } from '../../../i18n';
import { parseSource } from '../projectFormat';
import type { OfficialImportStage } from '../officialImport';
import { OfficialSongPanel, type OfficialSongSelection } from './OfficialSongPanel';

/** 导入阶段 → 文案键（与 OfficialImportStage 同一处：漏一个编译不过，别用模板串拼键） */
const STAGE_KEYS = {
  audio: 'projects.official.stage.audio',
  cover: 'projects.official.stage.cover',
  chart: 'projects.official.stage.chart',
  save: 'projects.official.stage.save',
} satisfies Record<OfficialImportStage, MessageKey>;

export type NewSource = 'blank' | 'copy' | 'official' | 'community';

/** 官方导入的回执：失败时给一句能读的话（按错误域 kind 翻的），弹窗就地显示 */
export type OfficialImportReply = { ok: true } | { ok: false; message: string };

export function NewProjectDialog({
  initialSource, projects, onClose, onCreate, onCopy, onImportOfficial, transport, importSources = false,
}: {
  initialSource: NewSource;
  projects: ChartProject[];
  onClose: () => void;
  onCreate: (input: { name: string; artist: string; diff: ChartDifficulty }) => void;
  onCopy: (projectId: string) => void;
  onImportOfficial: (
    selection: OfficialSongSelection,
    onStage: (stage: OfficialImportStage) => void,
  ) => Promise<OfficialImportReply>;
  /** 注入点：测试塞假出口；不传走 IPC 出口 */
  transport?: CommunityTransport;
  /** 有没有社区平台出口：静态演示版只留前两支（票 12 / ADR-0011 §1） */
  importSources?: boolean;
}) {
  const [source, setSource] = useState<NewSource>(initialSource);
  const [name, setName] = useState('');
  const [artist, setArtist] = useState('');
  const [diff, setDiff] = useState<ChartDifficulty>(3);
  const [copyFrom, setCopyFrom] = useState(projects[0]?.id ?? '');
  const [official, setOfficial] = useState<OfficialSongSelection | null>(null);
  // 导入中：下载 4MB 音频期间**不许关窗**（网关一次性的请求已经在飞，关掉只会让人以为「取消了」，
  // 结果工程照样建出来）。阶段文案代替字节级进度 —— 网关没有进度事件（票 07 定案）。
  const [stage, setStage] = useState<OfficialImportStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = stage !== null;

  const pickOfficial = useCallback((next: OfficialSongSelection | null) => setOfficial(next), []);
  const close = () => { if (!busy) onClose(); };

  const submit = () => {
    if (source === 'copy') { onCopy(copyFrom); return; }
    if (source === 'official') {
      if (!official) return;
      setError(null);
      setStage('audio');
      void onImportOfficial(official, setStage)
        .then((reply) => {
          if (!reply.ok) {
            setError(reply.message);
            setStage(null);
          }
        })
        .catch(() => {
          setError(t('projects.official.err.generic'));
          setStage(null);
        });
      return;
    }
    if (source === 'community') return;
    onCreate({ name, artist, diff });
  };

  const confirmDisabled = busy
    || (source === 'copy' && !copyFrom)
    || (source === 'official' && !official)
    || source === 'community';
  const pickerShell = source === 'official' || source === 'community';
  const noLocalProject = projects.length === 0;

  return (
    <Dialog
      // 空白/本地 md、官方/社区 lg：同一颗窗改 size + 宽高过渡，遮罩不卸（票 13 #6）
      size={pickerShell ? 'lg' : 'md'}
      clipBody={pickerShell}
      title={t('projects.newDialogTitle')}
      hint={t('projects.newHint')}
      onClose={close}
      footer={(
        <>
          <ActionBtn onClick={close} disabled={busy}>{t('projects.cancel')}</ActionBtn>
          {source !== 'community' && (
            <ActionBtn variant="primary" disabled={confirmDisabled} onClick={submit}>
              {source === 'copy' ? t('projects.copyAction') : t('projects.createOpen')}
            </ActionBtn>
          )}
        </>
      )}
    >
      <div className="dialog-tabs">
        <button type="button" className={source === 'blank' ? 'is-active' : ''} disabled={busy} onClick={() => setSource('blank')}>
          <FolderPlus size={14} />{t('projects.tabBlank')}
        </button>
        <button
          type="button"
          className={source === 'copy' ? 'is-active' : ''}
          disabled={busy || noLocalProject}
          title={noLocalProject ? t('projects.copyDisabledHint') : undefined}
          onClick={() => setSource('copy')}
        >
          <Copy size={14} />{t('projects.tabCopy')}
        </button>
        {importSources && (
          <>
            <button type="button" className={source === 'official' ? 'is-active' : ''} disabled={busy} onClick={() => setSource('official')}>
              <Music4 size={14} />{t('projects.tabOfficial')}
            </button>
            <button type="button" className={source === 'community' ? 'is-active' : ''} disabled={busy} onClick={() => setSource('community')}>
              <Users size={14} />{t('projects.tabCommunity')}
            </button>
          </>
        )}
      </div>

      {source === 'copy' && (
        <label className="dialog-field">
          <span>{t('projects.copyWhich')}</span>
          <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{t('projects.copyCharts', { name: displayProjectName(p), count: p.charts.length })}</option>
            ))}
          </select>
          <small>{t('projects.copyHint')}</small>
        </label>
      )}

      {source === 'blank' && (
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

      {source === 'official' && (
        <>
          <OfficialSongPanel selection={official} onSelectionChange={pickOfficial} transport={transport} />
          {stage && (
            <p className="off-status off-status--busy" role="status">
              <span className="off-spinner" aria-hidden="true" />
              {t(STAGE_KEYS[stage])}
            </p>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              <div><strong>{t('projects.official.importFail')}</strong><p style={{ margin: 0 }}>{error}</p></div>
            </div>
          )}
        </>
      )}

      {source === 'community' && <p className="off-status">{t('projects.community.notYet')}</p>}
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
