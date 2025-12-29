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

// 复制图标文件（如果存在）
const iconFiles = ["icon16.png", "icon48.png", "icon128.png"];
let iconCount = 0;
for (const icon of iconFiles) {
  if (existsSync(icon)) {
    copyFileSync(icon, join(distDir, icon));
    console.log(`  ✓ ${icon}`);
    iconCount++;
  }
}

if (iconCount === 0) {
  console.log("  ⚠ 未找到图标文件，请参考 ICONS.md 创建图标");
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

