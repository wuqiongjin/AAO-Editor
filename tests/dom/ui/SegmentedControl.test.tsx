// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SegmentedControl from '@/src/ui/SegmentedControl';

const opts = [
  { value: 'cover' as const, label: '铺满裁剪' },
  { value: 'contain' as const, label: '完整显示' },
];

describe('SegmentedControl', () => {
  it('当前档 aria-checked；点另一档才 onChange', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl label="填充方式" value="contain" options={opts} onChange={onChange} />,
    );
    const group = screen.getByRole('radiogroup', { name: '填充方式' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '完整显示' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '完整显示' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: '铺满裁剪' }));
    expect(onChange).toHaveBeenCalledWith('cover');
  });

  it('disabled 时点了也不写', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl label="填充方式" value="cover" options={opts} onChange={onChange} disabled />,
    );
    fireEvent.click(screen.getByRole('radio', { name: '完整显示' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
