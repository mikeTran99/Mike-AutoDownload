import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
export const extensionRoot = path.join(projectRoot, "src");

// Tên file logic (như cũ) → vị trí thật trong src/. Test không phải biết bố cục thư mục.
const FILE_LAYOUT = {
  "manifest.json": "src/manifest.json",
  "service-worker.js": "src/background/service-worker.js",
  "content-script.js": "src/content/content-script.js",
  "popup.html": "src/popup/popup.html",
  "popup.js": "src/popup/popup.js",
  "options.html": "src/options/options.html",
  "options.js": "src/options/options.js",
  "i18n.js": "src/shared/i18n.js",
  "analytics.js": "src/shared/analytics.js",
  "styles.css": "src/shared/styles.css"
};

export function fromRoot(...segments) {
  return path.join(projectRoot, ...segments);
}

export function resolveProjectFile(relativePath) {
  return fromRoot(FILE_LAYOUT[relativePath] || relativePath);
}

export async function readProjectFile(relativePath) {
  return readFile(resolveProjectFile(relativePath), "utf8");
}

export async function readManifest() {
  const raw = await readProjectFile("manifest.json");
  return JSON.parse(raw.replace(/^\uFEFF/, ""));
}

export async function assertLocalFileExists(reference, label = "file reference") {
  assert.equal(typeof reference, "string", `${label} must be a string`);
  assert.ok(reference.length > 0, `${label} must not be empty`);
  assert.ok(!path.isAbsolute(reference), `${label} must be relative: ${reference}`);
  assert.ok(!/^[a-z][a-z\d+.-]*:/i.test(reference), `${label} must be local: ${reference}`);

  const resolved = path.resolve(extensionRoot, reference);
  const relative = path.relative(extensionRoot, resolved);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative), `${label} escapes the project: ${reference}`);
  await access(resolved);
}

export function extractFunction(source, functionName) {
  const declaration = new RegExp(`(?:async\\s+)?function\\s+${functionName}\\s*\\(`);
  const match = declaration.exec(source);
  assert.ok(match, `Expected function ${functionName} to exist`);

  let parameterDepth = 1;
  let parameterEnd = -1;
  let parameterQuote = null;
  let parameterEscaped = false;
  for (let index = match.index + match[0].length; index < source.length; index += 1) {
    const character = source[index];
    if (parameterQuote) {
      if (parameterEscaped) {
        parameterEscaped = false;
      } else if (character === "\\") {
        parameterEscaped = true;
      } else if (character === parameterQuote) {
        parameterQuote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      parameterQuote = character;
      continue;
    }
    if (character === "(") parameterDepth += 1;
    if (character === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        parameterEnd = index;
        break;
      }
    }
  }

  assert.notEqual(parameterEnd, -1, `Expected function ${functionName} to close its parameter list`);
  const openingBrace = source.indexOf("{", parameterEnd + 1);
  assert.notEqual(openingBrace, -1, `Expected function ${functionName} to have a body`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
  }

  assert.fail(`Could not find the end of function ${functionName}`);
}

export function assertAppearsInOrder(source, tokens, label) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    assert.notEqual(index, -1, `${label}: missing ${JSON.stringify(token)}`);
    assert.ok(index > cursor, `${label}: ${JSON.stringify(token)} is out of order`);
    cursor = index;
  }
}
