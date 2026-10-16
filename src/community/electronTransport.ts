/**
 * 走 IPC 的社区出口 —— 全仓**唯一**的 `CommunityTransport` 实现（票 07 锁测：出口唯一）。
 *
 * 它自己不发网络：只把载荷递给 `window.electronAPI.communityNet`（preload 白名单里那一条），
 * 由主进程网关（`electron/communityNet.cjs`）发出去，并把统一错误域翻回来。
 * 没有这条桥 = 静态演示版 / 浏览器 → `kind === 'none'`，请求抛 `unsupported-runtime`；
 * 能力层据此降级（ADR-0011 §1），不是白屏、也不是循环报错。
 */
import {
  CommunityError,
  markJsonFromCache,
  type CommunityRequest,
  type CommunityTransport,
  type CommunityWireResult,
  type StagedBinary,
} from './transport';

/** preload 暴露的网络桥（本仓惯例：桥形状由消费方就近声明，没有集中 d.ts） */
export interface CommunityNetBridge {
  request(payload: CommunityRequest): Promise<CommunityWireResult>;
}

/** 读桥；浏览器里（没有 window / 没有 electronAPI）返回 null */
export function getCommunityNetBridge(): CommunityNetBridge | null {
  if (typeof window === 'undefined') return null;
  const api = (window as unknown as { electronAPI?: { communityNet?: CommunityNetBridge } }).electronAPI;
  return api?.communityNet ?? null;
}

/**
 * 这台机器有没有社区平台出口 —— 静态演示版没有（ADR-0011 §1）。
 * 判定口径与全仓既有惯例一致：`window.electronAPI` 缺失即静态演示版（如 ChartProject.ts 的自动选后端）。
 * 官方 / 社区两支导入按它隐藏，留空白与本地导入两支（票 12）。
 */
export function hasCommunityNet(): boolean {
  return getCommunityNetBridge() !== null;
}

type CommunityWireOk = Extract<CommunityWireResult, { ok: true }>;

function mismatch(expected: string, actual: string): CommunityError {
  return new CommunityError(`主进程回的是 ${actual}，与请求的 ${expected} 不一致`, {
    kind: 'invalid-response',
    message: `响应形态不符：期望 ${expected}，实际 ${actual}`,
  });
}

export class ElectronCommunityTransport implements CommunityTransport {
  private readonly bridge: CommunityNetBridge | null;

  constructor(bridge: CommunityNetBridge | null = getCommunityNetBridge()) {
    this.bridge = bridge;
  }

  get kind(): 'ipc' | 'none' {
    return this.bridge ? 'ipc' : 'none';
  }

  async requestJson(req: CommunityRequest): Promise<unknown> {
    const result = await this.send({ ...req, responseType: 'json' });
    if (result.responseType !== 'json') throw mismatch('json', result.responseType);
    return result.fromCache ? markJsonFromCache(result.data) : result.data;
  }

  async requestText(req: CommunityRequest): Promise<string> {
    const result = await this.send({ ...req, responseType: 'text' });
    if (result.responseType !== 'text') throw mismatch('text', result.responseType);
    return result.text;
  }

  /** 二进制：主进程落素材缓存（<数据根>/cache/community/），这里只拿到路径与字节数（字节不过 IPC） */
  async requestBinary(req: CommunityRequest): Promise<StagedBinary> {
    const result = await this.send({ ...req, responseType: 'binary' });
    if (result.responseType !== 'binary') throw mismatch('binary', result.responseType);
    return { path: result.path, byteLength: result.byteLength, contentType: result.contentType };
  }

  private async send(req: CommunityRequest): Promise<CommunityWireOk> {
    if (!this.bridge) {
      throw new CommunityError('这台机器没有社区平台出口（静态演示版 / 浏览器）', {
        kind: 'unsupported-runtime',
        message: '社区平台只在桌面版提供',
      });
    }
    let result: CommunityWireResult;
    try {
      result = await this.bridge.request(req);
    } catch (error) {
      // 桥本身挂了（通道没注册 / 主进程异常）：出口不可用，不让调用方看到裸异常
      throw new CommunityError(error instanceof Error ? error.message : String(error), {
        kind: 'unsupported-runtime',
        message: '社区网络通道不可用',
      });
    }
    if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new CommunityError('社区网络桥返回了无法识别的结果', {
        kind: 'invalid-response',
        message: '社区网络桥返回非法结果',
      });
    }
    if (!result.ok) throw new CommunityError(result.error.message, result.error);
    return result;
  }
}

/** 默认出口：有桥走 IPC，没有就是 'none'（静态演示版）；能力层按 kind 决定降级文案 */
export function createCommunityTransport(
  bridge: CommunityNetBridge | null = getCommunityNetBridge(),
): CommunityTransport {
  return new ElectronCommunityTransport(bridge);
}
