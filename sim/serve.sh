#!/usr/bin/env bash
# 本地起静态服务器看网页试玩版。用法：./sim/serve.sh  然后浏览器开 http://localhost:8088/web/
cd "$(dirname "$0")/.."
echo "打开 http://localhost:8088/web/  (Ctrl+C 停止)"
exec node -e '
const http=require("http"),fs=require("fs"),path=require("path");
const root=process.cwd();
const types={".html":"text/html",".js":"text/javascript",".css":"text/css",".ico":"image/x-icon"};
http.createServer((req,res)=>{
  let p=path.join(root,decodeURIComponent(req.url.split("?")[0]));
  if(req.url==="/"||req.url==="/web/")p=path.join(root,"web/index.html");
  fs.readFile(p,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{"content-type":types[path.extname(p)]||"application/octet-stream"});res.end(d);});
}).listen(8088,()=>console.log("server on 8088"));
'
