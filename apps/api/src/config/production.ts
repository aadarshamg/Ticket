/** The settings checked before the API will start in production. */
export interface ProductionConfig {
  NODE_ENV: string;
  PUBLIC_BASE_URL: string;
  DB_SCHEMA: string;
  REDIS_URL?: string;
  QR_SECRET: string;
  SESSION_SECRET: string;
  MESSAGE_SENDER: string;
  WA_PHONE_NUMBER_ID?: string;
  WA_ACCESS_TOKEN?: string;
  WA_APP_SECRET?: string;
  WA_VERIFY_TOKEN?: string;
  WASARATHI_TICKET_URL?: string;
  WASARATHI_API_TOKEN?: string;
}

/**
 * Configuration mistakes that are harmless in development but dangerous on the day:
 * better to refuse to start than to send 3,000 people a link that does not work.
 * Returns one line per problem; empty when the configuration is fit for production.
 */
export function productionConfigProblems(config: ProductionConfig): string[] {
  if (config.NODE_ENV !== 'production') return [];
  const problems: string[] = [];

  if (!config.PUBLIC_BASE_URL.startsWith('https://')) {
    problems.push('PUBLIC_BASE_URL must be the site\'s https:// address (it goes into every WhatsApp message and pass link)');
  } else if (/\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(config.PUBLIC_BASE_URL)) {
    problems.push('PUBLIC_BASE_URL points at localhost; buyers could not open their passes');
  }
  if (!config.REDIS_URL) problems.push('REDIS_URL is required (the WhatsApp send queue)');
  if (config.QR_SECRET === config.SESSION_SECRET) {
    problems.push('QR_SECRET and SESSION_SECRET must be two different values');
  }
  if (config.DB_SCHEMA.endsWith('_test')) problems.push('DB_SCHEMA must not be a test schema');

  if (config.MESSAGE_SENDER === 'cloud') {
    for (const name of ['WA_PHONE_NUMBER_ID', 'WA_ACCESS_TOKEN', 'WA_APP_SECRET', 'WA_VERIFY_TOKEN'] as const) {
      if (!config[name]) problems.push(`${name} is required when MESSAGE_SENDER=cloud`);
    }
  }
  if (config.MESSAGE_SENDER === 'wasarathi') {
    if (!config.WASARATHI_TICKET_URL) problems.push('WASARATHI_TICKET_URL is required when MESSAGE_SENDER=wasarathi');
    else if (!config.WASARATHI_TICKET_URL.startsWith('https://')) problems.push('WASARATHI_TICKET_URL must be an https:// link');
    else {
      const linkToken = new URL(config.WASARATHI_TICKET_URL).searchParams.get('apiToken');
      if (!config.WASARATHI_API_TOKEN && (!linkToken || linkToken === 'XXXX')) {
        problems.push('WASARATHI_API_TOKEN is required when the WaSarathi link has no API key');
      }
    }
  }
  return problems;
}
