import { z } from 'zod';
import yaml from 'js-yaml';

export const PluginPermissionsSchema = z.object({
  network:   z.array(z.string()).default([]),
  env:       z.array(z.string()).default([]),
  storage:   z.boolean().default(false),
  emailSend: z.boolean().default(false),
});

export const PluginSpecSchema = z.object({
  name:        z.string().regex(/^[a-z0-9-]+$/, 'lowercase-kebab-case only'),
  version:     z.string().default('1.0.0'),
  author:      z.string().optional(),
  description: z.string(),
  permissions: PluginPermissionsSchema,
  hooks: z.array(z.enum([
    'beforeEmailProcess',
    'afterEmailProcess',
    'beforeSendReply',
    'afterSendReply',
    'onFeedback',
  ])),
  enabled: z.boolean().default(true),
});

export type PluginSpec    = z.infer<typeof PluginSpecSchema>;
export type PluginPerms   = z.infer<typeof PluginPermissionsSchema>;

/** Parse PLUGIN.md frontmatter + body */
export function parsePluginSpec(markdown: string): { spec: PluginSpec; body: string } {
  const match = markdown.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('Invalid PLUGIN.md: missing frontmatter');

  const raw  = yaml.load(match[1]);
  const spec = PluginSpecSchema.parse(raw);
  return { spec, body: match[2].trim() };
}

/** Render a PluginSpec to PLUGIN.md format */
export function renderPluginMd(spec: PluginSpec, body: string): string {
  return `---\n${yaml.dump(spec).trim()}\n---\n\n${body}`;
}
