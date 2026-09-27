// 锁住「封面字段不回到未隐藏的原生 file input」这条结构约定。
//
// 为什么是静态断言：DOM 测试只能证明「改完之后跑得通」，证明不了「以后不会被改回
// 未隐藏的原生控件」——未隐藏与否是 CSS/结构事实，jsdom 没有布局引擎，只看得到类名。
// 故按本仓既有惯例（EditorAudioSessionRefactor）锁源码接线。
import { describe, expect, it } from 'vitest';
import { readStripped } from '@/tests/support/source';

const PAGE = readStripped('src/pages/ProjectsPage.tsx');
const FIELD = readStripped('src/ui/CoverField.tsx');

describe('chart-projects 12: 编辑工程信息封面字段改为自绘上传区', () => {
  it('EditInfoDialog 所在文件里不再出现任何 type="file" 字面', () => {
    expect(PAGE).not.toMatch(/type="file"/);
  });

  it('封面字段走 CoverField 自绘组件（原生 input 已下沉到 ui 组件）', () => {
    expect(PAGE).toMatch(/<CoverField\b/);
    expect(PAGE).toMatch(/from '\.\.\/ui\/CoverField'/);
  });

  it('CoverField 里唯一那份原生 input 是视觉隐藏的（沿用音频页做法）', () => {
    const inputs = FIELD.match(/<input\b[\s\S]*?>/g) ?? [];
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toContain('visually-hidden-input');
    expect(inputs[0]).toContain('accept="image/*"'); // 类型仍限 image/*
  });

  it('patch 出参不变：仍然只写 coverName / coverBlob / clearCover 三个字段', () => {
    expect(PAGE).toMatch(/coverName:/);
    expect(PAGE).toMatch(/coverBlob:/);
    expect(PAGE).toMatch(/clearCover:/);
  });
});
