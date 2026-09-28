// @vitest-environment jsdom
// issue 13：自绘确认弹窗的行为锁测（替 window.confirm 的那一枚）。
// 只按 role / 文本查询；焦点与 Esc 是键盘行为（jsdom 有 focus / 事件），可以测；
// 唯二按结构取的是遮罩节点 —— "点遮罩之外的地方不关"只能靠它表达。
// 视觉（面板宽度、危险色）jsdom 无布局引擎 → 人工门票。
import '@testing-library/jest-dom/vitest';
import { useEffect, useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ConfirmDialog from '@/src/ui/ConfirmDialog';

function renderDialog() {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="删除工程"
      message="删除工程「测试」？"
      confirmLabel="删除"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { onConfirm, onCancel };
}

/** 遮罩：弹窗的宿主节点（通用壳 ui/Dialog 的），点它 = 取消 */
function scrim(): HTMLElement {
  const el = document.querySelector('.dialog__scrim');
  if (!el) throw new Error('找不到遮罩');
  return el as HTMLElement;
}

/** 一枚按钮开 / 关确认弹窗（测焦点归还） */
function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开</button>
      {open && (
        <ConfirmDialog
          title="删除工程"
          message="删除工程「测试」？"
          confirmLabel="删除"
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * 谱面代码弹窗的 Esc 接线替身：window 捕获阶段接管 + stopPropagation + 待确认时让路。
 * 真身要挂整棵 ProviderTree 才渲染得出来，这里只复制这段接线 ——
 * 锁的是「两层都听 Esc 时，Esc 只关最上面那层」这条契约。
 */
function EscHost({ onClose }: { onClose: () => void }) {
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(asking);
  askingRef.current = asking;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      if (askingRef.current) return; // 确认弹窗开着 → 这次 Esc 归它
      setAsking(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return (
    <>
      <span>{asking ? 'asking' : 'idle'}</span>
      {asking && (
        <ConfirmDialog
          title="丢弃未应用的更改"
          message="确定关闭？"
          confirmLabel="丢弃"
          onConfirm={() => { setAsking(false); onClose(); }}
          onCancel={() => setAsking(false)}
        />
      )}
    </>
  );
}

describe('issue 13 · 自绘确认弹窗', () => {
  it('是 alertdialog，可访问名就是标题，aria-labelledby 指到标题节点', () => {
    renderDialog();

    const dialog = screen.getByRole('alertdialog', { name: '删除工程' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId as string)).toHaveTextContent('删除工程');
  });

  it('打开即把焦点落在危险确认键上', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: '删除' })).toHaveFocus();
  });

  it('点确认 → onConfirm，不回调 onCancel', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '删除' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('点取消 → onCancel，不回调 onConfirm', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc → 取消', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('叠在别的弹窗之上时，Esc 只关最上面这层（宿主已 stopPropagation 也照样收到）', async () => {
    const onClose = vi.fn();
    render(<EscHost onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' }); // 宿主先接 → 起确认
    expect(await screen.findByRole('alertdialog', { name: '丢弃未应用的更改' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' }); // 这次归确认弹窗：只关它

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('点遮罩 → 取消；点面板内不关', () => {
    const { onConfirm, onCancel } = renderDialog();

    fireEvent.mouseDown(screen.getByRole('alertdialog', { name: '删除工程' }));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.mouseDown(scrim());

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Tab 在弹窗内循环，不跑到背后的页面上', () => {
    renderDialog();
    const cancel = screen.getByRole('button', { name: '取消' });
    const confirm = screen.getByRole('button', { name: '删除' });

    fireEvent.keyDown(window, { key: 'Tab' }); // 确认键是最后一站 → 回到第一站
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true }); // 反向再绕回去
    expect(confirm).toHaveFocus();
  });

  it('关掉后焦点还给打开它的那枚按钮', () => {
    render(<Host />);
    const opener = screen.getByRole('button', { name: '打开' });
    opener.focus();
    fireEvent.click(opener);

    expect(screen.getByRole('button', { name: '删除' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(opener).toHaveFocus();
  });

  it('正文与弹窗程序化关联（读屏念得到正文）', () => {
    renderDialog();

    const dialog = screen.getByRole('alertdialog', { name: '删除工程' });
    const descId = dialog.getAttribute('aria-describedby');
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId as string)).toHaveTextContent('删除工程「测试」？');
  });
});
