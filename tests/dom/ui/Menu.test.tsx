// @vitest-environment jsdom
// 票 39 锁测 2：`ProjectBits.Menu` 的两个 additive 档 —— `placement`（Q29）与 `align`
// （用户 2026-10-14 真机验收回修）。
//
// jsdom 没有布局引擎，所以这里断言**内联样式**（面板是 `position: fixed` + 内联坐标），
// 不断言坐标值；真版面里"向上弹且不出屏 / 不被左栏裁"归票 39 手工验收（票内锁测 6 已列）。
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { render } from '@testing-library/react';
import { Menu } from '@/src/pages/projects/components/ProjectBits';

function openMenu(props: { placement?: 'up' | 'down'; align?: 'start' | 'end' } = {}) {
  render(
    <Menu placement={props.placement} align={props.align} trigger={<button type="button">打开</button>}>
      <button type="button">动作</button>
    </Menu>,
  );
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
  return document.querySelector('.pp-menu__panel') as HTMLElement;
}

describe('票 39 · Menu 的 placement / align（additive，默认档不变）', () => {
  it('默认档（down + end）：与既有消费方一致 —— top + right，不写 bottom / left', () => {
    const panel = openMenu();

    expect(panel.style.top).not.toBe('');
    expect(panel.style.right).not.toBe('');
    expect(panel.style.bottom).toBe('');
    expect(panel.style.left).toBe('');
  });

  it('placement="up"：面板钉住触发器上缘（bottom），不写 top', () => {
    const panel = openMenu({ placement: 'up' });

    expect(panel.style.bottom).not.toBe('');
    expect(panel.style.top).toBe('');
  });

  it('align="start"：面板贴触发器**左缘**（left），不写 right —— 账号区靠它，右对齐会让面板朝左长出去', () => {
    const panel = openMenu({ placement: 'up', align: 'start' });

    expect(panel.style.left).not.toBe('');
    expect(panel.style.right).toBe('');
    // 左缘不越过视口左沿（钳到 8px 起）
    expect(Number.parseFloat(panel.style.left)).toBeGreaterThanOrEqual(8);
  });

  it('trigger 外面那层有稳定类名 `pp-menu__trigger`（消费方要按它把行铺开成满宽）', () => {
    openMenu({ placement: 'up', align: 'start' });

    expect(document.querySelector('.pp-menu > .pp-menu__trigger > button')).not.toBeNull();
  });

  it('trigger 可以是函数：把 open 交回调用方（账号行要在触发键上如实写 aria-expanded）', () => {
    render(
      <Menu trigger={(open) => <button type="button" aria-expanded={open}>账号</button>}>
        <button type="button">动作</button>
      </Menu>,
    );
    const trigger = screen.getByRole('button', { name: '账号' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });
});
