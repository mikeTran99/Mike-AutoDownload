import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceRoot = path.join(projectRoot, "src");

async function javaScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await javaScriptFiles(filename));
    else if (entry.isFile() && entry.name.endsWith(".js")) files.push(filename);
  }
  return files.sort();
}

const files = await javaScriptFiles(sourceRoot);
let failures = 0;
for (const filename of files) {
  const relativeFile = path.relative(projectRoot, filename).replaceAll("\\", "/");
  const source = await readFile(filename, "utf8");
  const classic = path.relative(sourceRoot, filename).split(path.sep)[0] === "content";

  if (classic) {
    try {
      // Browser content scripts have no CommonJS wrapper, so top-level return is invalid.
      new Script(source, { filename: relativeFile });
    } catch (error) {
      console.error(`${relativeFile} (classic script)\n${error.stack || error}`);
      failures += 1;
    }
    continue;
  }

  // Explicit module input avoids Node's ambiguous .js syntax detection and reparsing.
  const checked = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: source,
    encoding: "utf8"
  });
  if (checked.error || checked.status !== 0) {
    console.error(`${relativeFile} (module)\n${checked.error || checked.stderr || checked.stdout || `Parser exited with status ${checked.status}`}`);
    failures += 1;
  }
}

if (failures) process.exitCode = 1;
else console.log(`Syntax checked ${files.length} JavaScript files.`);
