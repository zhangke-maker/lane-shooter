// node ESM 解析钩子：让 node 能跑 Cocos 风格的「无扩展名」相对 import
// 核心源码（assets/scripts/core/）保持 Cocos 要求的无扩展名 import，
// 这个钩子只在 node 无头模拟时补 .ts 扩展，源码本身不改。
// 用法：node --import ./sim/loader.mjs sim/xxx.ts
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

// 把解析逻辑注册成 worker 钩子
register('./resolve-hook.mjs', pathToFileURL(import.meta.dirname + '/'));
