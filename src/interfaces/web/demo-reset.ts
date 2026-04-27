import { getPool } from '../../storage/pg-pool.ts';
import { logger }  from '../../utils/logger.ts';

const ACC = 'acc-demo-001';

export async function resetDemoData(): Promise<void> {
  const pool = getPool();
  try {
    // Wipe mutable tables (keep users, email_accounts, personas)
    await pool.query(`DELETE FROM webhooks`);
    await pool.query(`DELETE FROM sender_overrides WHERE account_id = $1`, [ACC]);
    await pool.query(`DELETE FROM scheduled_emails WHERE account_id = $1`, [ACC]);
    await pool.query(`DELETE FROM email_log WHERE account_id = $1`, [ACC]);
    await pool.query(`DELETE FROM threads WHERE account_id = $1`, [ACC]);
    await pool.query(`DELETE FROM prompt_profiles WHERE account_id = $1 OR account_id IS NULL`, [ACC]);
    await pool.query(`DELETE FROM analytics_daily WHERE account_id = $1`, [ACC]);
    await pool.query(`DELETE FROM email_templates WHERE account_id = $1 OR account_id IS NULL`, [ACC]);

    // Re-seed threads
    await pool.query(`
      INSERT INTO threads (id, account_id, subject, participants, message_count, summary, status, first_message_at, last_message_at) VALUES
      ('thr-001','${ACC}','Partnership Proposal — Q2 2026','[{"email":"alice@partnerfirm.com","name":"Alice Chen"}]',2,'Discussion about a Q2 partnership proposal with revenue share terms.','active',NOW()-INTERVAL '7 days',NOW()-INTERVAL '2 days'),
      ('thr-002','${ACC}','Invoice #4821 overdue','[{"email":"billing@vendor.io","name":"Vendor Billing"}]',2,'Overdue invoice for $2,400 — now paid and confirmed.','active',NOW()-INTERVAL '6 days',NOW()-INTERVAL '1 day'),
      ('thr-003','${ACC}','Server is DOWN — urgent fix needed','[{"email":"devops@infra.com","name":"DevOps Team"}]',2,'Production outage resolved. Disk mount failure on primary node.','active',NOW()-INTERVAL '5 days',NOW()-INTERVAL '3 days'),
      ('thr-004','${ACC}','Weekly team standup notes','[{"email":"team@company.com","name":"Team"}]',1,'Weekly standup meeting notes for April 26.','active',NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 days'),
      ('thr-005','${ACC}','Job application: Senior Backend Engineer','[{"email":"hr@company.com","name":"HR"}]',1,'Job application review for Sarah Kim, Senior Backend Engineer.','active',NOW()-INTERVAL '4 days',NOW()-INTERVAL '4 days'),
      ('thr-006','${ACC}','Re: Annual subscription renewal','[{"email":"billing@acmecorp.com","name":"Acme Billing"}]',3,'20% discount offer on annual SaaS subscription renewal before May 15.','active',NOW()-INTERVAL '5 days',NOW()-INTERVAL '1 day'),
      ('thr-007','${ACC}','Feature request: dark mode support','[{"email":"user123@gmail.com","name":"Jordan Lee"}]',2,'Customer requesting dark mode for the web dashboard.','active',NOW()-INTERVAL '3 days',NOW()-INTERVAL '3 hours'),
      ('thr-008','${ACC}','Security audit findings — confidential','[{"email":"security@auditfirm.com","name":"SecureAudit Inc"}]',1,'Preliminary security audit: 3 medium issues, 1 low issue.','active',NOW()-INTERVAL '2 days',NOW()-INTERVAL '2 days'),
      ('thr-009','${ACC}','Candidate interview — Thursday 10am','[{"email":"recruiter@talent.io","name":"Maya Recruiter"}]',4,'Technical interview with Alex Chen confirmed for Thursday 10am PST.','active',NOW()-INTERVAL '6 days',NOW()-INTERVAL '12 hours'),
      ('thr-010','${ACC}','Newsletter: April dev digest','[{"email":"newsletter@devdigest.io","name":"Dev Digest"}]',1,'Monthly newsletter: Bun 2.0, Temporal API, Claude Code.','active',NOW()-INTERVAL '1 day',NOW()-INTERVAL '1 day'),
      ('thr-011','${ACC}','Re: Refund request — order #9921','[{"email":"support@shopify.com","name":"Shopify Support"}]',2,'Customer refund of $49 for duplicate charge on order #9921.','active',NOW()-INTERVAL '4 days',NOW()-INTERVAL '6 hours'),
      ('thr-012','${ACC}','Q2 budget approval','[{"email":"cfo@company.com","name":"CFO Office"}]',1,'15% engineering budget increase for contractors and cloud infra.','active',NOW()-INTERVAL '7 days',NOW()-INTERVAL '7 days')
      ON CONFLICT (id) DO NOTHING
    `);

    // Re-seed email_log
    await pool.query(`
      INSERT INTO email_log (id, account_id, thread_id, from_address, sender_name, subject, body, summary, priority, intent, agent_response, user_action, processed_at) VALUES
      ('email-001','${ACC}','thr-001','alice@partnerfirm.com','Alice Chen','Partnership Proposal — Q2 2026','Dear team, we would like to propose a partnership for Q2 2026 with a 70/30 revenue share model. Please review the attached proposal.','Alice Chen from PartnerFirm proposing a Q2 partnership with 70/30 revenue share.','medium','partnership','{"reply":"Thank you for reaching out, Alice. We have reviewed the proposal and are interested in moving forward. Can we schedule a call next week?","tokens":312}','approved',NOW()-INTERVAL '7 days'),
      ('email-002','${ACC}','thr-002','billing@vendor.io','Vendor Billing','Invoice #4821 overdue — action required','Your invoice #4821 for $2,400 is now 15 days overdue. Please settle immediately to avoid service interruption.','Invoice #4821 for $2,400 is 15 days overdue. Immediate payment required.','high','billing','{"reply":"Apologies for the delay. Payment has been initiated and should reflect within 2 business days.","tokens":198}','approved',NOW()-INTERVAL '6 days'),
      ('email-003','${ACC}','thr-003','devops@infra.com','DevOps Team','CRITICAL: Production server down — immediate response needed','ALERT: Production server at 209.126.1.43 is not responding. All services are down. ETA unknown.','Production server completely down. All services affected. No ETA.','critical','incident','{"reply":"On it. Spinning up the backup instance now. Will update in 15 minutes.","tokens":145}','approved',NOW()-INTERVAL '5 days'),
      ('email-004','${ACC}','thr-004','team@company.com','Team','Weekly team standup notes — April 26','Standup notes: Frontend — inbox redesign done. Backend — rate limiting deployed. Blocker: waiting on legal for NDA review.','Standup notes: inbox done, rate limiting deployed, NDA review pending.','low','update',NULL,'rejected',NOW()-INTERVAL '3 days'),
      ('email-005','${ACC}','thr-005','hr@company.com','HR','Review needed: Job application — Sarah Kim, Senior Backend Eng','Sarah Kim has applied for the Senior Backend Engineer role. 6 years experience, Go + Rust. Requesting technical review from engineering lead.','Sarah Kim applying for Senior Backend Engineer. 6yr exp, Go+Rust. Needs engineering review.','medium','hr','{"reply":"Thanks for flagging this. Sarah''s profile looks strong. Please schedule a technical screen for next week.","tokens":267}','approved',NOW()-INTERVAL '4 days'),
      ('email-006','${ACC}','thr-006','ceo@company.com','CEO','Q1 results summary','Q1 revenue: $1.2M (+34% YoY). Customer churn: 2.1%. New logos: 47. ARR: $4.8M. Strong quarter overall.','Q1 results: $1.2M revenue (+34%), 2.1% churn, 47 new logos, $4.8M ARR.','medium','update',NULL,'rejected',NOW()-INTERVAL '8 days'),
      ('email-007','${ACC}','thr-006','billing@acmecorp.com','Acme Billing','Annual subscription renewal — 20% discount offer','Your annual subscription expires May 15. We offer 20% discount if renewed before end of month.','Acme offering 20% discount on annual renewal before May 15.','medium','billing','{"reply":"Thank you for the renewal offer. I will review the pricing and get back to you by Friday.","tokens":189}','approved',NOW()-INTERVAL '5 days'),
      ('email-008','${ACC}','thr-007','user123@gmail.com','Jordan Lee','Feature request: please add dark mode','Love the product but I spend a lot of time in the dashboard at night. Any plans to add dark mode?','User requesting dark mode. Positive tone, long-time user.','low','feature_request','{"reply":"Thanks for the feedback Jordan! Dark mode is on our roadmap for Q3. We will keep you posted.","tokens":156}','approved',NOW()-INTERVAL '3 days'),
      ('email-009','${ACC}','thr-008','security@auditfirm.com','SecureAudit Inc','Preliminary security audit findings — CONFIDENTIAL','We identified 3 medium-severity issues (session token handling) and 1 low-severity CSP misconfiguration. Full report to follow.','Security audit: 3 medium issues (session tokens), 1 low (CSP). Full report pending.','critical','security','{"reply":"Thank you for the preliminary report. We will begin remediation immediately and schedule a call for next week.","tokens":445}','approved',NOW()-INTERVAL '2 days'),
      ('email-010','${ACC}','thr-009','recruiter@talent.io','Maya Recruiter','Interview scheduled: Alex Chen — Thursday 10am PST','Technical interview with Alex Chen confirmed for Thursday at 10am PST via Zoom. Link sent 30min before.','Interview with Alex Chen confirmed Thursday 10am PST via Zoom.','medium','scheduling','{"reply":"Confirmed! Thursday 10am works perfectly. Looking forward to meeting Alex.","tokens":134}','approved',NOW()-INTERVAL '12 hours'),
      ('email-011','${ACC}','thr-010','newsletter@devdigest.io','Dev Digest','[Dev Digest] April: Bun 2.0, Temporal API, Claude tooling','This month: Bun 2.0 with native S3, Temporal API Stage 4, Claude Code CLI launched.','Monthly developer newsletter.','low','newsletter',NULL,'rejected',NOW()-INTERVAL '1 day'),
      ('email-012','${ACC}','thr-011','support@shopify.com','Shopify Support','Refund request for order #9921','Customer requesting $49 refund for duplicate charge on order #9921.','$49 refund request for duplicate charge on order #9921.','high','support','{"reply":"Please proceed with the refund. The duplicate charge was confirmed. Apologies for the inconvenience.","tokens":212}','approved',NOW()-INTERVAL '6 hours'),
      ('email-013','${ACC}','thr-012','cfo@company.com','CFO Office','Q2 engineering budget — approval needed','Engineering requesting 15% budget increase for two contractor hires and cloud infrastructure.','Engineering requesting 15% Q2 budget increase.','high','approval','{"reply":"Approved. Please coordinate with finance for the formal PO.","tokens":289}','approved',NOW()-INTERVAL '7 days'),
      ('email-014','${ACC}','thr-001','alice@partnerfirm.com','Alice Chen','Re: Partnership Proposal — next steps','Excited to move forward! Can we schedule a call to discuss contract terms? Legal needs 5 business days.','Partner confirming interest. Requesting contract call. Legal needs 5 days.','medium','partnership','{"reply":"Absolutely. I will send a calendar invite for Tuesday at 2pm.","tokens":167}','approved',NOW()-INTERVAL '2 days'),
      ('email-015','${ACC}','thr-002','billing@vendor.io','Vendor Billing','Re: Invoice #4821 — payment confirmation','Payment of $2,400 received. Invoice #4821 marked as settled. Receipt attached.','Invoice #4821 settled. Receipt attached.','low','billing',NULL,'rejected',NOW()-INTERVAL '1 day'),
      ('email-016','${ACC}','thr-003','devops@infra.com','DevOps Team','RESOLVED: Production server back online','Server back online at 14:32 UTC. Root cause: failed disk mount on primary node. Post-mortem incoming.','Production outage resolved at 14:32 UTC. Disk mount failure. Post-mortem incoming.','high','incident','{"reply":"Thanks for the quick resolution. Please share the post-mortem when ready.","tokens":178}','approved',NOW()-INTERVAL '3 days'),
      ('email-017','${ACC}',NULL,'notifications@github.com','GitHub','[catchwire-agent] New issue: Plugin sandbox escape','Issue #14 opened: vm module sandbox can be bypassed with constructor access.','GitHub issue about vm sandbox security in plugin system.','high','notification',NULL,'rejected',NOW()-INTERVAL '5 hours'),
      ('email-018','${ACC}',NULL,'noreply@stripe.com','Stripe','Your monthly invoice is ready — $199.00','Stripe invoice for April 2026: $199.00. Payment charged on May 1.','Stripe April invoice $199 due May 1.','low','billing',NULL,'rejected',NOW()-INTERVAL '2 hours'),
      ('email-019','${ACC}',NULL,'legal@partnerfirm.com','Legal — PartnerFirm','NDA draft for review — please sign by Friday','Mutual NDA attached. Legal approved. Signature required by Friday EOD.','NDA draft for signature. Deadline Friday EOD.','high','legal','{"reply":"Forwarded to our legal counsel. Will aim to have it signed before Friday.","tokens":278}',NULL,NOW()-INTERVAL '30 minutes'),
      ('email-020','${ACC}',NULL,'aws-billing@amazon.com','AWS Billing','AWS Cost Anomaly Alert — spending 3x above baseline','EC2 costs in us-east-1 are 3x your 7-day baseline. Review running instances immediately.','AWS EC2 cost anomaly: 3x above baseline in us-east-1.','critical','alert','{"reply":null}',NULL,NOW()-INTERVAL '10 minutes')
      ON CONFLICT (id) DO NOTHING
    `);

    // Re-seed webhooks
    await pool.query(`
      INSERT INTO webhooks (url, events, secret, enabled) VALUES
      ('https://n8n.company.com/webhook/catchwire-inbox','["email.received","reply.sent"]','whsec_demo_n8n_secret_abc123',true),
      ('https://hooks.slack.com/services/T00000/B00000/demo_catchwire','["reply.sent","reply.rejected"]','whsec_demo_slack_secret_xyz789',true),
      ('https://api.pagerduty.com/catchwire/critical','["email.received"]','whsec_demo_pd_secret_def456',false),
      ('https://zapier.com/hooks/catch/demo/catchwire-all','["email.received","reply.sent","reply.rejected","email.scheduled"]','whsec_demo_zapier_secret_ghi012',true)
    `);

    // Re-seed sender overrides
    await pool.query(`
      INSERT INTO sender_overrides (account_id, sender_domain, sender_email, autonomy_level, tone, auto_reply, forward_to, priority, enabled) VALUES
      ('${ACC}','partnerfirm.com',NULL,'suggest','formal',false,NULL,10,true),
      ('${ACC}',NULL,'aws-billing@amazon.com','auto','professional',true,'devops@company.com',20,true),
      ('${ACC}','github.com',NULL,'suggest','professional',false,NULL,5,true),
      ('${ACC}',NULL,'newsletter@devdigest.io','auto','professional',false,NULL,1,false),
      ('${ACC}','auditfirm.com',NULL,'consult','formal',false,'security@company.com',30,true)
    `);

    // Re-seed prompt profiles
    await pool.query(`
      INSERT INTO prompt_profiles (account_id, name, description, system_prompt, is_active, scope, intent_type) VALUES
      ('${ACC}','Global Base Prompt','Applied to all emails unless overridden','You are a professional email assistant. Reply concisely and clearly. Match the tone of the sender. Never make up information.',true,'global',NULL),
      ('${ACC}','Support Intent','For customer support emails','You are handling a customer support request. Be empathetic, solution-focused, and offer next steps. Escalate if needed.',true,'intent','support'),
      ('${ACC}','Security Alerts','For security-related emails','This email contains security information. Treat it as high priority. Acknowledge receipt, confirm the team is aware, and request a follow-up call if needed.',false,'intent','security')
      ON CONFLICT DO NOTHING
    `);

    // Re-seed email templates
    await pool.query(`
      INSERT INTO email_templates (name, description, body_template, tone, account_id, times_used) VALUES
      ('Meeting Request','Schedule a meeting with a contact','Hi {{name}},\n\nI hope this finds you well. I would like to schedule a {{duration}} meeting to discuss {{topic}}.\n\nAre you available on {{date}} at {{time}}?\n\nBest regards','professional','${ACC}',12),
      ('Follow-up','Follow up after no response','Hi {{name}},\n\nI wanted to follow up on my previous email regarding {{subject}}. Please let me know if you have had a chance to review it.\n\nThanks','friendly','${ACC}',8),
      ('Invoice Acknowledgement','Acknowledge receipt of an invoice','Hi {{name}},\n\nThank you for sending invoice #{{invoice_number}} for {{amount}}. We have received it and will process payment within {{days}} business days.\n\nBest','professional','${ACC}',5),
      ('Decline Politely','Politely decline a request','Hi {{name}},\n\nThank you for reaching out. Unfortunately, we are unable to proceed with {{request}} at this time. We appreciate your understanding and hope to work together in the future.\n\nBest regards','formal','${ACC}',3),
      ('Quick Confirm','Confirm receipt of something','Hi {{name}},\n\nJust confirming I received your message about {{topic}}. I will get back to you by {{deadline}}.\n\nThanks','casual','${ACC}',19)
      ON CONFLICT DO NOTHING
    `);

    // Re-seed analytics
    await pool.query(`
      INSERT INTO analytics_daily (account_id, date, emails_received, emails_sent, auto_replied)
      SELECT '${ACC}', (CURRENT_DATE - s.i)::date,
             (5 + floor(random()*20))::int,
             (2 + floor(random()*12))::int,
             (1 + floor(random()*8))::int
      FROM generate_series(0,29) AS s(i)
      ON CONFLICT (account_id, date) DO NOTHING
    `);

    // Re-seed scheduled emails
    await pool.query(`
      INSERT INTO scheduled_emails (account_id, to_address, subject, body, send_at, status) VALUES
      ('${ACC}','alice@partnerfirm.com','Partnership call — Tuesday 2pm','Hi Alice, calendar invite for Tuesday at 2pm. Looking forward to our discussion.',NOW()+INTERVAL '2 days','scheduled'),
      ('${ACC}','legal@partnerfirm.com','Re: NDA draft — signed copy','Please find the signed NDA attached. Our legal counsel has approved all terms.',NOW()+INTERVAL '3 days','scheduled'),
      ('${ACC}','recruiter@talent.io','Post-interview feedback — Alex Chen','Following up on the interview with Alex. The team was impressed. We would like to move to the offer stage.',NOW()+INTERVAL '1 day','scheduled'),
      ('${ACC}','cfo@company.com','Q2 budget — formal confirmation','This confirms the Q2 engineering budget increase of 15%. Finance has been notified.',NOW()-INTERVAL '2 days','sent'),
      ('${ACC}','security@auditfirm.com','Security audit — remediation plan','Attached is our remediation plan with timelines for each identified issue.',NOW()-INTERVAL '5 hours','sent'),
      ('${ACC}','billing@acmecorp.com','Subscription renewal confirmation','We would like to proceed with the annual renewal at the discounted rate. Please send the invoice.',NOW()-INTERVAL '1 day','failed')
      ON CONFLICT DO NOTHING
    `);

    // Update thread message counts
    await pool.query(`
      UPDATE threads t SET
        message_count = (SELECT COUNT(*) FROM email_log e WHERE e.thread_id = t.id),
        last_message_at = (SELECT MAX(processed_at) FROM email_log e WHERE e.thread_id = t.id)
      WHERE t.account_id = '${ACC}'
    `);

    logger.info('Demo data reset complete');
  } catch (err) {
    logger.error('Demo data reset failed', { err });
  }
}
