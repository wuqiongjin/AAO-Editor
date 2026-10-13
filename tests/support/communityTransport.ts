// 社区出口的假实现：按 URL 回固定载荷，并记下每一次请求。
//
// 给能力层（08 曲库 / 09 社区帖）与导入编排注入用：不碰网络、不 mock 模块
// （全仓无 msw / `vi.mock`，见 tests/unit/upload/bestdori/sanitizeChart.test.ts 的惯例）。
// 没打桩的 URL 直接抛 —— 悄悄返回 undefined 会让「端点拼错」这类 bug 溜过去。
import type { CommunityRequest, CommunityTransport, StagedBinary } from '@/src/community/transport';

export interface FakeCommunityRoutes {
  /** key = 完整 URL（能力层从端点半拼出来的那一条） */
  json?: Record<string, unknown>;
  text?: Record<string, string>;
  binary?: Record<string, StagedBinary>;
}

export type FakeCommunityTransport = CommunityTransport & { requests: CommunityRequest[] };

function route<T>(table: Record<string, T> | undefined, url: string, kind: string): T {
  if (!table || !(url in table)) throw new Error(`未打桩的 ${kind} 请求: ${url}`);
  return table[url];
}

export function makeFakeCommunityTransport(routes: FakeCommunityRoutes = {}): FakeCommunityTransport {
  const requests: CommunityRequest[] = [];
  return {
    kind: 'ipc',
    requests,
    async requestJson(req) {
      requests.push(req);
      return route(routes.json, req.url, 'JSON');
    },
    async requestText(req) {
      requests.push(req);
      return route(routes.text, req.url, '文本');
    },
    async requestBinary(req) {
      requests.push(req);
      return route(routes.binary, req.url, '二进制');
    },
  };
}
