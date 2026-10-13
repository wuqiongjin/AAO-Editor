// 导出物（长图头带 / 视频开场）共用的**无衬线字体栈**：全站只有这一条，不打包字体。
//
// 为什么抽出来：ADR-0016 §5.1 定「文字沿用导出的既有 `HEADER_SANS` 链」—— 头带与开场两处
// 各抄一份字面量的话，改字体时必然漏一处（两份迟早漂）。
export const HEADER_SANS =
  '"Segoe UI Variable", "Noto Sans CJK SC", "PingFang SC", system-ui, sans-serif';
