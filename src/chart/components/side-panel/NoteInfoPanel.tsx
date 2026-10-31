// NoteInfoPanel（ADR-0003 §7）：右侧「音符信息」面板。
// 只负责「选中音符」域：数量、删除/镜像（issue 149：去掉 per-note 详情列表）。
// issue 37：谱面代码编辑器已改为按需弹窗（入口移至左侧工具栏「编辑」分组），此处不再占位。
import { memo } from 'react';
import { useEditing } from '../../../app/ProviderTree';
import { selectionNoteIndices } from '../../editing/SelectionEditing';
import ActionBtn from '../../../ui/ActionBtn';
import { t, tPlural } from '../../../i18n';

export default memo(function NoteInfoPanel() {
    const { selectedItems, deleteSelected, mirror } = useEditing();
    const selectedNotes = selectionNoteIndices(selectedItems);

    const handleDeleteSelected = () => {
        if (selectedNotes.length === 0) return;
        deleteSelected();
    };

    const handleMirrorSelected = () => {
        if (selectedNotes.length === 0) return;
        mirror();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 'var(--space-3)' }}>
            <div style={{
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
            }}>
                <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600 }}>{t('noteInfo.title')}</h3>
                </div>

                <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <div>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                            {tPlural('noteInfo.selected', selectedNotes.length)}
                        </span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        <ActionBtn
                            onClick={handleDeleteSelected}
                            disabled={selectedNotes.length === 0}
                            variant="danger"
                        >{t('noteInfo.delete')}</ActionBtn>
                        <ActionBtn
                            onClick={handleMirrorSelected}
                            disabled={selectedNotes.length === 0}
                        >{t('noteInfo.mirror')}</ActionBtn>
                    </div>
                </div>
            </div>
        </div>
    );
});
