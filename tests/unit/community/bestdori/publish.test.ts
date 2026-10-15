// bestdori-integration 11：发布能力（三步二进制上传 + 必填预检 + 发帖 + 记录写入接缝）。
//
// 锁测口径（票 11「锁测」1）：
//   ① 假出口 —— 三步上传遇 `ALREADY_UPLOADED` 跳过第二步（内容寻址可复用）；
//   ② 必填预检逐字段报错（缺什么点名什么，且一个字节的网络都不发）；
//   ③ 发帖成功后写入 `upload` 记录且只写一次（重复调用被拒）。
// 另锁：静默 sanitize（System / charge 不进发帖 body）、bandori 帖零上传、
// custom 无封面不发 cover 键、平台拒了时记录不写。
import { describe, expect, it } from 'vitest';
import {
  formatPostContent,
  precheckPublish,
  publishChart,
  publishFailureOf,
  type PublishInput,
  type PublishOutcome,
  type PublishUploadFile,
} from '@/src/community/bestdori/publish';
import {
  postCreateUrl,
  uploadPrepareUrl,
  uploadStatusUrl,
  uploadUrl,
  uploadedFileUrl,
} from '@/src/community/bestdori/endpoints';
import {
  CommunityError,
  type CommunityErrorKind,
  type CommunityRequest,
  type CommunityTransport,
} from '@/src/community/transport';

const PREPARE_URL = uploadPrepareUrl();
const UPLOAD_URL = uploadUrl();
const POST_URL = postCreateUrl();
const statusUrl = (hash: string) => uploadStatusUrl(hash);

/** 平台侧的失败：网关已按 code 翻成统一错误域（票 07），能力层只认 kind + platformCode */
function platformError(kind: CommunityErrorKind, platformCode?: string): CommunityError {
  return new CommunityError(`fake ${kind}`, { kind, message: `fake ${kind}`, platformCode });
}

type Route = unknown | ((req: CommunityRequest) => unknown);

/** 按 URL 打桩的假出口（照 AccountSession.test.ts 的就近声明惯例）：值 / 要抛的错 / 按请求算 */
function fakeTransport(routes: Record<string, Route>) {
  const requests: CommunityRequest[] = [];
  const transport: CommunityTransport & { requests: CommunityRequest[] } = {
    kind: 'ipc',
    requests,
    async requestJson(req) {
      requests.push(req);
      const hit = routes[req.url];
      if (hit === undefined) throw new Error(`未打桩的请求: ${req.url}`);
      if (hit instanceof Error) throw hit;
      return typeof hit === 'function' ? hit(req) : hit;
    },
    async requestText(req) {
      requests.push(req);
      throw new Error(`不该有文本请求: ${req.url}`);
    },
    async requestBinary(req) {
      requests.push(req);
      throw new Error(`不该有二进制请求: ${req.url}`);
    },
  };
  return transport;
}

/** 上传记录写入的假接缝：记下每次调用；`accept` 控制第 n 次能不能写进去 */
function fakeRecorder(accept: (n: number) => boolean = () => true) {
  const calls: { postId: number; at: number }[] = [];
  return {
    calls,
    write: async (record: { postId: number; at: number }) => {
      calls.push(record);
      return accept(calls.length);
    },
  };
}

const FILE_AUDIO: PublishUploadFile = {
  path: '/data/projects/p1/audio.bin',
  fileName: 'official-413- excite.mp3',
  size: 4_194_304,
  hash: 'a'.repeat(40),
};

const FILE_COVER: PublishUploadFile = {
  path: '/data/projects/p1/cover.bin',
  fileName: 'cover.png',
  size: 66_600,
  hash: 'b'.repeat(40),
};

/** 合法入参的基线（bandori：零上传）；各例按需覆盖 */
function makeInput(overrides: Partial<PublishInput> = {}): PublishInput {
  return {
    published: false,
    title: 'Test Chart',
    artists: 'RAS',
    diff: 3,
    level: 24,
    content: 'notes: 413',
    chartCode: [
      { type: 'BPM', beat: 0, bpm: 210 },
      { type: 'Single', lane: 1, beat: 220 },
    ],
    song: { kind: 'bandori', songId: 413 },
    ...overrides,
  };
}

/** 跑一次发布：假出口 + 假记录 + 假时钟（轮询不真等） */
async function run(
  routes: Record<string, Route>,
  input: PublishInput,
  options: { accept?: (n: number) => boolean; now?: number } = {},
): Promise<{ outcome: PublishOutcome; requests: CommunityRequest[]; writes: { postId: number; at: number }[] }> {
  const transport = fakeTransport(routes);
  const recorder = fakeRecorder(options.accept);
  const sleeps: number[] = [];
  const outcome = await publishChart(
    {
      transport,
      writeUploadRecord: recorder.write,
      now: () => options.now ?? 1_700_000_000_000,
      sleep: async (ms) => { sleeps.push(ms); },
    },
    input,
  );
  return { outcome, requests: transport.requests, writes: recorder.calls };
}

/** 发帖请求的 body（解析后；断言「发出去的字节」用它） */
function postBodyOf(requests: CommunityRequest[]): Record<string, unknown> {
  const post = requests.find((r) => r.url === POST_URL);
  if (!post?.body) throw new Error('没有发帖请求');
  return JSON.parse(post.body) as Record<string, unknown>;
}

describe('票 11 · 三步二进制上传', () => {
  it('正常路径：prepare → multipart upload → 轮询 status，回引用地址', async () => {
    const hash = 'c'.repeat(40);
    const { outcome, requests } = await run(
      {
        [PREPARE_URL]: { result: true },
        [UPLOAD_URL]: { hash },
        [statusUrl(hash)]: { status: 'available' },
        [POST_URL]: { result: true, id: 254203 },
      },
      makeInput({
        song: { kind: 'custom', audio: FILE_AUDIO, cover: null },
      }),
    );

    expect(outcome).toEqual({ ok: true, postId: 254203, recordWritten: true });
    // 三步各一次，次序不乱
    expect(requests.map((r) => r.url)).toEqual([PREPARE_URL, UPLOAD_URL, statusUrl(hash), POST_URL]);

    const prepare = requests[0];
    expect(prepare.method).toBe('POST');
    expect(JSON.parse(prepare.body!)).toEqual({ ver: 3, hash: FILE_AUDIO.hash, size: FILE_AUDIO.size });

    const upload = requests[1];
    expect(upload.method).toBe('POST');
    // 字节不过 IPC：过去的是路径与文件名，不是字节
    expect(upload.multipart).toEqual({
      field: 'file',
      filePath: FILE_AUDIO.path,
      fileName: FILE_AUDIO.fileName,
    });

    // 发帖 body 的 song.audio 就是上传产物的引用地址
    expect(postBodyOf(requests).song).toEqual({ type: 'custom', audio: uploadedFileUrl(hash) });
  });

  it('prepare 遇 ALREADY_UPLOADED：跳过上传与轮询，直接回引用地址', async () => {
    const { outcome, requests } = await run(
      {
        // 平台说这份字节已经在（内容寻址复用）—— 网关按码翻成 invalid-response + platformCode
        [PREPARE_URL]: platformError('invalid-response', 'ALREADY_UPLOADED'),
        // 这两个 URL 没有打桩：真被调用会抛「未打桩的请求」
        [UPLOAD_URL]: { hash: 'nope' },
        [statusUrl(FILE_AUDIO.hash)]: { status: 'available' },
        [POST_URL]: { result: true, id: 254203 },
      },
      makeInput({ song: { kind: 'custom', audio: FILE_AUDIO, cover: null } }),
    );

    expect(outcome.ok).toBe(true);
    // 只走了 prepare 与发帖：第二步、第三步一个都没发生
    expect(requests.map((r) => r.url)).toEqual([PREPARE_URL, POST_URL]);
    expect(postBodyOf(requests).song).toEqual({
      type: 'custom',
      audio: uploadedFileUrl(FILE_AUDIO.hash),
    });
  });

  it('status 未就绪时按间隔轮询，available 才继续', async () => {
    const hash = 'd'.repeat(40);
    let statusCalls = 0;
    const { outcome, requests } = await run(
      {
        [PREPARE_URL]: { result: true },
        [UPLOAD_URL]: { hash },
        // 前两次「处理中」，第三次就绪（计数器在闭包里，不读还没赋值的 requests）
        [statusUrl(hash)]: () => (++statusCalls < 3 ? { status: 'processing' } : { status: 'available' }),
        [POST_URL]: { result: true, id: 1 },
      },
      makeInput({ song: { kind: 'custom', audio: FILE_AUDIO, cover: null } }),
    );

    expect(outcome.ok).toBe(true);
    expect(requests.filter((r) => r.url === statusUrl(hash))).toHaveLength(3);
  });

  it('status 一直不就绪：次数用完报 invalid-response，不发帖', async () => {
    const hash = 'e'.repeat(40);
    const { outcome, requests } = await run(
      {
        [PREPARE_URL]: { result: true },
        [UPLOAD_URL]: { hash },
        [statusUrl(hash)]: { status: 'processing' },
        [POST_URL]: { result: true, id: 1 },
      },
      makeInput({ song: { kind: 'custom', audio: FILE_AUDIO, cover: null } }),
    );

    expect(outcome).toEqual({ ok: false, failure: 'rejected' });
    expect(requests.filter((r) => r.url === statusUrl(hash))).toHaveLength(10);
    expect(requests.some((r) => r.url === POST_URL)).toBe(false);
  });

  it('bandori 帖零上传：不发 prepare / upload / status', async () => {
    const { outcome, requests } = await run({ [POST_URL]: { result: true, id: 777 } }, makeInput());

    expect(outcome).toEqual({ ok: true, postId: 777, recordWritten: true });
    expect(requests.map((r) => r.url)).toEqual([POST_URL]);
    expect(postBodyOf(requests).song).toEqual({ type: 'bandori', id: 413 });
  });

  it('custom 有封面就传两个文件；没封面就不发 cover 键', async () => {
    const hashAudio = 'f'.repeat(40);
    const hashCover = '0'.repeat(40);
    const withCover = await run(
      {
        [PREPARE_URL]: { result: true },
        [UPLOAD_URL]: (req) => ({ hash: req.multipart?.fileName === FILE_COVER.fileName ? hashCover : hashAudio }),
        [statusUrl(hashAudio)]: { status: 'available' },
        [statusUrl(hashCover)]: { status: 'available' },
        [POST_URL]: { result: true, id: 2 },
      },
      makeInput({ song: { kind: 'custom', audio: FILE_AUDIO, cover: FILE_COVER } }),
    );
    expect(withCover.outcome.ok).toBe(true);
    expect(postBodyOf(withCover.requests).song).toEqual({
      type: 'custom',
      audio: uploadedFileUrl(hashAudio),
      cover: uploadedFileUrl(hashCover),
    });

    const noCover = await run(
      {
        [PREPARE_URL]: { result: true },
        [UPLOAD_URL]: { hash: hashAudio },
        [statusUrl(hashAudio)]: { status: 'available' },
        [POST_URL]: { result: true, id: 3 },
      },
      makeInput({ song: { kind: 'custom', audio: FILE_AUDIO, cover: null } }),
    );
    expect(postBodyOf(noCover.requests).song).toEqual({ type: 'custom', audio: uploadedFileUrl(hashAudio) });
  });
});

describe('票 11 · 必填预检（逐字段点名）', () => {
  it('全合法时放行', () => {
    expect(precheckPublish(makeInput())).toEqual({ ok: true, missing: [] });
  });

  it.each([
    ['title', { title: '  ' }],
    ['artists', { artists: '' }],
    ['level', { level: null }],
    ['level', { level: 0 }],
    ['level', { level: 36 }],
    ['content', { content: '' }],
    ['content', { content: 'x'.repeat(5001) }],
    ['chart', { chartCode: [] as never }],
    ['chart', { chartCode: [{ type: 'System', data: 'bgm1020.wav', beat: 0 }] as never }],
    ['audio', { song: { kind: 'custom' as const, audio: null, cover: null } }],
  ])('缺 %s 时点名 %s', (field, overrides) => {
    const precheck = precheckPublish(makeInput(overrides));
    expect(precheck.ok).toBe(false);
    expect(precheck.missing).toContain(field);
  });

  it('可以一次点名多个字段', () => {
    const precheck = precheckPublish(makeInput({ title: '', artists: '', level: null, content: '' }));
    expect(precheck.missing).toEqual(['title', 'artists', 'level', 'content']);
  });

  it('bandori 的曲库 id 不是正整数：点名 song（平台不校验曲 id，越界只会 POST_INVALID）', () => {
    for (const songId of [0, -1, 1.5]) {
      const precheck = precheckPublish(makeInput({ song: { kind: 'bandori', songId } }));
      expect(precheck.ok, String(songId)).toBe(false);
      expect(precheck.missing, String(songId)).toContain('song');
    }
    expect(precheckPublish(makeInput({ song: { kind: 'bandori', songId: 413 } })).missing)
      .not.toContain('song');
  });

  it('diff 越界（0..4 之外）：点名 diff', () => {
    for (const diff of [-1, 5, 2.5]) {
      const precheck = precheckPublish(makeInput({ diff }));
      expect(precheck.ok, String(diff)).toBe(false);
      expect(precheck.missing, String(diff)).toContain('diff');
    }
  });

  it('bandori 帖不要求音频引用', () => {
    expect(precheckPublish(makeInput({ song: { kind: 'bandori', songId: 1 } })).missing).not.toContain('audio');
  });

  it('publishChart 里预检挡在最前：缺字段时一个字节的网络都不发', async () => {
    const { outcome, requests, writes } = await run(
      { [POST_URL]: { result: true, id: 1 } },
      makeInput({ title: '', level: null }),
    );
    expect(outcome).toEqual({
      ok: false,
      failure: 'missing-fields',
      missing: ['title', 'level'],
    });
    expect(requests).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe('票 11 · 发帖与上传记录', () => {
  it('静默 sanitize：System 与 charge 不进发帖 body', async () => {
    const { requests } = await run({ [POST_URL]: { result: true, id: 5 } }, makeInput({
      chartCode: [
        { type: 'BPM', beat: 0, bpm: 210 },
        { type: 'System', data: 'bgm1020.wav', beat: 0 },
        { type: 'Single', lane: 1, beat: 220, charge: true, noteTag: 'keep-me' },
        {
          type: 'Slide',
          connections: [
            { lane: 0, beat: 223, charge: true },
            { lane: 2, beat: 223.5 },
          ],
        },
      ] as never,
    }));

    const chart = postBodyOf(requests).chart as { type: string; charge?: boolean; noteTag?: string; connections?: { charge?: boolean }[] }[];
    expect(chart.map((n) => n.type)).toEqual(['BPM', 'Single', 'Slide']);
    expect(chart.every((n) => n.charge === undefined)).toBe(true);
    expect(chart[1].noteTag).toBe('keep-me'); // 多余键保留（Apply 已放行部分）
    expect(chart[2].connections?.every((c) => c.charge === undefined)).toBe(true);
  });

  it('发帖 body 带齐必填项：title / artists / song / diff / level / chart / content / 分类', async () => {
    const { requests } = await run({ [POST_URL]: { result: true, id: 9 } }, makeInput({ diff: 0, level: 1 }));

    expect(postBodyOf(requests)).toEqual({
      title: 'Test Chart',
      artists: 'RAS',
      song: { type: 'bandori', id: 413 },
      diff: 0,
      level: 1,
      chart: [
        { type: 'BPM', beat: 0, bpm: 210 },
        { type: 'Single', lane: 1, beat: 220 },
      ],
      content: [{ type: 'text', data: 'notes: 413' }],
      categoryName: 'SELF_POST',
      categoryId: 'chart',
      tags: [],
    });
  });

  it('发帖成功后写一次上传记录（postId + 时刻）', async () => {
    const { outcome, writes } = await run({ [POST_URL]: { result: true, id: 254203 } }, makeInput(), {
      now: 1_700_000_000_000,
    });

    expect(outcome).toEqual({ ok: true, postId: 254203, recordWritten: true });
    expect(writes).toEqual([{ postId: 254203, at: 1_700_000_000_000 }]);
  });

  it('重复调用被拒：已发布过的谱面直接拒，零网络、零写入', async () => {
    const { outcome, requests, writes } = await run(
      { [POST_URL]: { result: true, id: 254204 } },
      makeInput({ published: true }),
    );

    expect(outcome).toEqual({ ok: false, failure: 'already-published' });
    expect(requests).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('记录写不进去（写入接缝拒绝）时结果仍是 ok：帖子已在平台上', async () => {
    const { outcome, writes } = await run(
      { [POST_URL]: { result: true, id: 254205 } },
      makeInput(),
      { accept: () => false },
    );

    expect(outcome).toEqual({ ok: true, postId: 254205, recordWritten: false });
    expect(writes).toHaveLength(1);
  });

  it('平台拒了发帖（POST_INVALID）：不写记录', async () => {
    const { outcome, writes } = await run(
      { [POST_URL]: platformError('invalid-response', 'POST_INVALID') },
      makeInput(),
    );
    expect(outcome).toEqual({ ok: false, failure: 'rejected' });
    expect(writes).toEqual([]);
  });

  it('发帖响应缺 id：当平台拒绝，不写记录', async () => {
    const { outcome, writes } = await run({ [POST_URL]: { result: true } }, makeInput());
    expect(outcome).toEqual({ ok: false, failure: 'rejected' });
    expect(writes).toEqual([]);
  });
});

describe('票 11 · 失败立档（界面只认这个，不认平台码）', () => {
  it.each([
    ['offline', 'offline'],
    ['timeout', 'offline'],
    ['rate-limited', 'rate-limited'],
    ['unauthorized', 'unauthorized'],
    ['unsupported-runtime', 'unsupported'],
    ['invalid-response', 'rejected'],
    ['http', 'rejected'],
    ['request-rejected', 'local'],
    ['staging-failed', 'local'],
  ] as const)('网关的 %s → %s', (kind, failure) => {
    expect(publishFailureOf(platformError(kind))).toBe(failure);
  });

  it('非社区错误（本地抛错）→ unknown', () => {
    expect(publishFailureOf(new Error('boom'))).toBe('unknown');
  });

  it('会话失效（发布中途被踢）→ unauthorized，不写记录', async () => {
    const { outcome, writes } = await run({ [POST_URL]: platformError('unauthorized') }, makeInput());
    expect(outcome).toEqual({ ok: false, failure: 'unauthorized' });
    expect(writes).toEqual([]);
  });

  it('离线 → offline', async () => {
    const { outcome } = await run({ [POST_URL]: platformError('offline') }, makeInput());
    expect(outcome).toEqual({ ok: false, failure: 'offline' });
  });
});

describe('票 42 Q4 · 正文换行解析为 text 与 br 块', () => {
  it('formatPostContent：单行文本为单块 text', () => {
    expect(formatPostContent('Hello World')).toEqual([
      { type: 'text', data: 'Hello World' },
    ]);
  });

  it('formatPostContent：多行文本拆成 text 与 br 块', () => {
    expect(formatPostContent('Line 1\nLine 2\r\nLine 3')).toEqual([
      { type: 'text', data: 'Line 1' },
      { type: 'br' },
      { type: 'text', data: 'Line 2' },
      { type: 'br' },
      { type: 'text', data: 'Line 3' },
    ]);
  });

  it('formatPostContent：连续换行产生空行 br 块', () => {
    expect(formatPostContent('Paragraph 1\n\nParagraph 2')).toEqual([
      { type: 'text', data: 'Paragraph 1' },
      { type: 'br' },
      { type: 'br' },
      { type: 'text', data: 'Paragraph 2' },
    ]);
  });

  it('发帖 body 包含换行时按 text 与 br 块递送', async () => {
    const { requests } = await run(
      { [POST_URL]: { result: true, id: 9 } },
      makeInput({ content: 'Notes: 413\nGood chart' }),
    );

    expect(postBodyOf(requests).content).toEqual([
      { type: 'text', data: 'Notes: 413' },
      { type: 'br' },
      { type: 'text', data: 'Good chart' },
    ]);
  });
});

