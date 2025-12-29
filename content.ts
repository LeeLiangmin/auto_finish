import { ContentType, ActionStatus, Progress, CurrentAction, Message, PageContent } from "./types";
import {
  defaultConfig,
  wait,
  waitForElement,
  waitForAnyElement,
  safeClick,
  findElementByText,
  findAllElementsByText,
  getVisibleCourseItems,
  sendMessageToPopup,
  isElementVisible
} from "./utils";

// 标记 content script 已加载
(window as any).__AUTO_FINISH_LOADED = true;
console.log("课程自动完成工具 - Content Script 已加载");

// 抑制来自网站本身的非关键警告（可选）
if (typeof console !== 'undefined') {
  const originalWarn = console.warn;
  console.warn = function(...args: any[]) {
    // 过滤掉非被动事件监听器的警告（这些通常来自网站本身）
    const message = args.join(' ');
    if (message.includes('non-passive event listener') || 
        message.includes('mousewheel') ||
        message.includes('touchstart') ||
        message.includes('touchmove')) {
      // 静默忽略这些警告，它们不影响插件功能
      return;
    }
    originalWarn.apply(console, args);
  };
}

// 全局状态
let isRunning = false;
let currentProgress: Progress = {
  currentIndex: 0,
  totalCount: 0,
  currentCourse: "",
  status: ActionStatus.IDLE
};

// 检测页面上的所有内容类型
export function detectAllContent(): PageContent {
  const content: PageContent = {
    videos: [],
    ppts: [],
    exams: []
  };

  // 检测所有视频
  const videos = document.querySelectorAll("video");
  content.videos = Array.from(videos) as HTMLVideoElement[];

  // 检测所有PPT - 查找包含"下一页"、"next"等文本的按钮
  const pptSelectors = [
    "button",
    ".next-btn",
    ".next-button",
    "[aria-label*='next']",
    "[aria-label*='下一页']"
  ];
  
  const foundPptContainers = new Set<Element>();
  for (const selector of pptSelectors) {
    const nextButtons = findAllElementsByText(selector, "下一页");
    const nextButtonsEn = findAllElementsByText(selector, "next");
    const nextButtonsZh = findAllElementsByText(selector, "下一张");
    
    const allNextButtons = [...nextButtons, ...nextButtonsEn, ...nextButtonsZh];
    for (const button of allNextButtons) {
      if (isElementVisible(button)) {
        // 找到PPT容器（按钮的父容器或最近的容器）
        let container = button.parentElement;
        while (container && container !== document.body) {
          // 检查是否是PPT容器（可能包含特定的class或id）
          if (container.classList.contains("ppt") || 
              container.classList.contains("slide") ||
              container.classList.contains("presentation") ||
              container.id.includes("ppt") ||
              container.id.includes("slide")) {
            foundPptContainers.add(container);
            break;
          }
          container = container.parentElement;
        }
        // 如果没找到特定容器，就使用按钮本身
        if (!container || container === document.body) {
          foundPptContainers.add(button);
        }
      }
    }
  }
  content.ppts = Array.from(foundPptContainers);

  // 检测所有考试 - 查找提交按钮
  // 方法1: 直接通过class查找
  const submitBtnByClass = document.querySelectorAll(".submit-btn");
  for (const button of submitBtnByClass) {
    if (isElementVisible(button)) {
      content.exams.push(button);
    }
  }

  // 方法2: 通过文本匹配查找
  const examSelectors = [
    "button",
    "[type='submit']"
  ];

  for (const selector of examSelectors) {
    const submitButtons = findAllElementsByText(selector, "提交");
    const submitButtonsEn = findAllElementsByText(selector, "submit");
    const submitButtonsZh = findAllElementsByText(selector, "交卷");
    
    const allSubmitButtons = [...submitButtons, ...submitButtonsEn, ...submitButtonsZh];
    for (const button of allSubmitButtons) {
      if (isElementVisible(button) && !content.exams.includes(button)) {
        content.exams.push(button);
      }
    }
  }

  return content;
}

// 处理单个视频
export async function handleSingleVideo(video: HTMLVideoElement, index: number, total: number): Promise<boolean> {
  if (!video) {
    console.log("视频元素无效");
    return false;
  }

  updateCurrentAction({
    type: ContentType.VIDEO,
    description: `正在处理视频 ${index + 1}/${total}...`
  });

  try {
    // 滚动到视频可见
    video.scrollIntoView({ behavior: "smooth", block: "center" });
    await wait(300);

    // 等待视频加载
    if (video.readyState < 2) {
      await new Promise<void>((resolve) => {
        const onLoadedData = () => {
          video.removeEventListener("loadeddata", onLoadedData);
          resolve();
        };
        video.addEventListener("loadeddata", onLoadedData);
        setTimeout(resolve, 5000); // 超时保护
      });
    }

    // 如果视频未播放，先播放
    if (video.paused) {
      await video.play();
      await wait(500);
    }

    // 快进到接近结束（留1秒避免直接跳到结束导致未完成）
    if (video.duration && !isNaN(video.duration)) {
      const targetTime = Math.max(0, video.duration - 1);
      video.currentTime = targetTime;
      await wait(1000);

      // 等待视频播放到结束或接近结束
      await new Promise<void>((resolve) => {
        const checkComplete = () => {
          if (video.currentTime >= video.duration - 0.5 || video.ended) {
            video.removeEventListener("timeupdate", checkComplete);
            resolve();
          }
        };
        video.addEventListener("timeupdate", checkComplete);
        setTimeout(resolve, 10000); // 超时保护
      });
    } else {
      // 如果无法获取时长，等待一段时间
      await wait(3000);
    }

    console.log(`视频 ${index + 1}/${total} 处理完成`);
    return true;
  } catch (error) {
    console.error(`处理视频 ${index + 1} 时出错:`, error);
    return false;
  }
}

// 处理所有视频
export async function handleAllVideos(videos: HTMLVideoElement[]): Promise<boolean> {
  if (videos.length === 0) {
    return true;
  }

  console.log(`找到 ${videos.length} 个视频，开始处理...`);

  for (let i = 0; i < videos.length; i++) {
    if (!isRunning) {
      return false;
    }

    const video = videos[i];
    await handleSingleVideo(video, i, videos.length);
    await wait(defaultConfig.waitBetweenActions);
  }

  console.log("所有视频处理完成");
  return true;
}

// 处理单个PPT容器
export async function handleSinglePPT(pptContainer: Element, index: number, total: number): Promise<boolean> {
  updateCurrentAction({
    type: ContentType.PPT,
    description: `正在翻页PPT ${index + 1}/${total}...`
  });

  // 滚动到PPT容器可见
  pptContainer.scrollIntoView({ behavior: "smooth", block: "center" });
  await wait(300);

  let pageCount = 0;
  const maxPages = 100; // 防止无限循环

  while (pageCount < maxPages) {
    if (!isRunning) {
      return false;
    }

    // 在PPT容器内查找"下一页"按钮
    const nextButtonSelectors = [
      "button",
      ".next-btn",
      ".next-button",
      "[aria-label*='next']",
      "[aria-label*='下一页']"
    ];

    let nextButton: Element | null = null;
    for (const selector of nextButtonSelectors) {
      // 先在容器内查找
      const buttons = pptContainer.querySelectorAll(selector);
      for (const button of buttons) {
        const text = button.textContent?.toLowerCase() || "";
        if ((text.includes("下一页") || text.includes("next") || text.includes("下一张")) &&
            isElementVisible(button)) {
          nextButton = button;
          break;
        }
      }
      if (nextButton) break;
    }

    // 如果容器内没找到，在整个页面查找（可能是全局按钮）
    if (!nextButton) {
      for (const selector of nextButtonSelectors) {
        nextButton = findElementByText(selector, "下一页") ||
                     findElementByText(selector, "next") ||
                     findElementByText(selector, "下一张");
        if (nextButton && isElementVisible(nextButton)) {
          break;
        }
      }
    }

    if (!nextButton) {
      // 没有找到下一页按钮，可能已经到最后一页
      console.log(`PPT ${index + 1} 翻页完成（未找到下一页按钮）`);
      return true;
    }

    // 检查按钮是否禁用
    if (nextButton instanceof HTMLElement) {
      const isDisabled = nextButton.hasAttribute("disabled") ||
                        nextButton.classList.contains("disabled") ||
                        nextButton.getAttribute("aria-disabled") === "true";
      if (isDisabled) {
        console.log(`PPT ${index + 1} 翻页完成（按钮已禁用）`);
        return true;
      }
    }

    // 点击下一页
    const clicked = await safeClick(nextButton);
    if (!clicked) {
      console.log(`无法点击PPT ${index + 1} 的下一页按钮`);
      return false;
    }

    pageCount++;
    await wait(defaultConfig.waitBetweenActions);

    // 等待页面切换动画
    await wait(500);
  }

  console.log(`PPT ${index + 1} 处理完成（达到最大页数限制）`);
  return true;
}

// 处理所有PPT
export async function handleAllPPTs(pptContainers: Element[]): Promise<boolean> {
  if (pptContainers.length === 0) {
    return true;
  }

  console.log(`找到 ${pptContainers.length} 个PPT，开始处理...`);

  for (let i = 0; i < pptContainers.length; i++) {
    if (!isRunning) {
      return false;
    }

    const pptContainer = pptContainers[i];
    await handleSinglePPT(pptContainer, i, pptContainers.length);
    await wait(defaultConfig.waitBetweenActions);
  }

  console.log("所有PPT处理完成");
  return true;
}

// 检测"显示答案"按钮
export function findShowAnswerButton(): Element | null {
  const showAnswerSelectors = [
    "button",
    "a",
    ".show-answer",
    ".view-answer",
    "[aria-label*='显示答案']",
    "[aria-label*='查看答案']"
  ];

  for (const selector of showAnswerSelectors) {
    const button = findElementByText(selector, "显示答案") ||
                   findElementByText(selector, "查看答案") ||
                   findElementByText(selector, "显示正确答案") ||
                   findElementByText(selector, "show answer") ||
                   findElementByText(selector, "view answer");
    if (button && isElementVisible(button)) {
      return button;
    }
  }

  return null;
}

// 检测答案（通过多种方式：高亮、标记、文本等）
export function detectAnswers(): Map<string, string[]> {
  const answers = new Map<string, string[]>();

  // 方法1: 查找带有特定class或data属性的选项（最可靠）
  const correctOptions = document.querySelectorAll(
    "input[data-correct='true'], input.correct, .option.correct, .choice.correct, " +
    "[class*='correct'], [class*='right'], [data-answer='true'], [data-correct='1']"
  );

  for (const option of correctOptions) {
    const questionContainer = option.closest(".question, .quiz-item, .exam-item, [class*='question'], [class*='quiz']") || 
                              option.parentElement?.parentElement || document.body;
    
    const questionText = questionContainer.querySelector(".question-text, .question-title, h3, h4, h5")?.textContent?.trim() || 
                        questionContainer.textContent?.substring(0, 100).replace(/\s+/g, " ") || "未知问题";
    
    // 获取答案文本
    let answerText = "";
    if (option instanceof HTMLInputElement) {
      // 对于input，查找对应的label
      const label = option.closest("label") || 
                   (option.id ? document.querySelector(`label[for="${option.id}"]`) : null) ||
                   option.parentElement?.querySelector("label");
      answerText = label?.textContent?.trim() || option.value || option.getAttribute("value") || "";
    } else {
      answerText = option.textContent?.trim() || option.getAttribute("value") || "";
    }
    
    if (answerText && answerText.length > 0) {
      const key = questionText.substring(0, 50);
      if (!answers.has(key)) {
        answers.set(key, []);
      }
      const answerList = answers.get(key)!;
      if (!answerList.includes(answerText)) {
        answerList.push(answerText);
      }
    }
  }

  // 方法2: 查找高亮的选项（通常正确答案会被高亮显示）
  const highlightedSelectors = [
    ".correct", ".answer", ".right-answer", ".right", ".success",
    "[class*='correct']", "[class*='answer']", "[class*='right']",
    "[style*='background-color:']", "[style*='background:']",
    "[style*='color: green']", "[style*='color:red']"
  ];

  for (const selector of highlightedSelectors) {
    try {
      const highlightedOptions = document.querySelectorAll(selector);
      for (const option of highlightedOptions) {
        // 跳过已经处理过的input元素
        if (option instanceof HTMLInputElement && correctOptions.contains(option)) {
          continue;
        }

        const questionContainer = option.closest(".question, .quiz-item, .exam-item, [class*='question']") || 
                                option.parentElement?.parentElement || document.body;
        
        const questionText = questionContainer.querySelector(".question-text, .question-title, h3, h4")?.textContent?.trim() || 
                            questionContainer.textContent?.substring(0, 100).replace(/\s+/g, " ") || "未知问题";
        
        let answerText = option.textContent?.trim() || "";
        // 如果是label，获取文本但排除"正确答案"等标签文本
        if (option instanceof HTMLLabelElement) {
          const input = option.querySelector("input");
          if (input) {
            answerText = option.textContent?.replace(input.value || "", "").trim() || "";
          }
        }
        
        if (answerText && answerText.length > 0 && 
            !answerText.includes("正确答案") && 
            !answerText.includes("correct answer") &&
            !answerText.includes("答案：")) {
          const key = questionText.substring(0, 50);
          if (!answers.has(key)) {
            answers.set(key, []);
          }
          const answerList = answers.get(key)!;
          if (!answerList.includes(answerText)) {
            answerList.push(answerText);
          }
        }
      }
    } catch (e) {
      // 忽略选择器错误
    }
  }

  // 方法3: 查找标记为"正确答案"的文本标签
  const answerLabels = findAllElementsByText("span, div, p, label", "正确答案");
  const answerLabelsEn = findAllElementsByText("span, div, p, label", "correct answer");
  const answerLabelsZh2 = findAllElementsByText("span, div, p, label", "答案：");
  
  for (const label of [...answerLabels, ...answerLabelsEn, ...answerLabelsZh2]) {
    const questionContainer = label.closest(".question, .quiz-item, .exam-item, [class*='question']") || 
                            label.parentElement || document.body;
    
    const questionText = questionContainer.querySelector(".question-text, .question-title, h3, h4")?.textContent?.trim() || 
                        questionContainer.textContent?.substring(0, 100).replace(/\s+/g, " ") || "未知问题";
    
    // 查找答案文本（可能在下一个元素或同一元素中）
    let answerText = "";
    const nextSibling = label.nextElementSibling;
    if (nextSibling) {
      answerText = nextSibling.textContent?.trim() || "";
    }
    
    // 如果没找到，尝试从label文本中提取（如"答案：A"）
    if (!answerText || answerText.length < 2) {
      const labelText = label.textContent?.trim() || "";
      const match = labelText.match(/[答案|answer][：:]\s*(.+)/i);
      if (match && match[1]) {
        answerText = match[1].trim();
      }
    }
    
    // 如果还是没找到，查找附近的选项
    if (!answerText || answerText.length < 2) {
      const nearbyOptions = questionContainer.querySelectorAll(".option, .choice, label, [class*='option']");
      for (const opt of nearbyOptions) {
        const optText = opt.textContent?.trim() || "";
        if (optText && optText.length > 1 && !optText.includes("正确答案")) {
          answerText = optText;
          break;
        }
      }
    }
    
    if (answerText && answerText.length > 1) {
      const key = questionText.substring(0, 50);
      if (!answers.has(key)) {
        answers.set(key, []);
      }
      const answerList = answers.get(key)!;
      if (!answerList.includes(answerText)) {
        answerList.push(answerText);
      }
    }
  }

  return answers;
}

// 根据答案重新选择选项
export async function selectAnswersByDetectedAnswers(answers: Map<string, string[]>): Promise<boolean> {
  let successCount = 0;

  // 查找所有问题
  const questions = document.querySelectorAll(".question, .quiz-item, .exam-item, [class*='question']");
  
  for (const question of questions) {
    if (!isRunning) {
      return false;
    }

    const questionText = question.querySelector(".question-text, .question-title, h3, h4")?.textContent?.trim() || 
                        question.textContent?.substring(0, 50) || "";
    
    // 查找匹配的答案
    let matchedAnswers: string[] = [];
    for (const [key, value] of answers.entries()) {
      if (questionText.includes(key.substring(0, 20)) || key.includes(questionText.substring(0, 20))) {
        matchedAnswers = value;
        break;
      }
    }

    if (matchedAnswers.length === 0) {
      continue;
    }

    // 取消所有已选选项
    const allInputs = question.querySelectorAll("input[type='radio'], input[type='checkbox']");
    for (const input of allInputs) {
      if (input instanceof HTMLInputElement && input.checked) {
        input.checked = false;
        // 触发change事件
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // 根据答案选择选项
    for (const answerText of matchedAnswers) {
      // 方法1: 通过文本匹配label
      const labels = question.querySelectorAll("label");
      for (const label of labels) {
        const labelText = label.textContent?.trim() || "";
        if (labelText.includes(answerText) || answerText.includes(labelText)) {
          const input = label.querySelector("input[type='radio'], input[type='checkbox']") ||
                       (label.getAttribute("for") ? document.getElementById(label.getAttribute("for")!) : null);
          if (input instanceof HTMLInputElement) {
            input.checked = true;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("click", { bubbles: true }));
            successCount++;
            break;
          }
        }
      }

      // 方法2: 通过选项文本匹配
      const options = question.querySelectorAll(".option, .choice, [class*='option'], [class*='choice']");
      for (const option of options) {
        const optionText = option.textContent?.trim() || "";
        if (optionText.includes(answerText) || answerText.includes(optionText)) {
          const input = option.querySelector("input[type='radio'], input[type='checkbox']");
          if (input instanceof HTMLInputElement) {
            input.checked = true;
            input.dispatchEvent(new Event("change", { bubbles: true }));
            input.dispatchEvent(new Event("click", { bubbles: true }));
            successCount++;
            break;
          }
        }
      }

      // 方法3: 处理文本输入（填空题）
      const textInputs = question.querySelectorAll("input[type='text'], textarea");
      for (const input of textInputs) {
        if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
          input.value = answerText;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          successCount++;
          break;
        }
      }
    }
  }

  console.log(`根据答案重新选择了 ${successCount} 个选项`);
  return successCount > 0;
}

// 处理单个考试（完整流程：提交 -> 显示答案 -> 重新选择 -> 再次提交）
export async function handleSingleExam(submitButton: Element, index: number, total: number): Promise<boolean> {
  if (!submitButton) {
    console.log("提交按钮无效");
    return false;
  }

  updateCurrentAction({
    type: ContentType.EXAM,
    description: `正在处理考试 ${index + 1}/${total}...`
  });

  // 滚动到按钮可见
  submitButton.scrollIntoView({ behavior: "smooth", block: "center" });
  await wait(300);

  // 第一步：点击提交按钮
  updateCurrentAction({
    type: ContentType.EXAM,
    description: `正在提交考试 ${index + 1}/${total}...`
  });

  const clicked = await safeClick(submitButton);
  if (!clicked) {
    console.log(`无法点击考试 ${index + 1} 的提交按钮`);
    return false;
  }

  // 等待可能的确认对话框
  await wait(1000);

  // 处理确认对话框（如果有）
  const confirmButton = findElementByText("button", "确认") ||
                       findElementByText("button", "确定") ||
                       findElementByText("button", "confirm");
  if (confirmButton && isElementVisible(confirmButton)) {
    await safeClick(confirmButton);
    await wait(500);
  }

  // 等待提交结果加载
  await wait(2000);

  // 第二步：检测是否有"显示答案"按钮
  const showAnswerButton = findShowAnswerButton();
  if (showAnswerButton) {
    console.log("检测到显示答案按钮，准备点击...");
    updateCurrentAction({
      type: ContentType.EXAM,
      description: `正在显示答案（考试 ${index + 1}/${total}）...`
    });

    const answerClicked = await safeClick(showAnswerButton);
    if (answerClicked) {
      // 等待答案显示
      await wait(2000);

      // 第三步：检测答案
      updateCurrentAction({
        type: ContentType.EXAM,
        description: `正在解析答案（考试 ${index + 1}/${total}）...`
      });

      const answers = detectAnswers();
      console.log(`检测到 ${answers.size} 个问题的答案`);

      if (answers.size > 0) {
        // 第四步：根据答案重新选择
        updateCurrentAction({
          type: ContentType.EXAM,
          description: `正在根据答案重新选择（考试 ${index + 1}/${total}）...`
        });

        await selectAnswersByDetectedAnswers(answers);
        await wait(1000);

        // 第五步：再次提交
        // 查找提交按钮（可能在原位置或新位置）
        const newSubmitButton = findElementByText("button", "提交") ||
                               findElementByText("button", "submit") ||
                               findElementByText("button", "交卷") ||
                               submitButton; // 如果还是原来的按钮

        if (newSubmitButton && isElementVisible(newSubmitButton)) {
          updateCurrentAction({
            type: ContentType.EXAM,
            description: `正在重新提交（考试 ${index + 1}/${total}）...`
          });

          await safeClick(newSubmitButton);
          await wait(1000);

          // 再次处理确认对话框
          const newConfirmButton = findElementByText("button", "确认") ||
                                  findElementByText("button", "确定");
          if (newConfirmButton && isElementVisible(newConfirmButton)) {
            await safeClick(newConfirmButton);
            await wait(500);
          }

          console.log(`考试 ${index + 1}/${total} 已重新提交`);
        } else {
          console.log("未找到重新提交按钮");
        }
      } else {
        console.log("未能检测到答案，跳过重新选择");
      }
    } else {
      console.log("无法点击显示答案按钮");
    }
  } else {
    console.log("未检测到显示答案按钮，直接完成提交");
  }

  console.log(`考试 ${index + 1}/${total} 处理完成`);
  return true;
}

// 检测"下一讲"按钮
export function findNextLessonButton(): Element | null {
  const nextLessonSelectors = [
    "button",
    "a",
    ".next-lesson",
    ".next-chapter",
    "[aria-label*='下一讲']",
    "[aria-label*='下一章']"
  ];

  for (const selector of nextLessonSelectors) {
    const button = findElementByText(selector, "下一讲") ||
                   findElementByText(selector, "下一章") ||
                   findElementByText(selector, "next lesson") ||
                   findElementByText(selector, "next chapter");
    if (button && isElementVisible(button)) {
      // 检查按钮是否禁用
      if (button instanceof HTMLElement) {
        const isDisabled = button.hasAttribute("disabled") ||
                          button.classList.contains("disabled") ||
                          button.getAttribute("aria-disabled") === "true";
        if (!isDisabled) {
          return button;
        }
      } else {
        return button;
      }
    }
  }

  return null;
}

// 点击"下一讲"按钮
export async function clickNextLesson(): Promise<boolean> {
  const nextLessonButton = findNextLessonButton();
  if (!nextLessonButton) {
    return false;
  }

  console.log("找到下一讲按钮，准备点击...");
  updateCurrentAction({
    type: ContentType.UNKNOWN,
    description: "正在跳转到下一讲..."
  });

  const clicked = await safeClick(nextLessonButton);
  if (clicked) {
    // 等待页面跳转或内容加载
    await wait(defaultConfig.waitForContentLoad);
    console.log("已点击下一讲按钮");
    return true;
  }

  return false;
}

// 处理当前页面的所有内容
export async function processCurrentContent(): Promise<boolean> {
  const pageContent = detectAllContent();
  
  console.log(`检测到页面内容: ${pageContent.videos.length} 个视频, ${pageContent.ppts.length} 个PPT, ${pageContent.exams.length} 个考试`);

  // 处理所有视频
  if (pageContent.videos.length > 0) {
    const videoResult = await handleAllVideos(pageContent.videos);
    if (!videoResult && isRunning) {
      return false;
    }
  }

  // 处理所有PPT
  if (pageContent.ppts.length > 0) {
    const pptResult = await handleAllPPTs(pageContent.ppts);
    if (!pptResult && isRunning) {
      return false;
    }
  }

  // 处理所有考试
  if (pageContent.exams.length > 0) {
    console.log(`找到 ${pageContent.exams.length} 个考试，开始处理...`);
    for (let i = 0; i < pageContent.exams.length; i++) {
      if (!isRunning) {
        return false;
      }
      const examResult = await handleSingleExam(pageContent.exams[i], i, pageContent.exams.length);
      if (!examResult && isRunning) {
        return false;
      }
      await wait(defaultConfig.waitBetweenActions);
    }
    console.log("所有考试处理完成");
  }

  // 如果没有任何内容，返回true继续
  if (pageContent.videos.length === 0 && 
      pageContent.ppts.length === 0 && 
      pageContent.exams.length === 0) {
    console.log("当前页面没有检测到视频、PPT或考试");
  }

  return true;
}

// 获取课程列表
export function getCourseList(): Element[] {
  return getVisibleCourseItems(defaultConfig);
}

// 点击课程项
export async function clickCourseItem(item: Element): Promise<boolean> {
  // 滚动到元素可见
  item.scrollIntoView({ behavior: "smooth", block: "center" });
  await wait(300);

  // 点击
  const clicked = await safeClick(item);
  if (!clicked) {
    return false;
  }

  // 等待内容加载
  await wait(defaultConfig.waitForContentLoad);
  return true;
}

// 更新当前操作
function updateCurrentAction(action: CurrentAction): void {
  currentProgress.currentAction = action;
  sendMessageToPopup({
    type: "progressUpdate",
    data: currentProgress
  });
}

// 更新进度
function updateProgress(index: number, total: number, courseName: string): void {
  currentProgress.currentIndex = index;
  currentProgress.totalCount = total;
  currentProgress.currentCourse = courseName;
  sendMessageToPopup({
    type: "progressUpdate",
    data: currentProgress
  });
}

// 主控制循环
export async function startAutoFinish(): Promise<void> {
  if (isRunning) {
    console.log("已经在运行中");
    return;
  }

  isRunning = true;
  currentProgress.status = ActionStatus.RUNNING;

  try {
    // 获取课程列表
    const courseItems = getCourseList();
    if (courseItems.length === 0) {
      console.log("未找到课程列表");
      currentProgress.status = ActionStatus.ERROR;
      sendMessageToPopup({
        type: "progressUpdate",
        data: currentProgress
      });
      isRunning = false;
      return;
    }

    console.log(`找到 ${courseItems.length} 个课程项`);

    // 遍历每个课程项
    for (let i = 0; i < courseItems.length; i++) {
      if (!isRunning) {
        console.log("已停止");
        break;
      }

      const item = courseItems[i];
      const courseName = item.textContent?.trim() || `课程 ${i + 1}`;

      updateProgress(i + 1, courseItems.length, courseName);
      console.log(`处理课程 ${i + 1}/${courseItems.length}: ${courseName}`);

      // 点击课程项
      const clicked = await clickCourseItem(item);
      if (!clicked) {
        console.log(`无法点击课程项 ${i + 1}`);
        continue;
      }

      // 等待内容加载
      await wait(defaultConfig.waitForContentLoad);

      // 循环处理当前页面的所有内容，直到没有"下一讲"按钮
      let hasNextLesson = true;
      let pageIteration = 0;
      const maxPageIterations = 50; // 防止无限循环

      while (hasNextLesson && pageIteration < maxPageIterations && isRunning) {
        pageIteration++;
        console.log(`处理页面内容 (第 ${pageIteration} 次迭代)...`);

        // 处理当前页面的所有内容
        const result = await processCurrentContent();
        if (!result) {
          console.log("处理内容时出错");
          break;
        }

        // 检查是否有"下一讲"按钮
        const nextLessonButton = findNextLessonButton();
        if (nextLessonButton) {
          console.log("检测到下一讲按钮，准备跳转...");
          const clicked = await clickNextLesson();
          if (clicked) {
            // 等待新内容加载
            await wait(defaultConfig.waitForContentLoad);
            // 继续循环处理新页面的内容
            continue;
          } else {
            hasNextLesson = false;
          }
        } else {
          hasNextLesson = false;
        }
      }

      if (pageIteration >= maxPageIterations) {
        console.log("达到最大页面迭代次数，停止处理");
      }

      // 等待一段时间再处理下一个课程项
      await wait(defaultConfig.waitAfterClick);
    }

    currentProgress.status = ActionStatus.COMPLETED;
    console.log("所有课程处理完成");
  } catch (error) {
    console.error("处理过程中出错:", error);
    currentProgress.status = ActionStatus.ERROR;
  } finally {
    isRunning = false;
    sendMessageToPopup({
      type: "progressUpdate",
      data: currentProgress
    });
  }
}

// 停止自动完成
export function stopAutoFinish(): void {
  isRunning = false;
  currentProgress.status = ActionStatus.PAUSED;
  sendMessageToPopup({
    type: "progressUpdate",
    data: currentProgress
  });
  console.log("已停止自动完成");
}

// 获取当前进度
export function getProgress(): Progress {
  return { ...currentProgress };
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  switch (message.type) {
    case "start":
      startAutoFinish();
      sendResponse({ success: true });
      break;
    case "stop":
      stopAutoFinish();
      sendResponse({ success: true });
      break;
    case "getProgress":
      sendResponse({ progress: getProgress() });
      break;
  }
  return true; // 保持消息通道开放
});

