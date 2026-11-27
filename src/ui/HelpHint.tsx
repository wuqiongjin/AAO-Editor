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
// **为什么保留两种方向**：弹窗标题等顶部触发器上方无空间，默认向下（`down`）；字段行触发器默认向上（`up`）。
// 气泡本身通过 `createPortal(..., document.body)` + `position: fixed` 定位并夹紧在视口内，防止被窄面板或
// `overflow: hidden / auto` 容器裁切，上下空间不足时也会自动翻转方向。
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import './ui.css';

const VIEWPORT_MARGIN = 8;
const POPOVER_GAP = 8;
const POPOVER_TARGET_W = 280;
const POPOVER_MIN_W = 160;
const FLIP_THRESHOLD = 88;
const ARROW_HALF = 5;

interface HelpHintLayout {
  placement: 'up' | 'down';
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  arrowLeft: number;
}

/** 根据触发按钮视口坐标计算 Portal 气泡位置与箭头偏移，防止被 overflow 容器裁切或溢出视口。 */
function computeHelpHintLayout(
  rect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>,
  preferredPlacement: 'up' | 'down',
  viewportW: number,
  viewportH: number,
): HelpHintLayout {
  const width = Math.min(POPOVER_TARGET_W, Math.max(POPOVER_MIN_W, viewportW - VIEWPORT_MARGIN * 2));
  const hasBox = rect.width > 0 || rect.height > 0;

  let placement = preferredPlacement;
  if (hasBox) {
    if (placement === 'up' && rect.top < FLIP_THRESHOLD && viewportH - rect.bottom > rect.top) {
      placement = 'down';
    } else if (placement === 'down' && viewportH - rect.bottom < FLIP_THRESHOLD && rect.top > viewportH - rect.bottom) {
      placement = 'up';
    }
  }

  const centerX = (rect.left + rect.right) / 2;
  const preferredLeft = placement === 'down' ? centerX - 24 : centerX - width / 2;
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportW - width - VIEWPORT_MARGIN);
  const left = Math.min(Math.max(VIEWPORT_MARGIN, preferredLeft), maxLeft);
  const arrowLeft = Math.min(Math.max(12, centerX - left - ARROW_HALF), Math.max(12, width - 22));

  if (placement === 'down') {
    return { placement, left, top: rect.bottom + POPOVER_GAP, width, arrowLeft };
  }
  return { placement, left, bottom: viewportH - rect.top + POPOVER_GAP, width, arrowLeft };
}

export default function HelpHint({ text, placement = 'up' }: {
  /** 气泡里那句话（也当 `title` / `aria-label`：悬停与读屏都念得到） */
  text: string;
  /** `up` = 气泡在按钮上方（字段标签行）；`down` = 在下方（弹窗标题，上面没地方） */
  placement?: 'up' | 'down';
}) {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<HelpHintLayout | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);

  const syncLayout = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const next = computeHelpHintLayout(
      btn.getBoundingClientRect(),
      placement,
      window.innerWidth,
      window.innerHeight,
    );
    setLayout((prev) => (
      prev &&
      prev.placement === next.placement &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.bottom === next.bottom &&
      prev.width === next.width &&
      prev.arrowLeft === next.arrowLeft
        ? prev
        : next
    ));
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    syncLayout();
  }, [open, syncLayout]);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const onResize = () => {
      syncLayout();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(syncLayout);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', syncLayout, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', syncLayout, true);
      cancelAnimationFrame(raf);
    };
  }, [open, syncLayout]);

  // 点别处收起（照工程信息弹窗那份口径）：捕获阶段 + pointerdown —— 弹窗面板会在冒泡
  // 路径上 stopPropagation，挂在冒泡阶段的话点哪儿都收不掉（真机验收回修的就是这条）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (wrapRef.current?.contains(target) || popoverRef.current?.contains(target))) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const resolvedLayout = layout ?? {
    placement,
    left: VIEWPORT_MARGIN,
    ...(placement === 'down' ? { top: POPOVER_GAP } : { bottom: POPOVER_GAP }),
    width: POPOVER_TARGET_W,
    arrowLeft: placement === 'down' ? 14 : 60,
  };

  const popoverStyle: CSSProperties & Record<'--help-hint-arrow-left', string> = {
    left: resolvedLayout.left,
    width: resolvedLayout.width,
    top: resolvedLayout.placement === 'down' ? resolvedLayout.top : 'auto',
    bottom: resolvedLayout.placement === 'up' ? resolvedLayout.bottom : 'auto',
    '--help-hint-arrow-left': `${resolvedLayout.arrowLeft}px`,
  };

  return (
    <span className="dialog-field__label-left" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="dialog-field__help-btn"
        title={text}
        aria-label={text}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <CircleHelp size={13} />
      </button>
      {open && createPortal(
        <span
          ref={popoverRef}
          className={`dialog-field__popover is-portaled${resolvedLayout.placement === 'down' ? ' is-below' : ''}`}
          style={popoverStyle}
          role="tooltip"
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}
