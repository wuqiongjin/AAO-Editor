import React, { memo } from 'react';
import PlayBar, { type PlayBarProps } from '../../playback/PlayBar';
import { usePlaybackSeconds } from '../../app/ProviderTree';

export type WorkspacePlayBarProps = Omit<PlayBarProps, 'currentSeconds'>;

/**
 * issue 232：工作台播放条接入件。
 * 直读 80ms 节流更新的 currentSeconds，将高频重渲染隔离在底栏播放条内部，
 * 避免 WorkspacePage（画布容器、工具轨、顶栏）随之周期性重渲染。
 */
const WorkspacePlayBar: React.FC<WorkspacePlayBarProps> = memo((props) => {
  const currentSeconds = usePlaybackSeconds();
  return <PlayBar {...props} currentSeconds={currentSeconds} />;
});

export default WorkspacePlayBar;
