import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { logger } from '../../utils/logger.ts';
import type { PluginSpec } from './plugin-spec.ts';
import type { IPlugin } from '../plugin-manager.ts';

export interface RegistryEntry {
  id:          string;
  spec:        PluginSpec;
  pluginMd:    string;
  codePath:    string;
  createdAt:   string;
  updatedAt:   string;
  sandboxOk:   boolean;
  enabled:     boolean;
}

const REGISTRY_DIR = process.env.PLUGINS_DIR ?? './data/plugins';

/**
 * Local plugin registry — stores plugin files on disk and loads them at runtime.
 *
 * Directory structure:
 *   data/plugins/
 *     <plugin-name>/
 *       PLUGIN.md      ← human-readable spec
 *       plugin.ts      ← generated TypeScript code
 *       meta.json      ← registry metadata
 */
export class PluginRegistry {
  constructor(private dir: string = REGISTRY_DIR) {
    mkdirSync(this.dir, { recursive: true });
  }

  save(spec: PluginSpec, pluginMd: string, code: string, sandboxOk: boolean): RegistryEntry {
    const pluginDir = join(this.dir, spec.name);
    mkdirSync(pluginDir, { recursive: true });

    const codePath = join(pluginDir, 'plugin.ts');
    writeFileSync(join(pluginDir, 'PLUGIN.md'), pluginMd, 'utf-8');
    writeFileSync(codePath, code, 'utf-8');

    const meta: RegistryEntry = {
      id:        randomUUID(),
      spec,
      pluginMd,
      codePath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sandboxOk,
      enabled:   false,
    };

    writeFileSync(join(pluginDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    logger.info('Plugin saved to registry', { name: spec.name, dir: pluginDir });
    return meta;
  }

  enable(name: string): void {
    this.updateMeta(name, (m) => ({ ...m, enabled: true, updatedAt: new Date().toISOString() }));
  }

  disable(name: string): void {
    this.updateMeta(name, (m) => ({ ...m, enabled: false, updatedAt: new Date().toISOString() }));
  }

  delete(name: string): void {
    const pluginDir = join(this.dir, name);
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true });
      logger.info('Plugin deleted from registry', { name });
    }
  }

  list(): RegistryEntry[] {
    if (!existsSync(this.dir)) return [];

    return readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const metaPath = join(this.dir, d.name, 'meta.json');
        if (!existsSync(metaPath)) return null;
        return JSON.parse(readFileSync(metaPath, 'utf-8')) as RegistryEntry;
      })
      .filter(Boolean) as RegistryEntry[];
  }

  get(name: string): RegistryEntry | null {
    const metaPath = join(this.dir, name, 'meta.json');
    if (!existsSync(metaPath)) return null;
    return JSON.parse(readFileSync(metaPath, 'utf-8')) as RegistryEntry;
  }

  /** Load enabled plugins as IPlugin instances (dynamic import of generated code) */
  async loadEnabled(): Promise<IPlugin[]> {
    const plugins: IPlugin[] = [];

    for (const entry of this.list().filter((e) => e.enabled)) {
      try {
        const mod = await import(entry.codePath);
        const Cls = mod.default ?? Object.values(mod)[0];
        if (typeof Cls === 'function') {
          const instance = new Cls();
          plugins.push(instance);
          logger.info('Loaded user plugin', { name: entry.spec.name });
        }
      } catch (err) {
        logger.error('Failed to load user plugin', { name: entry.spec.name, err });
      }
    }

    return plugins;
  }

  private updateMeta(name: string, fn: (m: RegistryEntry) => RegistryEntry): void {
    const metaPath = join(this.dir, name, 'meta.json');
    if (!existsSync(metaPath)) throw new Error(`Plugin not found: ${name}`);
    const current = JSON.parse(readFileSync(metaPath, 'utf-8')) as RegistryEntry;
    writeFileSync(metaPath, JSON.stringify(fn(current), null, 2), 'utf-8');
  }
}
