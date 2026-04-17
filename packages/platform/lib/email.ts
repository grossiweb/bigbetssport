import { Resend } from 'resend';
import { db } from './db.js';

/**
 * Transactional email via Resend.
 *
 * Scope for this turn: one `sendEmail(to, subject, html)` helper + logging.
 * Full React Email template suite (welcome / quota-warning / etc.) is
 * documented in the app's UX but deferred to a follow-up prompt.
 */

let client: Resend | null = null;

function resend(): Resend {
  if (!client) {
    const key = process.env['RESEND_API_KEY'];
    if (!key) throw new Error('RESEND_API_KEY is not set');
    client = new Resend(key);
  }
  return client;
}

function fromAddress(): string {
  return process.env['RESEND_FROM_EMAIL'] ?? 'noreply@bigballsports.io';
}

export interface SendResult {
  readonly id?: string;
  readonly error?: string;
}

export async function sendEmail(
  to: string,
  template: string,
  subject: string,
  html: string,
): Promise<SendResult> {
  try {
    const result = await resend().emails.send({
      from: fromAddress(),
      to: [to],
      subject,
      html,
    });
    const providerId = result.data?.id;
    const errorMsg = result.error?.message;
    await db()
      .query(
        `INSERT INTO sent_emails (to_email, template, subject, status, provider_id, error)
           VALUES ($1, $2, $3, $4, $5, $6)`,
        [to, template, subject, errorMsg ? 'failed' : 'sent', providerId ?? null, errorMsg ?? null],
      )
      .catch(() => undefined);
    return errorMsg !== undefined ? { error: errorMsg } : providerId !== undefined ? { id: providerId } : {};
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db()
      .query(
        `INSERT INTO sent_emails (to_email, template, subject, status, error)
           VALUES ($1, $2, $3, 'failed', $4)`,
        [to, template, subject, msg],
      )
      .catch(() => undefined);
    return { error: msg };
  }
}

// --- Minimal starter template (branded shell) ---------------------------

function renderShell(title: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="font-family:Inter,sans-serif;background:#F1F5F9;margin:0;padding:32px;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.06);overflow:hidden;">
      <div style="background:#0F172A;color:#fff;padding:20px 28px;font-weight:700;font-size:18px;">
        Big Ball Sports
      </div>
      <div style="padding:28px;color:#0F172A;line-height:1.55;">
        <h1 style="font-size:20px;margin:0 0 16px 0;">${title}</h1>
        ${body}
      </div>
      <div style="padding:16px 28px;border-top:1px solid #E2E8F0;color:#64748B;font-size:12px;">
        You're receiving this because you have an active Big Ball Sports account.
        <a href="https://bigballsports.io/dashboard/settings" style="color:#3B82F6;">Notification settings</a>
      </div>
    </div>
  </body>
</html>`;
}

export async function sendApiKeyCreated(to: string, keyPrefix: string): Promise<SendResult> {
  return sendEmail(
    to,
    'api-key-created',
    'Your new Big Ball Sports API key',
    renderShell(
      'New API key created',
      `<p>A new API key was just created on your account.</p>
       <p>Prefix: <code style="background:#F1F5F9;padding:2px 8px;border-radius:4px;">${keyPrefix}</code></p>
       <p>If this wasn't you, <a href="https://bigballsports.io/dashboard/keys" style="color:#3B82F6;">revoke it immediately</a>.</p>`,
    ),
  );
}
