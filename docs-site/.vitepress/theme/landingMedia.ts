/**
 * 落地页用到的图片：规格集中放这里，alt / 图注只存文案键，渲染时按当前语言解析。
 *
 * 图片本身直接复用仓库里 `docs/media/readme/`（`@shots` 别名，构建时按 base 输出哈希资源），
 * 站点目录不再存副本。
 */
import type { ShotSpec } from './landingTypes'

import createFromOfficialChart from '@shots/create-from-official-chart.png'
import curveTool from '@shots/curve-tool.gif'
import placeSlide from '@shots/place-slide.gif'
import projectDetail from '@shots/project-detail.png'
import projectHub from '@shots/project-hub.png'
import sheetExport from '@shots/sheet-export.png'
import simulation from '@shots/simulation.png'
import staticPreview from '@shots/static-preview.png'
import workspace from '@shots/workspace.png'

/** 首屏主图 */
export const HERO_SHOT: ShotSpec = {
  src: projectHub,
  altKey: 'altProjectHub',
  captionKey: 'heroShotCap',
  width: 1920,
  height: 1001,
}

/** 01 工程管理：曲库建工程 / 工程详情 / 启动台 */
export const CAP01_SLIDES: ShotSpec[] = [
  { src: createFromOfficialChart, altKey: 'altOfficialChart', captionKey: 'cap01Shot1Cap', width: 1920, height: 1001 },
  { src: projectDetail, altKey: 'altProjectDetail', captionKey: 'cap01Shot2Cap', width: 1920, height: 1001 },
  { src: projectHub, altKey: 'altProjectHub', captionKey: 'cap01Shot3Cap', width: 1920, height: 1001 },
]

/** 02 编辑：工作台 + 两张操作演示动图 */
export const CAP02_SHOTS: ShotSpec[] = [
  { src: workspace, altKey: 'altWorkspace', captionKey: 'cap02ShotCap', width: 1920, height: 1001 },
  { src: placeSlide, altKey: 'altPlaceSlide', captionKey: 'gif1Cap', width: 1475, height: 652, demo: true },
  { src: curveTool, altKey: 'altCurveTool', captionKey: 'gif2Cap', width: 1477, height: 652, demo: true },
]

/** 03 预览与导出：静态预览 / 仿真场 / 谱面图 */
export const CAP03_SLIDES: ShotSpec[] = [
  { src: staticPreview, altKey: 'altStaticPreview', captionKey: 'cap03Shot1Cap', width: 1920, height: 1001 },
  { src: simulation, altKey: 'altSimulation', captionKey: 'cap03Shot2Cap', width: 1920, height: 1001 },
  { src: sheetExport, altKey: 'altSheetExport', captionKey: 'cap03Shot3Cap', width: 1006, height: 976 },
]
