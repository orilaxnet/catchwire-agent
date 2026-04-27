import { getPool } from '../storage/pg-pool.ts';

export interface DailyStats {
  date:              string;
  totalEmails:       number;
  autoSent:          number;
  drafts:            number;
  ignored:           number;
  avgConfidence:     number;
  priorityBreakdown: Record<string, number>;
}

export interface AccountStats {
  accountId:     string;
  last30Days:    DailyStats[];
  acceptedRatio: number;
  topSenders:    Array<{ sender: string; count: number }>;
  avgResponseMs: number;
}

export class AnalyticsEngine {
  async getAccountStats(accountId: string): Promise<AccountStats> {
    const pool = getPool();

    const { rows: daily } = await pool.query(`
      SELECT
        f.created_at::date::text                                                  AS date,
        COUNT(*)::int                                                              AS total_emails,
        SUM(CASE WHEN f.user_action = 'sent_as_is' THEN 1 ELSE 0 END)::int       AS auto_sent,
        SUM(CASE WHEN f.user_action = 'edited'     THEN 1 ELSE 0 END)::int       AS drafts,
        SUM(CASE WHEN f.user_action = 'ignored'    THEN 1 ELSE 0 END)::int       AS ignored,
        AVG((f.prediction->>'confidence')::real)                                  AS avg_confidence,
        SUM(CASE WHEN f.prediction->>'priority'='critical' THEN 1 ELSE 0 END)::int AS p_critical,
        SUM(CASE WHEN f.prediction->>'priority'='high'     THEN 1 ELSE 0 END)::int AS p_high,
        SUM(CASE WHEN f.prediction->>'priority'='medium'   THEN 1 ELSE 0 END)::int AS p_medium,
        SUM(CASE WHEN f.prediction->>'priority'='low'      THEN 1 ELSE 0 END)::int AS p_low
      FROM feedback f
      WHERE f.account_id = $1 AND f.created_at > NOW() - INTERVAL '30 days'
      GROUP BY f.created_at::date
      ORDER BY date ASC
    `, [accountId]);

    const { rows: topSenders } = await pool.query(`
      SELECT from_address AS sender, COUNT(*)::int AS cnt
      FROM email_log
      WHERE account_id = $1 AND processed_at > NOW() - INTERVAL '30 days'
      GROUP BY from_address
      ORDER BY cnt DESC
      LIMIT 10
    `, [accountId]);

    const { rows: ratioRows } = await pool.query(`
      SELECT AVG(CASE WHEN was_correct THEN 1.0 ELSE 0.0 END) AS ratio
      FROM feedback
      WHERE account_id = $1 AND created_at > NOW() - INTERVAL '30 days'
    `, [accountId]);

    const { rows: avgRows } = await pool.query(`
      SELECT AVG(processing_ms) AS avg_ms
      FROM email_log
      WHERE account_id = $1 AND processing_ms IS NOT NULL
        AND processed_at > NOW() - INTERVAL '30 days'
    `, [accountId]);

    return {
      accountId,
      last30Days: daily.map((r) => ({
        date:          r.date,
        totalEmails:   r.total_emails   ?? 0,
        autoSent:      r.auto_sent      ?? 0,
        drafts:        r.drafts         ?? 0,
        ignored:       r.ignored        ?? 0,
        avgConfidence: r.avg_confidence ?? 0,
        priorityBreakdown: {
          critical: r.p_critical ?? 0,
          high:     r.p_high     ?? 0,
          medium:   r.p_medium   ?? 0,
          low:      r.p_low      ?? 0,
        },
      })),
      acceptedRatio: ratioRows[0]?.ratio ?? 0,
      topSenders:    topSenders.map((r) => ({ sender: r.sender, count: r.cnt })),
      avgResponseMs: avgRows[0]?.avg_ms  ?? 0,
    };
  }

  async getSummary(accountId: string): Promise<string> {
    const stats    = await this.getAccountStats(accountId);
    const total    = stats.last30Days.reduce((s, d) => s + d.totalEmails, 0);
    const autoSent = stats.last30Days.reduce((s, d) => s + d.autoSent, 0);
    const pct      = total > 0 ? Math.round((autoSent / total) * 100) : 0;
    return [
      `📊 Analytics (30 days)`,
      `Total emails: ${total}`,
      `Auto-sent: ${autoSent} (${pct}%)`,
      `Acceptance ratio: ${Math.round(stats.acceptedRatio * 100)}%`,
      `Avg response: ${Math.round(stats.avgResponseMs)}ms`,
    ].join('\n');
  }
}
