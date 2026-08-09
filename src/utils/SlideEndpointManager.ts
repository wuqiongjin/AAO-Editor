import type { ChartNote, SlideNote } from '../notes/Charts';

/**
 * 滑条端点管理器
 * 维护所有滑条的起点和终点，用于高效的滑条组合判断
 */

export interface SlideEndpoint {
    noteIndex: number;  // 滑条音符在notes数组中的索引
    connectionIndex: number;  // 连接点在connections数组中的索引
    beat: number;
    lane: number;
    subBeat?: number;
    isStart: boolean;  // true表示起点，false表示终点
}

export class SlideEndpointManager {
    private startPoints: Map<string, SlideEndpoint> = new Map();
    private endPoints: Map<string, SlideEndpoint> = new Map();

    /**
     * 生成位置键，用于Map的key
     */
    private getPositionKey(beat: number, lane: number, subBeat?: number): string {
        return `${beat}_${lane}_${subBeat || 0}`;
    }

    /**
     * 更新滑条端点信息
     * @param notes 当前所有音符
     */
    updateEndpoints(notes: ChartNote[]): void {
        this.startPoints.clear();
        this.endPoints.clear();

        notes.forEach((note, noteIndex) => {
            if (note.type === "Slide" || note.type === "Long") {
                const slideNote = note as SlideNote;
                if (slideNote.connections.length >= 2) {
                    // 找到真正的起点和终点（按beat值排序）
                    const sortedConnections = [...slideNote.connections].sort((a, b) => {
                        if (a.beat !== b.beat) {
                            return a.beat - b.beat;
                        }
                        return (a.subBeat || 0) - (b.subBeat || 0);
                    });

                    const startConnection = sortedConnections[0];
                    const endConnection = sortedConnections[sortedConnections.length - 1];

                    // 找到原始索引
                    const startIndex = slideNote.connections.findIndex(conn =>
                        conn.beat === startConnection.beat &&
                        conn.lane === startConnection.lane &&
                        (conn.subBeat || 0) === (startConnection.subBeat || 0)
                    );
                    const endIndex = slideNote.connections.findIndex(conn =>
                        conn.beat === endConnection.beat &&
                        conn.lane === endConnection.lane &&
                        (conn.subBeat || 0) === (endConnection.subBeat || 0)
                    );

                    // 添加起点
                    const startKey = this.getPositionKey(startConnection.beat, startConnection.lane, startConnection.subBeat);
                    this.startPoints.set(startKey, {
                        noteIndex,
                        connectionIndex: startIndex,
                        beat: startConnection.beat,
                        lane: startConnection.lane,
                        subBeat: startConnection.subBeat,
                        isStart: true
                    });

                    // 添加终点
                    const endKey = this.getPositionKey(endConnection.beat, endConnection.lane, endConnection.subBeat);
                    this.endPoints.set(endKey, {
                        noteIndex,
                        connectionIndex: endIndex,
                        beat: endConnection.beat,
                        lane: endConnection.lane,
                        subBeat: endConnection.subBeat,
                        isStart: false
                    });
                }
            }
        });
    }

    /**
     * 查找指定位置的起点
     * @param beat 
     * @param lane 
     * @param subBeat 
     * @returns 找到的起点信息，未找到返回null
     */
    findStartPoint(beat: number, lane: number, subBeat?: number): SlideEndpoint | null {
        const key = this.getPositionKey(beat, lane, subBeat);
        return this.startPoints.get(key) || null;
    }

    /**
     * 查找指定位置的终点
     * @param beat 
     * @param lane 
     * @param subBeat 
     * @returns 找到的终点信息，未找到返回null
     */
    findEndPoint(beat: number, lane: number, subBeat?: number): SlideEndpoint | null {
        const key = this.getPositionKey(beat, lane, subBeat);
        return this.endPoints.get(key) || null;
    }

    /**
     * 查找指定位置的端点（起点或终点）
     * @param beat 
     * @param lane 
     * @param subBeat 
     * @returns 找到的端点信息，未找到返回null
     */
    findEndpoint(beat: number, lane: number, subBeat?: number): SlideEndpoint | null {
        return this.findStartPoint(beat, lane, subBeat) || this.findEndPoint(beat, lane, subBeat);
    }

    /**
     * 获取所有起点
     */
    getAllStartPoints(): SlideEndpoint[] {
        return Array.from(this.startPoints.values());
    }

    /**
     * 获取所有终点
     */
    getAllEndPoints(): SlideEndpoint[] {
        return Array.from(this.endPoints.values());
    }

    /**
     * 清空所有端点信息
     */
    clear(): void {
        this.startPoints.clear();
        this.endPoints.clear();
    }
}

// 全局单例实例
export const slideEndpointManager = new SlideEndpointManager();
