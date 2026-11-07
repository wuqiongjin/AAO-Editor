// 「收藏选区」的唯一执行路径（issue 185 / ADR-0023 §3）：抽屉 footer 按钮与 `execSavePattern`
// 快捷键都走这里。
//
// 两条口径：
// - **读的是选区、不写谱面** → 不受只读闸门约束：已上传的谱面允许选中 / 复制，也就能收藏；
// - **无选区 = 无事发生**：不落库、不提示、不自动打开抽屉（别打断正在编辑的人）。
//
// `canSave` 与 `save` 同源给出：按钮置灰与快捷键的判据必须是同一个（两处各读一次选区必然漂）。
import { useCallback, useRef } from 'react';
import { useEditing } from '../../app/ProviderTree';
import type { PatternLibraryApi } from '../../patterns/usePatternLibrary';
import { t } from '../../i18n';
import { showToast } from '../../ui/Toast';

export interface SaveSelectionPatternApi {
  /** 选区非空 → 可收藏 */
  canSave: boolean;
  save: () => Promise<void>;
}

export function useSaveSelectionPattern(library: PatternLibraryApi): SaveSelectionPatternApi {
  const { notes, selectedItems } = useEditing();
  // 走 ref 读最新值：调用方是快捷键分发器（`runFunction`），它的身份每变一次就要重挂
  // window keydown —— 把 notes 放进 deps 等于"每敲一个音符重订阅一次"。
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const selectionRef = useRef(selectedItems);
  selectionRef.current = selectedItems;

  const save = useCallback(async () => {
    const saved = await library.addFromSelection(notesRef.current, selectionRef.current);
    if (!saved) return;
    showToast(t('patternLibrary.savedToast'), 'success');
  }, [library]);

  return { canSave: selectedItems.length > 0, save };
}
