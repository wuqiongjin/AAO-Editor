// AudioSession（架构深化评审候选 3 深模块）：把"音频域"收敛成单一接缝。
// 拥有：引擎 + 音频文件 + 时长同步 + 键音素材包 + SE 音量 + 持久化钩子。
// 音频页与工作台（播放条 / Editor）都朝它调用——AudioPageContext 桥接消失。
//
// 设计原则：
//   1. 纯逻辑：核心是 TypeScript class，可在 node 环境单测。
//   2. local-substitutable：引擎通过工厂注入（AudioEngineFactory），测试可换假引擎。
//   3. 状态外部订阅：通过 subscribe(listener) 让 React 层监听变化；
//      类内部只存不可变 snapshot，外部按需读 getter；这样避免 setState 触发整棵组件树重渲染。
//   4. 字段名清晰区分 chartDuration / audioDuration：消除旧 PlaybackContext.duration
//      "既是图表长度又被音频长度赋值"的语义重载（ADR-0005 §4 仍保持"有音频=音频时长"作为外规则）。
//   5. 持久化钩子：调用方（Editor / 持久化层）通过 setPersistNow() 反向注入；
//      不再需要 Editor 里的 audioMetaRef / persistRef 手动 ref 环（候选 3 收口）。
//
// 接缝：AudioSession 是单一接缝；外部只通过 getSnapshot() 读 / 方法调用写 / subscribe() 监听。
// 不变量：
//   - audioName 必与 engine.duration 是否非空 一致（导入成功 = audioName !== null && engine.duration != null）
//   - 错误状态独占：audioError 非空时 audioName 必为 null（导入失败回退到无音频）
//   - importAudio 在飞行中被新调用打断时，旧调用的回调被丢弃（inFlightToken 单调递增）
//   - chartDuration 经 clampChartDuration（默认 / 上下界 / 夹取的唯一口径，architecture-refactor/10）
import { AudioEngine } from './AudioEngine';
import { keySoundSetEntryById, type KeySoundKind } from './KeySound';
import { clampChartDuration, DEFAULT_CHART_DURATION_SECONDS } from './chartDuration';
import { t } from '../i18n';

/** 音频会话的不可变快照（外部读取用） */
export interface AudioSessionSnapshot {
  /** 当前音频文件名；无音频 = null */
  audioName: string | null;
  /** 导入/解码失败的错误信息；无错误 = null */
  audioError: string | null;
  /** 当前谱面时长（秒，ADR-0005 §4：有音频=音频时长；无音频=用户值或 30s 默认；上限 MAX_DURATION_SECONDS） */
  chartDuration: number;
  /** 当前音频时长（秒，null = 无音频） */
  audioDuration: number | null;
  /** 引擎是否可播放（等价于 hasAudio，合成时间线使 engine.canPlay 恒真；语义上 = 是否有音频） */
  hasAudio: boolean;
  /** 激活键音素材包 id（settings.audio.keySet） */
  keySetId: string;
  /** 节奏图示 SE 音量（0..1，settings.audio.seVolume） */
  seVolume: number;
  /** 共享音频与时长是否锁定（工程含已上传谱面时锁定，ADR-0015 §4） */
  audioLocked: boolean;
}

/** 引擎工厂（local-substitutable：测试可注入假引擎） */
export type AudioEngineFactory = () => AudioEngine;

/** 默认工厂：生产 AudioEngine */
const defaultFactory: AudioEngineFactory = () => new AudioEngine();

/** 监听器签名：snapshot 变化时回调 */
export type AudioSessionListener = (snapshot: AudioSessionSnapshot) => void;

/** 数值合法性辅助：拒绝 NaN / Infinity；clamp 到 [lo, hi]。
 *  只服务 [0,1] 的音量 / SE 口径 —— **谱面时长不要用它**，时长口径在 `./chartDuration`。 */
function clampFinite(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

/**
 * 音频会话深模块（架构深化评审候选 3）。
 *
 * 不持有 React state；React 层通过 subscribe() 把变化映射到 setState。
 * 内部用 snapshot 模式：每次 setX 重新计算新 snapshot 并通知所有 listener。
 */
export class AudioSession {
  private engine: AudioEngine;
  private factory: AudioEngineFactory;

  // 内部状态（外部只通过 snapshot 读取）
  private _audioName: string | null = null;
  private _audioError: string | null = null;
  private _chartDuration: number;
  private _audioBlob: Blob | null = null;
  private _audioLocked = false;
  private _keySetId: string;
  private _seVolume: number;
  private _volume: number; // 主音量（与 SE 音量分离；唯一真相源 = 本字段；engine 是镜像）

  // 持久化钩子（调用方注入 saveNow）
  private persistNow: () => void | Promise<void> = () => {};
  // 设置持久化钩子：键音/SE 音量变更时调用，外部把变更写回 ConfigContext → localStorage
  private persistKeySet: (id: string) => void = () => {};
  private persistSeVolume: (v: number) => void = () => {};

  /** 共享音频与谱面时长锁定态（工程含已上传谱面时锁定，ADR-0015 §4） */
  get isAudioLocked(): boolean {
    return this._audioLocked;
  }

  setAudioLocked(locked: boolean): void {
    if (this._audioLocked === locked) return;
    this._audioLocked = locked;
    this.emit();
  }

  // 订阅者列表
  private listeners = new Set<AudioSessionListener>();

  // importAudio 飞行序号：每次调用自增；回调内仅当 token === inFlightToken 时才应用结果
  private inFlightToken = 0;

  constructor(opts: {
    /** 引擎工厂（默认 new AudioEngine()，测试可注入假引擎） */
    engineFactory?: AudioEngineFactory;
    /** 初始激活素材包 id */
    keySetId: string;
    /** 初始 SE 音量（0..1） */
    seVolume: number;
    /** 初始谱面时长（秒，默认 30；上限 MAX_DURATION_SECONDS） */
    chartDuration?: number;
    /** 初始主音量（0..1，默认 0.8 与 PlaybackContext 默认对齐） */
    volume?: number;
  }) {
    this.factory = opts.engineFactory ?? defaultFactory;
    this.engine = this.factory();
    // 历史持久化 id（'placeholder'/'bangdream' 等）归一化回落到默认包（issue 29 删占位包）
    this._keySetId = keySoundSetEntryById(opts.keySetId).id;
    this._seVolume = clampFinite(opts.seVolume, 0, 1, 1);
    this._chartDuration = clampChartDuration(opts.chartDuration ?? DEFAULT_CHART_DURATION_SECONDS);
    this._volume = clampFinite(opts.volume ?? 0.8, 0, 1, 0.8);

    // 构造时把初始音量/SE 音量/素材挂到引擎
    this.engine.setVolume(this._volume);
    this.engine.setSeVolume(this._seVolume);
    this.engine.setKeySetId(this._keySetId);
  }

  // ===== 订阅接口 =====

  /** 订阅变化：snapshot 每次更新时回调。返回 unsubscribe。 */
  subscribe(listener: AudioSessionListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** 读取当前 snapshot */
  getSnapshot(): AudioSessionSnapshot {
    return this._snapshot();
  }

  /** 引擎引用（暴露给 usePlaybackCoordinator 做 RAF / seek / tick） */
  getEngine(): AudioEngine {
    return this.engine;
  }

  /** 注入持久化 saveNow（importAudio/clearAudio 后调用，Editor 侧 React 化时一次性接入） */
  setPersistNow(fn: () => void | Promise<void>): void {
    this.persistNow = fn;
  }

  /**
   * 注入设置持久化回调：键音/SE 音量变更时 session 内部会调用，外部应把变更写回
   * ConfigContext（再由 ConfigContext 写 localStorage）。
   *
   * 必须在 Provider 挂载完成后才能调用——setKeySetId / setSeVolume 内部的 persistKeySet /
   * persistSeVolume 引用此时才会就绪；否则变更只更新引擎与内存，不持久化（与旧 AudioPageContext
   * 桥接行为一致：未就绪时注册 api 是空桥）。
   */
  setSettingsPersist(opts: { persistKeySet: (id: string) => void; persistSeVolume: (v: number) => void }): void {
    this.persistKeySet = opts.persistKeySet;
    this.persistSeVolume = opts.persistSeVolume;
  }

  // ===== 音频文件操作 =====

  /**
   * 导入音频文件：解码 → 设音频名 → 时长跟随 → 触发持久化 → 通知订阅者。
   * 异步（engine.load 异步解码）；多次快速调用时仅最后一次结果生效（inFlightToken）。
   */
  importAudio(file: File): void {
    if (this._audioLocked) return;
    this._audioError = null;
    const token = ++this.inFlightToken;
    this.engine.load(file)
      .then(() => {
        // 若期间被新调用打断（clear / 再 import），丢弃此次结果
        if (token !== this.inFlightToken) return;
        this._audioName = file.name;
        this._audioBlob = file;
        // bug 34：换音频时无论 canPlay 是否已 true 都直接按新音频时长刷新谱面时长
        // 夹取按统一口径（clampChartDuration：下界 0.1、上限 MAX_DURATION_SECONDS = issue 28 P6 的 30 分钟）
        const ad = this.engine.duration;
        if (ad != null) this._chartDuration = clampChartDuration(ad);
        void this.persistNow();
        this.emit();
      })
      .catch((err: unknown) => {
        if (token !== this.inFlightToken) return;
        // 失败：保持无音频态 + 错误信息
        this._audioName = null;
        this._audioBlob = null;
        this._audioError = err instanceof Error && err.message ? err.message : t('audio.decodeFallback');
        this.emit();
      });
  }

  /**
   * 切工程时整体替换音频会话：同步写入 blob/时长，解码异步。
   * 不触发 persistNow——由工程加载路径在恢复结算后统一落盘，以免空会话写进新工程。
   */
  hydrateFromProject(opts: {
    audioName: string | null;
    audioBlob?: Blob;
    durationSeconds: number;
    audioLocked?: boolean;
  }): void {
    if (opts.audioLocked != null) this._audioLocked = opts.audioLocked;
    const token = ++this.inFlightToken;
    this._audioError = null;
    const duration = clampChartDuration(opts.durationSeconds);
    if (!opts.audioName || !opts.audioBlob) {
      this.engine.clear();
      this._audioName = null;
      this._audioBlob = null;
      this._chartDuration = duration;
      this.emit();
      return;
    }
    this._audioName = opts.audioName;
    this._audioBlob = opts.audioBlob;
    this._chartDuration = duration;
    this.emit();
    const file = opts.audioBlob instanceof File
      ? opts.audioBlob
      : new File([opts.audioBlob], opts.audioName);
    this.engine.load(file)
      .then(() => {
        if (token !== this.inFlightToken) return;
        const ad = this.engine.duration;
        if (ad != null) this._chartDuration = clampChartDuration(ad);
        this.emit();
      })
      .catch((err: unknown) => {
        if (token !== this.inFlightToken) return;
        this._audioError = err instanceof Error && err.message ? err.message : t('audio.decodeFallback');
        this.emit();
      });
  }

  /** 清除音频：引擎复位 → 时长保留当前值 → 触发持久化 → 通知订阅者 */
  clearAudio(): void {
    if (this._audioLocked) return;
    // 打断任何 in-flight import
    this.inFlightToken++;
    this.engine.clear();
    this._audioName = null;
    this._audioBlob = null;
    this._audioError = null;
    void this.persistNow();
    this.emit();
  }

  /** 关闭错误横幅 */
  dismissError(): void {
    if (this._audioError === null) return;
    this._audioError = null;
    this.emit();
  }

  // ===== 时长操作 =====

  /**
   * 手动改谱面时长（无音频时，issue 22 §4 / ADR-0005 §4）。
   * 有音频时由 importAudio 自动跟随音频时长，外部不应再调用本方法。
   * 拒绝 <=0 / NaN / Infinity；接受值经 clampChartDuration（口径唯一处）。
   */
  setChartDuration(sec: number): void {
    if (this._audioLocked) return;
    if (!Number.isFinite(sec) || sec <= 0) return;
    const clamped = clampChartDuration(sec);
    if (this._chartDuration === clamped) return;
    this._chartDuration = clamped;
    this.emit();
  }

  // ===== 引擎转发（透传到 usePlaybackCoordinator 等需要直接控制的场景） =====

  /** 改主音量（播放条）；同步到引擎；NaN/越界拒绝 */
  setVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const v = Math.min(1, Math.max(0, volume));
    if (this._volume === v) return;
    this._volume = v;
    this.engine.setVolume(v);
  }

  /** 获取主音量（0..1） */
  getVolume(): number {
    return this._volume;
  }

  // ===== 设置变更（keySet / seVolume） =====

  /** 切换激活素材包（音频页点击素材包卡片时调用） */
  setKeySetId(id: string): void {
    const resolved = keySoundSetEntryById(id).id;
    if (this._keySetId === resolved) return;
    this._keySetId = resolved;
    this.engine.setKeySetId(resolved);
    this.persistKeySet(resolved);
    this.emit();
  }

  /**
   * 试听（issue 29）：播放指定素材包某击打样式（方向键按 tier 1..3）的采样。
   * 透传到引擎；素材包 chunk 首次点击时按需下载。返回 Promise 供 UI 展示加载态。
   */
  previewKeySample(setId: string, kind: KeySoundKind, tier?: number): Promise<void> {
    return this.engine.previewKeySample(keySoundSetEntryById(setId).id, kind, tier);
  }

  /** 改 SE 音量（音频页 SE 滑杆）；NaN/越界拒绝 */
  setSeVolume(volume: number): void {
    if (!Number.isFinite(volume)) return;
    const v = Math.min(1, Math.max(0, volume));
    if (this._seVolume === v) return;
    this._seVolume = v;
    this.engine.setSeVolume(v);
    this.persistSeVolume(v);
    this.emit();
  }

  /**
   * 外部 settings 变化时同步进来（Editor 挂载 / settings 从存储加载完成后调用一次）。
   * 仅同步到引擎（不 emit），由调用方决定何时触发 snapshot。
   * 注意：构造时已经把初始值挂到引擎了，正常情况下 settings 与构造时一致 → 本方法早退。
   */
  syncSettingsFromConfig(rawKeySetId: string, seVolume: number): void {
    const keySetId = keySoundSetEntryById(rawKeySetId).id;
    const kChanged = this._keySetId !== keySetId;
    const sChanged = this._seVolume !== seVolume;
    if (kChanged) {
      this._keySetId = keySetId;
      this.engine.setKeySetId(keySetId);
    }
    if (sChanged) {
      const v = clampFinite(seVolume, 0, 1, this._seVolume);
      this._seVolume = v;
      this.engine.setSeVolume(v);
    }
    if (kChanged || sChanged) this.emit();
  }

  // ===== 状态查询（snapshot 之外的低成本读取） =====

  /** 是否有音频（等价于 audioName !== null） */
  hasAudio(): boolean {
    return this._audioName !== null;
  }

  /** 当前音频 Blob（持久化层读取用） */
  getAudioBlob(): Blob | null {
    return this._audioBlob;
  }

  // ===== 内部 =====

  private _snapshot(): AudioSessionSnapshot {
    return {
      audioName: this._audioName,
      audioError: this._audioError,
      chartDuration: this._chartDuration,
      audioDuration: this.engine.duration,
      hasAudio: this._audioName !== null,
      keySetId: this._keySetId,
      seVolume: this._seVolume,
      audioLocked: this._audioLocked,
    };
  }

  private emit(): void {
    const snap = this._snapshot();
    for (const l of this.listeners) {
      try { l(snap); } catch { /* listener 内部错误不阻断其他订阅者 */ }
    }
  }
}

/**
 * 工厂便捷函数（默认引擎）。
 * 测试场景：传自定义 factory（mock engine）。
 */
export function createAudioSession(opts: {
  keySetId: string;
  seVolume: number;
  chartDuration?: number;
  volume?: number;
  engineFactory?: AudioEngineFactory;
}): AudioSession {
  return new AudioSession(opts);
}
