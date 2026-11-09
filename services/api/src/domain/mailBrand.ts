import type { Ctx, Db } from '../context.ts';
import { originFor } from '../config.ts';
import type { MailBrand } from '../adapters/mail/templates.ts';

/** The shop's name, colour and contact details for the header and footer of every mail it sends. */
export async function loadMailBrand(db: Db, c: Ctx): Promise<MailBrand> {
  const tenant = c.get('tenant')!;
  const { config } = c.get('deps');
  const { rows } = await db.query<{
    display_name: string | null; primary_color: string | null; support_email: string | null; legal_name: string | null; legal_address: string | null;
  }>('select display_name, primary_color, support_email, legal_name, legal_address from reseller_branding where reseller_id = $1', [tenant.id]);
  const b = rows[0];
  return {
    brandName: b?.display_name ?? tenant.slug,
    storefrontUrl: originFor(config, c.get('host').name),
    ...(b?.primary_color ? { primaryColor: b.primary_color.trim() } : {}),
    ...(b?.support_email ? { supportEmail: b.support_email } : {}),
    ...(b?.legal_name ? { legalName: b.legal_name } : {}),
    ...(b?.legal_address ? { legalAddress: b.legal_address } : {}),
  };
}
