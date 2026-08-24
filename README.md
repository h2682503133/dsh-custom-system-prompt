# dsh-custom-system-prompt

按会话自定义系统提示的 DSH Web 插件。设置 → 插件 分区中的卡片：选择会话、写入提示词、保存；该会话的下一轮模型调用即带上这段系统提示。配置经 `settings` 服务持久化，重启进程后保留。

## 安装

在 `$DSH_HOME/profiles/web/package.json` 中加入依赖并列入 bundles，然后 `pnpm install` 并重启 web 进程：

```json
{
  "dependencies": {
    "dsh-custom-system-prompt": "file:path/to/dsh-custom-system-prompt.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-custom-system-prompt"]
    }
  }
}
```

## 行为

- 每个会话可配置一段独立系统提示；留空保存 = 清除注入。
- 注入段名为 `custom-user-prompt`，order 50，位于 persona 之后、工具说明之前。
- 配置存于 settings 命名空间 `dsh-custom-system-prompt`（JSON storage，重启保留）。
