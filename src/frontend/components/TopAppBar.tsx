import { h } from 'preact';
import { AccountSwitcher } from './AccountSwitcher.tsx';
import { PageInfo, PageInfoContent } from './PageInfo.tsx';

export function TopAppBar({
  title, info, onChatToggle, chatOpen,
}: {
  title: string;
  info?: PageInfoContent;
  onChatToggle?: () => void;
  chatOpen?: boolean;
}) {
  return (
    <header class="top-app-bar">
      <span class="title">{title}</span>
      <AccountSwitcher />
      {info && <PageInfo info={info} />}
      <button class="icon-btn" title="Refresh" onClick={() => window.location.reload()}>
        <span class="material-symbols-rounded">refresh</span>
      </button>
      {onChatToggle && (
        <button
          class={`chat-toggle-btn${chatOpen ? ' active' : ''}`}
          onClick={onChatToggle}
          title="Agent Chat"
        >
          <span class="material-symbols-rounded">smart_toy</span>
        </button>
      )}
    </header>
  );
}
