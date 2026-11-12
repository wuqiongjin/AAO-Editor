import type { ActiveNoteIcons } from '../../../rendering/skin/noteSkin';
import CanvasSpriteIcon, { type SpriteIconConfig } from '../../../ui/CanvasSpriteIcon';

/** 当前皮肤的准备边界；也覆盖按住时插值轨位使用的端帽。 */
export async function prepareSimNoteSprites(icons: ActiveNoteIcons): Promise<void> {
  const configs: SpriteIconConfig[] = [];
  for (let lane = 0; lane < 7; lane++) {
    configs.push(icons.tapFor(lane), icons.tapVirtualFor(lane), icons.flickFor(lane), icons.skillFor(lane),
      icons.slideAmongFor(lane), icons.slideEndpointFor(lane), icons.slideEndpointLaneFor(lane));
    for (const side of ['L', 'R'] as const) {
      configs.push(icons.dirLaneFor(side, lane));
    }
  }
  for (const side of ['L', 'R'] as const) {
    // 箭头源矩形与 width 无关，取一组即可覆盖所有长度。
    const arrow = icons.dirGroup(side, 1).chevron;
    if (arrow) configs.push(arrow.config);
  }
  if (icons.flickTopDecorator) configs.push(icons.flickTopDecorator);
  if (icons.simultaneousLine) configs.push(icons.simultaneousLine);
  // 各源独立结算：缺一张图时，其他已加载切片仍准备完毕后才交还播放控制。
  const results = await Promise.allSettled([
    CanvasSpriteIcon.ensureImagesLoaded(icons.preloadSrcs()),
    CanvasSpriteIcon.ensureSpritesLoaded(configs),
  ]);
  const failed = results.find(result => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
