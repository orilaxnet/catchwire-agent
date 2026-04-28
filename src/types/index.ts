// ─────────────────────────────────────────────────────────────
// Core Types — Email Agent
// ─────────────────────────────────────────────────────────────

export type Priority      = 'critical' | 'high' | 'medium' | 'low';
export type AutonomyLevel = 'full' | 'draft' | 'consultative';
export type AccountType   = 'gmail' | 'outlook' | 'imap' | 'forward';
export type ToneType      = 'very_formal' | 'professional' | 'friendly' | 'casual';
export type LanguageCode  = 'fa' | 'en' | 'auto';

export type EmailIntent =
  | 'action_required'
  | 'question'
  | 'complaint'
  | 'fyi'
  | 'deadline'
  | 'payment'
  | 'follow_up'
  | 'meeting_request'
  | 'order_tracking'
  | 'marketing'
  | 'newsletter';

// ─────────────────────────────────────────────────────────────
// Raw Email (from Ingestion Layer)
// ─────────────────────────────────────────────────────────────

export interface RawEmail {
  id: string;
  accountId: string;
  receivedAt: Date;
  source: AccountType;
  raw: string;
  headers: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────
// Parsed Email (from Parser Layer)
// ─────────────────────────────────────────────────────────────

export interface ParsedEmail {
  id: string;
  accountId: string;

  originalSender: string;
  originalSenderName: string;
  recipientEmail: string;
  originalDate: Date;
  subject: string;

  bodyText: string;
  bodyHtml?: string;
  quotedHistory?: string[];
  attachments: Attachment[];

  threadId?: string;
  inReplyTo?: string;
  references?: string[];

  isForwarded: boolean;
  parseMethod: 'regex' | 'llm';
  parseConfidence: number;
}

export interface Attachment {
  filename: string;
  contentType: string;
  size: number;
  contentId?: string;
}

// ─────────────────────────────────────────────────────────────
// Agent Response (from LLM Brain)
// ─────────────────────────────────────────────────────────────

export interface AgentResponse {
  priority: Priority;
  intent: EmailIntent;
  summary: string;

  suggestedReplies: SuggestedReply[];

  extractedData: {
    deadlines?: string[];
    amounts?: string[];
    actionItems?: string[];
    orderIds?: string[];
    meetingTimes?: string[];
    people?: string[];
    location?: string;
  };

  confidence: number;
}

export interface SuggestedReply {
  label: string;
  body: string;
  tone: string;
}

// ─────────────────────────────────────────────────────────────
// Email Thread
// ─────────────────────────────────────────────────────────────

export interface EmailThread {
  id: string;
  accountId: string;
  subject: string;
  participants: string[];
  messages: ThreadMessage[];

  messageCount: number;
  summary?: string;
  summaryAt?: Date;

  entities: ThreadEntities;

  status: 'active' | 'waiting_response' | 'closed';
  waitingOn: 'user' | 'sender' | null;

  firstMessageAt: Date;
  lastMessageAt: Date;
}

export interface ThreadMessage {
  messageId: string;
  from: string;
  to: string[];
  cc?: string[];
  date: Date;
  body: string;
  intent?: EmailIntent;
  sentiment?: 'positive' | 'neutral' | 'negative';
  actionItems?: string[];
}

export interface ThreadEntities {
  people: string[];
  dates: string[];
  amounts: string[];
  products: string[];
  documents: string[];
  actionItems: string[];
}

// ─────────────────────────────────────────────────────────────
// User & Account
// ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  telegramId: string;
  name: string;
  createdAt: Date;
}

export interface EmailAccount {
  id: string;
  userId: string;
  emailAddress: string;
  displayName?: string;
  accountType: AccountType;
  enabled: boolean;
  priority: number;
  pollingIntervalMin?: number;
  stats: AccountStats;
  createdAt: Date;
}

export interface AccountStats {
  totalEmails: number;
  lastSyncAt?: Date;
  errorCount: number;
}

// ─────────────────────────────────────────────────────────────
// Persona
// ─────────────────────────────────────────────────────────────

export interface Persona {
  accountId: string;
  tone: ToneType;
  useEmoji: boolean;
  language: LanguageCode;
  autonomyLevel: AutonomyLevel;
  styleSamples?: string[];
  styleDna?: string;
  systemPrompt?: string;
  llmConfig: LLMConfig;
  onboardingDone: boolean;
  shadowMode: boolean;
}

// ─────────────────────────────────────────────────────────────
// LLM Config
// ─────────────────────────────────────────────────────────────

export type LLMProvider = 'openai' | 'gemini' | 'claude' | 'openrouter' | 'ollama' | 'custom' | 'grok';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  fallback?: LLMConfig;
  temperature?: number;
  maxTokens?: number;
}

// ─────────────────────────────────────────────────────────────
// Feedback
// ─────────────────────────────────────────────────────────────

export type UserAction =
  | 'sent_as_is'
  | 'sent_modified'
  | 'sent_custom'
  | 'ignored'
  | 'wrong_priority'
  | 'wrong_category';

export interface FeedbackRecord {
  id: string;
  emailLogId: string;
  accountId: string;
  prediction: AgentResponse;
  userAction: UserAction;
  userCorrection?: Partial<AgentResponse>;
  wasCorrect?: boolean;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Template
// ─────────────────────────────────────────────────────────────

export interface EmailTemplate {
  id: string;
  userId: string;
  accountId?: string;
  name: string;
  description?: string;

  trigger: {
    intentMatch?: EmailIntent[];
    keywordMatch?: string[];
    senderDomain?: string;
    subjectContains?: string;
  };

  content: {
    subjectTemplate?: string;
    bodyTemplate: string;
    tone: ToneType;
    language: LanguageCode;
  };

  variables: TemplateVariable[];

  stats: {
    timesUsed: number;
    acceptanceRate: number;
    lastUsedAt?: Date;
  };
}

export interface TemplateVariable {
  name: string;
  type: 'text' | 'number' | 'date' | 'email' | 'auto';
  source:
    | { type: 'extract_from_email'; pattern: string }
    | { type: 'ask_user' }
    | { type: 'database_query'; query: string }
    | { type: 'api_call'; endpoint: string }
    | { type: 'llm_extract' }
    | { type: 'auto' };
  required: boolean;
  default?: string;
}

// ─────────────────────────────────────────────────────────────
// Scheduling
// ─────────────────────────────────────────────────────────────

export type ScheduleReason = 'user_request' | 'business_hours' | 'optimal_time' | 'follow_up';
export type ScheduleStatus = 'scheduled' | 'sent' | 'cancelled';

export interface ScheduledEmail {
  id: string;
  accountId: string;
  emailLogId?: string;
  recipient: string;
  subject?: string;
  body: string;
  scheduledFor: Date;
  reason: ScheduleReason;
  status: ScheduleStatus;
  sentAt?: Date;
  createdAt: Date;
}

// ─────────────────────────────────────────────────────────────
// Email Draft
// ─────────────────────────────────────────────────────────────

export interface EmailDraft {
  from: string;
  to: string;
  subject: string;
  body: string;
  replyToMessageId?: string;
  threadId?: string;
  attachments?: Attachment[];
}

export interface SentEmail extends EmailDraft {
  id: string;
  sentAt: Date;
  messageId: string;
}
