// 一次性时长探针（票 15 定案 9）：只要"这个音频多长"，拿完即丢。
//
// 为什么不用共享 AudioEngine 的 load()：那是工作台的位置——它手里是**当前工程**解码后的
// buffer，也是播放器。为了问一句"非当前工程的音频多长"去借它 load 一次，就把工作台那份顶掉了。
// OfflineAudioContext 解码得到的 AudioBuffer 用完即丢，不常驻、不进采样缓存，也不参与播放。
//
// 接缝形状要为将来的"按需播放"留位（票 22 定案 11）：那时会需要的是**解码结果**而不只是时长，
// 所以这里把"解码"这一环抽成可注入的 decode —— 扩展时多返回一个 buffer 即可，调用方不改。

/** 解码一步的形状：至少给得出时长（将来可加 buffer）。 */
export type AudioDecodeResult = { duration: number };

/** 解码器：字节 → 解码结果。测试注入假解码器即可在 node 环境跑。 */
export type AudioBytesDecoder = (bytes: ArrayBuffer) => Promise<AudioDecodeResult>;

/**
 * 生产解码器：离线音频上下文。
 *
 * OfflineAudioContext 的构造参数只影响**渲染**，不影响 decodeAudioData 的结果
 * （时长由音频数据自身决定），所以给 1 帧、默认采样率即可。
 */
export function offlineAudioDecoder(bytes: ArrayBuffer): Promise<AudioDecodeResult> {
  const Ctor =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!Ctor) throw new Error('无离线音频上下文');
  const ctx = new Ctor(1, 1, 44100);
  return ctx.decodeAudioData(bytes);
}

/** 求音频时长（秒）。解不出来 / 时长非法一律抛错——调用方据此放弃这次写入，不落半截记录。 */
export async function probeAudioDuration(
  file: Blob,
  decode: AudioBytesDecoder = offlineAudioDecoder,
): Promise<number> {
  const bytes = await file.arrayBuffer();
  const decoded = await decode(bytes);
  const duration = decoded?.duration;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    throw new Error('音频时长不可用');
  }
  return duration;
}
