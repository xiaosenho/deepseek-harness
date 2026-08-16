# Agent Note：Electron Sharp LGPL 分发

Status: implemented

[English](2026-08-14-electron-sharp-lgpl-distribution.md) | 中文

## 问题

Windows Electron 运行时需要预构建的 `@img/sharp-win32-x64` 包，因为打包后的 Harness 依赖树会让图像附件功能调用 Sharp。0.35.3 版本声明 `Apache-2.0 AND LGPL-3.0-or-later`，并携带动态加载的 libvips 及其支撑 DLL。第三方声明生成器默认拒绝这项非宽松运行时依赖是正确行为；接受它是一项分发决策，其义务不能仅靠校验和或 npm manifest 表格满足。

## 决策

项目所有者授权分发精确的 `@img/sharp-win32-x64` 包身份，前提是其已发布 manifest 继续声明 `Apache-2.0 AND LGPL-3.0-or-later`。这项授权不涵盖 `sharp`、其他 `@img/sharp-*` 身份、静态构建或发生变化的声明条款。声明生成器继续将 LGPL 归类为非宽松许可证，只匹配精确身份与声明，任一项变化都会失败。

Electron Builder 会把 `apps/electron/legal/` 复制到每个打包应用的 `resources/legal/`。该目录包含完整的 LGPL 第 3 版和 GPL 第 3 版文本，以及一份 Sharp/libvips 声明。声明会标出当前 Sharp 与 libvips 版本、上游列出的 LGPL 组件，以及固定的源码与构建来源。应用使用 `asar: false`；Windows DLL 保持为普通的动态加载文件，接收者可以检查并替换为兼容构建。

包版本与组件版本属于发布输入，而非开放式授权。生成器测试从已安装元数据中推导 Sharp 包版本和 libvips 版本。Builder 测试要求法务目录存在，并把声明固定到直接依赖版本和当前 libvips 版本。任一版本变化后，发布操作人员必须先评审并更新声明与源码链接，才能分发安装程序；与已发布安装包对应的源码也必须持续可用。

[生成的第三方声明决策](2026-07-30-generated-third-party-notices.md)继续负责依赖披露与默认拒绝的许可证策略。本 Note 只负责 Electron Sharp Windows 分发义务。

## 考虑过的替代方案

**把 LGPL 归类为宽松许可证。** 这会误述许可证，并使无关的 copyleft 运行时依赖在没有明确决策时通过。

**增加可复用的原生包允许列表。** 按包族或许可证族授权会把所有者的接受范围扩大到未经评审的身份与条款。

**从 Windows 包中移除 Sharp。** 这会破坏打包后的图像附件路径，而不是履行其分发要求。

**只提供声明链接。** LGPL 第 3 版纳入 GPL 第 3 版条款，并要求接收者获得适用条款和对应源码信息。因此安装包会携带两份完整文本和版本明确的来源说明。

## 后果

Windows Electron 制品会携带额外法务文件和明确的对应源码义务。Sharp 身份或许可证声明变化会让声明生成器失败。包版本或 libvips 版本变化会让固定版本的法务材料测试失败，直至完成评审。

这项授权具有长期决策价值，因为未来 Electron 打包和依赖升级必须区分已经评审的动态 Windows 载荷与其他 Sharp 包或链接方式。本 Note 保持活跃；没有同主题 Agent Note 被取代。
