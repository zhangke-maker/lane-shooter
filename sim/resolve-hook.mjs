// 实际的 resolve 钩子（在 register 的 worker 上下文里运行）
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
    // 只处理相对路径的无扩展名 import → 补 .ts
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.[a-z]+$/i.test(specifier)) {
        try {
            const candidate = new URL(specifier + '.ts', context.parentURL);
            if (existsSync(fileURLToPath(candidate))) {
                return nextResolve(specifier + '.ts', context);
            }
        } catch { /* fall through */ }
    }
    return nextResolve(specifier, context);
}
