// AudioPageContext（issue 28 页面壳）：
// AppShell 的「音频」页所需的工程音频数据与操作。
// 音频引擎与持久化仍由工作台（Editor）拥有；本 Context 仅把工作台暴露给音频页的数据/操作桥接过去，
// 避免把页面壳与播放引擎耦合（Q16 工作台黑盒边界）。
import { createContext, useContext, useState, type ReactNode } from 'react';

export interface AudioPageApi {
  audioName: string | null;
  /** 当前谱面时长（秒） */
  duration: number;
  /** 导入/解码失败的错误信息（Q15：内联横幅展示） */
  error: string | null;
  importAudio: (file: File) => void;
  clearAudio: () => void;
  dismissError: () => void;
  onDurationChange: (sec: number) => void;
}

interface AudioPageContextValue {
  api: AudioPageApi | null;
  setApi: (api: AudioPageApi | null) => void;
}

const AudioPageContext = createContext<AudioPageContextValue | null>(null);

export function AudioPageProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState<AudioPageApi | null>(null);
  return <AudioPageContext.Provider value={{ api, setApi }}>{children}</AudioPageContext.Provider>;
}

/** 工作台注册其音频页 API（Editor 挂载时调用，随 audioName/error 变化更新） */
export function useAudioPageRegister(): (api: AudioPageApi | null) => void {
  const ctx = useContext(AudioPageContext);
  if (!ctx) throw new Error('useAudioPageRegister must be used within AudioPageProvider');
  return ctx.setApi;
}

/** 音频页读取工作台暴露的音频 API */
export function useAudioPage(): AudioPageApi | null {
  const ctx = useContext(AudioPageContext);
  if (!ctx) throw new Error('useAudioPage must be used within AudioPageProvider');
  return ctx.api;
}
