/**
 * macOS (Darwin) 原生应用菜单模板构建
 * 包含应用主菜单（关于、隐藏、退出 Cmd+Q 等）与编辑菜单（撤销、重做、剪切、复制、粘贴、全选）
 *
 * @param {string} [appName='AAO Editor']
 * @returns {Array<object>}
 */
function buildDarwinMenuTemplate(appName = 'AAO Editor') {
    return [
        {
            label: appName,
            submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
            ],
        },
        {
            role: 'editMenu',
            submenu: [
                { role: 'undo' },
                { role: 'redo' },
                { type: 'separator' },
                { role: 'cut' },
                { role: 'copy' },
                { role: 'paste' },
                { role: 'selectAll' },
            ],
        },
    ];
}

/**
 * 按平台安装应用顶栏菜单：
 * - darwin (macOS): 安装极简原生应用菜单（保留关于、退出 Cmd+Q、编辑原生快捷键等）
 * - win32 / linux: 设为 null，保持沉浸式无边框/无原生顶栏菜单风格
 *
 * @param {NodeJS.Platform} platform
 * @param {string} appName
 * @param {typeof import('electron').Menu} MenuModule
 * @returns {object | null}
 */
function setupApplicationMenu(platform, appName, MenuModule) {
    if (platform === 'darwin') {
        const template = buildDarwinMenuTemplate(appName);
        const menu = MenuModule.buildFromTemplate(template);
        MenuModule.setApplicationMenu(menu);
        return menu;
    }
    MenuModule.setApplicationMenu(null);
    return null;
}

module.exports = {
    buildDarwinMenuTemplate,
    setupApplicationMenu,
};
