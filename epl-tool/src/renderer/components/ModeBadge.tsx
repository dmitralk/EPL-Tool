import { Badge } from './ui/badge';
import { pricingModeLabel, type PermCustomer } from '../../shared/permissions';

// Pricing management mode of a customer: Open / Managed by PBP / Managed by <names>.
export function ModeBadge({ customer, short }: { customer: PermCustomer; short?: boolean }) {
  const label = short && customer.pricing_mode === 'managed' ? 'Managed' : pricingModeLabel(customer);
  const variant = customer.pricing_mode === 'open' ? 'success' : customer.pricing_mode === 'pbp' ? 'secondary' : 'default';
  return <Badge variant={variant} title={pricingModeLabel(customer)} className="whitespace-nowrap">{label}</Badge>;
}
