import { h } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useSignal } from '@preact/signals';
import { api } from '../api/client.ts';
import { selectedAccount } from '../signals/store.ts';

interface ChatMessage {
  id:        string;
  role:      'user' | 'assistant';
  content:   string;
  action?:   string;
  task?:     any;
  pending?:  boolean;
}

function uid() {
  return Math.random().toString(36).slice(2);
}

function MarkdownText({ text }: { text: string }) {
  // Security note: HTML is fully escaped FIRST (& < >) before any markup tags are
  // introduced. The regex capture groups therefore only ever contain escaped text —
  // no raw HTML from LLM output can reach the browser unescaped.
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/gs,    '<em>$1</em>')
    .replace(/`(.+?)`/gs,      '<code>$1</code>')
    .replace(/\n• /g, '\n<span class="chat-bullet">•</span> ')
    .replace(/\n/g, '<br>');
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function AgentChat({ open, onClose }: { open: boolean; onClose: () => void }) {
  const messages    = useSignal<ChatMessage[]>([{
    id: 'welcome', role: 'assistant',
    content: "Hi! I'm your email agent. Ask me anything or give me a task:\n• *\"Find all emails from Alex\"*\n• *\"Unsubscribe all newsletters\"*\n• *\"Summarize my invoices\"*\n• *\"Forward emails from Sarah to bob@co.com\"*",
  }]);
  const input       = useSignal('');
  const loading     = useSignal(false);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.value.length]);

  async function send() {
    const text = input.value.trim();
    if (!text || loading.value) return;

    const accountId = selectedAccount.value;
    if (!accountId) { alert('Select an account first'); return; }

    input.value  = '';
    loading.value = true;

    const history = messages.value
      .filter(m => m.role === 'user' || (m.role === 'assistant' && !m.pending))
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content }));

    messages.value = [...messages.value,
      { id: uid(), role: 'user',      content: text },
      { id: uid(), role: 'assistant', content: '…',  pending: true },
    ];

    try {
      const data = await api.chat.send(accountId, text, history);
      messages.value = [
        ...messages.value.slice(0, -1),
        { id: uid(), role: 'assistant', content: data.reply, action: data.action, task: data.task },
      ];
    } catch {
      messages.value = [
        ...messages.value.slice(0, -1),
        { id: uid(), role: 'assistant', content: 'Sorry, something went wrong. Please try again.' },
      ];
    } finally {
      loading.value = false;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  async function confirmTask(task: any) {
    const accountId = selectedAccount.value;
    if (!accountId) return;

    loading.value = true;
    messages.value = [...messages.value, { id: uid(), role: 'assistant', content: '⚙️ Working on it…', pending: true }];

    try {
      const data = await api.chat.execute(accountId, task);
      messages.value = [
        ...messages.value.slice(0, -1),
        { id: uid(), role: 'assistant', content: data.reply || 'Done!' },
      ];
    } catch {
      messages.value = [
        ...messages.value.slice(0, -1),
        { id: uid(), role: 'assistant', content: '❌ Execution failed. Please try again.' },
      ];
    } finally {
      loading.value = false;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  const SUGGESTIONS = [
    'Summarize my invoices',
    'Find emails from Alex',
    'Unsubscribe all newsletters',
    'What needs action today?',
  ];

  return (
    <aside class={`agent-chat${open ? ' open' : ''}`}>
      {/* Header */}
      <div class="chat-header">
        <div class="chat-header-title">
          <span class="material-symbols-rounded" style="font-size:18px;color:var(--accent)">smart_toy</span>
          <span>Agent Chat</span>
        </div>
        <button class="icon-btn" onClick={onClose} title="Close">
          <span class="material-symbols-rounded">close</span>
        </button>
      </div>

      {/* Messages */}
      <div class="chat-messages">
        {messages.value.map(msg => (
          <div key={msg.id} class={`chat-msg ${msg.role}${msg.pending ? ' pending' : ''}`}>
            {msg.role === 'assistant' && (
              <span class="chat-avatar">
                <span class="material-symbols-rounded" style="font-size:14px">smart_toy</span>
              </span>
            )}
            <div class="chat-bubble">
              {msg.pending
                ? <span class="chat-dots"><span /><span /><span /></span>
                : <MarkdownText text={msg.content} />
              }
              {msg.action === 'confirm' && msg.task && !msg.pending && (
                <div class="chat-confirm-btns">
                  <button class="chat-confirm-yes" onClick={() => confirmTask(msg.task)}>
                    <span class="material-symbols-rounded" style="font-size:15px">check</span>
                    Yes, do it
                  </button>
                  <button class="chat-confirm-no" onClick={() => {
                    messages.value = [...messages.value, { id: uid(), role: 'assistant', content: 'Cancelled.' }];
                    // Remove the task from this message so buttons disappear
                    messages.value = messages.value.map(m =>
                      m.id === msg.id ? { ...m, task: undefined, action: 'done' } : m
                    );
                  }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick suggestions (shown only when just the welcome message) */}
      {messages.value.length === 1 && (
        <div class="chat-suggestions">
          {SUGGESTIONS.map(s => (
            <button key={s} class="chat-suggestion" onClick={() => { input.value = s; send(); }}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div class="chat-input-row">
        <textarea
          ref={inputRef}
          class="chat-input"
          placeholder="Ask or give a task…"
          value={input.value}
          onInput={(e) => { input.value = (e.target as HTMLTextAreaElement).value; }}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={loading.value}
        />
        <button class="chat-send-btn" onClick={send} disabled={loading.value || !input.value.trim()}>
          <span class="material-symbols-rounded">send</span>
        </button>
      </div>
    </aside>
  );
}
