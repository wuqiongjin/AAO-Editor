// bestdori-integration 10 锁测（票 10 #2 / issues/04「实现票需补『密码不落盘』锁测」）。
//
// 一条红线：**密码不落盘**（ADR-0011 §3）。它不是一个动作写对就行，而是「凭据没有路走到
// 任何持久化写入路径」——所以这里断言的是**通路**，不是某一行的写法：
//
//   ① `password` 字面量在 `src/` 里只准出现在**两处**白名单：账号模块 + 登录弹窗
//      （票 39 Q9 —— 登录表单天生要一个 `<input type="password">`，藏字面量才是自欺；
//      弹窗那一处另有结构性约束，见 PASSWORD_WHITELIST 与下面那条弹窗断言。
//      `electron/` 那一侧由 ③ 单独盯：`sourceFiles()` 只走 .ts/.tsx，两边射程不同，别把话说过头）；
//   ② 会话 Cookie 的持久化接缝**零入参**（renderer 递不进凭据，主进程从自己的 jar 落盘）；
//   ③ 持久化那几个文件**不认识** password / username；加密只有主进程会做，renderer 连 API 都没有；
//   ④ 加密不可用时**不写**（宁可不记住登录态，也不落一份明文）；
//   ⑤ 凭据文件不跟数据根走（数据根可搬家 / 可分享），也不进设置对象，且**凭据模块的 import 面里
//      没有任何持久化出口**（名字正则挡不住改名绕道，import 面能）。
import { describe, expect, it } from 'vitest';
import { readSource, readStripped, sourceFiles } from '@/tests/support/source';

const ACCOUNT_MODULE = 'src/community/bestdori/account.ts';
/** 登录弹窗：白名单的第二处（票 39 Q9），它只把凭据递给 `account.login()` 的参数 */
const SIGN_IN_DIALOG = 'src/pages/projects/components/SignInDialog.tsx';
const SESSION_BRIDGE = 'src/community/sessionPersistence.ts';
const SESSION_MAIN = 'electron/communitySession.cjs';
const PRELOAD = 'electron/preload.js';
const MAIN = 'electron/main.cjs';
const SETTINGS = 'src/chart/config/AppSettings.ts';

/** 会话那条通道的三条 invoke（一条都不许带参数） */
const SESSION_CHANNELS = [
  'communitySession:restore',
  'communitySession:persist',
  'communitySession:clear',
];

/** `password` 那个标识符（大小写与包含关系都算：`userPassword` 也逃不掉） */
const PASSWORD = /password/i;
/**
 * `password` 字面量允许出现的**两处**（票 39 Q9）。放宽成"白名单"而不是"目录级豁免"是
 * 有意的：目录级豁免会长期弱化这条红线（谁往那个目录里丢文件都不再受约束），而白名单的
 * 第二处还带着结构性约束 —— 登录弹窗**不 import 任何持久化出口**、正文里也没有 storage 出口，
 * 于是「界面有表单」与「凭据有第二条落盘路」被分开（后者仍是红线）。
 */
const PASSWORD_WHITELIST = [ACCOUNT_MODULE, SIGN_IN_DIALOG];
/** 渲染侧的持久化出口：任何一条出现在账号模块里都是红线被绕道 */
const PERSISTENCE_SINKS = /localStorage|sessionStorage|indexedDB|projectStore|safeStorage/;
/**
 * 凭据模块允许 import 的**只有相对路径**：`../transport`（注入的出口）、`./endpoints` 这些。
 * 别名（`@/…`）与裸包名一律不许 —— 设置对象 / 工程记录 / 当前工程指针都是从那里进的，
 * 这是「会话不属于设置对象、不写 localStorage」的**结构性**保证（比逐个名字否定结实）。
 */
const ALLOWED_IMPORT = /^\.{1,2}\//;

function importsOf(rel: string): string[] {
  return [...readStripped(rel).matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((hit) => hit[1]);
}

describe('票 10 · 密码不落盘（凭据通路）', () => {
  it('`password` 在 `src/` 里只出现在两处白名单（账号模块 + 登录弹窗），别处一个都不许有', () => {
    const offenders = sourceFiles('src')
      .filter((rel) => !PASSWORD_WHITELIST.includes(rel) && PASSWORD.test(readStripped(rel)));
    expect(offenders).toEqual([]);
  });

  it('登录弹窗那一处是结构性的：不 import 持久化出口、正文里也没有 storage 出口', () => {
    // 它 import 的是账号模块（凭据唯一的去处），不是任何"能不能存"的接缝
    const sinks = importsOf(SIGN_IN_DIALOG).filter((spec) => /persist|storage|credential|safeStorage/i.test(spec));
    expect(sinks).toEqual([]);
    expect(readStripped(SIGN_IN_DIALOG)).not.toMatch(PERSISTENCE_SINKS);
  });

  it('在账号模块里它只以两种身份出现：函数形参、登录请求体里的那个值', () => {
    const lines = readStripped(ACCOUNT_MODULE)
      .split('\n')
      .filter((text) => PASSWORD.test(text))
      .map((text) => text.trim());

    // 形参（接口 + 实现两处）+ 请求体一处，就这三处
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      // 赋值给别的变量 / 传给别的函数 / 存进对象字段，都不在这里的两种身份之内
      expect(line, line).toMatch(
        /password\s*:\s*string|body:\s*JSON\.stringify\(\{\s*username,\s*password\s*\}\)/,
      );
    }
    expect(lines.filter((line) => /JSON\.stringify/.test(line))).toHaveLength(1);
  });

  it('账号模块不碰任何持久化出口（会话对象只活在内存里）', () => {
    expect(readStripped(ACCOUNT_MODULE)).not.toMatch(PERSISTENCE_SINKS);
  });

  it('凭据模块的 import 面里没有持久化出口（改名绕道也拦得住）', () => {
    for (const file of [ACCOUNT_MODULE, SESSION_BRIDGE]) {
      const outsiders = importsOf(file).filter((spec) => !ALLOWED_IMPORT.test(spec));
      expect(outsiders, `${file} 只准 import 相对路径`).toEqual([]);
    }
  });

  it('持久化的三个文件都不认识凭据：只搬 cookie', () => {
    for (const file of [SESSION_BRIDGE, SESSION_MAIN, PRELOAD]) {
      const src = readStripped(file);
      expect(src, file).not.toMatch(/password/i);
      expect(src, file).not.toMatch(/username/i);
    }
    // 主进程那份密文里只有 jar 快照（`{version, cookies}`）
    const main = readStripped(SESSION_MAIN);
    expect(main).toMatch(/cookieJar/);
    expect(main).toMatch(/cookies/);
  });

  it('渲染侧那条接缝也零入参：persist 拿不到东西可存', () => {
    expect(readStripped(SESSION_BRIDGE)).not.toMatch(/persist\(\s*[^)]/);
  });

  it('加密只有主进程会做（renderer 连 API 都没有，也就没法自己存一份）', () => {
    const rendererFiles = sourceFiles('src').filter((rel) => /encryptString|decryptString/.test(readStripped(rel)));
    expect(rendererFiles).toEqual([]);
    const main = readStripped(SESSION_MAIN);
    expect(main).toMatch(/encryptString/);
    expect(main).toMatch(/decryptString/);
  });
});

describe('票 10 · 会话通道零入参（递不进凭据）', () => {
  it('主进程三条 handler 都不声明参数（listener 必须是零参箭头）', () => {
    const src = readStripped(SESSION_MAIN);
    for (const channel of SESSION_CHANNELS) {
      // 写成 `async (event, payload) =>` 就匹配不上 —— 那就是给凭据开了口子
      expect(src, channel).toMatch(
        new RegExp(`handle\\(\\s*['"]${channel}['"]\\s*,\\s*(?:async\\s*)?\\(\\s*\\)\\s*=>`),
      );
    }
    // 就这三条，不多开（凭据面的接口越小越好）
    expect(src.match(/ipcMain\.handle\(/g)).toHaveLength(SESSION_CHANNELS.length);
  });

  it('preload 三条桥都不传参数给 invoke，且只暴露这一个命名空间', () => {
    const src = readStripped(PRELOAD);
    expect(src).toMatch(/communitySession\s*:\s*\{/);
    for (const channel of SESSION_CHANNELS) {
      expect(src, channel).toMatch(new RegExp(`\\w+:\\s*\\(\\)\\s*=>\\s*ipcRenderer\\.invoke\\(\\s*['"]${channel}['"]\\s*\\)`));
    }
  });
});

describe('票 10 · 凭据落点与降级', () => {
  it('会话文件落在 userData 下、**不跟数据根走**（数据根可以被搬家 / 拷贝 / 分享）', () => {
    expect(readStripped(MAIN)).toMatch(/sessionFilePath\(userDataDir\(\)\)/);
    expect(readStripped(SESSION_MAIN)).not.toMatch(/dataRoot/);
  });

  it('不支持加密就不落盘（没有「退化成明文」这条兜底）', () => {
    const src = readStripped(SESSION_MAIN);
    expect(src).toMatch(/isEncryptionAvailable/);
    // 全文件只有一处真写盘，而且写进去的必须是 encryptString 的产物
    expect(src.match(/fs\.promises\.writeFile\(/g)).toHaveLength(1);
    expect(src).toMatch(/writeFileAtomic\(\s*filePath\(\),\s*safeStorage\.encryptString\(text\)\s*\)/);
  });

  it('会话不进设置对象（CONTEXT：设置对象是 chrome 偏好，不含凭据）', () => {
    expect(readStripped(SETTINGS)).not.toMatch(/password|cookie|token|credential/i);
    // 全仓唯一的出口实现也没把自己变成第二份凭据仓库
    expect(readSource('src/community/electronTransport.ts')).not.toMatch(PERSISTENCE_SINKS);
  });
});
