import { Progress, ActionStatus, Message } from "./types";

// DOM 元素引用
const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
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

// 发送消息到 content script
async function sendMessageToContentScript(message: Message): Promise<any> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) {
      throw new Error("无法获取当前标签页");
    }
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    console.error("发送消息失败:", error);
    throw error;
  }
}

// 开始自动完成
async function startAutoFinish(): Promise<void> {
  try {
    await sendMessageToContentScript({ type: "start" });
    // 立即获取进度更新
    await refreshProgress();
  } catch (error) {
    console.error("启动失败:", error);
    statusDiv.textContent = "启动失败，请刷新页面后重试";
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
  } catch (error) {
    // 如果 content script 未加载，显示默认状态
    console.log("无法获取进度（content script可能未加载）");
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

// 初始化：获取当前进度
refreshProgress();

// 定期刷新进度（当运行中时）
setInterval(() => {
  if (currentProgress && currentProgress.status === ActionStatus.RUNNING) {
    refreshProgress();
  }
}, 1000);

