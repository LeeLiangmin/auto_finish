import { existsSync, mkdirSync } from "fs";
import { join } from "path";

// 检查是否有图片处理库
let sharp: any = null;
try {
  sharp = require("sharp");
} catch (e) {
  // sharp 未安装，尝试使用其他方法
}

const iconsDir = "icons";
const distDir = "dist";

async function processIcons() {
  console.log("🖼️  处理图标文件...\n");

  // 检查 icons 目录
  if (!existsSync(iconsDir)) {
    console.log("  ⚠ icons 目录不存在");
    return false;
  }

  // 确保 dist 目录存在
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  // 图标配置
  const iconSizes = [16, 48, 128];
  let successCount = 0;

  // 检查是否有统一的 icon.jpeg 文件
  const unifiedIconPath = join(iconsDir, "icon.jpeg");
  const hasUnifiedIcon = existsSync(unifiedIconPath);

  // 如果有 sharp 库，使用它来处理
  if (sharp) {
    for (const size of iconSizes) {
      const outputPath = join(distDir, `icon${size}.png`);

      // 优先使用对应尺寸的文件，否则使用统一的 icon.jpeg
      const inputPath = existsSync(join(iconsDir, `icon${size}.jpeg`))
        ? join(iconsDir, `icon${size}.jpeg`)
        : hasUnifiedIcon
        ? unifiedIconPath
        : null;

      if (inputPath) {
        try {
          await sharp(inputPath)
            .resize(size, size, {
              fit: "contain",
              background: { r: 255, g: 255, b: 255, alpha: 0 }, // 透明背景
            })
            .png()
            .toFile(outputPath);
          const sourceName = inputPath.includes(`icon${size}.jpeg`)
            ? `icon${size}.jpeg`
            : "icon.jpeg";
          console.log(`  ✓ icon${size}.png (从 ${sourceName} ${hasUnifiedIcon && !inputPath.includes(`icon${size}`) ? "缩放" : "转换"})`);
          successCount++;
        } catch (error: any) {
          console.log(`  ✗ 转换 icon${size}.png 失败: ${error.message}`);
        }
      }
    }
  } else {
    // 如果没有 sharp，尝试直接复制并重命名（需要用户手动转换）
    console.log("  ⚠ 未安装 sharp 库，尝试直接复制...");
    console.log("  💡 提示：运行 'bun install' 安装 sharp 库以获得图片转换能力");

    for (const size of iconSizes) {
      const outputPath = join(distDir, `icon${size}.png`);
      const inputPath = existsSync(join(iconsDir, `icon${size}.jpeg`))
        ? join(iconsDir, `icon${size}.jpeg`)
        : hasUnifiedIcon
        ? unifiedIconPath
        : null;

      if (inputPath) {
        const fs = require("fs");
        fs.copyFileSync(inputPath, outputPath);
        const sourceName = inputPath.includes(`icon${size}.jpeg`)
          ? `icon${size}.jpeg`
          : "icon.jpeg";
        console.log(`  ⚠ icon${size}.png (已复制自 ${sourceName}，但仍是 JPEG 格式，建议安装 sharp 转换为 PNG)`);
        successCount++;
      }
    }
  }

  if (successCount === 0) {
    console.log("  ⚠ 未找到任何图标文件");
    return false;
  }

  return true;
}

// 如果直接运行此脚本
if (import.meta.main) {
  processIcons().then((success) => {
    if (success) {
      console.log("\n✅ 图标处理完成");
    } else {
      console.log("\n❌ 图标处理失败");
      process.exit(1);
    }
  });
}

export { processIcons };

