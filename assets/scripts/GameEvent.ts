import { EventTarget } from 'cc';

// 全局事件总线，独立文件确保最先初始化
export const gameEvent = new EventTarget();
