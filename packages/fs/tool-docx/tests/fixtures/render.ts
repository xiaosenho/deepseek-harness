/** Generate the representative resume used for manual DOCX render verification. */

import { writeFile } from 'node:fs/promises'
import { buildResumeDocx } from '../../src/document.ts'

const output = process.argv[2]
if (output === undefined) throw new Error('render fixture requires an output .docx path')

await writeFile(output, await buildResumeDocx({
  name: '张伟',
  headline: 'AI 工程师 · 推理与智能体系统',
  contact: ['上海', 'zhang@example.com', '+86 138 0000 0000'],
  sections: [
    {
      heading: '职业概述',
      entries: [{
        title: '专注大模型推理、评测与生产系统',
        description: '具备从模型评测、服务优化到可观测性建设的完整工程经验。以下内容仅用于版式验证。',
      }],
    },
    {
      heading: '工作经历',
      entries: [{
        title: 'AI 工程师 · 示例科技',
        meta: '2023 年 3 月–至今 · 上海',
        bullets: [
          '设计批处理与缓存策略，将推理服务 P95 延迟降低 35%。',
          '搭建覆盖准确率、延迟和成本的模型评测流程，支持版本发布决策。',
          '建立请求链路追踪与异常归因机制，缩短线上问题定位时间。',
        ],
      }, {
        title: '后端工程师 · 示例网络',
        meta: '2020 年 7 月–2023 年 2 月 · 杭州',
        bullets: [
          '负责高并发 API 服务及数据处理任务，维护稳定发布流程。',
          '推动关键模块测试与监控覆盖，降低重复故障。',
        ],
      }],
    },
    {
      heading: '项目经历',
      entries: [{
        title: '智能体评测平台',
        meta: 'TypeScript · Python · PostgreSQL',
        bullets: [
          '实现可复现的工具调用回放与结构化结果比较。',
          '按模型、场景和版本聚合指标，为迭代提供可追踪证据。',
        ],
      }],
    },
    {
      heading: '教育经历',
      entries: [{ title: '计算机科学与技术学士 · 示例大学', meta: '2016 年 9 月–2020 年 6 月' }],
    },
    {
      heading: '技能',
      entries: [{
        title: '工程能力',
        description: 'TypeScript、Python、Node.js、PostgreSQL、Docker、大模型推理与评测',
      }],
    },
  ],
}))
