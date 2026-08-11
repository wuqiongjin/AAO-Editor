import { useRef } from 'react';
import { AlertTriangle, Check, Clock3, Music2, Upload } from 'lucide-react';
import { useAudioPage } from '../contexts/AudioPageContext';
import { MAX_DURATION_SECONDS } from '../utils/AppSettings';

// 音频页（issue 28 Q15）：
// - 导入/解码失败用内联错误横幅就地反馈（文字醒目、可即时重试）；
// - 成功仅更新状态，不加 toast；
// - 移除页内"返回工作台"按钮（切页由应用导航承担）；
// - 清除音频不需二次确认（低风险、可重新导入），旁加说明"清除后需重新导入"。
export default function AudioPage() {
  const api = useAudioPage();
  const fileRef = useRef<HTMLInputElement>(null);

  const audioName = api?.audioName ?? null;
  const canPlay = audioName !== null;
  const error = api?.error ?? null;

  const pickFile = () => fileRef.current?.click();

  return (
    <div className="page-content is-fill">
      <header className="page-intro">
        <span>当前谱面工程</span>
        <h2>音频与谱面时长</h2>
        <p>音频是可选素材。清除音频后仍可继续制谱，并能手动调整谱面时长。</p>
      </header>

      <div className="audio-layout">
        <section className="audio-primary surface-section">
          <div className="section-heading">
            <div>
              <h2>音频素材</h2>
              <p>支持浏览器可解码的常见音频格式</p>
            </div>
            <span className={`state-label${canPlay ? ' success' : ''}`}>{canPlay ? '已加载' : '无音频'}</span>
          </div>

          <div className="audio-file">
            <span className="audio-file-icon"><Music2 size={22} /></span>
            <div>
              <strong>{canPlay ? audioName : '尚未导入音频'}</strong>
              <span>{canPlay ? '已加载 · 谱面时长锁定为音频时长' : '无音频模式可正常编辑和预览谱面'}</span>
            </div>
            {canPlay && (
              <button type="button" onClick={() => api?.clearAudio()} title="清除后需重新导入">
                清除
              </button>
            )}
          </div>

          <div className="section-actions">
            <button className="button-primary" type="button" onClick={pickFile}>
              <Upload size={16} />{canPlay ? '更换音频' : '导入音频'}
              <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files && e.target.files[0]) api?.importAudio(e.target.files[0]); e.target.value = ''; }}
              />
            </button>
            <span>导入后，谱面时长将跟随音频长度。</span>
          </div>

          {canPlay && (
            <div className="flow-note"><Check size={15} />清除音频后需重新导入。</div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <AlertTriangle size={18} />
              <div>
                <strong>音频解码失败</strong>
                <p style={{ margin: 0 }}>{error}</p>
                <div className="error-actions">
                  <button type="button" onClick={pickFile}>重新选择音频</button>
                  <button type="button" onClick={() => api?.dismissError()}>知道了</button>
                </div>
              </div>
            </div>
          )}
        </section>

        <aside className="audio-side surface-section">
          <Clock3 size={20} />
          <div>
            <h2>谱面时长</h2>
            <p>{canPlay ? '由当前音频锁定' : '无音频时可手动修改'}</p>
          </div>
          <div className="duration-field">
            <input
              type="number"
              min={1}
              max={MAX_DURATION_SECONDS}
              value={Math.round(api?.duration ?? 30)}
              readOnly={canPlay}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!isNaN(v) && v > 0) api?.onDurationChange(Math.min(v, MAX_DURATION_SECONDS));
              }}
            />
            <span>秒</span>
          </div>
          <span className="field-help">{canPlay ? '清除音频后即可编辑' : '至少 1 秒，自动保存'}</span>
        </aside>
      </div>

      <div className="flow-note"><Check size={15} />切换到此页面时，工作台会保留当前位置；若正在播放则自动暂停。</div>
    </div>
  );
}
