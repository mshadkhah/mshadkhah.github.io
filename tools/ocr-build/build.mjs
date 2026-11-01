// Run pnpm install, then node build.mjs from this directory.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const out = resolve(import.meta.dirname, '../assets/paddle');
const sdk = resolve(import.meta.dirname, 'node_modules/@paddleocr/paddleocr-js/dist');
const ort = dirname(require.resolve('onnxruntime-web'));
await mkdir(out, { recursive: true });
await build({entryPoints: [resolve(sdk, 'index.mjs')], external:['fs','path'], bundle:true, format:'esm', platform:'browser', minify:true, outfile:resolve(out,'paddle.mjs')});
await mkdir(resolve(out,'assets'), {recursive:true});
await copyFile(resolve(sdk,'assets/worker-entry-C9UNuyOJ.js'), resolve(out,'assets/worker-entry-C9UNuyOJ.js'));
for (const name of ['ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','ort-wasm-simd-threaded.jsep.mjs','ort-wasm-simd-threaded.jsep.wasm']) await copyFile(resolve(ort,name),resolve(out,name));
for (const model of ['PP-OCRv5_mobile_det','PP-OCRv5_mobile_rec']) {
  const response = await fetch(`https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/${model}_onnx_infer.tar`);
  if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
  await writeFile(resolve(out,model+'.tar'),new Uint8Array(await response.arrayBuffer()));
}
console.log('PaddleOCR assets prepared:',out);
