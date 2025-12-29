import { Config } from "./types";

// 默认配置
export const defaultConfig: Config = {
  courseListSelector: "aside, .sidebar, .course-list, .menu, nav, .course-nav, .chapter-list, .lesson-list, [class*='course-list'], [class*='chapter-list'], [class*='lesson-list'], [class*='catalog'], [class*='directory']",
  courseItemSelector: "li, .course-item, .lesson-item, .tree-node-content, .chapter-item, .section-item, [class*='course-item'], [class*='lesson-item'], [class*='chapter-item'], [class*='pie'], a[href*='course'], a[href*='lesson'], a[href*='chapter'], a[href*='section']",
  videoSelector: "video",
  pptNextButtonSelector: "button:contains('下一页'), button:contains('next'), .next-btn, .next-button, [aria-label*='next'], [aria-label*='下一页']",
  examSubmitButtonSelector: "button:contains('提交'), button:contains('submit'), .submit-btn, [type='submit']",
  waitAfterClick: 1000,
  waitForContentLoad: 2000,
  waitBetweenActions: 500
};

// 等待指定时间
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 等待元素出现
export function waitForElement(
  selector: string,
  timeout: number = 10000,
  parent: Document | Element = document
): Promise<Element | null> {
  return new Promise((resolve) => {
    // 先尝试直接查找
    const element = parent.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    // 如果没找到，使用 MutationObserver 监听
    const observer = new MutationObserver(() => {
      const element = parent.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(parent, {
      childList: true,
      subtree: true
    });

    // 超时处理
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

// 等待多个选择器中的任意一个出现
export function waitForAnyElement(
  selectors: string[],
  timeout: number = 10000
): Promise<{ element: Element; selector: string } | null> {
  return new Promise((resolve) => {
    // 先尝试直接查找
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        resolve({ element, selector });
        return;
      }
    }

    // 如果没找到，使用 MutationObserver
    const observer = new MutationObserver(() => {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve({ element, selector });
          return;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

// 安全点击元素
export async function safeClick(element: Element | null): Promise<boolean> {
  if (!element) return false;

  try {
    // 滚动到元素可见
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await wait(300);

    // 尝试多种点击方式
    if (element instanceof HTMLElement) {
      // 方式1: 直接点击
      element.click();
      return true;
    } else if (element instanceof SVGElement) {
      // SVG元素
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      });
      element.dispatchEvent(event);
      return true;
    }
  } catch (error) {
    console.error("点击元素失败:", error);
  }

  return false;
}

// 查找包含文本的元素（不区分大小写）
export function findElementByText(
  selector: string,
  text: string,
  parent: Document | Element = document
): Element | null {
  const elements = parent.querySelectorAll(selector);
  for (const el of elements) {
    if (el.textContent?.toLowerCase().includes(text.toLowerCase())) {
      return el;
    }
  }
  return null;
}

// 查找所有包含文本的元素
export function findAllElementsByText(
  selector: string,
  text: string,
  parent: Document | Element = document
): Element[] {
  const elements = parent.querySelectorAll(selector);
  const results: Element[] = [];
  for (const el of elements) {
    if (el.textContent?.toLowerCase().includes(text.toLowerCase())) {
      results.push(el);
    }
  }
  return results;
}

// 检查元素是否可见
export function isElementVisible(element: Element | null): boolean {
  if (!element) return false;
  if (!(element instanceof HTMLElement)) return false;

  const style = window.getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    element.offsetWidth > 0 &&
    element.offsetHeight > 0
  );
}

// 获取所有可见的课程项
export function getVisibleCourseItems(config: Config): Element[] {
  const courseListContainers = document.querySelectorAll(config.courseListSelector);
  const items: Element[] = [];

  for (const container of courseListContainers) {
    const courseItems = container.querySelectorAll(config.courseItemSelector);
    for (const item of courseItems) {
      if (isElementVisible(item)) {
        items.push(item);
      }
    }
  }

  // 去重（如果同一个元素被多个选择器匹配）
  return Array.from(new Set(items));
}

// 发送消息到 popup
export function sendMessageToPopup(message: any): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // 忽略错误（popup可能未打开）
  });
}

