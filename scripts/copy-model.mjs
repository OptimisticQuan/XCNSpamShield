import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !value || !key.startsWith('--')) {
      throw new Error('Usage: node scripts/copy-model.mjs --source <dir> --target <dir>');
    }
    args.set(key.slice(2), value);
  }
  return {
    source: args.get('source'),
    target: args.get('target'),
  };
}

async function copyDirectory(source, target) {
  await fs.mkdir(target, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(source, entry.name);
      const targetPath = path.join(target, entry.name);

      if (entry.isDirectory()) {
        await copyDirectory(sourcePath, targetPath);
        return;
      }

      await fs.copyFile(sourcePath, targetPath);
    }),
  );
}

async function main() {
  const { source, target } = parseArgs(process.argv);
  if (!source || !target) {
    throw new Error('Both --source and --target are required.');
  }

  await fs.access(source);
  await copyDirectory(path.resolve(source), path.resolve(target));
  console.log(`Copied TF.js model from ${source} to ${target}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
