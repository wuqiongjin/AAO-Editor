// 背景皮肤文件（issue 117）：<数据根>/assets/background-skin.bin
// 数据根每次现取（可搬家）；写盘走原子写，与片段库同口径。
const fs = require('fs');
const path = require('path');
const { backgroundSkinPath } = require('../storage/dataRoot.cjs');
const { writeFileAtomic } = require('../foundation/atomicWrite.cjs');

function registerBackgroundSkinIpc(ipcMain, deps) {
    const currentDataRoot = deps.currentDataRoot;

    ipcMain.handle('backgroundSkin:get', async () => {
        try {
            return await fs.promises.readFile(backgroundSkinPath(currentDataRoot()));
        } catch {
            return null;
        }
    });

    ipcMain.handle('backgroundSkin:put', async (_event, bytes) => {
        if (!(bytes instanceof Uint8Array)) {
            throw new Error('backgroundSkin:put 需要字节');
        }
        const filePath = backgroundSkinPath(currentDataRoot());
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await writeFileAtomic(filePath, Buffer.from(bytes));
        return true;
    });

    ipcMain.handle('backgroundSkin:clear', async () => {
        await fs.promises.rm(backgroundSkinPath(currentDataRoot()), { force: true });
        return true;
    });
}

module.exports = { registerBackgroundSkinIpc };
