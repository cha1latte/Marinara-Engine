import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");
const SERVER_DIR = resolve(REPO_ROOT, "packages/server");
const MODELS_DIR = resolve(REPO_ROOT, "packages/server/data/models");
const RUNTIME_INFO_PATH = resolve(MODELS_DIR, "sidecar-runtime-info.json");
const PNPM_BIN = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const ALLOWED_GPU_MODES = new Set(["auto", "metal", "cuda", "vulkan"]);
const GPU_TOOLCHAIN_FAILURE_PATTERNS = [
  /Could NOT find Vulkan/i,
  /missing:\s*Vulkan_LIBRARY\s+Vulkan_INCLUDE_DIR/i,
  /Could NOT find CUDAToolkit/i,
  /CUDA_TOOLKIT_ROOT_DIR/i,
  /Failed to find nvcc/i,
  /No CUDA toolset found/i,
  /Cannot find CUDA/i,
];

function normalizeGpuMode(rawValue) {
  if (!rawValue) return "auto";

  const normalized = String(rawValue).trim().toLowerCase();
  if (["false", "off", "none", "cpu"].includes(normalized)) return false;
  if (!ALLOWED_GPU_MODES.has(normalized)) {
    throw new Error(
      `Invalid MARINARA_SIDECAR_GPU value \"${rawValue}\". Use one of: auto, metal, cuda, vulkan, false.`,
    );
  }
  return normalized;
}

function formatGpuMode(gpuMode) {
  return gpuMode === false ? "false" : gpuMode;
}

function isMissingGpuToolchain(output) {
  return GPU_TOOLCHAIN_FAILURE_PATTERNS.some((pattern) => pattern.test(output));
}

function writeRuntimeInfo(info) {
  mkdirSync(MODELS_DIR, { recursive: true });
  writeFileSync(
    RUNTIME_INFO_PATH,
    JSON.stringify({ ...info, updatedAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8",
  );
}

function runNodeLlamaBuild(gpuMode) {
  const args = [
    "exec",
    "node-llama-cpp",
    "source",
    "download",
    "--release",
    "latest",
    "--noUsageExample",
    "--gpu",
    formatGpuMode(gpuMode),
  ];

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(PNPM_BIN, args, {
      cwd: SERVER_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let combinedOutput = "";
    const forwardOutput = (stream, target) => {
      stream.on("data", (chunk) => {
        const text = String(chunk);
        combinedOutput += text;
        target.write(text);
      });
    };

    forwardOutput(child.stdout, process.stdout);
    forwardOutput(child.stderr, process.stderr);

    child.on("error", rejectPromise);
    child.on("close", (code, signal) => {
      resolvePromise({
        code: code ?? (signal ? 1 : 0),
        signal,
        output: combinedOutput,
      });
    });
  });
}

async function main() {
  const explicitGpuPreference = process.env.MARINARA_SIDECAR_GPU != null;
  const requestedGpuMode = normalizeGpuMode(process.env.MARINARA_SIDECAR_GPU);

  console.log(`[sidecar:build] Building node-llama-cpp runtime with gpu=${formatGpuMode(requestedGpuMode)}`);
  const primaryBuild = await runNodeLlamaBuild(requestedGpuMode);
  if (primaryBuild.code === 0) {
    writeRuntimeInfo(
      requestedGpuMode === false
        ? {
            state: "ready",
            backend: "cpu",
            reason: "manual_cpu",
            message: "Local Gemma runtime was built in CPU-only mode.",
          }
        : {
            state: "ready",
            backend: "gpu",
            reason: "unknown",
            message: "Local Gemma runtime built successfully.",
          },
    );
    return;
  }

  const missingGpuToolchain = isMissingGpuToolchain(primaryBuild.output);
  const canFallbackToCpu = !explicitGpuPreference && requestedGpuMode === "auto" && missingGpuToolchain;

  if (!canFallbackToCpu) {
    writeRuntimeInfo({
      state: "failed",
      backend: "unknown",
      reason: missingGpuToolchain ? "missing_gpu_toolchain" : "build_failed",
      message: missingGpuToolchain
        ? "Local Gemma could not build because the Vulkan or CUDA development toolkit is missing. Marinara will still work without it."
        : "Local Gemma could not be built on this machine. Marinara will still work without it.",
    });
    process.exit(primaryBuild.code || 1);
  }

  console.warn(
    "[sidecar:build] GPU runtime build failed because the local Vulkan/CUDA development toolchain was not found.",
  );
  console.warn(
    "[sidecar:build] This does not mean the GPU is unsupported. Retrying with a CPU-only sidecar runtime so Marinara can still start.",
  );

  const cpuFallbackBuild = await runNodeLlamaBuild(false);
  if (cpuFallbackBuild.code === 0) {
    writeRuntimeInfo({
      state: "fallback",
      backend: "cpu",
      reason: "missing_gpu_toolchain",
      message:
        "GPU acceleration could not be built because the local Vulkan or CUDA development toolkit is missing. Local Gemma fell back to CPU-only mode.",
    });
    console.log(
      "[sidecar:build] CPU-only sidecar runtime built successfully. Install the Vulkan SDK or CUDA Toolkit and rerun `pnpm sidecar:build` later if you want GPU acceleration.",
    );
    return;
  }

  writeRuntimeInfo({
    state: "failed",
    backend: "unknown",
    reason: "build_failed",
    message:
      "Local Gemma could not be built automatically on this machine, even after retrying CPU-only mode. Marinara will still work without it.",
  });
  process.exit(cpuFallbackBuild.code || 1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[sidecar:build] ${message}`);
  process.exit(1);
});
