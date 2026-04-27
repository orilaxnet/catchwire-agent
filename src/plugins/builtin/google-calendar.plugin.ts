import type { IPlugin } from '../plugin-manager.ts';
import type { ParsedEmail, AgentResponse } from '../../types/index.ts';
import { logger } from '../../utils/logger.ts';

export interface GoogleCalendarConfig {
  accessToken:  string;
  calendarId:   string;
}

export class GoogleCalendarPlugin implements IPlugin {
  name    = 'google-calendar';
  version = '1.0.0';
  enabled = true;

  constructor(private config: GoogleCalendarConfig) {}

  async afterEmailProcess(email: ParsedEmail, response: AgentResponse): Promise<AgentResponse> {
    const dates = (response.extractedData?.meetingTimes ?? response.extractedData?.deadlines) as string[] | undefined;
    if (!dates?.length) return response;

    for (const dateStr of dates) {
      const start = new Date(dateStr);
      if (isNaN(start.getTime())) continue;

      const end = new Date(start.getTime() + 60 * 60_000);

      const event = {
        summary:     `[Email] ${email.subject}`,
        description: `From: ${email.originalSender}\n\n${response.summary}`,
        start: { dateTime: start.toISOString() },
        end:   { dateTime: end.toISOString() },
      };

      try {
        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.config.calendarId)}/events`,
          {
            method:  'POST',
            headers: {
              'Authorization': `Bearer ${this.config.accessToken}`,
              'Content-Type':  'application/json',
            },
            body: JSON.stringify(event),
          },
        );
        if (!resp.ok) {
          logger.warn('Calendar API error', { status: resp.status, date: dateStr });
        }
      } catch (err) {
        logger.error('Google Calendar plugin failed', { err });
      }
    }

    return response;
  }
}
