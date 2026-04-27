import { h } from 'preact';
import { useSignal } from '@preact/signals';
import { useEffect, useRef } from 'preact/hooks';

export interface PageInfoContent {
  description: string;
  actions: string[];
}

export function PageInfo({ info }: { info: PageInfoContent }) {
  const open = useSignal(false);
  const ref  = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        open.value = false;
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <div ref={ref} style="position:relative;display:inline-flex">
      <button
        class="icon-btn"
        title="Page info"
        onClick={() => { open.value = !open.value; }}
        style={open.value ? 'color:var(--accent);background:var(--accent-subtle)' : ''}
      >
        <span class="material-symbols-rounded">info</span>
      </button>

      {open.value && (
        <div style={`
          position:absolute;top:calc(100% + 8px);right:0;
          width:280px;background:var(--surface);
          border:1px solid var(--border);border-radius:var(--r-lg);
          box-shadow:0 8px 24px rgba(0,0,0,.12);
          padding:16px;z-index:200;
        `}>
          <div style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:.06em;margin-bottom:8px">
            ABOUT THIS PAGE
          </div>
          <p style="font-size:13px;color:var(--text-primary);line-height:1.6;margin-bottom:12px">
            {info.description}
          </p>
          <div style="font-size:12px;font-weight:700;color:var(--text-muted);letter-spacing:.06em;margin-bottom:8px">
            WHAT YOU CAN DO
          </div>
          <ul style="list-style:none;display:flex;flex-direction:column;gap:6px">
            {info.actions.map((a, i) => (
              <li key={i} style="display:flex;gap:8px;align-items:flex-start">
                <span class="material-symbols-rounded" style="font-size:14px;color:var(--accent);flex-shrink:0;margin-top:1px">
                  check_circle
                </span>
                <span style="font-size:13px;color:var(--text-secondary);line-height:1.5">{a}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
