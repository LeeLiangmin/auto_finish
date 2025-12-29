import { ContentType, ActionStatus, Progress, CurrentAction, Message, PageContent, CourseItem } from "./types";
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
let courseItemsList: CourseItem[] = [];
let currentProgress: Progress = {
  currentIndex: 0,
  totalCount: 0,
  currentCourse: "",
  status: ActionStatus.IDLE,
  courses: []
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

// 查找确认对话框按钮（包括"仍要交卷"等）
function findConfirmDialogButton(): Element | null {
  const confirmTexts = [
    "确认", "确定", "confirm", "ok",
    "仍要交卷", "继续提交", "确认提交", "确定提交",
    "仍要提交", "继续交卷", "确认交卷"
  ];
  
  for (const text of confirmTexts) {
    const button = findElementByText("button", text) ||
                   findElementByText("a", text) ||
                   findElementByText("div", text);
    if (button && isElementVisible(button)) {
      // 检查是否是确认按钮（通常确认按钮会有特定的样式或位置）
      // 排除取消按钮（通常包含"取消"、"取消提交"等）
      const buttonText = button.textContent?.trim() || "";
      if (!buttonText.includes("取消") && !buttonText.includes("cancel")) {
        return button;
      }
    }
  }
  
  return null;
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

  // 处理确认对话框（如果有，包括"仍要交卷"等）
  const confirmButton = findConfirmDialogButton();
  if (confirmButton && isElementVisible(confirmButton)) {
    console.log(`检测到确认对话框，点击确认按钮: ${confirmButton.textContent?.trim()}`);
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

          // 再次处理确认对话框（包括"仍要交卷"等）
          const newConfirmButton = findConfirmDialogButton();
          if (newConfirmButton && isElementVisible(newConfirmButton)) {
            console.log(`检测到确认对话框，点击确认按钮: ${newConfirmButton.textContent?.trim()}`);
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
// 调试：获取所有可能的课程列表容器
function debugCourseListContainers(): void {
  const selectors = defaultConfig.courseListSelector.split(",").map(s => s.trim());
  console.log("🔍 调试：查找课程列表容器...");
  
  for (const selector of selectors) {
    const containers = document.querySelectorAll(selector);
    console.log(`  选择器 "${selector}": 找到 ${containers.length} 个容器`);
    if (containers.length > 0) {
      for (let i = 0; i < Math.min(containers.length, 3); i++) {
        const container = containers[i];
        const itemCount = container.querySelectorAll(defaultConfig.courseItemSelector).length;
        console.log(`    容器 ${i + 1}: ${itemCount} 个可能的课程项, 类名: ${container.className}, ID: ${container.id || '无'}`);
      }
    }
  }
  
  // 尝试更通用的查找
  const allPossibleContainers = document.querySelectorAll("aside, nav, .sidebar, .menu, .list, [class*='course'], [class*='lesson'], [class*='chapter']");
  console.log(`  通用查找: 找到 ${allPossibleContainers.length} 个可能的容器`);
}

// 调试：获取所有可能的课程项
function debugCourseItems(): void {
  const itemSelectors = defaultConfig.courseItemSelector.split(",").map(s => s.trim());
  console.log("🔍 调试：查找课程项...");
  
  for (const selector of itemSelectors) {
    const items = document.querySelectorAll(selector);
    const visibleItems = Array.from(items).filter(item => isElementVisible(item));
    console.log(`  选择器 "${selector}": 找到 ${items.length} 个元素, ${visibleItems.length} 个可见`);
    if (visibleItems.length > 0 && visibleItems.length <= 10) {
      visibleItems.forEach((item, idx) => {
        const text = item.textContent?.trim().substring(0, 30) || "无文本";
        console.log(`    项 ${idx + 1}: "${text}"`);
      });
    }
  }
  
  // 尝试查找所有可能的课程项
  const allPossibleItems = document.querySelectorAll("li, .item, [class*='course'], [class*='lesson'], [class*='chapter'], a[href*='course'], a[href*='lesson']");
  const visiblePossibleItems = Array.from(allPossibleItems).filter(item => isElementVisible(item));
  console.log(`  通用查找: 找到 ${allPossibleItems.length} 个可能的项, ${visiblePossibleItems.length} 个可见`);
  
  if (visiblePossibleItems.length > 0 && visiblePossibleItems.length <= 10) {
    visiblePossibleItems.forEach((item, idx) => {
      const text = item.textContent?.trim().substring(0, 30) || "无文本";
      const className = item.className || "无类名";
      console.log(`    通用项 ${idx + 1}: "${text}" (类名: ${className})`);
    });
  }
}

export function getCourseList(): Element[] {
  const items = getVisibleCourseItems(defaultConfig);
  
  // 如果没找到，尝试查找包含 pie 类的元素（课程进度指示器）
  if (items.length === 0) {
    console.log("⚠️ 使用默认选择器未找到课程项，尝试查找包含 pie 类的元素...");
    
    // 查找所有包含 pie 类的元素（通常是课程进度指示器）
    const pieElements = document.querySelectorAll("[class*='pie'], .pie");
    const foundItems: Element[] = [];
    
    for (const el of pieElements) {
      // 查找包含 pie 的父元素或兄弟元素（课程项可能在附近）
      let courseItem: Element | null = null;
      
      // 检查元素本身是否是课程项
      if (el.textContent && el.textContent.trim().length > 0 && el.textContent.trim().length < 200) {
        courseItem = el;
      } else {
        // 检查父元素
        let parent = el.parentElement;
        while (parent && parent !== document.body) {
          const text = parent.textContent?.trim() || "";
          if (text.length > 0 && text.length < 200 && isElementVisible(parent)) {
            courseItem = parent;
            break;
          }
          parent = parent.parentElement;
        }
      }
      
      if (courseItem && isElementVisible(courseItem) && !foundItems.includes(courseItem)) {
        foundItems.push(courseItem);
      }
    }
    
    if (foundItems.length > 0) {
      console.log(`✅ 通过 pie 类找到 ${foundItems.length} 个可能的课程项`);
      return Array.from(new Set(foundItems));
    }
    
    // 如果还是没找到，进行调试
    debugCourseListContainers();
    debugCourseItems();
    
    // 尝试更通用的查找方法
    console.log("🔍 尝试通用查找方法...");
    
    // 方法1: 查找所有包含"课程"、"章节"、"课时"等关键词的元素
    const keywordSelectors = [
      "li",
      ".item",
      "[class*='course']",
      "[class*='lesson']",
      "[class*='chapter']",
      "[class*='section']",
      "a[href*='course']",
      "a[href*='lesson']",
      "a[href*='chapter']"
    ];
    
    for (const selector of keywordSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          if (isElementVisible(el) && !foundItems.includes(el)) {
            const text = el.textContent?.trim() || "";
            // 检查是否可能是课程项（有文本内容，不是空的）
            if (text.length > 0 && text.length < 200) {
              foundItems.push(el);
            }
          }
        }
      } catch (e) {
        // 忽略选择器错误
      }
    }
    
    if (foundItems.length > 0) {
      console.log(`✅ 通用方法找到 ${foundItems.length} 个可能的课程项`);
      // 限制数量，避免太多
      return Array.from(new Set(foundItems)).slice(0, 100);
    }
  }
  
  return items;
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

// 检查课程是否已完成（通过样式类判断）
function isCourseCompleted(element: Element): boolean {
  // 优先检查 anticon-check-circle 类（最可靠的完成标记）
  const hasCheckCircle = element.querySelector(".anticon-check-circle") !== null ||
                        element.classList.contains("anticon-check-circle") ||
                        element.querySelector("[class*='anticon-check-circle']") !== null;
  
  if (hasCheckCircle) {
    return true; // 已完成
  }
  
  // 检查是否有 pie pie-zero 类（未完成）
  // 如果元素有 pie 类且有 pie-zero 类，说明未完成
  const hasPieZero = element.classList.contains("pie") && element.classList.contains("pie-zero");
  
  if (hasPieZero) {
    return false; // 未完成
  }
  
  // 如果元素有 pie 类但没有 pie-zero，说明已完成
  if (element.classList.contains("pie") && !element.classList.contains("pie-zero")) {
    return true; // 已完成
  }
  
  // 检查子元素中是否有 anticon-check-circle
  const checkCircleElements = element.querySelectorAll(".anticon-check-circle, [class*='anticon-check-circle']");
  if (checkCircleElements.length > 0) {
    return true; // 已完成
  }
  
  // 检查子元素中是否有 pie pie-zero（可能样式在子元素上）
  const pieElements = element.querySelectorAll(".pie");
  for (const pieEl of pieElements) {
    if (pieEl.classList.contains("pie-zero")) {
      return false; // 找到未完成标记
    }
    // 如果有 pie 但没有 pie-zero，可能是已完成
    if (pieEl.classList.contains("pie") && !pieEl.classList.contains("pie-zero")) {
      return true; // 已完成
    }
  }
  
  // 检查其他完成标记
  const hasCompletedClass = element.classList.contains("completed") || 
                           element.classList.contains("done") ||
                           element.classList.contains("finished") ||
                           element.getAttribute("data-completed") === "true";
  
  return hasCompletedClass;
}

// 滚动课程列表以加载全部内容
async function scrollCourseListToLoadAll(): Promise<void> {
  console.log("📜 开始滚动课程列表以加载全部内容...");
  
  // 查找课程列表容器
  const selectors = defaultConfig.courseListSelector.split(",").map(s => s.trim());
  let container: Element | null = null;
  
  for (const selector of selectors) {
    const containers = document.querySelectorAll(selector);
    for (const c of containers) {
      if (isElementVisible(c) && c instanceof HTMLElement) {
        // 检查容器是否可滚动
        const style = window.getComputedStyle(c);
        const isScrollable = c.scrollHeight > c.clientHeight || 
                           style.overflow === "auto" || 
                           style.overflow === "scroll" ||
                           style.overflowY === "auto" ||
                           style.overflowY === "scroll";
        
        if (isScrollable) {
          container = c;
          console.log(`✅ 找到可滚动的课程列表容器: ${selector}`);
          break;
        }
      }
    }
    if (container) break;
  }
  
  // 如果没找到可滚动的容器，尝试查找所有可能的容器
  if (!container) {
    for (const selector of selectors) {
      const containers = document.querySelectorAll(selector);
      for (const c of containers) {
        if (isElementVisible(c) && c instanceof HTMLElement) {
          container = c;
          console.log(`✅ 找到课程列表容器: ${selector}`);
          break;
        }
      }
      if (container) break;
    }
  }
  
  if (!container || !(container instanceof HTMLElement)) {
    console.log("⚠️ 未找到课程列表容器，跳过滚动");
    return;
  }
  
  const scrollContainer = container as HTMLElement;
  let previousItemCount = 0;
  let currentItemCount = 0;
  let scrollAttempts = 0;
  const maxScrollAttempts = 50; // 防止无限滚动
  const scrollStep = 300; // 每次滚动的距离（像素）
  
  // 获取初始课程项数量
  const initialItems = scrollContainer.querySelectorAll(defaultConfig.courseItemSelector);
  previousItemCount = initialItems.length;
  console.log(`📊 初始课程项数量: ${previousItemCount}`);
  
  // 逐步滚动到底部
  while (scrollAttempts < maxScrollAttempts) {
    // 记录滚动前的位置
    const scrollTopBefore = scrollContainer.scrollTop;
    const scrollHeightBefore = scrollContainer.scrollHeight;
    
    // 滚动到底部
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    
    // 等待内容加载
    await wait(500);
    
    // 检查是否有新内容加载
    const currentItems = scrollContainer.querySelectorAll(defaultConfig.courseItemSelector);
    currentItemCount = currentItems.length;
    
    // 检查滚动位置是否改变
    const scrollTopAfter = scrollContainer.scrollTop;
    const scrollHeightAfter = scrollContainer.scrollHeight;
    
    // 如果滚动位置没有变化，且没有新内容，说明已经到底了
    if (scrollTopAfter === scrollTopBefore && 
        scrollHeightAfter === scrollHeightBefore && 
        currentItemCount === previousItemCount) {
      console.log(`✅ 已滚动到底部，课程项数量: ${currentItemCount}`);
      break;
    }
    
    // 如果有新内容加载，继续滚动
    if (currentItemCount > previousItemCount) {
      console.log(`📈 检测到新内容，课程项数量: ${previousItemCount} -> ${currentItemCount}`);
      previousItemCount = currentItemCount;
      scrollAttempts = 0; // 重置尝试次数
    } else {
      // 如果没有新内容，尝试小幅滚动
      scrollContainer.scrollTop += scrollStep;
      await wait(300);
      scrollAttempts++;
    }
    
    // 如果滚动高度没有变化，说明可能已经到底
    if (scrollHeightAfter === scrollHeightBefore) {
      scrollAttempts++;
    }
  }
  
  // 最后再等待一下，确保所有内容都加载完成
  await wait(1000);
  
  const finalItems = scrollContainer.querySelectorAll(defaultConfig.courseItemSelector);
  console.log(`✅ 滚动完成，最终课程项数量: ${finalItems.length}`);
  
  // 滚动回顶部（可选，保持原始位置）
  // scrollContainer.scrollTop = 0;
  // await wait(300);
}

// 初始化课程列表
async function initializeCourseList(): Promise<CourseItem[]> {
  // 先滚动列表加载全部内容
  await scrollCourseListToLoadAll();
  
  // 然后获取课程列表
  const courseElements = getCourseList();
  const courses: CourseItem[] = courseElements.map((element, index) => {
    const isCompleted = isCourseCompleted(element);
    return {
      id: `course-${index}`,
      name: element.textContent?.trim() || `课程 ${index + 1}`,
      element: element,
      status: isCompleted ? "completed" : "pending"
    };
  });
  
  courseItemsList = courses;
  currentProgress.courses = courses.map(c => ({
    id: c.id,
    name: c.name,
    element: null, // 不序列化 DOM 元素
    status: c.status
  }));
  
  return courses;
}

// 检测并添加子课程（支持多级嵌套）
// 如果之前识别到过（元素已在列表中），不处理，否则添加到列表中
// 如果父课程已完成（有 anticon-check-circle），不检测子课程
async function detectAndAddSubCourses(
  parentCourse: CourseItem, 
  depth: number = 0,
  maxDepth: number = 10
): Promise<CourseItem[]> {
  const indent = "  ".repeat(depth);
  console.log(`${indent}🔍 [层级 ${depth}] 检测 ${parentCourse.name} 的子课程...`);
  
  // 如果父课程已完成（有 anticon-check-circle），不检测子课程
  if (parentCourse.element && isCourseCompleted(parentCourse.element)) {
    console.log(`${indent}⏭️ 父课程已完成（有 anticon-check-circle），跳过子课程检测`);
    return [];
  }
  
  // 防止无限递归
  if (depth >= maxDepth) {
    console.log(`${indent}⚠️ 达到最大嵌套深度 ${maxDepth}，停止检测`);
    return [];
  }
  
  // 等待子课程展开
  await wait(1000);
  
  const newCourses: CourseItem[] = [];
  // 使用 Set 存储已存在的元素引用，用于快速查找
  const existingElements = new Set(courseItemsList.map(c => c.element).filter(Boolean));
  
  if (!parentCourse.element) {
    return newCourses;
  }
  
  // 方法1: 查找父元素下的直接子元素（展开的子列表）
  let currentElement: Element | null = parentCourse.element;
  
  // 查找父元素的兄弟元素或子元素（展开的子列表通常在父元素之后）
  let parent = currentElement.parentElement;
  if (parent) {
    // 查找父元素后面的兄弟元素（可能是展开的子列表）
    let nextSibling = currentElement.nextElementSibling;
    while (nextSibling) {
      const subItems = nextSibling.querySelectorAll(defaultConfig.courseItemSelector);
      for (const subItem of subItems) {
        // 如果之前识别到过（元素已在列表中），跳过
        if (existingElements.has(subItem)) {
          console.log(`${indent}  ⏭️ [层级 ${depth}] 跳过已识别的课程: ${subItem.textContent?.trim() || '未知'}`);
          continue;
        }
        
        if (isElementVisible(subItem)) {
          const isCompleted = isCourseCompleted(subItem);
          const subCourse: CourseItem = {
            id: `course-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: subItem.textContent?.trim() || `子课程 ${newCourses.length + 1}`,
            element: subItem,
            status: isCompleted ? "completed" : "pending"
          };
          newCourses.push(subCourse);
          existingElements.add(subItem);
          console.log(`${indent}  ✅ [层级 ${depth}] 发现新子课程: ${subCourse.name} (${isCompleted ? '已完成' : '待处理'})`);
        }
      }
      nextSibling = nextSibling.nextElementSibling;
    }
    
    // 查找父元素内的子元素（嵌套的子列表）
    const childItems = currentElement.querySelectorAll(defaultConfig.courseItemSelector);
    for (const childItem of childItems) {
      // 排除父元素本身
      if (childItem === currentElement) continue;
      
      // 如果之前识别到过（元素已在列表中），跳过
      if (existingElements.has(childItem)) {
        console.log(`${indent}  ⏭️ [层级 ${depth}] 跳过已识别的嵌套课程: ${childItem.textContent?.trim() || '未知'}`);
        continue;
      }
      
      if (isElementVisible(childItem)) {
        const isCompleted = isCourseCompleted(childItem);
        const subCourse: CourseItem = {
          id: `course-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: childItem.textContent?.trim() || `子课程 ${newCourses.length + 1}`,
          element: childItem,
          status: isCompleted ? "completed" : "pending"
        };
        newCourses.push(subCourse);
        existingElements.add(childItem);
        console.log(`${indent}  ✅ [层级 ${depth}] 发现新嵌套子课程: ${subCourse.name} (${isCompleted ? '已完成' : '待处理'})`);
      }
    }
  }
  
  // 方法2: 重新扫描整个课程列表，查找新出现的课程（仅在顶层执行）
  if (depth === 0) {
    const allCourseElements = getCourseList();
    for (const element of allCourseElements) {
      // 如果之前识别到过（元素已在列表中），跳过
      if (existingElements.has(element)) {
        continue;
      }
      
      if (isElementVisible(element)) {
        const isCompleted = isCourseCompleted(element);
        const subCourse: CourseItem = {
          id: `course-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: element.textContent?.trim() || `子课程 ${newCourses.length + 1}`,
          element: element,
          status: isCompleted ? "completed" : "pending"
        };
        newCourses.push(subCourse);
        existingElements.add(element);
        console.log(`${indent}  ✅ [层级 ${depth}] 发现新课程: ${subCourse.name} (${isCompleted ? '已完成' : '待处理'})`);
      }
    }
  }
  
  // 将新课程添加到列表中
  if (newCourses.length > 0) {
    // 过滤掉已完成的课程（只返回待处理的）
    const pendingSubCourses = newCourses.filter(c => c.status !== "completed");
    courseItemsList.push(...newCourses);
    
    console.log(`${indent}📝 [层级 ${depth}] 添加了 ${newCourses.length} 个子课程（${pendingSubCourses.length} 个待处理，${newCourses.length - pendingSubCourses.length} 个已完成）`);
    updateCourseList();
    
    return pendingSubCourses;
  }
  
  return [];
}

// 递归处理所有层级的子课程
async function processSubCoursesRecursively(
  subCourses: CourseItem[], 
  depth: number = 0,
  maxDepth: number = 10
): Promise<void> {
  // 防止无限递归
  if (depth >= maxDepth) {
    console.log(`⚠️ 达到最大嵌套深度 ${maxDepth}，停止递归处理`);
    return;
  }
  
  const indent = "  ".repeat(depth);
  
  for (const subCourse of subCourses) {
    if (!isRunning) {
      break;
    }
    
    console.log(`${indent}📚 [层级 ${depth}] 处理子课程: ${subCourse.name}`);
    
    // 处理当前子课程
    // processCourse 会：
    // 1. 点击子课程
    // 2. 检测并添加它的子课程
    // 3. 处理当前课程的内容
    // 4. 递归处理它的子课程
    await processCourse(subCourse, courseItemsList.indexOf(subCourse), courseItemsList.length);
    
    // 等待一段时间再处理下一个子课程
    await wait(defaultConfig.waitAfterClick);
  }
}

// 处理单个课程
async function processCourse(course: CourseItem, index: number, total: number): Promise<void> {
  if (!course.element) {
    course.status = "error";
    course.error = "课程元素不存在";
    updateCourseList();
    return;
  }

  // 检查课程是否已完成（有 anticon-check-circle）
  const isCompleted = isCourseCompleted(course.element);
  if (isCompleted) {
    console.log(`⏭️ 跳过已完成的课程: ${course.name} (有 anticon-check-circle)`);
    course.status = "completed";
    updateCourseList();
    return; // 已完成的课程及其子项都不处理
  }

  course.status = "processing";
  updateCourseList();
  
  updateProgress(index + 1, total, course.name);
  console.log(`处理课程 ${index + 1}/${total}: ${course.name}`);

  try {
    // 点击课程项
    const clicked = await clickCourseItem(course.element);
    if (!clicked) {
      course.status = "error";
      course.error = "无法点击课程项";
      updateCourseList();
      return;
    }

    // 等待内容加载
    await wait(defaultConfig.waitForContentLoad);
    
    // 检测并添加子课程（只有未完成的课程才检测子课程）
    const subCourses = await detectAndAddSubCourses(course);
    
    // 先处理当前页面的内容（如果有）
    const pageContent = detectAllContent();
    const hasContent = pageContent.videos.length > 0 || 
                      pageContent.ppts.length > 0 || 
                      pageContent.exams.length > 0;
    
    if (hasContent) {
      console.log(`📄 当前课程有内容，先处理内容...`);
      
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
    } else {
      console.log(`📄 当前课程没有内容，跳过内容处理`);
    }
    
    // 如果有子课程且未完成，递归处理所有层级的子课程
    if (subCourses.length > 0) {
      console.log(`📚 发现 ${subCourses.length} 个待处理的子课程，开始递归处理...`);
      
      // 递归处理所有子课程（包括子课程的子课程）
      await processSubCoursesRecursively(subCourses, 0);
      
      console.log(`✅ 所有子课程（包括嵌套子课程）处理完成`);
    }

    // 标记当前课程为已完成
    course.status = "completed";
    updateCourseList();
  } catch (error: any) {
    console.error(`处理课程 ${course.name} 时出错:`, error);
    course.status = "error";
    course.error = error.message || "处理失败";
    updateCourseList();
  }
}

// 更新课程列表状态
function updateCourseList(): void {
  if (currentProgress.courses) {
    currentProgress.courses = courseItemsList.map(c => ({
      id: c.id,
      name: c.name,
      element: null,
      status: c.status,
      error: c.error
    }));
  }
  sendMessageToPopup({
    type: "progressUpdate",
    data: currentProgress
  });
}

// 主控制循环
export async function startAutoFinish(selectedCourseIds?: string[]): Promise<void> {
  if (isRunning) {
    console.log("已经在运行中");
    return;
  }

  isRunning = true;
  currentProgress.status = ActionStatus.RUNNING;

  try {
    // 初始化或获取课程列表
    let coursesToProcess: CourseItem[];
    if (courseItemsList.length === 0) {
      coursesToProcess = await initializeCourseList();
    } else {
      coursesToProcess = courseItemsList;
    }

    if (coursesToProcess.length === 0) {
      console.log("❌ 未找到课程列表");
      console.log("💡 提示：请打开浏览器控制台（F12）查看详细的调试信息");
      console.log("💡 如果页面确实有课程列表，可能需要调整选择器配置");
      
      updateCurrentAction({
        type: ContentType.UNKNOWN,
        description: "未找到课程列表，请查看控制台调试信息"
      });
      
      currentProgress.status = ActionStatus.ERROR;
      sendMessageToPopup({
        type: "progressUpdate",
        data: currentProgress
      });
      isRunning = false;
      return;
    }

    // 过滤选中的课程
    let courses = coursesToProcess;
    if (selectedCourseIds && selectedCourseIds.length > 0) {
      // 如果指定了选中的课程，处理选中的课程（包括已完成的，用于重新处理）
      courses = coursesToProcess.filter(c => selectedCourseIds.includes(c.id));
    } else {
      // 如果没有指定，只处理未完成的课程（已完成的默认不处理）
      courses = coursesToProcess.filter(c => c.status !== "completed" && c.status !== "skipped");
    }

    if (courses.length === 0) {
      console.log("没有需要处理的课程");
      currentProgress.status = ActionStatus.COMPLETED;
      isRunning = false;
      updateCourseList();
      return;
    }

    console.log(`找到 ${coursesToProcess.length} 个课程项，将处理 ${courses.length} 个`);

    // 使用 Set 来跟踪已处理的课程ID，避免重复处理
    const processedCourseIds = new Set<string>();
    
    // 遍历每个课程项（使用 while 循环以支持动态添加的课程）
    let i = 0;
    while (i < courses.length && isRunning) {
      const course = courses[i];
      
      // 跳过已处理的课程（避免重复处理）
      if (processedCourseIds.has(course.id)) {
        i++;
        continue;
      }
      
      // 检查课程元素是否已完成（有 anticon-check-circle）
      if (course.element && isCourseCompleted(course.element)) {
        // 如果被选中且用户想要重新处理，允许重新处理
        if (selectedCourseIds && selectedCourseIds.includes(course.id)) {
          console.log(`🔄 重新处理已完成的课程: ${course.name} (有 anticon-check-circle)`);
          course.status = "pending";
          course.error = undefined;
          updateCourseList();
        } else {
          // 如果已完成且未被选中，直接跳过（包括子项也不处理）
          console.log(`⏭️ 跳过已完成的课程: ${course.name} (有 anticon-check-circle)`);
          course.status = "completed";
          updateCourseList();
          i++;
          continue;
        }
      }
      
      // 如果课程已完成但被选中，允许重新处理（重置状态）
      if (course.status === "completed" && selectedCourseIds && selectedCourseIds.includes(course.id)) {
        console.log(`🔄 重新处理已完成的课程: ${course.name}`);
        course.status = "pending";
        course.error = undefined;
        updateCourseList();
      }
      
      // 跳过已跳过但未选中的课程
      if (course.status === "skipped" && (!selectedCourseIds || !selectedCourseIds.includes(course.id))) {
        i++;
        continue;
      }

      // 标记为已处理
      processedCourseIds.add(course.id);

      // 处理课程（可能会添加新的子课程）
      await processCourse(course, i, courses.length);
      
      // 重新获取课程列表（可能已添加新课程）
      // 更新 courses 数组，包含新添加的待处理课程
      const allPendingCourses = courseItemsList.filter(c => 
        c.status !== "completed" && 
        c.status !== "skipped" && 
        !processedCourseIds.has(c.id)
      );
      
      // 如果课程列表有变化，更新 courses 数组
      if (allPendingCourses.length > 0) {
        const newCoursesCount = allPendingCourses.length - (courses.length - i - 1);
        if (newCoursesCount > 0) {
          console.log(`📈 检测到 ${newCoursesCount} 个新课程，添加到处理队列`);
          // 将新课程添加到当前 courses 数组的末尾
          courses.push(...allPendingCourses.filter(c => !courses.includes(c)));
        }
      }

      // 等待一段时间再处理下一个课程项
      await wait(defaultConfig.waitAfterClick);
      i++;
    }

    // 检查是否所有课程都完成了
    const allCompleted = courseItemsList.every(c => c.status === "completed" || c.status === "skipped");
    currentProgress.status = allCompleted ? ActionStatus.COMPLETED : ActionStatus.RUNNING;
    
    if (allCompleted) {
      console.log("所有课程处理完成");
    }
  } catch (error) {
    console.error("处理过程中出错:", error);
    currentProgress.status = ActionStatus.ERROR;
  } finally {
    isRunning = false;
    updateCourseList();
  }
}

// 重试单个课程
export async function retryCourse(courseId: string): Promise<void> {
  const course = courseItemsList.find(c => c.id === courseId);
  if (!course) {
    console.log(`未找到课程: ${courseId}`);
    return;
  }

  // 重置课程状态
  course.status = "pending";
  course.error = undefined;
  updateCourseList();

  // 如果当前没有运行，直接处理这个课程
  if (!isRunning) {
    await processCourse(course, courseItemsList.indexOf(course), courseItemsList.length);
  } else {
    // 如果正在运行，将课程添加到待处理队列
    console.log(`课程 ${course.name} 已加入重试队列`);
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
      const selectedIds = message.data?.selectedCourseIds;
      startAutoFinish(selectedIds);
      sendResponse({ success: true });
      break;
    case "stop":
      stopAutoFinish();
      sendResponse({ success: true });
      break;
    case "getProgress":
      sendResponse({ progress: getProgress() });
      break;
    case "selectCourses":
      // 初始化课程列表（如果还没有）
      if (courseItemsList.length === 0) {
        initializeCourseList().then(() => {
          sendResponse({ progress: getProgress() });
        }).catch(() => {
          sendResponse({ progress: getProgress() });
        });
        return true; // 保持消息通道开放
      }
      sendResponse({ progress: getProgress() });
      break;
    case "retryCourse":
      retryCourse(message.data?.courseId);
      sendResponse({ success: true });
      break;
  }
  return true; // 保持消息通道开放
});

