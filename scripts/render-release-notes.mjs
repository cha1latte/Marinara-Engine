import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(args) {
  const [version, ...rest] = args;
  if (!version) {
    throw new Error("Usage: node scripts/render-release-notes.mjs <version> [--output <path>]");
  }

  const outputFlagIndex = rest.findIndex((arg) => arg === "--output");
  const outputPath = outputFlagIndex === -1 ? null : rest[outputFlagIndex + 1];
  if (outputFlagIndex !== -1 && !outputPath) {
    throw new Error("Missing value for --output");
  }

  return {
    version: version.replace(/^v/, ""),
    outputPath: outputPath ? resolve(REPO_ROOT, outputPath) : null,
  };
}

function extractReleaseEntry(changelog, version) {
  const heading = `## [${version}]`;
  const start = changelog.indexOf(heading);
  if (start === -1) {
    throw new Error(`CHANGELOG.md does not contain an entry for ${version}`);
  }

  const afterHeading = changelog.slice(start + heading.length);
  const nextSectionOffset = afterHeading.search(/\n## \[/);
  const body = (nextSectionOffset === -1 ? afterHeading : afterHeading.slice(0, nextSectionOffset)).trim();

  if (!body) {
    throw new Error(`CHANGELOG.md entry for ${version} is empty`);
  }

  return body + "\n";
}

try {
  const { version, outputPath } = parseArgs(process.argv.slice(2));
  const changelog = await readFile(resolve(REPO_ROOT, "CHANGELOG.md"), "utf8");
  const notes = extractReleaseEntry(changelog, version);

  if (outputPath) {
    await writeFile(outputPath, notes);
  } else {
    process.stdout.write(notes);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
