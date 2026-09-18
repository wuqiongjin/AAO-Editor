/**
 * 内容壳一行几何（issue 120 / ADR-0007 §5）。
 * W = 内容壳宽 = 窗口宽 − 应用导航。
 * L + 侧栏 + gap + 正文 + R = W。
 */

export const CONTENT_SHELL_GAP = 24;
export const CONTENT_SHELL_BODY_ANCHOR = 920;
export const CONTENT_SHELL_BODY_MAX = 1440;
export const CONTENT_SHELL_GUTTER_MIN = 16;
/** 左侧外侧间隙上限。可调；不锁死 ADR 数字。 */
export const CONTENT_SHELL_INSET_L_MAX = 96;
/** 默认窗左缘，Q18：不改成左右对称。 */
export const CONTENT_SHELL_INSET_L_ANCHOR = 51;
export const CONTENT_SHELL_WINDOW_DEFAULT = 1260;
export const CONTENT_SHELL_NAV_COLLAPSED = 52;
export const CONTENT_SHELL_SIDEBAR_MIN = 140;
export const CONTENT_SHELL_SIDEBAR_MAX = 200;
export const CONTENT_SHELL_SIDEBAR_PCT = 0.125;

export type ContentShellLayout = {
  L: number;
  R: number;
  body: number;
  sidebar: number;
};

export function contentShellSidebarWidth(W: number): number {
  return Math.min(
    CONTENT_SHELL_SIDEBAR_MAX,
    Math.max(CONTENT_SHELL_SIDEBAR_MIN, CONTENT_SHELL_SIDEBAR_PCT * W),
  );
}

function defaultRightGutter(): number {
  const W0 = CONTENT_SHELL_WINDOW_DEFAULT - CONTENT_SHELL_NAV_COLLAPSED;
  const S0 = contentShellSidebarWidth(W0);
  return W0 - S0 - CONTENT_SHELL_GAP - CONTENT_SHELL_BODY_ANCHOR - CONTENT_SHELL_INSET_L_ANCHOR;
}

export function layoutContentShell(W: number, L_max = CONTENT_SHELL_INSET_L_MAX): ContentShellLayout {
  const sidebar = contentShellSidebarWidth(W);
  const row = W - sidebar - CONTENT_SHELL_GAP;
  const L0 = CONTENT_SHELL_INSET_L_ANCHOR;
  const R0 = defaultRightGutter();
  const frozenBody = row - L0 - R0;

  if (frozenBody < CONTENT_SHELL_BODY_ANCHOR) {
    const deficit = CONTENT_SHELL_BODY_ANCHOR - frozenBody;
    const shrinkL = L0 - CONTENT_SHELL_GUTTER_MIN;
    const shrinkR = R0 - CONTENT_SHELL_GUTTER_MIN;
    const equalEach = Math.min(shrinkL, shrinkR);
    if (deficit <= equalEach * 2) {
      const d = deficit / 2;
      return { L: L0 - d, R: R0 - d, body: CONTENT_SHELL_BODY_ANCHOR, sidebar };
    }
    let rest = deficit - equalEach * 2;
    let L = L0 - equalEach;
    let R = R0 - equalEach;
    if (R > CONTENT_SHELL_GUTTER_MIN) {
      const take = Math.min(rest, R - CONTENT_SHELL_GUTTER_MIN);
      R -= take;
      rest -= take;
    }
    if (rest > 0 && L > CONTENT_SHELL_GUTTER_MIN) {
      const take = Math.min(rest, L - CONTENT_SHELL_GUTTER_MIN);
      L -= take;
      rest -= take;
    }
    if (rest <= 0) {
      return { L, R, body: CONTENT_SHELL_BODY_ANCHOR, sidebar };
    }
    return {
      L: CONTENT_SHELL_GUTTER_MIN,
      R: CONTENT_SHELL_GUTTER_MIN,
      body: Math.max(0, row - CONTENT_SHELL_GUTTER_MIN * 2),
      sidebar,
    };
  }

  if (frozenBody <= CONTENT_SHELL_BODY_MAX) {
    return { L: L0, R: R0, body: frozenBody, sidebar };
  }

  const extra = frozenBody - CONTENT_SHELL_BODY_MAX;
  const growL = L_max - L0;
  if (extra <= growL * 2) {
    const d = extra / 2;
    return { L: L0 + d, R: R0 + d, body: CONTENT_SHELL_BODY_MAX, sidebar };
  }
  return {
    L: L_max,
    R: R0 + growL + (extra - growL * 2),
    body: CONTENT_SHELL_BODY_MAX,
    sidebar,
  };
}
