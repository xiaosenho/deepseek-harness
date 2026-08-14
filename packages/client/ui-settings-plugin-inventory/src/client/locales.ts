/** Copy dictionaries for the plugin inventory Settings section. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  tab: '插件列表',
  discoveryTitle: '发现更多插件',
  discoveryDescription: '在 GitHub 查看带有 dsh-plugin 标签的社区插件。安装前请检查插件仓库的说明和源码。',
  discoveryAction: '浏览社区插件',
  importTitle: '导入到桌面应用',
  importChoose: '从插件仓库复制 npm 包名或 Git 地址。',
  importInstall: '退出 DeepSeek Harness，在已安装 dsh CLI 和 pnpm 的终端中运行：',
  importRestart: '重新打开应用，然后在此列表确认插件已加载。',
  importWarning: '第三方插件以受信任代码运行，不受智能体沙箱保护。只安装你信任的插件。',
  loading: '正在读取插件…',
  error: '暂时无法读取插件。',
  retry: '重试',
  search: '搜索插件',
  catalog: '插件列表',
  empty: '暂无插件。',
  emptySearch: '没有匹配的插件。',
  enabledTag: '已启用',
  disabledTag: '已停用',
  configuration: '配置状态',
  cordis: 'Cordis 状态',
  unobserved: '未挂载',
  pending: '等待依赖',
  loadingPhase: '加载中',
  active: '已挂载',
  failed: '挂载失败',
  unloading: '卸载中',
} satisfies Record<string, string>

/** Plugin inventory locale key union. */
export type PluginInventoryLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Plugin list',
  discoveryTitle: 'Discover more plugins',
  discoveryDescription: 'Browse community plugins tagged dsh-plugin on GitHub. Review each repository and its source before installing.',
  discoveryAction: 'Browse community plugins',
  importTitle: 'Import into the desktop app',
  importChoose: 'Copy the npm package name or Git spec from the plugin repository.',
  importInstall: 'Quit DeepSeek Harness, then run this in a terminal with the dsh CLI and pnpm installed:',
  importRestart: 'Reopen the app and confirm the plugin appears in this list.',
  importWarning: 'Third-party plugins run as trusted code outside the agent sandbox. Install only plugins you trust.',
  loading: 'Reading plugins…',
  error: 'Plugins are temporarily unavailable.',
  retry: 'Retry',
  search: 'Search plugins',
  catalog: 'Plugin list',
  empty: 'No plugins are available.',
  emptySearch: 'No matching plugins.',
  enabledTag: 'Enabled',
  disabledTag: 'Disabled',
  configuration: 'Configuration',
  cordis: 'Cordis status',
  unobserved: 'Not mounted',
  pending: 'Waiting for dependencies',
  loadingPhase: 'Loading',
  active: 'Mounted',
  failed: 'Mount failed',
  unloading: 'Unloading',
} satisfies Record<PluginInventoryLocaleKey, string>
