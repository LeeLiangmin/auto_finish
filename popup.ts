import { Progress, ActionStatus, Message } from "./types";

// DOM 元素引用
const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
const btnReload = document.getElementById("btnReload") as HTMLButtonElement;
const statusDiv = document.getElementById("status") as HTMLDivElement;
const progressInfo = document.getElementById("progressInfo") as HTMLDivElement;
const currentCourseSpan = document.getElementById("currentCourse") as HTMLSpanElement;
const progressTextSpan = document.getElementById("progressText") as HTMLSpanElement;
const progressBarFill = document.getElementById("progressBarFill") as HTMLDivElement;
const currentActionDiv = document.getElementById("currentAction") as HTMLDivElement;

let currentProgress: Progress | null = null;

// 更新UI状态
function updateUI(progress: Progress): void {
  currentProgress = progress;

  // 更新按钮状态
  const isRunning = progress.status === ActionStatus.RUNNING;
  btnStart.disabled = isRunning;
  btnStop.disabled = !isRunning;

  // 更新状态文本
  let statusText = "就绪";
  let statusClass = "";
  
  switch (progress.status) {
    case ActionStatus.RUNNING:
      statusText = "运行中...";
      statusClass = "running";
      break;
    case ActionStatus.COMPLETED:
      statusText = "已完成";
      statusClass = "completed";
      break;
    case ActionStatus.ERROR:
      statusText = "出错";
      statusClass = "error";
      break;
    case ActionStatus.PAUSED:
      statusText = "已暂停";
      statusClass = "";
      break;
  }

  statusDiv.textContent = statusText;
  statusDiv.className = `status ${statusClass}`;

  // 更新进度信息
  if (progress.totalCount > 0) {
    progressInfo.classList.remove("hidden");
    currentCourseSpan.textContent = progress.currentCourse || "-";
    progressTextSpan.textContent = `${progress.currentIndex} / ${progress.totalCount}`;
    
    const percentage = (progress.currentIndex / progress.totalCount) * 100;
    progressBarFill.style.width = `${percentage}%`;
  } else {
    progressInfo.classList.add("hidden");
  }

  // 更新当前操作
  if (progress.currentAction) {
    currentActionDiv.textContent = progress.currentAction.description;
    currentActionDiv.classList.remove("hidden");
  } else {
    currentActionDiv.classList.add("hidden");
  }
}

// 检查当前标签页是否支持 content script
async function checkTabSupport(): Promise<{ supported: boolean; reason?: string }> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) {
      return { supported: false, reason: "无法获取当前标签页" };
    }

    // 检查是否是特殊页面（chrome://, edge://, about: 等）
    const url = tab.url || "";
    if (url.startsWith("chrome://") || 
        url.startsWith("edge://") || 
        url.startsWith("about:") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("moz-extension://")) {
      return { supported: false, reason: "当前页面不支持插件（特殊页面）" };
    }

    // 尝试发送消息检查 content script 是否已加载
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "getProgress" });
      return { supported: true };
    } catch (error: any) {
      // 如果消息发送失败，可能是 content script 未加载
      if (error.message?.includes("Could not establish connection") || 
          error.message?.includes("Receiving end does not exist")) {
        return { supported: false, reason: "Content script 未加载，请刷新页面" };
      }
      throw error;
    }
  } catch (error: any) {
    return { supported: false, reason: error.message || "未知错误" };
  }
}

// 发送消息到 content script
async function sendMessageToContentScript(message: Message): Promise<any> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) {
      throw new Error("无法获取当前标签页");
    }

    // 检查标签页是否支持
    const support = await checkTabSupport();
    if (!support.supported) {
      throw new Error(support.reason || "当前页面不支持");
    }

    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error: any) {
    console.error("发送消息失败:", error);
    throw error;
  }
}

// 开始自动完成
async function startAutoFinish(): Promise<void> {
  try {
    // 先检查页面支持
    const support = await checkTabSupport();
    if (!support.supported) {
      statusDiv.textContent = support.reason || "当前页面不支持，请刷新页面";
      statusDiv.className = "status error";
      return;
    }

    await sendMessageToContentScript({ type: "start" });
    // 立即获取进度更新
    await refreshProgress();
  } catch (error: any) {
    console.error("启动失败:", error);
    const errorMessage = error.message || "未知错误";
    
    if (errorMessage.includes("刷新") || errorMessage.includes("未加载")) {
      statusDiv.textContent = errorMessage;
    } else {
      statusDiv.textContent = `启动失败: ${errorMessage}。请刷新页面后重试`;
    }
    statusDiv.className = "status error";
  }
}

// 停止自动完成
async function stopAutoFinish(): Promise<void> {
  try {
    await sendMessageToContentScript({ type: "stop" });
    await refreshProgress();
  } catch (error) {
    console.error("停止失败:", error);
  }
}

// 刷新进度
async function refreshProgress(): Promise<void> {
  try {
    const response = await sendMessageToContentScript({ type: "getProgress" });
    if (response && response.progress) {
      updateUI(response.progress);
    }
  } catch (error: any) {
    // 如果 content script 未加载，显示默认状态
    console.log("无法获取进度:", error.message || error);
    
    // 检查是否是特殊页面
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || "";
    
    if (url.startsWith("chrome://") || url.startsWith("edge://") || url.startsWith("about:")) {
      statusDiv.textContent = "当前页面不支持插件（特殊页面）";
      statusDiv.className = "status error";
    } else {
      statusDiv.textContent = "请刷新页面以加载插件";
      statusDiv.className = "status error";
    }
    
    updateUI({
      currentIndex: 0,
      totalCount: 0,
      currentCourse: "",
      status: ActionStatus.IDLE
    });
  }
}

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message: any) => {
  if (message.type === "progressUpdate" && message.data) {
    updateUI(message.data);
  }
});

// 事件监听
btnStart.addEventListener("click", () => {
  startAutoFinish();
});

btnStop.addEventListener("click", () => {
  stopAutoFinish();
});

// 刷新页面按钮
btnReload.addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      await chrome.tabs.reload(tab.id);
      statusDiv.textContent = "正在刷新页面...";
      statusDiv.className = "status";
      // 关闭 popup
      window.close();
    }
  } catch (error: any) {
    console.error("刷新页面失败:", error);
    statusDiv.textContent = "刷新页面失败";
    statusDiv.className = "status error";
  }
});

// 初始化：获取当前进度
refreshProgress();

// 定期刷新进度（当运行中时）
setInterval(() => {
  if (currentProgress && currentProgress.status === ActionStatus.RUNNING) {
    refreshProgress();
  }
}, 1000);

