// 架构深化评审候选 3 收口后：Editor.tsx 不再持有 audioMetaRef / persistRef ref 环。
// 静态源回归测试：防止后续重构意外复活旧的"音频元数据 ref 桥"反模式。
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { readStripped, repoRoot } from '@/tests/support/source';

const editorSrc = readFileSync(
  join(repoRoot, 'src/pages/workspace/WorkspacePage.tsx'),
  'utf-8',
);

describe('Editor.tsx · 候选 3 收口（音频域 ref 环消解）', () => {
  it('不再声明 audioMetaRef', () => {
    expect(editorSrc).not.toMatch(/audioMetaRef\s*=/);
  });

  it('不再声明 persistRef 用来桥接 audioBridge', () => {
    // persistRef 在注释里允许出现，但作为 ref 变量声明不允许
    expect(editorSrc).not.toMatch(/persistRef\s*=\s*useRef/);
  });

  it('不再使用 AudioPageContext 桥接 API（已删除）', () => {
    // 检测实际代码使用（不查注释）
    const codeOnly = editorSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toContain('AudioPageContext');
    expect(codeOnly).not.toContain('useAudioPage');
    expect(codeOnly).not.toContain('useAudioPageRegister');
  });

  it('不再直接 new AudioEngine()（session 单例负责）', () => {
    expect(editorSrc).not.toMatch(/new\s+AudioEngine\s*\(/);
  });

  it('不再单独 import AudioEngine（仅由 session 透出）', () => {
    // 路径字面量随 WorkspacePage 移到 src/pages/workspace/ 补一层（architecture-refactor 02，语义未动）
    expect(editorSrc).not.toMatch(/import\s+\{[^}]*AudioEngine[^}]*\}\s+from\s+['"]\.\.\/\.\.\/utils\/AudioEngine['"]/);
  });

  it('走 useAudioSession 取音频会话', () => {
    expect(editorSrc).toMatch(/useAudioSession/);
  });

  it('不在 useAudioBridge 解构 dismissError（候选 3 收口后桥不再返回供 Editor 用）', () => {
    const codeOnly = editorSrc.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toMatch(/const\s*\{\s*dismissError\s*\}/);
  });

  it('chartEndKey 仅作重锚 effect 依赖使用（缩放锚定修复后的唯一消费者）', () => {
    // architecture-refactor/09（候选 4）：重锚装配搬进谱面视口会话，断言随宿主改锚（内容逐条不变）。
    const codeOnly = readStripped('src/playback/useChartViewSession.ts');
    const uses = codeOnly.match(/chartEndKey/g) ?? [];
    expect(uses.length).toBe(3); // useChartSpace 解构 + useScrollModel 注入 + effect 依赖
    expect(codeOnly).toMatch(/\{\s*geometry,\s*chartEndKey\s*\}\s*=\s*useChartSpace/);
    expect(codeOnly).toMatch(/geometry,\s*scale,\s*chartEndKey/);
    expect(codeOnly).toMatch(/\},\s*\[virtualHeight,\s*chartEndKey\]\)/);
  });

  it('主音量改走 session.setVolume（候选 3 收口后由 session 转发）', () => {
    expect(editorSrc).toMatch(/audioSession\.setVolume\(/);
    expect(editorSrc).not.toMatch(/audioSession\.setEngineVolume\(/);
  });
});

describe('App.tsx · 候选 3 收口（音频会话 Provider 挂载）', () => {
  const appSrc = readFileSync(
    join(repoRoot, 'src/App.tsx'),
    'utf-8',
  );

  it('挂载 AudioSessionProvider（替代 AudioPageProvider）', () => {
    // issue 48 整改后，App.tsx 改用 ProviderTree 间接挂载；AudioSessionProvider
    // 现在住在 src/app/providers/AudioSessionProvider.tsx，被 ProviderTree 引用。
    // 这里同时校验「App.tsx 走 ProviderTree」和「ProviderTree 引用 AudioSessionProvider」。
    const providerTreeSrc = readFileSync(
      join(repoRoot, 'src/app/ProviderTree.tsx'),
      'utf-8',
    );
    expect(providerTreeSrc).toMatch(/AudioSessionProvider/);
    expect(appSrc).toMatch(/ProviderTree/);
    expect(appSrc).not.toMatch(/AudioPageProvider/);
  });

  it('不再 import AudioPageContext（已删除）', () => {
    expect(appSrc).not.toMatch(/from\s+['"]\.\/contexts\/AudioPageContext['"]/);
  });
});

describe('AudioPage.tsx · 候选 3 收口（直读 useAudioSession）', () => {
  const audioPageSrc = readFileSync(
    join(repoRoot, 'src/pages/audio/AudioPage.tsx'),
    'utf-8',
  );

  it('不再用 useAudioPage（已删除的桥）', () => {
    expect(audioPageSrc).not.toMatch(/useAudioPage/);
  });

  it('不再单独从 useConfig 读 settings.audio（已并入 session）', () => {
    // 旧实现：const { settings, setKeySetId } = useConfig() + settings.audio.keySet
    // 新实现：useAudioSession().keySetId + session.setKeySetId()
    // 仅检查 JSX 表达式与解构，不查段落文案
    const codeOnly = audioPageSrc
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<p>[\s\S]*?<\/p>/g, ''); // 去掉 <p>...</p> 段落
    expect(codeOnly).not.toMatch(/settings\.audio\.keySet/);
    expect(codeOnly).not.toMatch(/settings\.audio\.seVolume/);
    // 显式不 import useConfig（路径字面量随 AudioPage 移到 src/pages/audio/ 补一层，语义未动）
    expect(codeOnly).not.toMatch(/import\s*\{[^}]*\buseConfig\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/contexts['"]/);
  });
});
