import { existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { build } from "bun";

const distDir = "dist";

// 清理并创建 dist 目录
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

console.log("📦 开始构建插件...\n");

// 检查是否是开发模式
const isDev = process.argv.includes("--dev");
const minify = !isDev;

// 1. 构建 TypeScript 文件
console.log("🔨 构建 TypeScript 文件...");

// 构建 popup.ts
const popupResult = await build({
  entrypoints: ["popup.ts"],
  outdir: distDir,
  target: "browser",
  minify: minify,
});
console.log(`  ✓ popup.js ${minify ? "(已压缩)" : "(开发模式)"}`);

// 构建 content.ts
const contentResult = await build({
  entrypoints: ["content.ts"],
  outdir: distDir,
  target: "browser",
  minify: minify,
});
console.log(`  ✓ content.js ${minify ? "(已压缩)" : "(开发模式)"}`);

// 移除文件末尾的 export 语句（content script 不需要模块导出）
const contentJsPath = join(distDir, "content.js");
if (existsSync(contentJsPath)) {
  const fs = require("fs");
  let content = fs.readFileSync(contentJsPath, "utf-8");
  
  // 移除文件末尾的 export 语句（匹配 export { ... } 格式）
  content = content.replace(/export\s*\{[^}]*\}\s*;?\s*$/m, "");
  
  // 移除单独的 export 语句
  content = content.replace(/export\s+\{[^}]*\}\s*;?\s*$/m, "");
  
  // 确保文件以分号或换行结束
  if (!content.trim().endsWith(";") && !content.trim().endsWith("\n")) {
    content = content.trim() + "\n";
  }
  
  fs.writeFileSync(contentJsPath, content, "utf-8");
  console.log("  ✓ 已清理 export 语句");
}

// 2. 复制静态文件
console.log("\n📋 复制静态文件...");

// 复制 manifest.json
if (existsSync("manifest.json")) {
  copyFileSync("manifest.json", join(distDir, "manifest.json"));
  console.log("  ✓ manifest.json");
}

// 复制 popup.html
if (existsSync("popup.html")) {
  copyFileSync("popup.html", join(distDir, "popup.html"));
  console.log("  ✓ popup.html");
}

// 处理图标文件（从 icons 目录转换）
const { processIcons } = await import("./process-icons.ts");
const iconsProcessed = await processIcons();
if (!iconsProcessed) {
  console.log("  ⚠ 图标处理失败，请检查 icons 目录");
}

console.log("\n✅ 构建完成！所有文件已输出到 dist 目录");
console.log("\n📁 构建产物列表：");
const files = readdirSync(distDir);
files.forEach((file: string) => {
  const stats = statSync(join(distDir, file));
  const size = (stats.size / 1024).toFixed(2);
  console.log(`  - ${file} (${size} KB)`);
});

console.log("\n💡 提示：在浏览器中加载 dist 目录作为未打包的扩展程序");

