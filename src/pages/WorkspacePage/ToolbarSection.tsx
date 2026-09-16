// 左侧工具栏的区块标题（统一样式：小号大写灰字）。
// 单独成文件：Toolbar 与 CurveConfigPanel 共用，避免两者互相 import 形成循环。
import type { ReactNode } from 'react';

export default function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 className="toolbar__section-header">{children}</h3>
  );
}
