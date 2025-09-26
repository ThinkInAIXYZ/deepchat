@echo off
REM Windows批处理脚本用于更新shadcn组件

echo 更新 shadcn-vue 组件...

REM 转到项目根目录
cd /d %~dp0..

REM 运行Node.js脚本
node scripts/update-shadcn.js %*

echo.
echo 更新完成！
pause