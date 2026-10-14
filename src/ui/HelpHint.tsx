// 「?」帮助气泡（票 39 Q49）：把工程信息弹窗里那枚 help 按钮抽成可复用件。
//
// 为什么抽：票 39 的登录弹窗要在标题右侧放一枚「?」（凭据说明收进去，不占常驻版面），
// 而 `.dialog-field__help-btn` / `.dialog-field__popover` 那套视觉已经在 ui.css 里了 ——
// 再各写一份就是**养第二套 help 气泡**（样式分叉的开始）。
//
// 两个方向：字段标签那种往上弹（`.dialog-field__popover` 既有形态，默认 `up`），
// 弹窗标题那种只能往下弹（`down`，`is-below` 修饰符只翻方向、不换视觉）。
// 点开才展开（不是 hover）：与「曲目归属」同款，键盘用户也能打开。
//
// 「点别处收起」必须挂在 window 的**捕获阶段**（用户的回修，2026-10-14 真机验收）：
// `Dialog` 的面板在 `onMouseDown` 上 `stopPropagation()`（见 src/ui/Dialog.tsx），
// 挂冒泡阶段根本收不到 —— 第一版就是这样，气泡点不掉。「曲目归属」那枚能收，靠的
// 正是 `pointerdown` + 捕获阶段；这里与它同款（同一件事不写两种做法）。
//
// Esc 归 `Dialog` 管：气泡收到那一下就是「关掉弹窗」（它随弹窗一起消失，不需要第三态）。
//
// **为什么不像「曲目归属」那样「Esc 先收气泡」**：那一处不是靠事件顺序，而是把气泡状态接进
// 自己的 `handleDialogClose`（弹窗的**关闭路径**问一句"气泡还开着吗"）。往上蹭同一目标的
// 监听没有用 —— `stopPropagation()` 挡不住同一节点、同一阶段注册的另一个监听（实测：气泡
// 拦了 Esc，弹窗照关）。要在这儿做，得让本组件受控、或给 `Dialog` 开一道缝，不属本票范围。
//
// **为什么方向是「往下」**：`Dialog` 的面板 `overflow: hidden`（裁圆角用），标题行在弹窗
// 最上面 —— 往上弹会被面板裁掉。既有那枚挂在弹窗中部的字段标签旁，往上有地方，所以是向上。
import { useEffect, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import './ui.css';

export default function HelpHint({ text, placement = 'up' }: {
  /** 气泡里那句话（也当 `title` / `aria-label`：悬停与读屏都念得到） */
  text: string;
  /** `up` = 气泡在按钮上方（字段标签行）；`down` = 在下方（弹窗标题，上面没地方） */
  placement?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // 点别处收起（照工程信息弹窗那份口径）：捕获阶段 + pointerdown —— 弹窗面板会在冒泡
  // 路径上 stopPropagation，挂在冒泡阶段的话点哪儿都收不掉（真机验收回修的就是这条）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  return (
    <span className="dialog-field__label-left" ref={wrapRef}>
      <button
        type="button"
        className="dialog-field__help-btn"
        title={text}
        aria-label={text}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleHelp size={13} />
      </button>
      {open && (
        <span
          className={`dialog-field__popover${placement === 'down' ? ' is-below' : ''}`}
          role="tooltip"
        >
          {text}
        </span>
      )}
    </span>
  );
}
