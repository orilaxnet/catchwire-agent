import { h } from 'preact';
import { useSignal } from '@preact/signals';
import { PriorityBadge } from './PriorityBadge.tsx';
import { expandedEmail } from '../signals/store.ts';
import { api } from '../api/client.ts';
import type { EmailItem } from '../api/client.ts';

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface Reply { label: string; body: string; }

export function EmailCard({ email, onAction }: { email: EmailItem; onAction?: () => void }) {
  const isExpanded  = expandedEmail.value === email.id;
  const showEdit    = useSignal(false);
  const editBody    = useSignal('');
  const sending     = useSignal(false);
  const sentMsg     = useSignal('');
  const analysis    = email.agent_response as any;
  const replies: Reply[] = analysis?.suggestedReplies ?? [];

  const toggle = () => {
    expandedEmail.value = isExpanded ? null : email.id;
    showEdit.value = false;
    sentMsg.value  = '';
  };

  const sendReply = async (e: Event, body: string) => {
    e.stopPropagation();
    if (sending.value) return;
    sending.value = true;
    try {
      await api.emails.reply(email.id, body);
      await api.actions.send(email.id);
      sentMsg.value = '✅ Sent';
      onAction?.();
    } catch (err: any) {
      sentMsg.value = `❌ ${err.message}`;
    } finally {
      sending.value = false;
    }
  };

  const sendEdit = async (e: Event) => {
    e.stopPropagation();
    if (!editBody.value.trim() || sending.value) return;
    await sendReply(e, editBody.value);
    showEdit.value = false;
  };

  const ignore = async (e: Event) => {
    e.stopPropagation();
    try {
      await api.actions.ignore(email.id);
      sentMsg.value = '🚫 Ignored';
      onAction?.();
    } catch {}
  };

  const priorityBorderColor: Record<string, string> = {
    critical: 'var(--c-critical)',
    high:     'var(--c-high)',
    medium:   'var(--c-medium)',
    low:      'transparent',
  };

  return (
    <div
      class={`inbox-item ${isExpanded ? 'expanded' : ''}`}
      style={`border-left:3px solid ${priorityBorderColor[email.priority] ?? 'transparent'}`}
      onClick={toggle}
    >
      <div class="inbox-item-header">
        <PriorityBadge priority={email.priority} />
        <span class="inbox-sender">{email.sender_name || email.from_address}</span>
        <span class="inbox-time">{timeAgo(email.created_at)}</span>
        {email.user_action && (
          <span class="chip" style="font-size:10px">{email.user_action}</span>
        )}
      </div>

      <div class="inbox-subject">{email.subject}</div>

      {email.summary && (
        <div class="inbox-summary">{email.summary}</div>
      )}

      {email.intent && (
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
          Intent: <strong>{email.intent}</strong>
          {analysis?.confidence != null && (
            <> · Confidence: <strong>{Math.round(analysis.confidence * 100)}%</strong></>
          )}
        </div>
      )}

      {sentMsg.value && (
        <div style="margin-top:8px;font-size:13px;color:var(--accent)">{sentMsg.value}</div>
      )}

      {isExpanded && !sentMsg.value && (
        <div onClick={(e) => e.stopPropagation()}>
          {replies.length > 0 && (
            <div style="margin-top:12px">
              <div style="font-size:11px;font-weight:700;color:var(--text-muted);margin-bottom:8px;letter-spacing:.05em">
                AI SUGGESTED REPLIES
              </div>
              {replies.map((r, i) => (
                <div key={i} style="background:var(--surface-2);border-radius:var(--r-md);padding:12px;margin-bottom:8px">
                  <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:4px">{r.label}</div>
                  <div style="font-size:13px;white-space:pre-wrap">{r.body}</div>
                  <button
                    class="btn btn-primary"
                    style="margin-top:8px;font-size:12px;padding:4px 12px"
                    onClick={(e) => sendReply(e, r.body)}
                    disabled={sending.value}
                  >
                    {sending.value ? 'Sending…' : `Send: ${r.label}`}
                  </button>
                </div>
              ))}
            </div>
          )}

          {showEdit.value ? (
            <div style="margin-top:12px">
              <textarea
                class="edit-area"
                rows={5}
                style="width:100%;resize:vertical"
                value={editBody.value}
                onInput={(e) => { editBody.value = (e.target as HTMLTextAreaElement).value; }}
                placeholder="Write your reply…"
              />
              <div style="display:flex;gap:8px;margin-top:8px">
                <button class="btn btn-primary" onClick={sendEdit} disabled={sending.value}>
                  {sending.value ? 'Sending…' : 'Send Reply'}
                </button>
                <button class="btn btn-outline" onClick={() => { showEdit.value = false; }}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style="display:flex;gap:8px;margin-top:12px">
              <button class="btn btn-outline" onClick={() => {
                editBody.value = replies[0]?.body ?? '';
                showEdit.value = true;
              }}>
                <span class="material-symbols-rounded" style="font-size:16px">edit</span>
                Edit & Send
              </button>
              <button class="btn btn-ghost" onClick={ignore}>Ignore</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
