import { Progress, ActionStatus, Message, CourseItem } from "./types";

// DOM 元素引用
const btnStart = document.getElementById("btnStart") as HTMLButtonElement;
const btnStop = document.getElementById("btnStop") as HTMLButtonElement;
const btnReload = document.getElementById("btnReload") as HTMLButtonElement;
const btnInject = document.getElementById("btnInject") as HTMLButtonElement;
const btnDebug = document.getElementById("btnDebug") as HTMLButtonElement;
const courseListContainer = document.getElementById("courseListContainer") as HTMLDivElement;
const courseList = document.getElementById("courseList") as HTMLDivElement;
const btnSelectAll = document.getElementById("btnSelectAll") as HTMLButtonElement;
const btnSelectNone = document.getElementById("btnSelectNone") as HTMLButtonElement;
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

  // 更新课程列表
  if (progress.courses && progress.courses.length > 0) {
    renderCourseList(progress.courses);
  }

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

// 渲染课程列表
function renderCourseList(courses: CourseItem[] | undefined): void {
  if (!courses || courses.length === 0) {
    if (courseListContainer) {
      courseListContainer.classList.add("hidden");
    }
    return;
  }

  if (!courseListContainer || !courseList) return;

  courseListContainer.classList.remove("hidden");
  courseList.innerHTML = "";

  courses.forEach((course) => {
    const courseItem = document.createElement("div");
    courseItem.style.cssText = "display: flex; align-items: center; padding: 6px; margin-bottom: 4px; border-radius: 3px; background: #f9f9f9;";
    
    // 状态颜色
    let statusColor = "#666";
    let statusText = "待处理";
    if (course.status === "processing") {
      statusColor = "#2196F3";
      statusText = "处理中";
      courseItem.style.background = "#e3f2fd";
    } else if (course.status === "completed") {
      statusColor = "#4CAF50";
      statusText = "已完成";
      courseItem.style.background = "#e8f5e9";
    } else if (course.status === "error") {
      statusColor = "#f44336";
      statusText = "失败";
      courseItem.style.background = "#ffebee";
    } else if (course.status === "skipped") {
      statusColor = "#999";
      statusText = "已跳过";
    }

    // 已完成的课程默认不选中
    const shouldCheck = course.status === "pending" || course.status === "error";
    
    courseItem.innerHTML = `
      <input type="checkbox" id="course-${course.id}" ${course.status === "completed" ? "disabled" : ""} 
             style="margin-right: 8px; cursor: pointer;" ${shouldCheck ? "checked" : ""}>
      <label for="course-${course.id}" style="flex: 1; cursor: pointer; font-size: 12px; margin-right: 8px;">
        <span style="display: block; font-weight: 500;">${course.name}</span>
        <span style="font-size: 11px; color: ${statusColor};">${statusText}${course.error ? `: ${course.error}` : ""}</span>
      </label>
      ${course.status === "error" ? `<button class="btn-retry" data-course-id="${course.id}" style="padding: 4px 8px; font-size: 11px; background: #FF9800; color: white; border: none; border-radius: 3px; cursor: pointer;">重试</button>` : ""}
    `;

    courseList.appendChild(courseItem);
  });

  // 绑定重试按钮事件
  courseList.querySelectorAll(".btn-retry").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const courseId = (e.target as HTMLElement).getAttribute("data-course-id");
      if (courseId) {
        await retryCourse(courseId);
      }
    });
  });
}

// 获取选中的课程ID
function getSelectedCourseIds(): string[] {
  if (!courseList) return [];
  const checkboxes = courseList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled):checked');
  return Array.from(checkboxes).map(cb => cb.id.replace("course-", ""));
}

// 重试单个课程
async function retryCourse(courseId: string): Promise<void> {
  try {
    await sendMessageToContentScript({ 
      type: "retryCourse",
      data: { courseId }
    });
    await refreshProgress();
  } catch (error: any) {
    console.error("重试失败:", error);
    statusDiv.textContent = `重试失败: ${error.message}`;
    statusDiv.className = "status error";
  }
}

// 检查当前标签页是否支持 content script
async function checkTabSupport(): Promise<{ supported: boolean; reason?: string; details?: string }> {
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

    // 检查 content script 是否已注入
    try {
      // 先尝试发送消息检查（最快的方式）
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: "getProgress" });
        if (response) {
          return { supported: true };
        }
      } catch (msgError: any) {
        // 消息发送失败，尝试执行脚本检查
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              // 检查是否有我们的全局变量
              return typeof window !== 'undefined' && 
                     (window as any).__AUTO_FINISH_LOADED === true;
            }
          });
          
          if (results && results[0]?.result === true) {
            // Content script 已加载但消息通道有问题
            return { 
              supported: false, 
              reason: "Content script 已加载但通信失败",
              details: "请刷新页面"
            };
          }
        } catch (scriptError: any) {
          // 执行脚本也失败，可能是权限问题
          console.error("执行脚本失败:", scriptError);
        }
      }
      
      // Content script 未加载
      return { 
        supported: false, 
        reason: "Content script 未加载",
        details: "请刷新页面或检查插件是否已正确安装"
      };
    } catch (error: any) {
      // 如果消息发送失败，可能是 content script 未加载
      const errorMsg = error.message || String(error);
      if (errorMsg.includes("Could not establish connection") || 
          errorMsg.includes("Receiving end does not exist") ||
          errorMsg.includes("Extension context invalidated")) {
        return { 
          supported: false, 
          reason: "Content script 未加载",
          details: "请刷新页面或重新加载插件扩展"
        };
      }
      return { 
        supported: false, 
        reason: "检查失败",
        details: errorMsg
      };
    }
  } catch (error: any) {
    return { 
      supported: false, 
      reason: error.message || "未知错误",
      details: String(error)
    };
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

// 重试单个课程
async function retryCourse(courseId: string): Promise<void> {
  try {
    await sendMessageToContentScript({ 
      type: "retryCourse",
      data: { courseId }
    });
    await refreshProgress();
  } catch (error: any) {
    console.error("重试失败:", error);
    statusDiv.textContent = `重试失败: ${error.message}`;
    statusDiv.className = "status error";
  }
}

// 开始自动完成
async function startAutoFinish(): Promise<void> {
  try {
    // 先检查页面支持
    const support = await checkTabSupport();
    if (!support.supported) {
      // 如果 content script 未加载，尝试手动注入
      if (support.reason?.includes("未加载") || support.reason?.includes("Content script")) {
        statusDiv.textContent = "正在尝试注入脚本...";
        statusDiv.className = "status";
        
        const injected = await injectContentScript();
        if (injected) {
          // 等待一下让脚本加载
          await new Promise(resolve => setTimeout(resolve, 500));
          // 再次检查
          const retrySupport = await checkTabSupport();
          if (retrySupport.supported) {
            // 先获取课程列表
            await sendMessageToContentScript({ type: "selectCourses" });
            await refreshProgress();
            
            // 获取选中的课程ID
            const selectedIds = getSelectedCourseIds();
            await sendMessageToContentScript({ 
              type: "start",
              data: { selectedCourseIds: selectedIds }
            });
            await refreshProgress();
            return;
          }
        }
      }
      
      statusDiv.textContent = support.reason || support.details || "当前页面不支持，请刷新页面";
      statusDiv.className = "status error";
      return;
    }

    // 先获取课程列表（如果还没有）
    if (!currentProgress.courses || currentProgress.courses.length === 0) {
      await sendMessageToContentScript({ type: "selectCourses" });
      await refreshProgress();
    }

    // 获取选中的课程ID
    const selectedIds = getSelectedCourseIds();
    await sendMessageToContentScript({ 
      type: "start",
      data: { selectedCourseIds: selectedIds.length > 0 ? selectedIds : undefined }
    });
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

// 手动注入按钮
btnInject.addEventListener("click", async () => {
  statusDiv.textContent = "正在手动注入脚本...";
  statusDiv.className = "status";
  
  const injected = await injectContentScript();
  if (injected) {
    statusDiv.textContent = "注入成功！请稍候...";
    statusDiv.className = "status running";
    
    // 等待脚本加载
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 检查是否成功
    const support = await checkTabSupport();
    if (support.supported) {
      statusDiv.textContent = "注入成功！可以开始使用了";
      statusDiv.className = "status completed";
      await refreshProgress();
    } else {
      statusDiv.textContent = "注入失败，请刷新页面";
      statusDiv.className = "status error";
    }
  } else {
    statusDiv.textContent = "注入失败，请检查页面权限";
    statusDiv.className = "status error";
  }
});

// 调试按钮
btnDebug.addEventListener("click", async () => {
  try {
    statusDiv.textContent = "正在检测课程列表...";
    statusDiv.className = "status running";
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) {
      statusDiv.textContent = "无法获取当前标签页";
      statusDiv.className = "status error";
      return;
    }

    // 执行调试脚本
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // 获取课程列表
        const selectors = {
          containers: "aside, .sidebar, .course-list, .menu, nav, .course-nav, .chapter-list, .lesson-list",
          items: "li, .course-item, .lesson-item, .tree-node-content, .chapter-item"
        };
        
        const containers = document.querySelectorAll(selectors.containers);
        const allItems: any[] = [];
        
        containers.forEach((container, idx) => {
          const items = container.querySelectorAll(selectors.items);
          const visibleItems = Array.from(items).filter((el: any) => {
            const style = window.getComputedStyle(el);
            return style.display !== "none" && 
                   style.visibility !== "hidden" && 
                   el.offsetWidth > 0 && 
                   el.offsetHeight > 0;
          });
          
          if (visibleItems.length > 0) {
            allItems.push({
              container: {
                index: idx,
                className: container.className,
                id: container.id || "无",
                itemCount: visibleItems.length
              },
              items: Array.from(visibleItems).slice(0, 5).map((el: any) => ({
                text: el.textContent?.trim().substring(0, 50) || "无文本",
                className: el.className || "无类名"
              }))
            });
          }
        });
        
        return {
          containerCount: containers.length,
          foundContainers: allItems.length,
          details: allItems
        };
      }
    });
    
    if (results && results[0]?.result) {
      const debugInfo = results[0].result;
      let message = `找到 ${debugInfo.containerCount} 个容器，${debugInfo.foundContainers} 个包含课程项\n`;
      message += "请查看浏览器控制台（F12）获取详细信息";
      
      statusDiv.textContent = message;
      statusDiv.className = debugInfo.foundContainers > 0 ? "status completed" : "status error";
      
      // 同时在控制台输出
      console.log("调试信息:", debugInfo);
    } else {
      statusDiv.textContent = "调试失败，请检查 content script 是否已加载";
      statusDiv.className = "status error";
    }
  } catch (error: any) {
    console.error("调试失败:", error);
    statusDiv.textContent = `调试失败: ${error.message}`;
    statusDiv.className = "status error";
  }
});

// 手动注入 content script（备用方案）
async function injectContentScript(): Promise<boolean> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab.id) {
      return false;
    }

    // 检查是否是特殊页面
    const url = tab.url || "";
    if (url.startsWith("chrome://") || 
        url.startsWith("edge://") || 
        url.startsWith("about:") ||
        url.startsWith("chrome-extension://") ||
        url.startsWith("moz-extension://")) {
      return false;
    }

    // 尝试注入 content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      console.log("手动注入 content script 成功");
      return true;
    } catch (injectError: any) {
      console.error("注入失败:", injectError);
      return false;
    }
  } catch (error: any) {
    console.error("手动注入失败:", error);
    return false;
  }
}

// 全选/全不选按钮
btnSelectAll.addEventListener("click", () => {
  const checkboxes = courseList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)');
  checkboxes.forEach(cb => cb.checked = true);
});

btnSelectNone.addEventListener("click", () => {
  const checkboxes = courseList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:disabled)');
  checkboxes.forEach(cb => cb.checked = false);
});

// 初始化：获取当前进度
refreshProgress();

// 如果已经有课程列表，也获取一下
setTimeout(async () => {
  try {
    await sendMessageToContentScript({ type: "selectCourses" });
    await refreshProgress();
  } catch (e) {
    // 忽略错误
  }
}, 500);

// 定期刷新进度（当运行中时）
setInterval(() => {
  if (currentProgress && currentProgress.status === ActionStatus.RUNNING) {
    refreshProgress();
  }
}, 1000);

