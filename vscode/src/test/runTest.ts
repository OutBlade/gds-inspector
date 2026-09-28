import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { runTests } from "@vscode/test-electron";

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "../..");
  const extensionTestsPath = path.resolve(__dirname, "./suite/index");
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "gds-inspector-test-"));
  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspace, "--disable-extensions", "--disable-workspace-trust"],
      extensionTestsEnv: { GDS_TEST_DIR: workspace, GDS_TEST_SAVE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "gds-inspector-out-")) },
    });
  } catch (e) {
    console.error("Tests failed", e);
    process.exit(1);
  }
}

main();
