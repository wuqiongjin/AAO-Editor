// 「谱面代码」入口按钮（issue 37：按需弹窗；issue 59 §2：永远打开**完整**谱面代码，不看选区）。
// 弹窗本体与打开态在 ChartCodeEditorProvider / ChartCodeEditorModal。
// 与「音符代码」工具的入口各司其职：本按钮不进工具轴、不看选区；选区 ≥2 时弹窗顶部给一行提示。
import { Braces } from "lucide-react";
import { useChartCodeEditor } from './ChartCodeEditorProvider';
import { t } from '../../../i18n';

export default function ChartCodeEditor() {
    const { openChartCode } = useChartCodeEditor();

    return (
        <button
            onClick={openChartCode}
            title={t('chartCode.open')}
            style={{
                width: '100%',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid transparent',
                backgroundColor: 'transparent', color: 'var(--text)',
                cursor: 'pointer', textAlign: 'left',
                fontFamily: 'inherit', fontSize: 'var(--text-sm)',
                transition: 'background-color var(--dur) var(--ease), color var(--dur) var(--ease)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
            <span style={{ display: 'flex', flexShrink: 0 }}><Braces size={20} /></span>
            <span>{t('tool.chartCode')}</span>
        </button>
    );
}
