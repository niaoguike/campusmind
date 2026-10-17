const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function normalizeKnowledgePointName(value, fallback = '综合练习') {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, 100);
}

export async function ensureKnowledgePoint({ db, courseId, name, description = '', now }) {
  const pointName = normalizeKnowledgePointName(name);
  let point = await db.prepare('SELECT * FROM knowledge_points WHERE course_id=? AND name=?').get(courseId, pointName);
  if (point) return point;
  const result = await db.prepare('INSERT INTO knowledge_points (course_id,name,description,created_at) VALUES (?,?,?,?)').
  run(courseId, pointName, String(description || '').slice(0, 600), now());
  return await db.prepare('SELECT * FROM knowledge_points WHERE id=?').get(result.insertId);
}

export async function recordLearningEvent({ db, userId, eventType, sourceType = '', sourceId = null, payload = {}, now }) {
  await db.prepare('INSERT INTO learning_events (user_id,event_type,source_type,source_id,payload_json,created_at) VALUES (?,?,?,?,?,?)').
  run(userId, String(eventType).slice(0, 60), String(sourceType).slice(0, 60), sourceId || null, JSON.stringify(payload || {}), now());
}

export async function updateMasteryFromQuiz({ db, userId, courseId, questions, results, now, quizId }) {
  const resultById = new Map(results.map((item) => [item.id, item]));
  const grouped = new Map();
  for (const question of questions) {
    const result = resultById.get(question.id);
    if (!result) continue;
    const pointName = normalizeKnowledgePointName(question.knowledge_point, '课程综合练习');
    const item = grouped.get(pointName) || { questions: 0, score: 0, total: 0 };
    item.questions += 1;
    item.score += Number(result.score) || 0;
    item.total += Number(result.max_score) || Number(question.score) || 10;
    grouped.set(pointName, item);
  }

  const updates = [];
  await db.transaction(async () => {
    for (const [name, item] of grouped) {
      const point = await ensureKnowledgePoint({ db, courseId, name, now });
      const previous = await db.prepare('SELECT * FROM user_knowledge_mastery WHERE user_id=? AND knowledge_point_id=?').get(userId, point.id);
      const accuracy = item.total ? clamp(item.score / item.total, 0, 1) : 0;
      const oldMastery = previous ? Number(previous.mastery) : 0.5;
      const mastery = Number((oldMastery * 0.7 + accuracy * 0.3).toFixed(3));
      await db.prepare(`INSERT INTO user_knowledge_mastery (user_id,knowledge_point_id,mastery,attempts,correct_count,last_assessed_at,updated_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(user_id,knowledge_point_id) DO UPDATE SET
          mastery=excluded.mastery,
          attempts=user_knowledge_mastery.attempts+excluded.attempts,
          correct_count=user_knowledge_mastery.correct_count+excluded.correct_count,
          last_assessed_at=excluded.last_assessed_at,
          updated_at=excluded.updated_at`).
      run(userId, point.id, mastery, item.questions, Number(item.score / 10).toFixed(2), now(), now());
      updates.push({ knowledge_point_id: point.id, name: point.name, previous_mastery: oldMastery, mastery, accuracy, question_count: item.questions });
    }
  })();
  await recordLearningEvent({ db, userId, eventType: 'quiz_graded', sourceType: 'quiz', sourceId: quizId, payload: { course_id: courseId, updates }, now });
  return updates.sort((left, right) => left.mastery - right.mastery);
}

export async function getLearningState({ db, userId, courseId = null, limit = 8 }) {
  const values = [userId];
  let where = 'WHERE um.user_id=?';
  if (courseId) {where += ' AND kp.course_id=?';values.push(courseId);}
  const points = await db.prepare(`SELECT kp.id,kp.course_id,kp.name,kp.description,c.name AS course_name,
      um.mastery,um.attempts,um.correct_count,um.last_assessed_at,um.updated_at
    FROM user_knowledge_mastery um JOIN knowledge_points kp ON kp.id=um.knowledge_point_id
    LEFT JOIN courses c ON c.id=kp.course_id ${where}
    ORDER BY um.mastery ASC, um.updated_at DESC LIMIT ?`).all(...values, limit);
  const recentEvents = await db.prepare('SELECT event_type,source_type,source_id,payload_json,created_at FROM learning_events WHERE user_id=? ORDER BY id DESC LIMIT 8').all(userId);
  const mastered = (await db.prepare(`SELECT COUNT(*) count FROM user_knowledge_mastery um JOIN knowledge_points kp ON kp.id=um.knowledge_point_id ${where} AND um.mastery>=0.75`).get(...values)).count;
  const tracked = (await db.prepare(`SELECT COUNT(*) count FROM user_knowledge_mastery um JOIN knowledge_points kp ON kp.id=um.knowledge_point_id ${where}`).get(...values)).count;
  return { weak_points: points.filter((point) => Number(point.mastery) < 0.6), points, tracked_count: tracked, mastered_count: mastered, recent_events: recentEvents.map((item) => ({ ...item, payload: JSON.parse(item.payload_json || '{}') })) };
}

export async function buildLearningReviewInput({ db, userId }) {
  return {
    state: await getLearningState({ db, userId, limit: 12 }),
    plans: await db.prepare("SELECT title,content,status,due_date FROM study_plans WHERE user_id=? ORDER BY id DESC LIMIT 8").all(userId),
    quizzes: await db.prepare("SELECT title,topic,score,total_score,completed_at FROM quizzes WHERE user_id=? AND status='graded' ORDER BY id DESC LIMIT 6").all(userId)
  };
}
