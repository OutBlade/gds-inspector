const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.forceDevUpdateConfig = false;

if (process.platform === "win32") {
  autoUpdater.verifyUpdateCodeSignature = false;
}

let mainWindow = null;

function getBackendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "gds_backend", "gds_backend.exe");
  }
  return path.join(__dirname, "../../dist/gds_backend/gds_backend.exe");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#080810",
    titleBarStyle: "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  createWindow();

  setTimeout(() => {
    try {
      autoUpdater.checkForUpdatesAndNotify();
    } catch (_) {}
  }, 5000);

  setInterval(() => {
    try {
      autoUpdater.checkForUpdatesAndNotify();
    } catch (_) {}
  }, 15 * 60 * 1000);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

autoUpdater.on("update-available", (info) => {
  mainWindow?.webContents.send("update:available", info.version);
});

autoUpdater.on("update-downloaded", (info) => {
  mainWindow?.webContents.send("update:downloaded", info.version);
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 8000);
});

ipcMain.handle("app:version", () => app.getVersion());

ipcMain.handle("app:install-update", () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle("gds:open-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Open GDSII File",
    filters: [
      { name: "GDSII Layout", extensions: ["gds", "gds2", "gdsx"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("gds:analyze", async (_event, filepath) => {
  const backendPath = getBackendPath();

  if (!fs.existsSync(backendPath)) {
    mainWindow?.webContents.send(
      "gds:error",
      "Backend not found. Please use the release build or compile the Python backend first."
    );
    return;
  }

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    const proc = spawn(backendPath, [filepath], { timeout: 60000 });

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      try {
        const data = JSON.parse(stdout.trim());
        if (data.status === "error") {
          mainWindow?.webContents.send("gds:error", data.message);
        } else {
          mainWindow?.webContents.send("gds:result", data);
        }
      } catch {
        mainWindow?.webContents.send(
          "gds:error",
          stderr || `Backend exited with code ${code}`
        );
      }
      resolve();
    });

    proc.on("error", (err) => {
      mainWindow?.webContents.send("gds:error", `Failed to start backend: ${err.message}`);
      resolve();
    });
  });
});
