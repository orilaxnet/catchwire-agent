import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActionController } from '../../src/action/controller.ts';
import type { ParsedEmail } from '../../src/types/index.ts';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/sqlite.adapter.ts', () => ({
  getDB: () => ({
    prepare: () => ({ get: () => null, run: () => {}, all: () => [] }),
  }),
  EmailLogRepo: { insert: vi.fn(), recordAction: vi.fn() },
  FeedbackRepo:  { insert: vi.fn() },
  AccountRepo:   { logEmail: vi.fn() },
}));

vi.mock('../../src/services/webhook-dispatcher.ts', () => ({
  webhookDispatcher: { dispatch: vi.fn() },
}));

vi.mock('../../src/services/email-sender.ts', () => ({
  EmailSender: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({ success: true, messageId: 'mid-1' }),
  })),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const mockLLMRouter = {
  completeWithRetry: vi.fn(),
  complete: vi.fn(),
};

const mockInterfaceManager = {
  sendToUser: vi.fn().mockResolvedValue(undefined),
};

const mockPluginManager = {
  runTransformHook: vi.fn().mockImplementation((_hook: string, arg: any) => Promise.resolve(arg)),
  runHook:          vi.fn().mockResolvedValue(undefined),
};

const mockDB = {
  prepare: () => ({
    get:  () => ({ id: 'user-1', autonomy_level: 'draft', llm_provider: 'openrouter', llm_model: 'gpt-4o', llm_api_key_enc: null }),
    run:  () => {},
    all:  () => [],
  }),
};

const defaultAnalysis = {
  intent:           'question',
  priority:         'medium' as const,
  confidence:       0.9,
  summary:          'Test email summary',
  suggestedReplies: [
    { label: 'Reply 1', body: 'Hi there, thanks for reaching out.' },
  ],
  needsHumanReview: false,
  entities:         { dates: [], amounts: [], actionItems: [] },
};

function makeEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    id:                  'email-1',
    accountId:           'acc-1',
    originalSender:      'sender@example.com',
    originalSenderName:  'Sender',
    subject:             'Test Subject',
    body:                'Test email body',
    originalDate:        new Date(),
    parseMethod:         'regex',
    parseConfidence:     1,
    rawContent:          'raw',
    headers:             {},
    addresses:           [],
    ...overrides,
  };
}

function makeController() {
  return new ActionController({
    db:               mockDB as any,
    llmRouter:        mockLLMRouter as any,
    interfaceManager: mockInterfaceManager as any,
    pluginManager:    mockPluginManager as any,
    encryption:       {} as any,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ActionController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLLMRouter.completeWithRetry.mockResolvedValue(defaultAnalysis);
  });

  it('processes a normal email and notifies the user', async () => {
    const controller = makeController();
    await controller.processEmail(makeEmail());

    expect(mockInterfaceManager.sendToUser).toHaveBeenCalledOnce();
    const [, message] = mockInterfaceManager.sendToUser.mock.calls[0];
    expect(message.text).toContain('Test email summary');
  });

  it('dispatches email.received webhook on every email', async () => {
    const { webhookDispatcher } = await import('../../src/services/webhook-dispatcher.ts');
    const controller = makeController();
    await controller.processEmail(makeEmail());
    expect(webhookDispatcher.dispatch).toHaveBeenCalledWith('email.received', expect.any(Object));
  });

  it('dispatches priority.critical webhook for critical emails', async () => {
    mockLLMRouter.completeWithRetry.mockResolvedValue({
      ...defaultAnalysis, priority: 'critical',
    });

    const { webhookDispatcher } = await import('../../src/services/webhook-dispatcher.ts');
    const controller = makeController();
    await controller.processEmail(makeEmail());

    const calls = (webhookDispatcher.dispatch as any).mock.calls.map((c: any) => c[0]);
    expect(calls).toContain('priority.critical');
  });

  it('does not throw when LLM call fails — logs error and continues', async () => {
    mockLLMRouter.completeWithRetry.mockRejectedValue(new Error('LLM unavailable'));
    const controller = makeController();
    await expect(controller.processEmail(makeEmail())).resolves.not.toThrow();
  });

  it('runs plugin hooks before and after processing', async () => {
    const controller = makeController();
    await controller.processEmail(makeEmail());

    expect(mockPluginManager.runTransformHook).toHaveBeenCalledWith(
      'beforeEmailProcess', expect.any(Object)
    );
    expect(mockPluginManager.runHook).toHaveBeenCalledWith(
      'afterEmailProcess', expect.any(Object), expect.any(Object)
    );
  });
});
