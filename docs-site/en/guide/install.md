# Install

AAO Editor ships desktop installers for Windows, macOS, and Linux. If you'd rather not install anything yet, open the [home page](../index.md) and choose **Try online** to use the [web version](./web-version.md) first.

## Download

Installers are published on [GitHub Releases](https://github.com/wuqiongjin/AAO-Editor/releases). On networks in China, [CNB Releases](https://cnb.cool/AsterPicker/AAO-Editor/-/releases) mirrors the same files — synced slightly later, download only. In-app updates still use GitHub.

| Platform | Package | Notes |
| --- | --- | --- |
| Windows | NSIS (`.exe`) | Guided install; you can change the install directory |
| macOS | DMG (`.dmg`) | Builds for both Intel and Apple silicon |
| Linux | AppImage (`.AppImage`) | No install; make it executable and run |

## Installing

### Windows

1. Run the downloaded `.exe`.
2. If **Windows protected your PC** appears, choose **More info** → **Run anyway**.
3. Pick an install location and finish the wizard.

### macOS

1. Open the `.dmg` and drag AAO Editor into **Applications**.
2. Don't double-click the first time: in **Applications**, right-click (or Control-click) the icon, choose **Open**, then confirm with **Open** once more.
3. After that, double-clicking works normally.

### Linux

Make the AppImage executable, then run it:

```bash
chmod +x AAO-Editor-*.AppImage
./AAO-Editor-*.AppImage
```

You can also right-click the file → Properties → Permissions → **Allow executing file as program**, then double-click it.

## Unsigned builds

The installers are not code-signed or notarized yet, so the OS treats them as unsigned apps. That is expected:

- **macOS**: the first launch warns that the app is from an unidentified developer. Allow it once with right-click → **Open**; it won't ask again.
- **Windows**: SmartScreen shows the protected-PC warning. Choose **More info** → **Run anyway**.

## First launch

The app opens on the **project manager page**, on the project hub. With no projects yet, the page offers **Create your first project**. No account or network connection is required.

- Want to see something immediately: follow the [quick start](./getting-started.md).
- Want to adjust the UI first: appearance, canvas display, and shortcuts all live in Settings and apply immediately.

## Where your data lives

Chart projects, asset cache, and canvas background are stored in the local app data directory — never on a business server. To see the actual path:

**Settings › Storage & data › Charts & assets** shows the current path and has an **Open data directory** button. You can also move the directory there, or point the app at an existing one (useful when migrating machines).

## Updates

The installed app checks for a new version once in the background at startup (**Settings › About** → **Auto check**, on by default; one check per run). Once the download finishes, the app offers **Restart to update**; choose **Restart now** to install.

You can also check manually any time in **Settings › About**. Updates come from GitHub Releases; CNB only mirrors installers and is not an update source.
