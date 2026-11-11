import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { withTenantContextRaw } from '../../db/client.js';
import type { MessagingProvider, SmsProvider } from './messaging.provider.js';
import {
  TEMPLATE_REGISTRY,
  validateTemplateParams,
} from './template.registry.js';
import {
  isOptOutKeyword,
  isWithinQuietHours,
  evaluateMessageConsent,
} from './consent.engine.js';
import {
  evaluateMessagingBudget,
  ESTIMATED_MESSAGE_COST_PAISE,
} from './budget.engine.js';
import type {
  SendMessageDto,
  RecordConsentDto,
  UpdateMessagingSettingsDto,
  MessageQueryDto,
} from './messaging.dto.js';

export interface OrgMessagingSettingsRow {
  org_id: string;
  monthly_budget_paise: string;
  daily_budget_paise: string;
  is_marketing_enabled: boolean;
  quiet_hours_start_utc: number;
  quiet_hours_end_utc: number;
  sms_fallback_enabled: boolean;
}

export interface MessageLogRow {
  id: string;
  org_id: string;
  customer_id: string | null;
  phone: string;
  channel: string;
  template: string;
  category: string;
  provider_msg_id: string | null;
  provider: string;
  status: string;
  failure_reason: string | null;
  cost_minor: string;
  created_at: Date;
}

/**
 * Messaging Service (Phase 9)
 *
 * Coordinates WhatsApp & SMS messaging with strict DPDP consent enforcement,
 * budget limits, quiet hours, and idempotent delivery tracking.
 *
 * Invariants (AGENTS §2, ARCH §20):
 *  - Integer minor units (paise) for all costs and budgets (Rule 1).
 *  - Marketing messages strictly require active opt-in in `consents` table.
 *  - Immediate STOP / UNSUBSCRIBE handling.
 *  - Evolution API calls strictly scoped to instance name.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly provider: MessagingProvider,
    private readonly smsProvider?: SmsProvider,
  ) {}

  // ─── Send Templated Message ────────────────────────────────────────────────

  async sendMessage(orgId: string, dto: SendMessageDto) {
    const templateDef = TEMPLATE_REGISTRY[dto.templateName];
    if (!templateDef) {
      throw new BadRequestException(`Template '${dto.templateName}' is not registered`);
    }

    // 1. Validate required variables
    const paramValidation = validateTemplateParams(dto.templateName, dto.params);
    if (!paramValidation.valid) {
      throw new BadRequestException(
        `Missing template parameters: ${paramValidation.missingVars.join(', ')}`,
      );
    }

    return withTenantContextRaw(orgId, async (client) => {
      // 2. Check idempotency
      if (dto.idempotencyKey) {
        const existing = await client.query<MessageLogRow>(
          `SELECT * FROM message_log WHERE org_id = $1 AND idempotency_key = $2`,
          [orgId, dto.idempotencyKey],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          return {
            id: existingRow.id,
            status: existingRow.status,
            providerMessageId: existingRow.provider_msg_id,
            costMinorPaise: Number(existingRow.cost_minor),
            isIdempotentReplay: true,
          };
        }
      }

      // 3. Load Org Messaging Settings
      const settingsRes = await client.query<OrgMessagingSettingsRow>(
        `SELECT * FROM org_messaging_settings WHERE org_id = $1`,
        [orgId],
      );
      const settings = settingsRes.rows[0] || {
        org_id: orgId,
        monthly_budget_paise: '50000',
        daily_budget_paise: '10000',
        is_marketing_enabled: true,
        quiet_hours_start_utc: 15,
        quiet_hours_end_utc: 3,
        sms_fallback_enabled: true,
      };

      // 4. Budget Check
      const spendRes = await client.query<{
        daily_spend: string | null;
        monthly_spend: string | null;
      }>(
        `SELECT
           COALESCE(SUM(cost_minor) FILTER (WHERE created_at >= CURRENT_DATE), 0) as daily_spend,
           COALESCE(SUM(cost_minor) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)), 0) as monthly_spend
         FROM message_log
         WHERE org_id = $1`,
        [orgId],
      );
      const spend = spendRes.rows[0];
      const dailySpendPaise = BigInt(spend?.daily_spend || '0');
      const monthlySpendPaise = BigInt(spend?.monthly_spend || '0');

      const budgetEval = evaluateMessagingBudget({
        dailySpendPaise,
        dailyBudgetPaise: BigInt(settings.daily_budget_paise),
        monthlySpendPaise,
        monthlyBudgetPaise: BigInt(settings.monthly_budget_paise),
        category: templateDef.category,
      });

      if (!budgetEval.allowed) {
        // Record blocked message in message_log
        await client.query(
          `INSERT INTO message_log (
             org_id, customer_id, phone, channel, template, category,
             provider, status, failure_reason, cost_minor, idempotency_key
           )
           VALUES ($1, $2, $3, 'WHATSAPP', $4, $5, $6, 'BLOCKED', $7, 0, $8)`,
          [
            orgId,
            dto.customerId || null,
            dto.phone,
            dto.templateName,
            templateDef.category,
            this.provider.name,
            budgetEval.reason,
            dto.idempotencyKey || null,
          ],
        );
        throw new BadRequestException(budgetEval.reason);
      }

      // 5. Consent & Quiet Hours Evaluation (for MARKETING)
      if (templateDef.category === 'MARKETING') {
        if (!settings.is_marketing_enabled) {
          throw new BadRequestException('Marketing messages are disabled for this organization.');
        }

        // Fetch latest consent status for this phone
        const consentRes = await client.query<{ granted: boolean }>(
          `SELECT granted FROM consents
           WHERE org_id = $1 AND phone = $2 AND purpose = 'MARKETING_WHATSAPP'
           ORDER BY created_at DESC LIMIT 1`,
          [orgId, dto.phone],
        );
        const consentGranted = consentRes.rows[0]?.granted ?? false;

        // Fetch latest marketing message timestamp to calculate frequency cap
        const lastMktRes = await client.query<{ created_at: Date }>(
          `SELECT created_at FROM message_log
           WHERE org_id = $1 AND phone = $2 AND category = 'MARKETING' AND status IN ('SENT', 'DELIVERED', 'READ')
           ORDER BY created_at DESC LIMIT 1`,
          [orgId, dto.phone],
        );
        const lastMktDate = lastMktRes.rows[0]?.created_at;
        const daysSinceLast = lastMktDate
          ? (Date.now() - new Date(lastMktDate).getTime()) / (1000 * 60 * 60 * 24)
          : null;

        const inQuietHours = isWithinQuietHours(
          new Date(),
          settings.quiet_hours_start_utc,
          settings.quiet_hours_end_utc,
        );

        const consentEval = evaluateMessageConsent('MARKETING', {
          consentGranted,
          inQuietHours,
          daysSinceLastMarketing: daysSinceLast,
        });

        if (!consentEval.allowed) {
          await client.query(
            `INSERT INTO message_log (
               org_id, customer_id, phone, channel, template, category,
               provider, status, failure_reason, cost_minor, idempotency_key
             )
             VALUES ($1, $2, $3, 'WHATSAPP', $4, $5, $6, 'BLOCKED', $7, 0, $8)`,
            [
              orgId,
              dto.customerId || null,
              dto.phone,
              dto.templateName,
              templateDef.category,
              this.provider.name,
              consentEval.reason,
              dto.idempotencyKey || null,
            ],
          );
          throw new BadRequestException(consentEval.reason);
        }
      }

      // 6. Provider Dispatch
      const result = await this.provider.sendTemplate({
        to: dto.phone,
        templateName: dto.templateName,
        category: templateDef.category,
        language: dto.language,
        params: dto.params,
        orgId,
        idempotencyKey: dto.idempotencyKey,
      });

      // 7. Write to message_log
      const insertRes = await client.query<MessageLogRow>(
        `INSERT INTO message_log (
           org_id, customer_id, phone, channel, template, category,
           provider_msg_id, provider, status, failure_reason, cost_minor, idempotency_key
         )
         VALUES ($1, $2, $3, 'WHATSAPP', $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          orgId,
          dto.customerId || null,
          dto.phone,
          dto.templateName,
          templateDef.category,
          result.providerMessageId,
          result.provider,
          result.status,
          result.status === 'FAILED' ? 'Provider returned failure' : null,
          result.costMinorPaise.toString(),
          dto.idempotencyKey || null,
        ],
      );

      const logRow = insertRes.rows[0];
      if (!logRow) {
        throw new Error('Failed to record message_log');
      }

      return {
        id: logRow.id,
        status: logRow.status,
        providerMessageId: logRow.provider_msg_id,
        costMinorPaise: Number(logRow.cost_minor),
        isIdempotentReplay: false,
      };
    });
  }

  // ─── Fast-path OTP Verification Message ────────────────────────────────────

  async sendOtp(orgId: string, phone: string, code: string) {
    const res = await this.sendMessage(orgId, {
      phone,
      templateName: 'auth_otp_v1',
      params: { code },
      language: 'en',
    });

    // SMS Fallback for OTP if WhatsApp fails
    if (res.status === 'FAILED' && this.smsProvider) {
      this.logger.warn(`[OTP] WhatsApp failed for ${phone}; triggering SMS fallback`);
      const smsRes = await this.smsProvider.sendSms(
        phone,
        `${code} is your DineFlow verification code.`,
        TEMPLATE_REGISTRY['auth_otp_v1']?.dltTemplateId,
      );
      return {
        ...res,
        channel: 'SMS',
        status: smsRes.status,
        providerMessageId: smsRes.providerMessageId,
      };
    }

    return res;
  }

  // ─── Record Consent (DPDP Compliance) ──────────────────────────────────────

  async recordConsent(
    orgId: string,
    customerId: string | null,
    dto: RecordConsentDto,
    ipHash?: string,
  ) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `INSERT INTO consents (org_id, customer_id, phone, purpose, granted, notice_version, source, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          orgId,
          customerId,
          dto.phone,
          dto.purpose,
          dto.granted,
          dto.noticeVersion,
          dto.source,
          ipHash || null,
        ],
      );

      return res.rows[0];
    });
  }

  // ─── Inbound Webhook (Evolution API & Meta Cloud API) ──────────────────────

  async handleInboundWebhook(rawPayload: any) {
    // 1. Evolution API format: Inbound message (e.g. STOP command)
    const evoText =
      rawPayload?.data?.message?.conversation ||
      rawPayload?.data?.message?.extendedTextMessage?.text;

    const evoRemoteJid = rawPayload?.data?.key?.remoteJid as string | undefined;

    if (evoText && evoRemoteJid) {
      const phoneDigits = evoRemoteJid.replace(/\D/g, '');
      const phone = phoneDigits.startsWith('+') ? phoneDigits : `+${phoneDigits}`;

      if (isOptOutKeyword(evoText)) {
        this.logger.log(`[OPT-OUT] Inbound STOP received from ${phone}`);

        // Revoke marketing consent globally across all orgs for this phone
        await withTenantContextRaw('00000000-0000-0000-0000-000000000000', async (client) => {
          // Find orgs where this phone is registered
          const orgsRes = await client.query<{ org_id: string }>(
            `SELECT DISTINCT org_id FROM consents WHERE phone = $1`,
            [phone],
          );

          for (const row of orgsRes.rows) {
            await client.query(
              `INSERT INTO consents (org_id, phone, purpose, granted, notice_version, source)
               VALUES ($1, $2, 'MARKETING_WHATSAPP', false, 'v1.0', 'WA_INBOUND')`,
              [row.org_id, phone],
            );
          }
        });

        return { action: 'OPT_OUT_RECORDED', phone };
      }
    }

    // 2. Status Update (Evolution or Meta)
    const msgId =
      rawPayload?.data?.key?.id ||
      rawPayload?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.id;

    const rawStatus =
      rawPayload?.data?.status ||
      rawPayload?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0]?.status;

    if (msgId && rawStatus) {
      const statusMap: Record<string, string> = {
        DELIVERY_ACK: 'DELIVERED',
        delivered: 'DELIVERED',
        READ: 'READ',
        read: 'READ',
        FAILED: 'FAILED',
        failed: 'FAILED',
        sent: 'SENT',
      };

      const mappedStatus = statusMap[rawStatus] || 'SENT';

      await withTenantContextRaw('00000000-0000-0000-0000-000000000000', async (client) => {
        await client.query(
          `UPDATE message_log
           SET status = $1, updated_at = now()
           WHERE provider_msg_id = $2`,
          [mappedStatus, msgId],
        );
      });

      return { action: 'STATUS_UPDATED', messageId: msgId, status: mappedStatus };
    }

    return { action: 'IGNORED' };
  }

  // ─── Settings & Reporting ──────────────────────────────────────────────────

  async getSettings(orgId: string) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query<OrgMessagingSettingsRow>(
        `SELECT * FROM org_messaging_settings WHERE org_id = $1`,
        [orgId],
      );
      return (
        res.rows[0] || {
          org_id: orgId,
          monthly_budget_paise: '50000',
          daily_budget_paise: '10000',
          is_marketing_enabled: true,
          quiet_hours_start_utc: 15,
          quiet_hours_end_utc: 3,
          sms_fallback_enabled: true,
        }
      );
    });
  }

  async updateSettings(orgId: string, dto: UpdateMessagingSettingsDto) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `INSERT INTO org_messaging_settings (
           org_id, monthly_budget_paise, daily_budget_paise, is_marketing_enabled,
           quiet_hours_start_utc, quiet_hours_end_utc, sms_fallback_enabled, updated_at
         )
         VALUES ($1, COALESCE($2, 50000), COALESCE($3, 10000), COALESCE($4, true),
                 COALESCE($5, 15), COALESCE($6, 3), COALESCE($7, true), now())
         ON CONFLICT (org_id) DO UPDATE SET
           monthly_budget_paise = COALESCE($2, org_messaging_settings.monthly_budget_paise),
           daily_budget_paise = COALESCE($3, org_messaging_settings.daily_budget_paise),
           is_marketing_enabled = COALESCE($4, org_messaging_settings.is_marketing_enabled),
           quiet_hours_start_utc = COALESCE($5, org_messaging_settings.quiet_hours_start_utc),
           quiet_hours_end_utc = COALESCE($6, org_messaging_settings.quiet_hours_end_utc),
           sms_fallback_enabled = COALESCE($7, org_messaging_settings.sms_fallback_enabled),
           updated_at = now()
         RETURNING *`,
        [
          orgId,
          dto.monthlyBudgetPaise,
          dto.dailyBudgetPaise,
          dto.isMarketingEnabled,
          dto.quietHoursStartUtc,
          dto.quietHoursEndUtc,
          dto.smsFallbackEnabled,
        ],
      );

      return res.rows[0];
    });
  }

  async listMessages(orgId: string, query: MessageQueryDto) {
    return withTenantContextRaw(orgId, async (client) => {
      const conditions = ['org_id = $1'];
      const values: any[] = [orgId];
      let pIdx = 2;

      if (query.phone) {
        conditions.push(`phone = $${pIdx++}`);
        values.push(query.phone);
      }
      if (query.category) {
        conditions.push(`category = $${pIdx++}`);
        values.push(query.category);
      }
      if (query.status) {
        conditions.push(`status = $${pIdx++}`);
        values.push(query.status);
      }

      const whereClause = conditions.join(' AND ');

      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM message_log WHERE ${whereClause}`,
        values,
      );

      const itemsRes = await client.query<MessageLogRow>(
        `SELECT * FROM message_log WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...values, query.limit, query.offset],
      );

      return {
        total: Number(countRes.rows[0]?.count || 0),
        items: itemsRes.rows.map((r) => ({
          id: r.id,
          customerId: r.customer_id,
          phone: r.phone,
          channel: r.channel,
          template: r.template,
          category: r.category,
          providerMsgId: r.provider_msg_id,
          provider: r.provider,
          status: r.status,
          failureReason: r.failure_reason,
          costMinorPaise: Number(r.cost_minor),
          createdAt: r.created_at,
        })),
      };
    });
  }
}
