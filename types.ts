// 内容类型枚举
export enum ContentType {
  VIDEO = "video",
  PPT = "ppt",
  EXAM = "exam",
  UNKNOWN = "unknown"
}

// 操作状态
export enum ActionStatus {
  IDLE = "idle",
  RUNNING = "running",
  PAUSED = "paused",
  COMPLETED = "completed",
  ERROR = "error"
}

// 当前操作信息
export interface CurrentAction {
  type: ContentType;
  description: string;
}

// 课程项信息
export interface CourseItem {
  id: string;
  name: string;
  element: Element | null; // 在 content script 中使用
  status: "pending" | "processing" | "completed" | "error" | "skipped";
  error?: string;
  retryCount?: number; // 补做次数
}

// 进度信息
export interface Progress {
  currentIndex: number;
  totalCount: number;
  currentCourse: string;
  status: ActionStatus;
  currentAction?: CurrentAction;
  courses?: CourseItem[]; // 课程列表
}

// 消息类型
export interface Message {
  type: "start" | "stop" | "getProgress" | "progressUpdate" | "selectCourses" | "retryCourse";
  data?: any;
}

// 配置选项（用于适配不同网站）
export interface Config {
  // 课程列表选择器
  courseListSelector: string;
  courseItemSelector: string;
  // 内容检测选择器
  videoSelector: string;
  pptNextButtonSelector: string;
  examSubmitButtonSelector: string;
  // 等待时间（毫秒）
  waitAfterClick: number;
  waitForContentLoad: number;
  waitBetweenActions: number;
}

// 页面内容检测结果
export interface PageContent {
  videos: HTMLVideoElement[];
  ppts: Element[];
  exams: Element[];
}

