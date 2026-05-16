// @vitest-environment node

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const extensionRoot = path.resolve(import.meta.dirname, '..');
const projectRoot = path.resolve(extensionRoot, '..');
const extensionModelDir = path.join(extensionRoot, 'public', 'tfjs_model');
const mlVocabPath = path.join(projectRoot, 'ml', 'data', 'vocab.txt');

describe('copied tfjs model artifacts', () => {
  it('includes a copied vocab.txt that matches the ML training output', async () => {
    const [extensionVocab, mlVocab] = await Promise.all([
      readFile(path.join(extensionModelDir, 'vocab.txt'), 'utf-8'),
      readFile(mlVocabPath, 'utf-8'),
    ]);

    expect(extensionVocab).toBe(mlVocab);
    expect(extensionVocab.split(/\r?\n/u).filter(Boolean).length).toBeGreaterThan(10);
  });

  it('includes model.json and all referenced weight shards', async () => {
    const modelJson = JSON.parse(await readFile(path.join(extensionModelDir, 'model.json'), 'utf-8')) as {
      weightsManifest?: Array<{ paths?: string[] }>;
    };

    expect(modelJson.weightsManifest?.length ?? 0).toBeGreaterThan(0);

    const referencedPaths = modelJson.weightsManifest?.flatMap((entry) => entry.paths ?? []) ?? [];
    expect(referencedPaths.length).toBeGreaterThan(0);

    await Promise.all(referencedPaths.map((relativePath) => readFile(path.join(extensionModelDir, relativePath))));
  });
});