import { h } from 'preact';
import { AccountSwitcher } from './AccountSwitcher.tsx';
import { PageInfo, PageInfoContent } from './PageInfo.tsx';

export function TopAppBar({ title, info }: { title: string; info?: PageInfoContent }) {
  return (
    <header class="top-app-bar">
      <span class="title">{title}</span>
      <AccountSwitcher />
      {info && <PageInfo info={info} />}
      <button class="icon-btn" title="Refresh" onClick={() => window.location.reload()}>
        <span class="material-symbols-rounded">refresh</span>
      </button>
    </header>
  );
}
