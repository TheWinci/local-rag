import {
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const EMBEDDING_DIM = 384;

let extractor: FeatureExtractionPipeline | null = null;

export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", MODEL_ID, {
      dtype: "fp32",
    });
  }
  return extractor;
}

export async function embed(text: string): Promise<Float32Array> {
  const model = await getEmbedder();
  const output = await model(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data as Float64Array);
}

export { EMBEDDING_DIM };
