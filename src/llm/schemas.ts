/**
 * Zod schemas for validating LLM output
 */

import { z } from 'zod';

export const PrioritySchema  = z.enum(['critical', 'high', 'medium', 'low']);

export const IntentSchema = z.enum([
  'action_required',
  'question',
  'complaint',
  'fyi',
  'deadline',
  'payment',
  'follow_up',
  'meeting_request',
  'order_tracking',
  'marketing',
  'newsletter'
]);

export const SuggestedReplySchema = z.object({
  label: z.string().max(30),
  body:  z.string().max(2000),
  tone:  z.string()
});

export const AgentResponseSchema = z.object({
  priority: PrioritySchema,
  intent:   IntentSchema,
  summary:  z.string().max(200),

  suggestedReplies: z.array(SuggestedReplySchema)
    .min(1)
    .max(3),

  extractedData: z.object({
    deadlines:    z.array(z.string()).optional(),
    amounts:      z.array(z.string()).optional(),
    actionItems:  z.array(z.string()).optional(),
    orderIds:     z.array(z.string()).optional(),
    meetingTimes: z.array(z.string()).optional(),
    people:       z.array(z.string()).optional(),
    location:     z.string().optional()
  }).default({}),

  confidence: z.number().min(0).max(1)
});

export type AgentResponseOutput = z.infer<typeof AgentResponseSchema>;

// ─────────────────────────────────────────────────────────────
// Style DNA Extraction Schema
// ─────────────────────────────────────────────────────────────

export const StyleDNASchema = z.object({
  tone:           z.string(),
  formality:      z.enum(['very_formal', 'professional', 'friendly', 'casual']),
  averageLength:  z.enum(['short', 'medium', 'long']),
  usesEmoji:      z.boolean(),
  usesGreeting:   z.boolean(),
  signatureStyle: z.string(),
  keyPhrases:     z.array(z.string()),
  avoidPhrases:   z.array(z.string()),
  summary:        z.string()
});

// ─────────────────────────────────────────────────────────────
// Thread Entities Extraction Schema
// ─────────────────────────────────────────────────────────────

export const ThreadEntitiesSchema = z.object({
  people:      z.array(z.string()),
  dates:       z.array(z.string()),
  amounts:     z.array(z.string()),
  products:    z.array(z.string()),
  documents:   z.array(z.string()),
  actionItems: z.array(z.string())
});

// ─────────────────────────────────────────────────────────────
// Variable Extraction Schema (Template)
// ─────────────────────────────────────────────────────────────

export const VariableExtractionSchema = z.record(
  z.string(),
  z.string().nullable()
);
