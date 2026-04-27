import { PersonaManager } from './persona-manager.ts';
import { StyleExtractor }  from './style-extractor.ts';
import type { ToneType, AutonomyLevel } from '../types/index.ts';

export class ColdStart {
  constructor(
    private personaManager: PersonaManager,
    private styleExtractor: StyleExtractor,
  ) {}

  async applyTone(accountId: string, tone: ToneType): Promise<void> {
    this.personaManager.update(accountId, { tone });
  }

  async applyAutonomy(accountId: string, level: AutonomyLevel): Promise<void> {
    this.personaManager.update(accountId, { autonomyLevel: level });
  }

  async applyStyleSamples(accountId: string, samples: string[]): Promise<string> {
    if (samples.length < 1) throw new Error('At least one sample required');

    this.personaManager.setStyleSamples(accountId, samples);
    const dna = await this.styleExtractor.extract(samples);
    this.personaManager.update(accountId, { styleDna: dna });

    return dna;
  }

  async finalize(accountId: string): Promise<void> {
    this.personaManager.update(accountId, {
      onboardingDone: true,
      shadowMode:     true,   // shadow mode stays active for the first week
    });
  }

  async exitShadowMode(accountId: string): Promise<void> {
    this.personaManager.update(accountId, { shadowMode: false });
  }
}
