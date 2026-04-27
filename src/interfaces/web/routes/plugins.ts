import { Router } from 'express';
import { PluginBuilderService } from '../../../plugins/builder/plugin-builder.service.ts';
import { logger } from '../../../utils/logger.ts';

export function createPluginRouter(builderService: PluginBuilderService): Router {
  const router = Router();

  /** GET /api/plugins — list all user plugins */
  router.get('/', (_req, res) => {
    res.json(builderService.listPlugins());
  });

  /** POST /api/plugins/build — build a new plugin from description */
  router.post('/build', async (req, res) => {
    const { description, accountId } = req.body as { description: string; accountId: string };

    if (!description?.trim()) {
      res.status(400).json({ error: 'description is required' });
      return;
    }

    if (description.length > 2048) {
      res.status(400).json({ error: 'description exceeds maximum length of 2048 characters' });
      return;
    }

    try {
      const result = await builderService.buildPlugin({
        userDescription: description,
        accountId:       accountId ?? 'web-user',
      });

      res.json({
        name:           result.spec.name,
        description:    result.spec.description,
        hooks:          result.spec.hooks,
        permissions:    result.spec.permissions,
        pluginMd:       result.pluginMd,
        code:           result.code,
        analysisReport: result.analysisReport,
        sandboxResult:  result.sandboxResult,
        ready:          result.ready,
      });
    } catch (err: any) {
      logger.error('Plugin build error', { err });
      res.status(500).json({ error: 'Plugin build failed' });
    }
  });

  /** POST /api/plugins/:name/enable */
  router.post('/:name/enable', async (req, res) => {
    try {
      await builderService.enablePlugin(req.params.name);
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Plugin enable error', { name: req.params.name, err });
      res.status(400).json({ error: 'Could not enable plugin' });
    }
  });

  /** POST /api/plugins/:name/disable */
  router.post('/:name/disable', (req, res) => {
    try {
      builderService.disablePlugin(req.params.name);
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Plugin disable error', { name: req.params.name, err });
      res.status(400).json({ error: 'Could not disable plugin' });
    }
  });

  /** DELETE /api/plugins/:name */
  router.delete('/:name', (req, res) => {
    try {
      builderService.deletePlugin(req.params.name);
      res.json({ ok: true });
    } catch (err: any) {
      logger.error('Plugin delete error', { name: req.params.name, err });
      res.status(400).json({ error: 'Could not delete plugin' });
    }
  });

  /** GET /api/plugins/:name/code */
  router.get('/:name/code', (req, res) => {
    const result = builderService.getPluginCode(req.params.name);
    if (!result) { res.status(404).json({ error: 'Plugin not found' }); return; }
    res.json(result);
  });

  return router;
}
