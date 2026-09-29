// 04 票 · 「谱面代码只从一个口解析」的**静态看守**。
//
// 单测（`tests/unit/chart/code/ParseCodeText.test.ts`）证明入口本身只 parse 一次；
// 这里锁的是**调用方接线**：谁都不许再对谱面代码文本自己 `JSON.parse` 一遍。
// 修复前 projectCatalog / 弹窗各自「校验 parse 一遍、取数组再 parse 一遍」，
// 根因是校验把解析出的数组丢了；这两个名字一回来，这条文件会红。
import { describe, it, expect } from 'vitest';
import { readStripped } from '@/tests/support/source';

const CATALOG = 'src/project/projectCatalog.ts';
const MODAL = 'src/chart/components/code-editor/ChartCodeEditorModal.tsx';
const CONVERTER = 'src/chart/editing/ChartConverter.ts';
const NOTE_CODE_OPS = 'src/chart/editing/NoteCodeOps.ts';
const ANALYZE_SCRIPT = 'scripts/analyze-stress-test-charts.ts';

/** 取一个顶层函数的源码区间（到下一个顶层 `export ` 为止），用来把断言钉在具体函数体内 */
function functionBody(src: string, signature: string): string {
  const from = src.indexOf(signature);
  expect(from).toBeGreaterThan(-1);
  const next = src.indexOf('\nexport ', from + signature.length);
  return src.slice(from, next === -1 ? undefined : next);
}

describe('谱面代码 · 一个入口（ChartConverter.parseCodeText）', () => {
  it('两个肇事入口已消失，仓库里再无调用点', () => {
    for (const rel of [CATALOG, MODAL, CONVERTER, NOTE_CODE_OPS, ANALYZE_SCRIPT]) {
      const src = readStripped(rel);
      expect(src).not.toContain('validateChartCodeJSON');
      expect(src).not.toContain('parseChartCodeFromJSON');
    }
  });

  it('工程目录加谱面：一次 parseCodeText，errors 非空即拒', () => {
    const src = readStripped(CATALOG);
    expect(src).toContain('parseCodeText(trimmed)');
    expect(src.split('parseCodeText(')).toHaveLength(2);
    // 除 `cloneJson`（深拷贝 notes，与谱面代码文本无关）外不得再有 JSON.parse
    expect(src.split('JSON.parse(')).toHaveLength(2);
    expect(functionBody(src, 'function cloneJson')).toContain('JSON.parse(');
  });

  it('弹窗：完整视图不再自己对文本 JSON.parse', () => {
    const src = readStripped(MODAL);
    expect(src.split('JSON.parse(')).toHaveLength(1);
    // 校验与应用共用同一次解析结果：完整视图的文本解析只出现一处
    expect(src.split('parseCodeText(')).toHaveLength(2);
  });

  it('弹窗校验函数把 code 交给调用方（"应用"不再二次解析）', () => {
    const body = functionBody(readStripped(MODAL), 'const validateCode');
    expect(body).toMatch(/parseCodeText\(/);
    const apply = functionBody(readStripped(MODAL), 'const handleApply');
    expect(apply).toMatch(/const \{ code: parsedCode, errors \} = validateCode\(chartCode\)/);
    expect(apply).toMatch(/hasBeat0Bpm\(parsedCode\)/);
    expect(apply).toMatch(/commitApply\(parsedCode, chartCode\)/);
  });

  it('解析侧唯一真相源：ChartConverter 里 JSON.parse 只有一处（解析原语）', () => {
    const src = readStripped(CONVERTER);
    expect(src.split('JSON.parse(')).toHaveLength(2);
    expect(functionBody(src, 'export function parseCodeRaw')).toContain('JSON.parse(');
    expect(functionBody(src, 'export function parseCodeText')).not.toContain('JSON.parse(');
    // 粘贴重排（`normalizeChartCodeText`）也只经原语
    expect(functionBody(src, 'export function normalizeChartCodeText')).toContain('parseCodeRaw(');
  });

  it('压力测试盘点脚本：同一份语料文本也只解析一次', () => {
    const src = readStripped(ANALYZE_SCRIPT);
    const from = src.indexOf('async function analyzeFile');
    expect(from).toBeGreaterThan(-1);
    const analyzeFile = src.slice(from, src.indexOf('\nfunction ', from));
    // 语料文本走原语（刻意：脚本要区分「语法错」与「根不是数组」），原语之外不再 parse
    expect(analyzeFile).not.toContain('JSON.parse(');
    expect(analyzeFile.split('parseCodeRaw(')).toHaveLength(2);
    expect(analyzeFile.split('validateChartCode(')).toHaveLength(2);
    // 全脚本剩下的一处 JSON.parse 只读语料索引（index.json），与谱面代码文本无关
    expect(src.split('JSON.parse(')).toHaveLength(2);
    expect(src).toContain("JSON.parse(await readFile(path.join(CORPUS, 'index.json'), 'utf8'))");
  });

  it('对象视图同样只经原语（裸对象容错留在对象视图）', () => {
    const src = readStripped(NOTE_CODE_OPS);
    expect(src.split('JSON.parse(')).toHaveLength(1);
    const coerce = functionBody(src, 'export function coerceNoteViewCode');
    expect(coerce).toContain('parseCodeRaw(');
    // 容错语义本身不能被搬走：裸对象在这里才被包成单元素数组
    expect(coerce).toMatch(/typeof value === 'object'.*\[value as ChartCodeNote\]/s);
  });
});
