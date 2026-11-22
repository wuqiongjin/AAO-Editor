/**
 * 封面缩略图（bestdori-integration 15）：把进缓存的封面原图顺手产一张 96×96 方形 PNG。
 *
 * 站点没有缩略图端点（13 #10 实测：jacket 是 400×400 PNG、39–98KB，跨境冷取 7.7s），
 * 「更小的图」只能本地生成。96×96 = 选曲行上的 48 CSS px @2x（票 15 定案 B · 48px 圆角），
 * 免得高分屏上发虚；行本来就按方形显示（`object-fit: cover`），所以先居中裁方再缩。
 *
 * 本模块只做「字节 → 字节」：不碰文件、不碰缓存记账（那是 assetCache 的事）。
 * `nativeImage` 由装配处注入（main.cjs 传 electron 的 nativeImage）—— 这样这里在 node 环境可单测，
 * 也免得 electron 依赖漏进纯逻辑。
 */

/** 缩略图边长（px）：48 CSS px @2x（与 ProjectsPage.css 的 `--off-thumb-size` 互锁） */
const THUMB_SIZE = 96;
/** 本地工程封面缩略图边长（px）：覆盖 172px 流式卡片 @2x 与 120px hero @3x（chart-projects 44） */
const PROJECT_THUMB_SIZE = 384;

/** 居中裁方：取短边，四边等分留白（400×300 → 300×300，起点 x=50 / y=0） */
function squareCrop(width, height) {
    const size = Math.min(width, height);
    return {
        x: Math.round((width - size) / 2),
        y: Math.round((height - size) / 2),
        width: size,
        height: size,
    };
}

/**
 * 造一个「字节 → 缩略图」的产出函数，喂给 `assetCache` 的 `makeThumb`（产固定 PNG）。
 * 不是图片 / 解不开 / 产出为空都回 **null** = 这条素材没有缩略图（界面降级成图标，不是报错）。
 *
 * **判定口径**：只拦「明说了不是图片」的那一类（SPA 回退页 `text/html`），其余交给解码器嗅探魔数 ——
 * 社区帖的**用户上传文件一律回 `application/octet-stream`**（实测：封面是 JPEG、音频是 mp3，
 * 站点都不给具体类型），按类型拦会让封面永远产不出缩略图。
 *
 * @param {{ createFromBuffer: (bytes: Buffer) => any }} nativeImage
 */
function decodeValidImage(nativeImage, bytes, contentType) {
    if (typeof contentType === 'string' && /^text\//i.test(contentType)) return null;
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image == null || typeof image.isEmpty !== 'function' || image.isEmpty()) return null;
    const { width, height } = image.getSize();
    if (!(width > 0) || !(height > 0)) return null;
    return { image, width, height };
}

/** 落盘 / 读盘前封面图片可解码性校验（票 56） */
function createImageValidator(nativeImage) {
    return (bytes, contentType) => decodeValidImage(nativeImage, bytes, contentType) != null;
}

function createThumbMaker(nativeImage, size = THUMB_SIZE) {
    return (bytes, contentType) => {
        const decoded = decodeValidImage(nativeImage, bytes, contentType);
        if (decoded == null) return null;
        const { image, width, height } = decoded;
        const png = image
            .crop(squareCrop(width, height))
            .resize({ width: size, height: size, quality: 'good' })
            .toPNG();
        if (!(png instanceof Uint8Array) || png.length === 0) return null;
        return { bytes: png, contentType: 'image/png' };
    };
}

module.exports = {
    THUMB_SIZE,
    PROJECT_THUMB_SIZE,
    squareCrop,
    createImageValidator,
    createThumbMaker,
};
