# dsh-projection-guard

[English](README.md)

DeepSeek Harness (DSH) 插件：**守卫会话投影缓存**，让会话标题（及其它所有投影）不再因第三方插件的违规投影单元而在重启后丢失。

## 修复的问题

DSH 会把每个会话的投影检查点（会话标题、统计、权限等）持久化到 `session_projcache.json`。写盘路径对**整个**会话检查点做一次 JSON 序列化：只要**一个**投影单元的状态不是纯 JSON（`Map`、`Set`、类实例、循环引用或非有限数——例如某些第三方插件），**整个写盘就会失败**。该失败是 fail-soft（只记日志），所以缓存会悄悄停止更新；重启后所有冷会话的 `title` 投影缺失，界面就回退显示**工作区文件夹名**而不是会话标题。

## 插件做了什么

1. **逐行降级（运行时包装）。** 包装 `sessionProjectionCache.put()`，只丢弃无法无损 JSON 化的行，其余健康行照常持久化。单个坏单元不再拖垮整个缓存——标题、`sessionListMetadata`、统计等继续正常写盘。

2. **启动自愈。** 启动时扫描"缓存里缺标题"的持久化会话，冷读其日志并回填 `title` 投影，已过期缓存自动恢复。

3. **可观测性。** 只读路由 `GET /projection-guard/status` 报告包装调用数、丢弃行数、自愈标题数（挂载 client 半部时也会在设置页显示小卡片）。

不改任何官方/第三方文件——守卫是纯运行时包装，dsh 升级后依然有效，适用于任何部署。

## 安装

```sh
dsh plugin --profile web add github:DamonKoy/dsh-projection-guard
```

重启 `dsh web` 即可。

或将仓库加为 profile 依赖并挂载 bundle：

```json
{
  "dependencies": {
    "dsh-projection-guard": "github:DamonKoy/dsh-projection-guard"
  },
  "dsh": {
    "profile": {
      "bundles": ["dsh-projection-guard"]
    }
  }
}
```

然后在 profile 目录 `pnpm install` 并重启 `dsh web`。

## 配置

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `repairOnStart` | `true` | 启动时从持久化日志回填缺失的缓存标题。 |
| `logDropped` | `true` | 逐行丢弃非 JSON 行时告警（含键名与会话 id）。 |

示例（profile `cordis.patch.yml` 覆盖）：

```yaml
- id: projection-guard
  config:
    repairOnStart: true
    logDropped: true
```

## 开发

```sh
npm test          # 守卫核心单元测试
```

## License

MIT
