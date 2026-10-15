const { contextBridge, ipcRenderer } = require('electron');

// 暴露受保护的方法，允许渲染进程使用
contextBridge.exposeInMainWorld('electronAPI', {
    platform: process.platform,
    versions: process.versions,
    // 谱面工程文件后端：渲染进程经此桥把工程数据落到数据根文件。
    // get 返回 { doc, audio, cover } 或 null（无数据 / 旧 schema）；put 见 ChartProject.ts。
    projectStore: {
        get: (id) => ipcRenderer.invoke('project:get', id),
        put: (payload) => ipcRenderer.invoke('project:put', payload),
        list: () => ipcRenderer.invoke('project:list'),
        delete: (id) => ipcRenderer.invoke('project:delete', id),
        // 发布（票 11）：工程音频 / 封面的上传引用（路径 + 字节数 + SHA-1），字节不过 IPC
        uploadRefs: (id) => ipcRenderer.invoke('project:uploadRefs', id),
    },
    // issue 118：谱面代码另存为。每次弹出系统保存对话框，不记路径。
    chartCodeExport: {
        saveAs: (payload) => ipcRenderer.invoke('chartCode:saveAs', payload),
    },
    // chart-preview 03：二进制另存（宽图 PNG；07 的视频导出复用）。收 Uint8Array + 建议文件名 + mime，
    // 每次弹系统保存对话框，不记路径。浏览器侧没有这条桥，降级 Blob + <a download>。
    preview: {
        saveBinary: (payload) => ipcRenderer.invoke('preview:saveBinary', payload),
    },
    // issue 117 + 19：数据根（不进设置对象）。open = 打开目录；change = 搬家；claim = 认领已有根。
    dataRoot: {
        get: () => ipcRenderer.invoke('dataRoot:get'),
        open: () => ipcRenderer.invoke('dataRoot:open'),
        change: () => ipcRenderer.invoke('dataRoot:change'),
        claim: () => ipcRenderer.invoke('dataRoot:claim'),
    },
    backgroundSkin: {
        get: () => ipcRenderer.invoke('backgroundSkin:get'),
        put: (bytes) => ipcRenderer.invoke('backgroundSkin:put', bytes),
        clear: () => ipcRenderer.invoke('backgroundSkin:clear'),
    },
    // issue 126：窗体 OS 标题栏跟 settings.theme（nativeTheme / backgroundColor）。
    windowChrome: {
        sync: (payload) => ipcRenderer.invoke('windowChrome:sync', payload),
    },
    i18n: {
        setLanguage: (locale) => ipcRenderer.invoke('i18n:setLanguage', locale),
    },
    // bestdori-integration 07 + 14：社区平台的唯一网络出口。renderer 只递 URL + 方法 + 载荷，
    // 主机白名单 / 限流 / Cookie / 素材缓存全在主进程（electron/communityNet.cjs + assetCache.cjs）；
    // 二进制落素材缓存（<数据根>/cache/community/），只回路径不回字节。
    // 浏览器侧没有这条桥 = 静态演示版，能力层降级为「平台不可用」。
    communityNet: {
        request: (payload) => ipcRenderer.invoke('communityNet:request', payload),
    },
    // bestdori-integration 10：会话 Cookie 的加密持久化（safeStorage 在主进程）。
    // 三条通道**都不收也不回凭据**：恢复 / 落盘 / 清除都由主进程从它自己那份内存 jar 做，
    // renderer 只拿到「有没有会话 / 落没落盘」这类布尔（ADR-0011 §3 凭据红线）。
    // 没有第四条：凭据面的接口越小越好，「本机能不能加密」由 persist() 的成败回答。
    communitySession: {
        restore: () => ipcRenderer.invoke('communitySession:restore'),
        persist: () => ipcRenderer.invoke('communitySession:persist'),
        clear: () => ipcRenderer.invoke('communitySession:clear'),
    },
    // 票 39：站外链接的唯一出口 —— 注册 / 找回密码这类「去站点」的入口开系统浏览器
    // （仓里既有的 <a target="_blank"> 在 Electron 里会开应用内无地址栏窗口 = 错形态）。
    // 与上面几条零入参桥不同：这条**必须收 URL**，所以放不放行由主进程校验
    // （electron/externalLink.cjs 只放行社区平台及其子域），renderer 递不进任意地址。
    shell: {
        openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    },
    // bestdori-integration 14 + 18：素材缓存的占用查询 / 清除 / 回收策略推送（设置页「存储与数据」用）。
    // 只有这三条：一条只读统计、一条显式清除、一条策略参数 —— 不暴露缓存内容。
    assetCache: {
        stats: () => ipcRenderer.invoke('assetCache:stats'),
        clear: () => ipcRenderer.invoke('assetCache:clear'),
        configure: (policy) => ipcRenderer.invoke('assetCache:configure', policy),
    },
});
