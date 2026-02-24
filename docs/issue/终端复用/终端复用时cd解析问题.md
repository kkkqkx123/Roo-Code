当前执行命令工具使用的终端复用功能包含了对cd命令的解析，但解析成功的情况下cd段并未从命令中去除。分析导致问题的原因并修复

典型例子为：
PS E:\project\Roo-Code-3.50.0\src> cd src && npx vitest run utils/__tests__/streaming-token-counter.spec.ts
Set-Location: Cannot find path 'E:\project\Roo-Code-3.50.0\src\src' because it does not exist.

原始命令为cd src && npx vitest run utils/__tests__/streaming-token-counter.spec.ts，当前的终端处理逻辑会提取cd，直接使用新的目录作为调用vscode的终端api时的pwd，但原始命令中的cd段并未去除。
需要明确：最终回退(即抛出错误，代表vscode拒绝执行)时依然需要重新使用原始命令