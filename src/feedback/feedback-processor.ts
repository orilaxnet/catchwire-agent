import { getPool } from '../storage/pg-pool.ts';
import { FeedbackRepo } from '../storage/sqlite.adapter.ts';
import { PersonaManager } from '../persona/persona-manager.ts';
import { logger } from '../utils/logger.ts';
import type { AgentResponse, UserAction } from '../types/index.ts';

export class FeedbackProcessor {
  constructor(private personaManager: PersonaManager) {}

  async record(emailLogId: string, accountId: string, prediction: AgentResponse, userAction: UserAction, correction?: Partial<AgentResponse>): Promise<void> {
    const wasCorrect = userAction === 'sent_as_is' ? true : userAction === 'ignored' ? undefined : false;
    await FeedbackRepo.insert({
      emailLogId, accountId, prediction, userAction, userCorrection: correction,
      wasCorrect, createdAt: new Date(),
    });
    await this.maybeLearn(accountId);
  }

  private async maybeLearn(accountId: string): Promise<void> {
    const recent = await FeedbackRepo.countRecent(accountId, 7);
    if (recent > 0 && recent % 10 === 0) {
      this.runLearning(accountId).catch((e) => logger.error('Learning engine error', e));
    }
  }

  private async runLearning(accountId: string): Promise<void> {
    const { rows } = await getPool().query(
      `SELECT user_action, prediction, was_correct FROM feedback
       WHERE account_id = $1 AND created_at > NOW() - INTERVAL '30 days'
       ORDER BY created_at DESC LIMIT 50`,
      [accountId]
    );
    const acceptedRatio = rows.filter((r) => r.was_correct === true).length / Math.max(rows.length, 1);
    logger.info('Learning stats', { accountId, totalFeedback: rows.length, acceptedRatio: acceptedRatio.toFixed(2) });

    if (acceptedRatio < 0.6 && rows.length >= 20) {
      await this.personaManager.update(accountId, { shadowMode: true });
      logger.warn('Accuracy low, re-enabling shadow mode', { accountId });
    }
  }
}
