// issue 23 #4：详情页头部（封面 + 标题块 + 按钮组）与谱面行的布局，只锁"接线事实"。
//
// 症状演进（用户 2026-09-28 三轮截图）：
//   第一轮：窄窗口下按钮组与标题块抢同一行 → 标题断两行、「设置音频」chip 被压成竖排单字；
//           谱面行 5 个动作控件把标题列挤成一字一行的竖排。
//   第二轮：改成"折行兜底"后，**按钮组的落点随文字内容变** —— 切到不同工程，
//           按钮组在两个高度之间跳（用户："这东西就应该固定在一个位置"）。
//   第三轮：折行兜底仍让**按钮自己在组内折成两行**；用户要"按钮保持一行、
//           窄窗时整组挪到文字下方"，且"相同窗口尺寸下按钮布局与文字长短无关"。
//
// 最终口径（**这是本文件真正在守的东西**）：
//   ① **判据必须是容器宽度，不是内容宽度**：`.pc-detail` 设 `container-type: inline-size`，
//      用 `@container`（而非 viewport media query —— 左栏可拖拽，窗口宽 ≠ 详情栏宽）
//      在窄栏时把头部整体改成上下两段（按钮组挪到文字下方独占一行）。
//      这样同一详情栏宽度下，无论工程名/音频名多长，按钮布局都一样。
//   ② 按钮**恒一行**：动作组基础规则**不写 `flex-wrap`**（写了就会随内容宽度折行，
//      同一窗口下不同工程长得不一样）。
//   ③ 动作组的 y 稳定靠 **显式 `height: 96px`（= 封面高）+ `align-self: flex-start`**，
//      不用 `align-self: center`（center 跟着"被文字块撑高的整行中线"漂）。
//
// 反面教训（别再走回去）：
//   ① `align-self: center` / `align-items: center` —— 跟着整行中线漂；
//   ② 给动作组设 min-width / flex-basis 强制折行 → 还很宽敞时就抢占整行；
//   ③ 无条件 `flex-wrap` 或 viewport media query —— 两者都让"折不折"取决于内容 / 窗口而非容器。
//
// 真正的观感（位置、间距）jsdom 验不了 → 票内人工门票 / headless 真渲染截图；
// 这里锁的是"这几条声明不许被悄悄改成反面"。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped } from '@/tests/support/source';
import { PROJECT_LIST_WIDTH } from '@/src/chart/config/AppSettings';

const css = readSource('src/pages/projects/ProjectsPage.css');

describe('issue 23 #4 · 详情页头部布局的接线', () => {
  it('详情栏是查询容器（判据走容器宽度，不走窗口宽度）', () => {
    const block = css.match(/\.pc-detail\s*\{([^}]*)\}/s);
    expect(block, '.pc-detail 不见了').toBeTruthy();
    expect(block![1]).toMatch(/container-type:\s*inline-size/);
    // 反面：viewport media query 跟不上可拖拽的左栏，窗口宽 ≠ 详情栏宽
    expect(css).not.toMatch(/@media[^{]*\{[\s\S]*\.pc-detail__head/);
  });

  it('宽栏下头部不折行，动作组与标题同行（位置不随内容变）', () => {
    const head = css.match(/\.pc-detail__head\s*\{([^}]*)\}/s);
    expect(head, '.pc-detail__head 不见了').toBeTruthy();
    expect(head![1]).not.toMatch(/flex-wrap:\s*wrap/);
  });

  it('动作组 y 锚在封面（固定 height + align-self:flex-start），不用会漂的 center', () => {
    const block = css.match(/\.pc-detail__actions\s*\{([^}]*)\}/s);
    expect(block, '.pc-detail__actions 不见了').toBeTruthy();
    // 固定高度 = 封面高，让自身高度与文字块无关
    expect(block![1]).toMatch(/height:\s*96px/);
    // 贴行顶（行顶即封面顶）→ 中线恒等于封面中线
    expect(block![1]).toMatch(/align-self:\s*flex-start/);
    // 反面：center 会跟着被撑高的整行中线漂
    expect(block![1]).not.toMatch(/align-self:\s*center/);
    expect(block![1]).toMatch(/justify-content:\s*flex-end/);
    // 按钮**恒一行**：基础规则不许折行（折行判据会退化成"内容宽度"）
    expect(block![1]).not.toMatch(/flex-wrap/);
    // 反面：给动作组设 flex-basis / **正的**下限会在还很宽敞时就折行、位置飘
    // （`min-width: 0` 只是允许收缩，不是下限，允许存在）
    expect(block![1]).not.toMatch(/flex-basis/);
    expect(block![1]).not.toMatch(/min-width:\s*(?!0\b)\d/);
  });

  it('文字块可缩，但保留可读下限（不再被挤成一字一行）', () => {
    const block = css.match(/\.pc-detail__body\s*\{([^}]*)\}/s);
    expect(block, '.pc-detail__body 不见了').toBeTruthy();
    expect(block![1]).toMatch(/flex:\s*1 1 0/);
    // 下限是可读性保证：太小会把那行字压成竖排单字（曾实测 900px；当时那行是「歌手 · 来源」，
    // 票 37 起只剩歌手，下限照旧）
    expect(block![1]).toMatch(/min-width:\s*140px/);
  });

  // 头部有三个直系 <div>：封面、文字块、**按钮组**。任何"宽选择器"（`> div`、
  // `> div:not(.pp-cover)`）都会顺手套到按钮组上，用更高的 specificity 覆盖它的
  // `flex`，把它变成可伸缩项 → 按钮组被文字块挤扁、内部堆成三行（用户截图）。
  // 所以只能按显式类名定位文字块。
  it('文字块按显式类名定位，不用会误伤封面 / 按钮组的宽选择器', () => {
    expect(css).not.toMatch(/\.pc-detail__head\s*>\s*div\s*\{/);
    expect(css).not.toMatch(/\.pc-detail__head\s*>\s*div:not\(/);
    // 动作组必须保住自己的 flex（不被文字块规则覆盖）
    const block = css.match(/\.pc-detail__actions\s*\{([^}]*)\}/s);
    expect(block, '.pc-detail__actions 不见了').toBeTruthy();
    expect(block![1]).toMatch(/flex:\s*0 0 auto/);
  });

  it('窄栏兜底：@container 下整体改上下两段，上段钉死 96px 保 y 恒定', () => {
    const cq = css.match(/@container\s*\(max-width:\s*760px\)\s*\{([\s\S]*?)\n\}/);
    expect(cq, '@container (max-width: 760px) 兜底不见了').toBeTruthy();
    expect(cq![1]).toMatch(/\.pc-detail__head\s*\{[^}]*flex-wrap:\s*wrap/);
    // 上段高度钉死 = 封面高，否则音频名折行会把下段动作组推走（Henceforth y 177 vs 144）
    expect(cq![1]).toMatch(/\.pc-detail__body\s*\{[^}]*height:\s*96px/);
    expect(cq![1]).toMatch(/\.pc-detail__body\s*\{[^}]*overflow:\s*hidden/);
  });

  it('工程名过长省略号收尾（不再靠折行消化）', () => {
    const h2 = css.match(/\.pc-detail__head h2\s*\{([^}]*)\}/s);
    expect(h2, '.pc-detail__head h2 不见了').toBeTruthy();
    expect(h2![1]).toMatch(/text-overflow:\s*ellipsis/);
    expect(h2![1]).toMatch(/white-space:\s*nowrap/);
  });

  it('「设置音频」chip 不可断行（它就是被压成竖排单字的那一个）', () => {
    const block = css.match(/\.pc-audio-jump\s*\{([^}]*)\}/s);
    expect(block, '.pc-audio-jump 不见了').toBeTruthy();
    expect(block![1]).toMatch(/white-space:\s*nowrap/);
  });
});

// 同一病症的第二处（issue 23 #4 收尾时真渲染暴露）：谱面行的动作组 5 个控件
// 不肯缩，把标题列挤成一字一行的竖排、整行还溢出横向滚动条。
describe('issue 23 #4 · 谱面行布局的接线', () => {
  it('谱面行恒一行、不折行，且不退回 grid（auto 轨道撑破容器）', () => {
    const row = css.match(/\.pc-chart\s*\{([^}]*)\}/s);
    expect(row, '.pc-chart 不见了').toBeTruthy();
    expect(row![1]).not.toMatch(/flex-wrap:\s*wrap/);
    expect(row![1]).not.toMatch(/grid-template-columns/);
  });

  it('标题列可缩到任意窄并省略号收尾（动作组位置不随标题长度变）', () => {
    const title = css.match(/\.pc-chart__title\s*\{([^}]*)\}/s);
    expect(title, '.pc-chart__title 不见了').toBeTruthy();
    expect(title![1]).toMatch(/flex:\s*1 1 0/);
    expect(title![1]).toMatch(/min-width:\s*0/);
    expect(css).toMatch(/\.pc-chart__title b\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });

  it('动作组宽度由内容决定、恒贴行右缘（与头部同一套口径）', () => {
    const block = css.match(/\.pc-chart__actions\s*\{([^}]*)\}/s);
    expect(block, '.pc-chart__actions 不见了').toBeTruthy();
    expect(block![1]).toMatch(/flex:\s*0 0 auto/);
    // 反面：flex-basis / min-width / flex-wrap 都会让动作组自成一行或位置飘
    expect(block![1]).not.toMatch(/flex-basis/);
    expect(block![1]).not.toMatch(/min-width/);
    expect(block![1]).not.toMatch(/flex-wrap:\s*wrap/);
  });
});

// 同一病症的第三处（issue 25，用户 2026-09-29 报障）：**行高跟着字体回落走**。
// `line-height: normal` 的行盒高度取"这一行实际命中的字体"的度量 —— 同一个字体栈下，
// 拉丁命中 Geist（--text-sm 13px → 17px 行盒），中文回落 Microsoft YaHei（13px → 18px 行盒），
// 同字号差 1px。名字行（谱面标题 / 工程名）是行内最高项，于是**名字带不带中文**决定：
// 谱面行 56/57、列表盒 115/116、左栏工程行 57/58、其后区块 y 371/372（headless 实测，zh-CN + 出厂字体栈）。
// 与 issue 23 #4 同源：**布局判据不许依赖文字内容** —— 那边是宽度，这边是高度。
// 行高只跟字号走：unitless 随 --ui-type-scale 缩放，写 px 反而会在字号档被钉死。
describe('issue 25 · 名字行的行高不跟字体回落走', () => {
  const NAMES = ['\\.pc-chart__title b', '\\.pc-chart__title small', '\\.pc-item__text b', '\\.pc-item__text small'];

  it('谱面行 + 左栏工程行的名字两行都由同一条规则钉显式行高', () => {
    const rule = css.match(/\.pc-chart__title b,[\s\S]*?\.pc-item__text small\s*\{([^}]*)\}/);
    expect(rule, '名字行的行高规则不见了（line-height 回到了 normal）').toBeTruthy();
    for (const sel of NAMES) expect(rule![0], `${sel} 没进这条规则`).toMatch(new RegExp(sel));
    expect(rule![1]).toMatch(/line-height:\s*1\.3\b/);
  });

  it('名字行没有任何一条声明退回 line-height: normal（那正是本票的因）', () => {
    for (const sel of NAMES) {
      const blocks = [...css.matchAll(new RegExp(`${sel}\\s*\\{([^}]*)\\}`, 'g'))];
      expect(blocks.length, `${sel} 一条声明都没有`).toBeGreaterThan(0);
      for (const b of blocks) expect(b[1], `${sel} 把行高交回给字体度量了`).not.toMatch(/line-height:\s*normal/);
    }
  });
});

describe('issue 23 #2 · 详情页左栏分栏的接线', () => {
  it('三列网格：列表宽走内联 --pc-list-w，分隔条自己占 6px 一列', () => {
    const block = css.match(/\.pc-page\s*\{([^}]*)\}/s);
    expect(block, '.pc-page 不见了').toBeTruthy();
    expect(block![1]).toMatch(/grid-template-columns:\s*var\(--pc-list-w,\s*300px\)\s*6px\s*minmax\(0,\s*1fr\)/);
  });

  it('分隔条有命中区与 col-resize 光标（hover/拖动高亮 accent）', () => {
    expect(css).toMatch(/\.pc-split\s*\{[^}]*cursor:\s*col-resize/s);
    expect(css).toMatch(/\.pc-split:hover::before,\s*\.pc-split\.is-dragging::before\s*\{[^}]*background:\s*var\(--accent\)/s);
  });

  it('CSS 不写第二套 min/max（夹取只在 JS 侧，两把尺子会分叉）', () => {
    const block = css.match(/\.pc-page\s*\{([^}]*)\}/s)![1];
    expect(block).not.toMatch(/clamp\(/);
    expect(block).not.toMatch(/\d+vw/);
  });

  // 规格 L70 要求"夹取上下限常量在 CSS 与 JS 两侧同源"。CSS 的兜底值没法 import 常量，
  // 所以这里把"两边写的是同一个数"钉成断言：改 PROJECT_LIST_WIDTH.default 而忘了改 CSS，
  // 或反过来，这条会红。**别把这条删了改成注释** —— 注释不能防分叉。
  it('CSS 兜底值与 PROJECT_LIST_WIDTH.default 同源', () => {
    const { min, max, default: dft } = PROJECT_LIST_WIDTH;
    const block = css.match(/\.pc-page\s*\{([^}]*)\}/s)![1];
    const literal = block.match(/var\(--pc-list-w,\s*(\d+)px\)/)?.[1];
    expect(Number(literal), `CSS 兜底 ${literal}px 与 PROJECT_LIST_WIDTH.default ${dft} 分叉了`).toBe(dft);

    // 夹取区间不在 CSS 复述（只在 JS 一处），这条是配套的"没写第二套"证明
    expect(block).not.toContain(`${min}px`);
    expect(block).not.toContain(`${max}px`);
  });
});

// 票 37（用户 2026-10-13 验收，附详情页头部截图）：副行曾写「<歌手> · <曲目来源>」，
// bandori 曲显示成「Poppin'Party · BanG Dream #804」—— 站点名对用户是废话，`#804` 又与
// 下一行音频名（票 35 起自带曲库 id：`official-804-英…mp3`）重复，用户判定删掉。
// 这里锁「别再长回来」：那一行只剩歌手，`sourceLabel` 与其三枚文案键一并退役。
// **`曲目来源` 字段本身没删**（发布时要按它填 `song`，工程信息弹窗里可改，换音频时还会回自定义），
// 弹窗用的是另一组键 `projects.source{Custom,Bandori,Llsif}`，本票不许误伤。
describe('票 37 · 详情页副行不再显示曲目来源', () => {
  const detail = readStripped('src/pages/projects/components/ProjectDetail.tsx');
  const format = readStripped('src/pages/projects/projectFormat.ts');
  const FILES = ['src/i18n/messages/zh-CN.json', 'src/i18n/messages/en.json'];

  it('ProjectDetail 不再引用 sourceLabel，副行只渲染歌手', () => {
    expect(detail).not.toMatch(/sourceLabel/);
    expect(detail).toMatch(/projects\.artistMissing/);
  });

  it('sourceLabel 工具函数已退役（渲染点只有详情页那一处）', () => {
    expect(format).not.toMatch(/export function sourceLabel/);
  });

  it('三枚 sourceLabel.* 文案键已清掉，chart-projects 票 30 下线 sourceLlsif 并改用只读徽标文案', () => {
    for (const file of FILES) {
      const messages = JSON.parse(readSource(file)) as Record<string, string>;
      expect(Object.keys(messages).filter((k) => k.startsWith('projects.sourceLabel.')), file).toEqual([]);
      // chart-projects 票 30：LLSIF 彻底下线，不再保留 sourceLlsif 键
      expect(messages['projects.sourceLlsif'], file).toBeUndefined();
      // chart-projects 票 30：工程信息只读徽标与提示文案必须就绪
      expect(messages['projects.sourceBadgeCustom'], file).toBeTruthy();
      expect(messages['projects.sourceBadgeBandori'], file).toBeTruthy();
      expect(messages['projects.sourceCustomHint'], file).toBeTruthy();
      expect(messages['projects.sourceBandoriHint'], file).toBeTruthy();
    }
  });
});
