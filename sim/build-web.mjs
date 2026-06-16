// 零安装 web 构建：用 node 内置 stripTypeScriptTypes 把纯TS核心 + bot 转成
// 浏览器可直接 import 的 .js（ES module）。不引入 esbuild/webpack 等任何依赖。
// 用法：node sim/build-web.mjs  → 产物写到 web/lib/
import { stripTypeScriptTypes } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'web', 'lib');
mkdirSync(outDir, { recursive: true });

// 需要转译的源文件（相对 root）→ 输出文件名（扁平到 web/lib/）
const files = [
    { src: 'assets/scripts/core/types.ts',  out: 'types.js' },
    { src: 'assets/scripts/core/levels.ts', out: 'levels.js' },
    { src: 'assets/scripts/core/world.ts',  out: 'world.js' },
    { src: 'sim/bots.ts',                   out: 'bots.js' },
];

// 把无扩展名 / 跨目录的相对 import 重写为同目录的 ./xxx.js（产物已扁平化）
function rewriteImports(code) {
    return code.replace(
        /(from\s+['"])(\.[^'"]+?)(['"])/g,
        (_m, pre, spec, post) => {
            const base = spec.split('/').pop();          // types / world / ../assets/.../types
            return `${pre}./${base}.js${post}`;
        }
    );
}

for (const f of files) {
    const raw = readFileSync(join(root, f.src), 'utf8');
    const stripped = stripTypeScriptTypes(raw, { mode: 'strip' });
    const final = rewriteImports(stripped);
    writeFileSync(join(outDir, f.out), final);
    console.log(`built ${f.out}`);
}
console.log('web/lib 构建完成');
