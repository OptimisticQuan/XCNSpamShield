import * as tf from '@tensorflow/tfjs';

let modelPromise: Promise<tf.GraphModel | null> | undefined;

async function resolveModel(): Promise<tf.GraphModel | null> {
  try {
    const url = chrome.runtime.getURL('tfjs_model/model.json');
    return await tf.loadGraphModel(url);
  } catch {
    return null;
  }
}

export function getModel(): Promise<tf.GraphModel | null> {
  if (!modelPromise) {
    modelPromise = resolveModel();
  }
  return modelPromise;
}

export async function predictSpamScore(tokenIds: number[]): Promise<number | null> {
  const model = await getModel();
  if (!model) {
    return null;
  }

  const input = tf.tensor2d([tokenIds], [1, tokenIds.length], 'int32');
  try {
    const raw = model.predict(input);
    const tensor = Array.isArray(raw)
      ? raw[0]
      : isTensor(raw)
        ? raw
        : Object.values(raw)[0];
    const values = await tensor.data();
    return values[0] ?? null;
  } finally {
    input.dispose();
  }
}

function isTensor(value: tf.Tensor | tf.Tensor[] | tf.NamedTensorMap): value is tf.Tensor {
  return typeof (value as tf.Tensor).data === 'function';
}
