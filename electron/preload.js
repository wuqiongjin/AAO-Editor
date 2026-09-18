const { contextBridge, ipcRenderer } = require('electron');

// 暴露受保护的方法，允许渲染进程使用
contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    versions: process.versions,
    // 谱面工程文件后端（issue 25）：渲染进程经此桥把工程数据落到 userData 文件。
    // get 返回 { doc, audio(Uint8Array) | null } 或 null（无数据）；
    // put 载荷见 src/utils/ChartProject.ts 的 ProjectPutWire。
    projectStore: {
        get: (id) => ipcRenderer.invoke('project:get', id),
        put: (payload) => ipcRenderer.invoke('project:put', payload),
    },
    // issue 118：谱面代码另存为。每次弹出系统保存对话框，不记路径。
    chartCodeExport: {
        saveAs: (payload) => ipcRenderer.invoke('chartCode:saveAs', payload),
    },
    // issue 117：数据根（不进设置对象）。change = 搬家；claim = 认领已有根。
    dataRoot: {
        get: () => ipcRenderer.invoke('dataRoot:get'),
        change: () => ipcRenderer.invoke('dataRoot:change'),
        claim: () => ipcRenderer.invoke('dataRoot:claim'),
    },
    backgroundSkin: {
        get: () => ipcRenderer.invoke('backgroundSkin:get'),
        put: (bytes) => ipcRenderer.invoke('backgroundSkin:put', bytes),
        clear: () => ipcRenderer.invoke('backgroundSkin:clear'),
    },
});
