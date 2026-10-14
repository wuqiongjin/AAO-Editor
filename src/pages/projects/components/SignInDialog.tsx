// 登录弹窗（票 39 Q15 / Q26 / Q33 / Q38 / Q41 / Q43 / Q46 / Q48 / Q49）。
//
// 一条一条对票：
//   ① 字段 = 账号 + 密码（带显示 / 隐藏眼睛，默认关；Q38）+ 登录键；**不做**「记住账号 / 记住密码」（Q39）；
//   ② Enter 提交（`<form onSubmit>`；底栏那枚提交键经 `form` 关联进来 —— Dialog 的 body / foot 是两段）；
//      提交中两框 + 按钮一并禁用，按钮文字「登录中…」；
//   ③ 失败**就地内联在表单下方**（不 Toast：Toast 会自己消失，登录失败必须留在场）；
//   ④ 文案按**中立失败类型**取（`loginFailureOf`，Q43 / Q44），六档；
//   ⑤ **不做网络预检**（Q33）：打开弹窗一条请求都不发 —— 「一打开就发一条注定 401 的请求」不做；
//   ⑥ 标题**点名目标站点**（Q41），凭据说明收进标题右侧的「?」气泡（Q49，复用 ui/HelpHint）；
//   ⑦ 成功 → 自动关（账号区由会话驱动，不需要回报）+ 不 Toast；关闭即卸载 ⇒ 已输入的凭据随组件一起没了；
//   ⑧ 底栏左端常驻「注册 · 忘记密码」两枚**外链**（Q42 / Q45 / Q48）：本产品不集成账号生命周期，
//      只把人送到站点；站点侧没有独立页面 ⇒ 都指站点首页，点击开**系统浏览器**（Q47，不是 `<a target="_blank">`）。
//
// 凭据红线（ADR-0011 §3 / 票 39 Q9）：本文件是 `password` 字面量在白名单里的第二处，
// 但它**不 import 任何持久化出口**、正文里也不碰 storage 出口 —— `password` 只从这里
// 递进 `account.login()` 的参数，进不了任何落盘路径（tests/static/CommunityCredentialBoundary）。
import { useId, useState, type FormEvent } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { getCommunityAccount } from '../../../community/bestdori/account';
import { BESTDORI_HOST, siteHomeUrl } from '../../../community/bestdori/endpoints';
import { openCommunitySite } from '../../../community/externalLink';
import { loginFailureOf, type LoginFailure } from '../../../community/bestdori/loginFailure';
import { t, type MessageKey } from '../../../i18n';
import ActionBtn from '../../../ui/ActionBtn';
import Dialog from '../../../ui/Dialog';
import HelpHint from '../../../ui/HelpHint';

/** 六档失败 → i18n（`loginFailureOf` 给中立类型，文案在这里 —— 一档一句，Q43） */
const FAILURE_KEYS: Record<LoginFailure, MessageKey> = {
  credentials: 'community.account.err.credentials',
  offline: 'community.account.err.offline',
  'rate-limited': 'community.account.err.rateLimited',
  'account-unavailable': 'community.account.err.accountUnavailable',
  unsupported: 'community.account.err.unavailable',
  unknown: 'community.account.err.generic',
};

/**
 * 两枚外链的 `title`：写书面语说清「点下去会发生什么」（Q49 去口语化）。
 * 站点名从端点文件取（域名只住那一处，这里拿的是符号不是字面量）。
 */
function linksTitle(): string {
  return t('community.account.linksTitle', { host: BESTDORI_HOST });
}

export function SignInDialog({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<LoginFailure | null>(null);
  const accountId = useId();
  const secretId = useId();
  const formId = useId();

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      // 密码只走这一行参数：能力层不落盘、不记日志（票 10 的红线）
      await getCommunityAccount().login(username, secret);
      onClose(); // 成功：弹窗自己关，账号区跟着会话变（不 Toast）
    } catch (error) {
      setFailure(loginFailureOf(error));
    } finally {
      setBusy(false);
    }
  };

  const siteLink = (label: string) => (
    <a
      className="pc-signin__link"
      href={siteHomeUrl()}
      title={linksTitle()}
      onClick={(event) => {
        // 默认行为在 Electron 里会开**应用内无地址栏窗口**（Q47 的错形态）：拦掉，改走系统浏览器
        event.preventDefault();
        void openCommunitySite();
      }}
    >
      {label}
    </a>
  );

  return (
    <Dialog
      head={(
        <div className="pc-signin__head">
          <h3 className="dialog__title">{t('community.account.title')}</h3>
          {/* 凭据交给谁必须让用户看得见（Q41）；收进「?」不占常驻版面（Q49） */}
          <HelpHint text={t('community.account.siteHint')} placement="down" />
        </div>
      )}
      onClose={onClose}
      footer={(
        <>
          <span className="pc-signin__links">
            {siteLink(t('community.account.signUpLink'))}
            <span className="pc-signin__sep" aria-hidden="true">·</span>
            {siteLink(t('community.account.forgotLink'))}
          </span>
          <ActionBtn onClick={onClose} disabled={busy}>{t('ui.cancel')}</ActionBtn>
          <ActionBtn type="submit" form={formId} variant="primary" disabled={busy}>
            {busy ? t('community.account.submitting') : t('community.account.signIn')}
          </ActionBtn>
        </>
      )}
    >
      {/* onChange 清掉上一次的失败：错误留在场，但下一次尝试开始时它已经过期了 */}
      <form id={formId} className="pc-signin" onSubmit={(event) => void submit(event)}>
        <div className="dialog-field">
          <div className="dialog-field__label-row">
            <label className="dialog-field__label-left" htmlFor={accountId}>
              {t('community.account.username')}
            </label>
          </div>
          <input
            id={accountId}
            value={username}
            disabled={busy}
            autoComplete="off"
            onChange={(e) => {
              setUsername(e.target.value);
              setFailure(null);
            }}
          />
        </div>
        <div className="dialog-field">
          <div className="dialog-field__label-row">
            <label className="dialog-field__label-left" htmlFor={secretId}>
              {t('community.account.password')}
            </label>
          </div>
          <span className="pc-signin__secret">
            <input
              id={secretId}
              type={showSecret ? 'text' : 'password'}
              value={secret}
              disabled={busy}
              autoComplete="off"
              onChange={(e) => {
                setSecret(e.target.value);
                setFailure(null);
              }}
            />
            <button
              type="button"
              className="pc-signin__eye"
              disabled={busy}
              aria-label={showSecret ? t('community.account.hideSecret') : t('community.account.showSecret')}
              aria-pressed={showSecret}
              onClick={() => setShowSecret((v) => !v)}
            >
              {showSecret ? <EyeOff size={15} strokeWidth={1.9} /> : <Eye size={15} strokeWidth={1.9} />}
            </button>
          </span>
        </div>
        {failure && (
          <p className="pc-signin__error" role="alert">{t(FAILURE_KEYS[failure])}</p>
        )}
      </form>
    </Dialog>
  );
}
