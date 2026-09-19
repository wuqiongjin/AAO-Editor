// NoteInfoPanel（ADR-0003 §7）：右侧「音符信息」面板。
// 只负责「选中音符」域：数量、详情、删除/镜像。
// issue 37：谱面代码编辑器已改为按需弹窗（入口移至左侧工具栏「编辑」分组），此处不再占位。
import { useEditing } from '../../../app/ProviderTree';
import { selectionNoteIndices } from '../../editing/SelectionEditing';
import ActionBtn from '../../../ui/ActionBtn';
import { t, tPlural } from '../../../i18n';

export default function NoteInfoPanel() {
    const { notes, selectedItems, deleteSelected, mirror } = useEditing();
    const selectedNotes = selectionNoteIndices(selectedItems);
    const selectedNoteObjects = selectedNotes.map(index => notes[index]).filter(Boolean);

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
            {/* 音符信息区块 */}
            <div style={{
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
            }}>
                <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border)' }}>
                    <h3 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 600 }}>{t('noteInfo.title')}</h3>
                </div>

                <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {/* 选中音符数量 */}
                    <div>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                            {tPlural('noteInfo.selected', selectedNotes.length)}
                        </span>
                    </div>

                    {/* 操作按钮 */}
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

                {/* 选中音符详情 */}
                <div style={{
                    maxHeight: 256, overflowY: 'auto', padding: 'var(--space-3) var(--space-4)',
                    borderTop: '1px solid var(--border)', backgroundColor: 'var(--bg-inset)',
                }}>
                    {selectedNoteObjects.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                            {selectedNoteObjects.map((note, index) => (
                                <div key={index} style={{
                                    padding: 'var(--space-3)', backgroundColor: 'var(--bg-elevated)',
                                    borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                                    boxShadow: 'var(--shadow-sm)',
                                }}>
                                    <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                                        {note.type === "Single" && t('noteInfo.single')}
                                        {note.type === "Slide" && t('noteInfo.slide')}
                                        {note.type === "BPM" && t('noteInfo.bpm')}
                                    </div>
                                    {note.type === "Single" && (
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
                                            <div>{t('noteInfo.lane', { lane: note.lane })}</div>
                                            <div>{t('noteInfo.beat', { beat: note.beat })}</div>
                                            {note.flick && <div style={{ color: 'var(--danger-text)' }}>{t('noteInfo.flick')}</div>}
                                        </div>
                                    )}
                                    {note.type === "Slide" && (
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
                                            <div>{t('noteInfo.connections', { count: note.connections.length })}</div>
                                            {note.connections.map((conn, i) => (
                                                <div key={i}>
                                                    {t('noteInfo.point', { n: i + 1, lane: conn.lane, beat: conn.beat })}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {note.type === "BPM" && (
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: 'var(--space-1)', fontVariantNumeric: 'tabular-nums' }}>
                                            <div>{t('noteInfo.beat', { beat: note.beat })}</div>
                                            <div>{t('noteInfo.bpmValue', { bpm: note.bpm })}</div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ color: 'var(--text-subtle)', textAlign: 'center', padding: 'var(--space-8) 0', fontSize: 'var(--text-sm)' }}>
                            {t('noteInfo.empty')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
