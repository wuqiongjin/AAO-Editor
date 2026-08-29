// H5 收口：唯一位置类型，跨 Editing/UI/FinalVirtualCanvas/ChartGeometry 全栈复用
// 字段顺序统一为 { beat, lane }，调用点不再有 {lane, beat} / {beat, lane} / {preciseBeat, lane} 的多版本
export interface ChartPosition {
  beat: number;
  lane: number;
}
