// 账号行（票 39 Q20 / Q28 / Q35 / Q36 / Q37 / Q10 / Q11 / Q31）—— 详情视图左栏底部那一块。
//
// 结构（Q20 的骨架 + Q36 / Q37 定案后的实形）：
//   - 未登录：`[人像] 登录`            → 整行可点，开登录弹窗；
//   - 已失效：`[警示] 登录状态已失效，请重新登录` → 同样整行可点（Q17：就地一行文字，不弹窗、不 Toast）；
//   - 已登录：`[首字母头像] 昵称 [⋯]`  → 整行可点，向上弹菜单（信息头 + 退出登录）。
//
// 三条容易被做回去的事（票内专门否过的）：
//   ① **行尾不放「登录」文字**（Q36）：整行是唯一目标，再放一枚文字 = 一行两个目标；未登录文案是
//      **动作式**（「登录」），那句"为什么"（登录后可发布谱面）留给票 11 的灰化说明（CapabilityStatusLine）；
//   ② **没有 caret**（Q37）：`^` 是"折叠 / 展开"的语言，而这里只能往上弹、永远朝上、没有信息量 ——
//      次要动作走**渐进披露**（悬停 / 打开 / 键盘聚焦才浮现「⋯」）；
//   ③ **不是卡片**（Q35）:与兄弟 `.pc-item` 同族的**无框列表行**（满宽 / `padding: 10px 14px` /
//      hover `--bg-hover` / 打开 `--bg-active`）—— 左栏底部那块"框"就是上一版被否的原因。
//
// 静态演示版（没有社区出口）**整块不渲染**（Q11，与 ProjectsPage 的 `importSources` 同口径）。
import { useState } from 'react';
import { CircleAlert, LogOut, MoreHorizontal, User } from 'lucide-react';
import { getCommunityAccount, type CommunityAccountSession } from '../../../community/bestdori/account';
import { hasCommunityNet } from '../../../community/electronTransport';
import { projectCoverHue } from '../../../project/projectCatalog';
import { ProjectMenuItem } from '../../../project/ui/projectUi';
import { t } from '../../../i18n';
import { useCommunityCapabilities } from '../communityCapabilities';
import { Menu } from './ProjectBits';
import { SignInDialog } from './SignInDialog';

/**
 * 昵称首字母色块（Q31）：色相由**账号名**派生（展示名会改，账号名不会），
 * 沿用工程封面占位块的 `projectCoverHue`（同一套派生口径，不另写一份哈希）。
 */
function InitialAvatar({ name, seed }: { name: string; seed: string }) {
  return (
    <span
      className="pc-account__avatar"
      style={{ background: `hsl(${projectCoverHue(seed)} 58% 46%)` }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * 菜单：信息头（头像 + 昵称 + 账号名，Q10：`username` 只在这里出现）+「退出登录」。
 * 两项就两项（Q34：头像与作品集是另一张票的事），不放松散的其它入口。
 */
function AccountMenuBody({ session, onSignOut }: {
  session: CommunityAccountSession;
  onSignOut: () => void;
}) {
  const profile = session.account;
  if (!profile) return null;
  const display = profile.nickname ?? profile.username;
  return (
    <>
      {/* 信息头是**展示**，不是动作：`Menu` 的面板对「点面板任意处」一律关闭（那是给"面板里
          全是动作项"的菜单定的规矩），点昵称 / 账号名就收掉是误伤 —— 这里挡掉那一下冒泡
          （用户 2026-10-14 真机反馈）。「退出登录」照旧由面板那次点击收菜单，不用另接。 */}
      <div className="pc-account__id" onClick={(e) => e.stopPropagation()}>
        <InitialAvatar name={display} seed={profile.username} />
        <span className="pc-account__idtext">
          <b>{display}</b>
          <small>{t('community.account.menuAccount', { username: profile.username })}</small>
          {/* Q6：本机安全存储不可用（落盘失败）时说一句 —— 不说的话，用户下次启动会莫名其妙地要重登 */}
          {session.remembered === false && (
            <small className="pc-account__note">{t('community.account.notRemembered')}</small>
          )}
        </span>
      </div>
      <ProjectMenuItem icon={<LogOut size={14} strokeWidth={1.9} />} label={t('community.account.signOut')} onClick={onSignOut} />
    </>
  );
}

export function AccountBar() {
  const { session } = useCommunityCapabilities();
  // 登录弹窗是**就地挂载**的：关掉即卸载，已输入的账号 / 密码跟着组件一起没了（Q15 #7）
  const [signInOpen, setSignInOpen] = useState(false);

  if (!hasCommunityNet()) return null;

  const profile = session.account;
  const signedIn = session.signedIn && profile !== null;
  const display = profile ? (profile.nickname ?? profile.username) : '';

  return (
    <div className="pc-account">
      {signedIn ? (
        <Menu
          placement="up"
          align="start"
          trigger={(open) => (
            <button
              type="button"
              className="pc-account__row"
              aria-haspopup="true"
              aria-expanded={open}
            >
              <InitialAvatar name={display} seed={profile.username} />
              <span className="pc-account__text"><b>{display}</b></span>
              <MoreHorizontal size={15} strokeWidth={1.9} className="pc-account__more" aria-hidden="true" />
            </button>
          )}
        >
          <AccountMenuBody session={session} onSignOut={() => void getCommunityAccount().logout()} />
        </Menu>
      ) : (
        <button type="button" className="pc-account__row" onClick={() => setSignInOpen(true)}>
          <span className={`pc-account__lead${session.expired ? ' is-warn' : ''}`} aria-hidden="true">
            {session.expired ? <CircleAlert size={15} strokeWidth={1.9} /> : <User size={15} strokeWidth={1.9} />}
          </span>
          <span className="pc-account__text">
            <b>{session.expired ? t('community.account.expired') : t('community.account.signIn')}</b>
          </span>
        </button>
      )}
      {signInOpen && <SignInDialog onClose={() => setSignInOpen(false)} />}
    </div>
  );
}
