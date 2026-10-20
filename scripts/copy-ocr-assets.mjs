// Copies the on-device screenshot reader (Tesseract.js) into public/ so it is served
// from the app's own domain: no third-party CDN, no cost, and allowed by the CSP.
// Runs automatically after `npm install` (locally and on Vercel).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const out = join(process.cwd(), "public", "tesseract");
mkdirSync(join(out, "core"), { recursive: true });
mkdirSync(join(out, "lang"), { recursive: true });

const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

cpSync(join(pkgDir("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js"));

const core = pkgDir("tesseract.js-core");
for (const f of [
  "tesseract-core.wasm.js",
  "tesseract-core-simd.wasm.js",
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-relaxedsimd.wasm.js",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
]) {
  const src = join(core, f);
  if (existsSync(src)) cpSync(src, join(out, "core", f));
}

cpSync(join(pkgDir("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), join(out, "lang", "eng.traineddata.gz"));
console.log("Screenshot reader files copied to public/tesseract");
