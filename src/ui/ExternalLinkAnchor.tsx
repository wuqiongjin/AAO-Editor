/**
 * 站外链接（票 18）：`<a href>` 的外形 + 「拦掉默认行为、交给系统浏览器」的纪律。
 *
 * 为什么收成一件东西：本仓所有站外链接**都必须**先 `preventDefault` 再走 `openExternalUrl`
 * —— Electron 里裸 `<a target="_blank">` 会开一个无地址栏的应用内窗口（票 39 定的形态）。
 * 这条纪律靠每个调用点手写一遍 `onClick={(e) => { e.preventDefault(); ... }}`，第三次复制
 * 就会漏一个，漏了的那个表现为"点一下应用自己跳走了"，很难在测试里一眼看出来。
 *
 * 为什么仍保留 `<a href>`：可复制链接、键盘可达、右键能"在新标签页打开"——这三件事
 * 换成 `<button>` 就没了。
 */
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { openExternalUrl } from '../app/openExternal';

interface ExternalLinkAnchorProps
  extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'onClick' | 'target' | 'rel'> {
  href: string;
  children: ReactNode;
}

export default function ExternalLinkAnchor({ href, children, ...rest }: ExternalLinkAnchorProps) {
  return (
    <a
      {...rest}
      href={href}
      onClick={(e) => {
        // 拦掉默认导航：桌面端由主进程白名单决定放不放行，在线版开新标签页
        e.preventDefault();
        void openExternalUrl(href);
      }}
    >
      {children}
    </a>
  );
}
