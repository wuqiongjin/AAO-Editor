import { Check, Palette } from 'lucide-react';
import { useConfig } from '../contexts';
import { KEY_SOUND_SETS, type KeySoundSample } from '../utils/KeySound';
import { KEY_SOUND_KINDS, KEY_SOUND_KIND_META } from '../utils/KeySoundMeta';

// 素材页（issue 29）：导航第 3 项（音频之后，设置置末）。
// - 键音素材包：注册表内全部包以「卡片」呈现——左侧深色缩略图内是均衡器
//   （激活包跳动、未激活静止），右侧包名 + 五类击打样式 chip（绿点=真实音频、灰点=振荡器占位）；
//   点击「切换」写 settings.audio.keySet，与播放条素材下拉同字段，立即生效并自动持久化。
// - 皮肤：占位卡片（深色小画布预览 + 「即将支持」徽标），数据模型未定义，本轮不实现。

/** 采样类型短标签：真实音频 / 振荡器占位 / 分档音频 */
function sampleTag(sample: KeySoundSample): string {
  if (sample.tierSrcs) return '音频 · 分档';
  if (sample.src) return '音频';
  return '振荡器';
}

export default function AssetsPage() {
  const { settings, setKeySetId } = useConfig();
  const activeId = settings.audio.keySet;

  return (
    <div className="page-content is-fill">
      <header className="page-intro">
        <span>应用素材</span>
        <h2>素材</h2>
        <p>管理播放谱面时使用的键音素材包。切换立即生效并自动保存，与播放条的素材下拉共享同一配置。</p>
      </header>

      <div className="assets-layout">
        <section className="assets-sets" aria-label="键音素材包">
          <div className="section-heading">
            <div>
              <h2>键音素材包</h2>
              <p>播放时按击打样式（单键 / 滑键 / 技能键 / 滑条 / 方向键）触发对应音效</p>
            </div>
            <span className="state-label">{KEY_SOUND_SETS.length} 个</span>
          </div>

          {KEY_SOUND_SETS.map((set) => {
            const active = set.id === activeId;
            return (
              <div key={set.id} className={`asset-set${active ? ' is-active' : ''}`}>
                <div className="asset-set-visual" aria-hidden="true">
                  <span className="eq">
                    <i /><i /><i /><i /><i />
                  </span>
                </div>
                <div className="asset-set-body">
                  <div className="asset-set-head">
                    <strong>{set.label}</strong>
                    {active ? (
                      <span className="state-label success">使用中</span>
                    ) : (
                      <button type="button" onClick={() => setKeySetId(set.id)}>
                        切换
                      </button>
                    )}
                  </div>
                  <ul className="asset-samples">
                    {KEY_SOUND_KINDS.map((kind) => {
                      const meta = KEY_SOUND_KIND_META[kind];
                      const sample = set.samples[kind];
                      const synth = !sample.src && !sample.tierSrcs;
                      return (
                        <li key={kind} title={meta.hint}>
                          <span className={`asset-sample-dot${synth ? ' is-synth' : ''}`} />
                          <span>{meta.label}</span>
                          <span className="asset-sample-tag">{sampleTag(sample)}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            );
          })}

          <div className="flow-note"><Check size={15} />切换后立即对后续播放生效；当前播放中的按键音将在暂停/重播后使用新素材。</div>
        </section>

        <aside className="assets-skin surface-section" aria-label="皮肤（占位）">
          <div className="assets-skin-head">
            <Palette size={18} />
            <div>
              <h2>皮肤</h2>
              <p>谱面画布与音符外观</p>
            </div>
          </div>

          <div className="skin-preview" aria-hidden="true">
            <i className="n1" /><i className="n2" /><i className="n3" />
            <i className="n4" /><i className="n5" /><i className="n6" />
          </div>

          <span className="skin-badge">即将支持</span>
          <span className="field-help">皮肤数据模型尚未定义，此处仅预留分类；当前谱面画布外观随主题令牌（谱面画布固定深色）。</span>
        </aside>
      </div>
    </div>
  );
}
