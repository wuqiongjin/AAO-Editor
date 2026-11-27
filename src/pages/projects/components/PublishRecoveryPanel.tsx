import { useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { openCommunitySite } from '../../../community/externalLink';
import { t, type MessageKey } from '../../../i18n';
import ActionBtn from '../../../ui/ActionBtn';
import { useDismissOnOutside } from '../../../ui/useDismissOnOutside';
import type { PublishRecoveryResult } from '../usePublishEntry';

const STATUS_KEYS: Record<Exclude<PublishRecoveryResult['status'], 'choose'>, MessageKey> = {
  unmatched: 'projects.publish.recovery.unmatched',
  unavailable: 'projects.publish.recovery.unavailable',
  'wrong-account': 'projects.publish.recovery.account',
  mismatch: 'projects.publish.recovery.mismatch',
  'record-failed': 'projects.publish.err.record',
};

export function PublishPendingAlert({ pending, status, busy, onRecover }: {
  pending: boolean;
  status: PublishRecoveryResult | null;
  busy: boolean;
  onRecover: (postId?: number) => void;
}) {
  if (!pending && status == null) return null;
  return (
    <div className="pp-publish__alert pp-publish__alert--warn" role="alert">
      <CircleAlert size={15} aria-hidden="true" />
      <div className="pp-publish__alert__body">
        {pending && <p><strong>{t('projects.publish.recovery.pending')}</strong></p>}
        {status?.status === 'choose' && (
          <>
            <p>{t('projects.publish.recovery.choose')}</p>
            <ul className="ppc-recovery__posts">
              {status.posts.map((post) => (
                <li key={post.id}>
                  <ActionBtn disabled={busy} onClick={() => onRecover(post.id)}>
                    #{post.id} · {post.title || t('projects.untitled')}
                    {post.time !== null ? ` · ${new Date(post.time).toLocaleString()}` : ''}
                  </ActionBtn>
                </li>
              ))}
            </ul>
          </>
        )}
        {status !== null && status.status !== 'choose' && <p role="status">{t(STATUS_KEYS[status.status])}</p>}
      </div>
      {pending && (
        <div className="pp-publish__alert__actions">
          <ActionBtn disabled={busy} onClick={() => onRecover()}>{t('projects.publish.recovery.check')}</ActionBtn>
          <ActionBtn onClick={() => void openCommunitySite()}>{t('projects.publish.recovery.open')}</ActionBtn>
        </div>
      )}
    </div>
  );
}

export function PublishAssociateControl({ busy, onRecover }: {
  busy: boolean;
  onRecover: (postId?: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [postId, setPostId] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // 用户 2026-11-26：点弹层外部自动收起
  useDismissOnOutside(expanded, () => setExpanded(false), [rootRef, panelRef]);
  const id = /^\d+$/.test(postId.trim()) ? Number(postId) : 0;

  return (
    <div className="ppc-associate" ref={rootRef}>
      <button
        type="button"
        className="ppc-associate__toggle"
        disabled={busy}
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        {t('projects.publish.recovery.associate')}
      </button>
      {expanded && (
        <div
          className="ppc-associate__panel"
          ref={panelRef}
          role="dialog"
          aria-label={t('projects.publish.recovery.associate')}
        >
          <p className="ppc-associate__hint">{t('projects.publish.recovery.associateHint')}</p>
          <form
            className="ppc-associate__form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && Number.isSafeInteger(id) && id > 0) onRecover(id);
            }}
          >
            <input
              className="ppc-associate__id"
              type="text"
              inputMode="numeric"
              aria-label={t('projects.publish.recovery.postId')}
              placeholder={t('projects.publish.recovery.postId')}
              value={postId}
              disabled={busy}
              autoFocus
              onChange={(event) => setPostId(event.target.value)}
            />
            <ActionBtn type="submit" disabled={busy || !Number.isSafeInteger(id) || id <= 0}>
              {t('projects.publish.recovery.verify')}
            </ActionBtn>
          </form>
        </div>
      )}
    </div>
  );
}
