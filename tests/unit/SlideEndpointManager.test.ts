import { describe, test, expect, beforeEach } from 'vitest';
import { SlideEndpointManager } from '../../src/chart/editing/SlideEndpointManager';
import type { ChartNote } from '../../src/chart/types';

describe('SlideEndpointManager', () => {
    let manager: SlideEndpointManager;

    beforeEach(() => {
        manager = new SlideEndpointManager();
    });

    test('should correctly identify start and end points for normal slide', () => {
        const notes: ChartNote[] = [
            {
                type: "Slide",
                connections: [
                    { beat: 1, lane: 1, subBeat: 0 },  // 起点
                    { beat: 3, lane: 1, subBeat: 0 }   // 终点
                ]
            }
        ];

        manager.updateEndpoints(notes);

        // 检查起点
        const startPoint = manager.findStartPoint(1, 1, 0);
        expect(startPoint).not.toBeNull();
        expect(startPoint?.isStart).toBe(true);
        expect(startPoint?.beat).toBe(1);

        // 检查终点
        const endPoint = manager.findEndPoint(3, 1, 0);
        expect(endPoint).not.toBeNull();
        expect(endPoint?.isStart).toBe(false);
        expect(endPoint?.beat).toBe(3);
    });

    test('should correctly identify start and end points for reversed slide', () => {
        const notes: ChartNote[] = [
            {
                type: "Slide",
                connections: [
                    { beat: 3, lane: 1, subBeat: 0 },  // 用户先放的终点
                    { beat: 1, lane: 1, subBeat: 0 }   // 用户后放的起点
                ]
            }
        ];

        manager.updateEndpoints(notes);

        // 检查起点（应该是beat=1的点）
        const startPoint = manager.findStartPoint(1, 1, 0);
        expect(startPoint).not.toBeNull();
        expect(startPoint?.isStart).toBe(true);
        expect(startPoint?.beat).toBe(1);

        // 检查终点（应该是beat=3的点）
        const endPoint = manager.findEndPoint(3, 1, 0);
        expect(endPoint).not.toBeNull();
        expect(endPoint?.isStart).toBe(false);
        expect(endPoint?.beat).toBe(3);
    });

    test('should handle multiple slides correctly', () => {
        const notes: ChartNote[] = [
            {
                type: "Slide",
                connections: [
                    { beat: 1, lane: 1, subBeat: 0 },
                    { beat: 3, lane: 1, subBeat: 0 }
                ]
            },
            {
                type: "Slide",
                connections: [
                    { beat: 5, lane: 2, subBeat: 0 },
                    { beat: 7, lane: 2, subBeat: 0 }
                ]
            }
        ];

        manager.updateEndpoints(notes);

        // 检查第一个滑条
        expect(manager.findStartPoint(1, 1, 0)?.isStart).toBe(true);
        expect(manager.findEndPoint(3, 1, 0)?.isStart).toBe(false);

        // 检查第二个滑条
        expect(manager.findStartPoint(5, 2, 0)?.isStart).toBe(true);
        expect(manager.findEndPoint(7, 2, 0)?.isStart).toBe(false);
    });

    test('should handle slides with same beat but different subBeat', () => {
        const notes: ChartNote[] = [
            {
                type: "Slide",
                connections: [
                    { beat: 1, lane: 1, subBeat: 0.25 },  // 起点
                    { beat: 1, lane: 1, subBeat: 0.75 }   // 终点
                ]
            }
        ];

        manager.updateEndpoints(notes);

        // 检查起点（subBeat较小的）
        const startPoint = manager.findStartPoint(1, 1, 0.25);
        expect(startPoint).not.toBeNull();
        expect(startPoint?.isStart).toBe(true);

        // 检查终点（subBeat较大的）
        const endPoint = manager.findEndPoint(1, 1, 0.75);
        expect(endPoint).not.toBeNull();
        expect(endPoint?.isStart).toBe(false);
    });
});
