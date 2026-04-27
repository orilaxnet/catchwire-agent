import { h } from 'preact';

const ITEMS = [
  { icon: 'inbox',         label: 'Inbox',      href: '/agent/inbox'           },
  { icon: 'forum',         label: 'Threads',    href: '/agent/threads'         },
  { icon: 'bar_chart',     label: 'Analytics',  href: '/agent/analytics'       },
  { icon: 'description',   label: 'Templates',  href: '/agent/email-templates' },
  { icon: 'psychology',    label: 'Prompts',    href: '/agent/templates'       },
  { icon: 'schedule_send', label: 'Scheduled',  href: '/agent/scheduled'       },
  { icon: 'webhook',       label: 'Webhooks',   href: '/agent/webhooks'        },
  { icon: 'extension',     label: 'Plugins',    href: '/agent/plugins'         },
  { icon: 'tune',          label: 'Overrides',  href: '/agent/overrides'       },
  { icon: 'smart_toy',     label: 'Playground', href: '/agent/playground'      },
];

export function NavRail({ currentPath }: { currentPath: string }) {
  return (
    <nav class="nav-rail">
      <div class="nav-logo">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M4 8l8 5 8-5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
          <rect x="2" y="6" width="20" height="14" rx="2" stroke="#fff" stroke-width="2" fill="none"/>
        </svg>
      </div>

      {ITEMS.map((item) => (
        <a
          key={item.href}
          href={item.href}
          class={`nav-item ${currentPath === item.href ? 'active' : ''}`}
          data-label={item.label}
          title={item.label}
        >
          <span class="material-symbols-rounded">{item.icon}</span>
        </a>
      ))}

      <div class="nav-spacer" />

      <a href="/agent/settings" class={`nav-item ${currentPath === '/agent/settings' ? 'active' : ''}`}
        data-label="Settings" title="Settings">
        <span class="material-symbols-rounded">settings</span>
      </a>
    </nav>
  );
}
