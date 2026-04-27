import { readFileSync } from 'fs';
import { PluginBuilderAgent, type BuildRequest, type BuildResult } from './plugin-builder-agent.ts';
import { PluginRegistry } from './plugin-registry.ts';
import { PluginManager } from '../plugin-manager.ts';
import { logger } from '../../utils/logger.ts';

export class PluginBuilderService {
  private agent:    PluginBuilderAgent;
  private registry: PluginRegistry;

  constructor(
    private llmRouter: any,
    private pluginManager: PluginManager,
  ) {
    this.agent    = new PluginBuilderAgent(llmRouter);
    this.registry = new PluginRegistry();
  }

  /**
   * Full pipeline: user description → built plugin (not yet enabled)
   */
  async buildPlugin(request: BuildRequest): Promise<BuildResult & { saved: boolean }> {
    const result = await this.agent.build(request);

    const entry = this.registry.save(
      result.spec,
      result.pluginMd,
      result.code,
      result.sandboxResult.success,
    );

    logger.info('Plugin built and saved', { name: result.spec.name, ready: result.ready });

    return { ...result, saved: true };
  }

  /**
   * Enable a previously built plugin and register it in the PluginManager.
   */
  async enablePlugin(name: string): Promise<void> {
    const entry = this.registry.get(name);
    if (!entry) throw new Error(`Plugin not found: ${name}`);
    if (!entry.sandboxOk) throw new Error(`Plugin "${name}" failed sandbox tests — cannot enable`);

    this.registry.enable(name);

    // Dynamically load and register
    const plugins = await this.registry.loadEnabled();
    const plugin  = plugins.find((p) => p.name === name);
    if (plugin) {
      this.pluginManager.register(plugin);
      logger.info('Plugin enabled and registered', { name });
    }
  }

  disablePlugin(name: string): void {
    this.registry.disable(name);
    this.pluginManager.unregister(name);
    logger.info('Plugin disabled', { name });
  }

  deletePlugin(name: string): void {
    this.registry.delete(name);
    this.pluginManager.unregister(name);
    logger.info('Plugin deleted', { name });
  }

  listPlugins() {
    return this.registry.list().map((entry) => ({
      name:       entry.spec.name,
      description:entry.spec.description,
      hooks:      entry.spec.hooks,
      enabled:    entry.enabled,
      sandboxOk:  entry.sandboxOk,
      createdAt:  entry.createdAt,
    }));
  }

  getPluginCode(name: string): { code: string; pluginMd: string } | null {
    const entry = this.registry.get(name);
    if (!entry) return null;

    return {
      code:     readFileSync(entry.codePath, 'utf-8'),
      pluginMd: entry.pluginMd,
    };
  }

  /** Load all enabled user plugins at startup */
  async loadAll(): Promise<void> {
    const plugins = await this.registry.loadEnabled();
    for (const plugin of plugins) {
      try {
        this.pluginManager.register(plugin);
      } catch {
        // already registered
      }
    }
    logger.info('User plugins loaded', { count: plugins.length });
  }
}
