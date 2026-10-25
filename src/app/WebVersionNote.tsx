import { Download, HardDrive, MonitorOff, type LucideIcon } from 'lucide-react';
import { t } from '../i18n';
import './styles/webVersionNote.css';

/**
 * 在线版说明的**唯一一份内容**（票 04）：首访弹窗与 设置 › 关于 都渲染它，两处只差字号。
 *
 * 三条各自独立、各说一件事（能力 / 数据 / 出路），不写导语 —— 「在线版跑在浏览器里」这类
 * 话说出来对用户没有新信息。两档都带图标：条目是并列关系，图标就是它们的分行锚点
 * （2026-10-25 用户验收：关于页少了图标，三条看着像一坨）。文案全部来自消息表。
 */
export default function WebVersionNote({ compact = false }: { compact?: boolean }) {
  const items: Array<{ Icon: LucideIcon; text: string }> = [
    { Icon: MonitorOff, text: t('web.note.platform') },
    { Icon: HardDrive, text: t('web.note.data') },
    { Icon: Download, text: t('web.note.desktop') },
  ];
  return (
    <div className={`web-note${compact ? ' web-note--compact' : ''}`}>
      <ul className="web-note__items">
        {items.map(({ Icon, text }) => (
          <li className="web-note__item" key={text}>
            <Icon size={compact ? 14 : 15} strokeWidth={1.8} aria-hidden />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
