export function buildShortAnswerGradingPrompt (items) {
  return `你是严谨的大学课程助教。请只根据每题的参考要点，对学生简答进行给分。不要要求逐字一致；概念错误不可给满分。严格输出 JSON：{"items":[{"id":"q1","score":0,"feedback":"具体反馈"}],"analysis":"整体薄弱点分析","next_steps":["建议1","建议2"]}。不得输出 Markdown。\n题目数据：${JSON.stringify(items)}`
}
