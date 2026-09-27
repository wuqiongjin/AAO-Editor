// @vitest-environment jsdom
// 封面上传区的行为锁测。
//
// 口径：只按 role / 文本查询，断言行为不断言实现细节 —— 唯二的例外是
// 「给隐藏 input 灌 File」这一步（读屏层面没有对应 role，只能取元素句柄模拟选文件），
// 以及预览图的 src（那正是"预览的是刚选的那张图"这条行为本身）。
// 视觉（虚线框尺寸、缩略图比例）jsdom 没有布局引擎，测不了 —— 走人工截图门票。
// 原生 input 是否视觉隐藏由 tests/static/EditInfoDialogNoRawInput.test.ts 锁（结构事实）。
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CoverField, { type CoverValue } from '@/src/ui/CoverField';

/** jsdom 不实现 objectURL：发可辨认的假 URL，并记下建过/回收过几个。 */
let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let seq = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: () => {
      seq += 1;
      const url = `blob:probe/${seq}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function imageFile(name = 'cover.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
}

/** 受控壳：真实业务（EditInfoDialog）就是这么用的 —— 自己持 value，既有封面的 URL 回喂组件。 */
function Harness({ existingUrl = null }: { existingUrl?: string | null }) {
  const [value, setValue] = useState<CoverValue>(null);
  return (
    <CoverField
      label="封面"
      value={value}
      previewUrl={existingUrl}
      onChange={(next) => { changes.push(next); setValue(next); }}
    />
  );
}

let changes: CoverValue[] = [];

/** 模拟"用户在系统文件框里选了文件"：隐藏 input 没有对应 role，只能取句柄。 */
function pickFile(file: File) {
  const el = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error('找不到原生 file input');
  fireEvent.change(el, { target: { files: [file] } });
}

function fileInput(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!el) throw new Error('找不到原生 file input');
  return el;
}

describe('chart-projects 12 · CoverField 自绘封面上传区', () => {
  beforeEach(() => {
    changes = [];
  });

  it('无封面：上传区是一枚有可访问名的按钮，且标题与它程序化关联', () => {
    render(<Harness />);

    const drop = screen.getByRole('button', { name: /点击上传封面/ });
    expect(drop).toBeInTheDocument();
    expect(drop).toHaveTextContent('或拖入图片');
    // 标题不再是裸 span：group 用它当可访问名，读屏念得到"封面"
    expect(screen.getByRole('group', { name: '封面' })).toContainElement(drop);
  });

  it('点上传区 → 代触发隐藏 input 的 click（自绘区域不自己弹窗）', () => {
    render(<Harness />);
    const click = vi.spyOn(fileInput(), 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByRole('button', { name: /点击上传封面/ }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('选了文件：出缩略图预览 + 更换/清除两个文字按钮，并回 File', () => {
    render(<Harness />);
    const file = imageFile();

    pickFile(file);

    expect(changes).toEqual([file]);
    const thumb = screen.getByRole('img', { name: '封面' });
    expect(thumb).toHaveAttribute('src', 'blob:probe/1'); // 预览用的就是刚选的那个 File
    expect(screen.getByRole('button', { name: '更换' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /点击上传封面/ })).not.toBeInTheDocument();
  });

  it('点清除：预览消失、回到上传区，onChange 回 clear 语义', () => {
    render(<Harness existingUrl="blob:existing/1" />);
    expect(screen.getByRole('img', { name: '封面' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除' }));

    expect(changes).toEqual(['clear']);
    // 'clear' 由组件自己吃掉：调用方没把 previewUrl 置空，预览照样消失
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /点击上传封面/ })).toBeInTheDocument();
  });

  it('已有关联封面（value=null + previewUrl）：渲染该预览与两个按钮', () => {
    render(<Harness existingUrl="blob:existing/1" />);

    expect(screen.getByRole('img', { name: '封面' })).toHaveAttribute('src', 'blob:existing/1');
    expect(screen.getByRole('button', { name: '更换' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
    expect(created).toHaveLength(0); // 调用方给好的 URL 不该再开一份
  });

  it('换文件后旧 objectURL 回收，不留泄漏', () => {
    render(<Harness />);
    pickFile(imageFile('a.png'));
    expect(created).toEqual(['blob:probe/1']);

    fireEvent.click(screen.getByRole('button', { name: '更换' }));
    pickFile(imageFile('b.png'));

    expect(created).toEqual(['blob:probe/1', 'blob:probe/2']);
    expect(revoked).toEqual(['blob:probe/1']);
    expect(screen.getByRole('img', { name: '封面' })).toHaveAttribute('src', 'blob:probe/2');
  });

  it('清除后重新选图：预览回来，且不再是 clear 语义', () => {
    render(<Harness existingUrl="blob:existing/1" />);
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    pickFile(imageFile('c.png'));

    expect(changes[changes.length - 1]).toBeInstanceOf(File);
    expect(screen.getByRole('img', { name: '封面' })).toHaveAttribute('src', 'blob:probe/1');
  });
});
