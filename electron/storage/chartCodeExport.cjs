// 谱面代码另存为（issue 118）：每次 dialog，不记路径。
// basename 消毒与取消判定在 foundation/saveDialog.cjs，这里只给通道参数。
const { saveJsonWithDialog } = require('../foundation/saveDialog.cjs');

function registerChartCodeExportIpc(ipcMain, deps) {
    ipcMain.handle('chartCode:saveAs', (event, payload) =>
        saveJsonWithDialog(event, payload, {
            channel: 'chartCode:saveAs',
            titleKey: 'electron.exportChart',
            fallbackName: 'chart.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
        }, deps));
}

module.exports = { registerChartCodeExportIpc };
