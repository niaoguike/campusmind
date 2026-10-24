import { traceLabel } from './runTrace.js'

// Trace callbacks are driven by actual worker execution, never by simulated work.
export async function createPersonalRunTrace ({ db, now, eventLog, user, threadId, content, orchestration }) {
  const { plan, finalAgent } = orchestration
  const requestSummary = String(content || '学习附件分析').replace(/\s+/g, ' ').slice(0, 240)
  const runId = await db.transaction(async () => {
    const result = await db.prepare('INSERT INTO agent_runs (user_id,thread_id,intent,status,request_summary,created_at) VALUES (?,?,?,?,?,?)').run(user.id, threadId, plan.intent, 'running', requestSummary, now())
    const id = Number(result.insertId)
    const steps = [{ agent: 'coordinator', task: requestSummary, dependsOn: [] }, ...plan.steps]
    if (finalAgent === 'synthesis') steps.push({ agent: 'synthesis', task: '汇总专业 Agent 的真实结果与未完成项。', dependsOn: plan.steps.map(step => step.agent) })
    for (const [index, step] of steps.entries()) {
      await db.prepare('INSERT INTO agent_run_steps (run_id,step_index,agent_type,status,input_summary,output_summary,started_at,completed_at) VALUES (?,?,?,?,?,?,?,?)').run(
        id, index + 1, step.agent, index ? 'pending' : 'done',
        JSON.stringify({ task: step.task, dependsOn: step.dependsOn }),
        index ? '' : `已通过${plan.source === 'model' ? '模型规划' : plan.source === 'router' ? '复杂度路由' : '规则回退'}拆分 ${plan.steps.length} 个专业任务，按依赖执行。`,
        index ? '' : now(), index ? '' : now())
    }
    await eventLog({ actorUserId: user.id, runId: id, eventType: 'personal_agent_run_started', scope: { thread_id: threadId, intent: plan.intent }, payload: { plan }, status: 'done' })
    return id
  })()

  return {
    runId,
    async onStep (agent, fields) {
      await db.prepare(`UPDATE agent_run_steps SET status=?,output_summary=?,citations_json=?,
        started_at=CASE WHEN ?='running' THEN ? ELSE started_at END,
        completed_at=CASE WHEN ?='running' THEN '' ELSE ? END
        WHERE run_id=? AND agent_type=?`).run(fields.status, String(fields.output || '').replace(/\s+/g, ' ').slice(0, 1200), JSON.stringify(fields.citations || []), fields.status, now(), fields.status, now(), runId, agent)
    },
    async complete (answer, status) {
      await db.prepare('UPDATE agent_runs SET status=?,final_summary=?,completed_at=? WHERE id=?').run(status === 'degraded' ? 'partial' : 'done', String(answer).replace(/\s+/g, ' ').slice(0, 600), now(), runId)
      await eventLog({ actorUserId: user.id, runId, eventType: 'personal_agent_run_completed', payload: { final_agent: finalAgent, status }, status: 'done' })
    },
    async fail () {
      // Close only unfinished steps; completed work and original failures remain visible.
      await db.prepare("UPDATE agent_run_steps SET status=CASE WHEN status='running' THEN 'failed' ELSE 'skipped' END,output_summary='编排中断，此步骤未完成；已完成的操作不会自动重试。',completed_at=? WHERE run_id=? AND status IN ('pending','running')").run(now(), runId)
      const message = `${traceLabel(finalAgent)}编排未完成，请稍后重试并检查已有草稿。`
      await db.prepare("UPDATE agent_runs SET status='failed',final_summary=?,completed_at=? WHERE id=?").run(message, now(), runId)
      await eventLog({ actorUserId: user.id, runId, eventType: 'personal_agent_run_failed', payload: { message }, status: 'failed' })
    }
  }
}
