import { getPool } from '../storage/pg-pool.ts';
import type { EmailThread, ThreadMessage, ThreadEntities } from '../types/index.ts';

export class ThreadReconstructor {
  async reconstruct(threadId: string): Promise<EmailThread | null> {
    const pool = getPool();
    const { rows: tr } = await pool.query('SELECT * FROM threads WHERE id = $1', [threadId]);
    const row = tr[0];
    if (!row) return null;

    const { rows: logRows } = await pool.query(
      `SELECT * FROM email_log WHERE thread_id = $1 ORDER BY received_at ASC`, [threadId]
    );

    const messages: ThreadMessage[] = logRows.map((r) => {
      const analysis = r.agent_response ?? {};
      return {
        messageId:   r.id,
        from:        r.from_address,
        to:          [r.account_id],
        date:        new Date(r.received_at ?? r.processed_at),
        body:        r.body ?? '',
        intent:      analysis.intent,
        sentiment:   'neutral' as const,
        actionItems: analysis.extractedData?.actionItems ?? [],
      };
    });

    const entities: ThreadEntities = row.entities ?? this.aggregateEntities(logRows);

    return {
      id:             row.id,
      accountId:      row.account_id,
      subject:        row.subject,
      participants:   row.participants ?? [],
      messages,
      messageCount:   row.message_count,
      summary:        row.summary ?? undefined,
      entities,
      status:         row.status,
      waitingOn:      row.waiting_on ?? null,
      firstMessageAt: new Date(row.first_message_at),
      lastMessageAt:  new Date(row.last_message_at),
    };
  }

  private aggregateEntities(rows: any[]): ThreadEntities {
    const result: ThreadEntities = { people: [], dates: [], amounts: [], products: [], documents: [], actionItems: [] };
    for (const row of rows) {
      const analysis = row.agent_response ?? {};
      const ext = analysis.extractedData;
      if (!ext) continue;
      result.dates.push(...(ext.deadlines ?? []));
      result.amounts.push(...(ext.amounts ?? []));
      result.actionItems.push(...(ext.actionItems ?? []));
      result.people.push(...(ext.people ?? []));
    }
    for (const key of Object.keys(result) as (keyof ThreadEntities)[]) {
      (result[key] as string[]) = [...new Set(result[key] as string[])];
    }
    return result;
  }
}
