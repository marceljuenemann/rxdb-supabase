import path from "node:path";
import url from "node:url";
import { build as esbuild, BuildOptions } from "esbuild";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));

const baseConfig: BuildOptions = {
  platform: "node",
  target: "node18",
  format: "esm",
  nodePaths: [path.join(__dirname, "../src")],
  sourcemap: true,
  external: [],
  bundle: true,
};

async function build() {
  await esbuild({
    ...baseConfig,
    outdir: path.join(__dirname, "../build"),
    entryPoints: [path.join(__dirname, "../src/index.ts")],
  });
}

if (import.meta.url.startsWith("file:")) {
  if (process.argv[1] === url.fileURLToPath(import.meta.url)) {
    await build();
  }
}
