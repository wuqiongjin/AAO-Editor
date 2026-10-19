import { Fragment, type ReactNode } from 'react';
import { parseReleaseNotes, type Block, type Inline } from './releaseNotesParser';
import './styles/releaseNotes.css';

/** 行内节点 → React 元素（纯文本 / 粗体 / 斜体 / 行内代码；链接只出文字，见 releaseNotes.ts 头注） */
function renderInline(kids: Inline[]): ReactNode {
  return kids.map((k, i) => {
    switch (k.t) {
      case 'text':
        return <Fragment key={i}>{k.v}</Fragment>;
      case 'bold':
        return <strong key={i}>{renderInline(k.kids)}</strong>;
      case 'italic':
        return <em key={i}>{renderInline(k.kids)}</em>;
      case 'code':
        return <code key={i} className="release-notes__code">{k.v}</code>;
      case 'link':
        return <Fragment key={i}>{renderInline(k.kids)}</Fragment>;
    }
  });
}

function renderBlock(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'heading':
      // h4：弹窗标题是 h3（Dialog 的 dialog__title），说明内容低一级
      return <h4 key={i} className="release-notes__h">{renderInline(b.kids)}</h4>;
    case 'list':
      return (
        <ul key={i} className="release-notes__list">
          {b.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
        </ul>
      );
    case 'quote':
      return <p key={i} className="release-notes__quote">{renderInline(b.kids)}</p>;
    case 'para':
      return <p key={i} className="release-notes__p">{renderInline(b.kids)}</p>;
  }
}

/**
 * 发行说明渲染（ADR-0021 §2）：把 latest.yml 里带下来的 releaseNotes（markdown 子集）
 * 渲染成弹窗正文。入口是 AppUpdateHost 的「重启以更新」确认框。
 */
export default function ReleaseNotes({ markdown }: { markdown: string }) {
  return <div className="release-notes">{parseReleaseNotes(markdown).map(renderBlock)}</div>;
}
