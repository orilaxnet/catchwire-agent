import { h } from 'preact';
import { useEffect } from 'preact/hooks';
import { Sparkline } from '../components/Sparkline.tsx';
import { stats, selectedAccount } from '../signals/store.ts';
import { api } from '../api/client.ts';

export function Analytics() {
  useEffect(() => {
    if (!selectedAccount.value) return;
    api.accounts.stats(selectedAccount.value)
      .then((data) => { stats.value = data; })
      .catch(console.error);
  }, [selectedAccount.value]);

  const s = stats.value;
  if (!s) {
    return (
      <div class="empty-state">
        <span class="material-symbols-rounded">bar_chart</span>
        <p>No analytics data yet</p>
      </div>
    );
  }

  const totalEmails = s.last30Days.reduce((sum, d) => sum + d.totalEmails, 0);
  const autoSent    = s.last30Days.reduce((sum, d) => sum + d.autoSent, 0);
  const autoPct     = totalEmails > 0 ? Math.round((autoSent / totalEmails) * 100) : 0;
  const sparkData   = s.last30Days.map((d) => d.totalEmails);

  return (
    <div>
      <div class="section-header">Last 30 Days</div>

      <div class="kpi-grid">
        <div class="kpi-tile">
          <div class="kpi-value">{totalEmails}</div>
          <div class="kpi-label">Total Emails</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-value">{autoPct}%</div>
          <div class="kpi-label">Auto-Sent</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-value">{Math.round(s.acceptedRatio * 100)}%</div>
          <div class="kpi-label">Acceptance Rate</div>
        </div>
        <div class="kpi-tile">
          <div class="kpi-value">{Math.round(s.avgResponseMs)}ms</div>
          <div class="kpi-label">Avg Response</div>
        </div>
      </div>

      <div class="section-header">Daily Volume</div>
      <div style="background:var(--surface-2);border-radius:var(--r-md);padding:16px;margin-bottom:24px">
        <Sparkline data={sparkData} width={600} height={80} />
      </div>

      {s.topSenders.length > 0 && (
        <>
          <div class="section-header">Top Senders</div>
          {s.topSenders.map((sender) => (
            <div key={sender.sender} style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
              <span>{sender.sender}</span>
              <span style="color:var(--text-muted)">{sender.count}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
