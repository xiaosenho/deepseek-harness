/** Browse directory-flow installer shared by browse-capable client plugins. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { BrowseFlowInjected } from './browse-flow.ts'
import { BrowseDirectoryFlow } from './browse-flow.ts'

/** Locale namespace owning the in-app directory browser's copy. */
const LOCALE_NS = 'directory-browser'

/**
 * Install the in-app browser and its locale dictionaries into both workspace
 * directory-flow slots. Registration and disposal belong to the calling
 * plugin's Cordis fiber.
 * @param ctx - client context carrying slots, workspaces, and locale.
 */
export function installBrowseDirectoryFlow(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    const dictionaries: [locale: string, dict: Record<string, string>][] = [
      ['zh', {
        'browser.title': '选择工作区目录',
        'browser.home': '主目录',
        'browser.newFolder': '新建文件夹',
        'browser.folderName': '文件夹名称',
        'browser.createIn': '在"{name}"中新建文件夹',
        'browser.untitledFolder': '未命名文件夹',
        'browser.create': '创建',
        'browser.cancel': '取消',
        'browser.open': '打开',
        'browser.editPath': '编辑路径',
        'browser.loading': '加载中…',
        'browser.truncated': '文件夹过多，仅显示开头部分。',
        'browser.showHidden': '显示隐藏文件',
      }],
      ['en', {
        'browser.title': 'Select Workspace Directory',
        'browser.home': 'Home',
        'browser.newFolder': 'New folder',
        'browser.folderName': 'Folder name',
        'browser.createIn': 'New folder in "{name}"',
        'browser.untitledFolder': 'Untitled folder',
        'browser.create': 'Create',
        'browser.cancel': 'Cancel',
        'browser.open': 'Open',
        'browser.editPath': 'Edit path',
        'browser.loading': 'Loading…',
        'browser.truncated': 'Too many folders to list; only the beginning is shown.',
        'browser.showHidden': 'Show hidden files',
      }],
    ]
    try {
      for (const [locale, dict] of dictionaries) disposers.push(ctx.locale.register(LOCALE_NS, locale, dict))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    return () => { for (const dispose of disposers) dispose() }
  }, 'directory-picker-browse: dialog dictionaries')

  const injected = (): BrowseFlowInjected => ({
    listDirectory: (path, signal) => ctx.workspaces.listDirectory(path, signal),
    createDirectory: (path, name) => ctx.workspaces.createDirectory(path, name),
    t: ctx.locale.bind(LOCALE_NS),
  })
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register({
        name: 'conversation.hero.workspace.directoryFlow', inject: injected,
      }, BrowseDirectoryFlow)
      yield ctx.slots.register({
        name: 'sidebar.workspaces.directoryFlow', inject: injected,
      }, BrowseDirectoryFlow)
    }))
}
