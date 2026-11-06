// The only fields customers:update accepts. The rest are keys (id, customer_ref_sap), derived from price lists
// (effective, mailing_date, last_price_list_*), not edited per customer (email_pbp_*), or have their own channel
// (is_deleted → customers:soft-delete / customers:restore).
export const CUSTOMER_EDITABLE_FIELDS = [
  'customer_short_name',
  'customer_full_name',
  'customer_type',
  'customer_ref_type_sap',
  'comment_on_business_model',
  'currency',
  'packaging_version',
  'country',
  'zone',
  'main_supply_region',
  'customer_spoc',
  'price_list_managed_by',
  'email_to_customer',
  'email_internal_copy',
] as const;

export type CustomerEditableField = typeof CUSTOMER_EDITABLE_FIELDS[number];

export const CUSTOMER_REQUIRED_FIELDS: Readonly<Partial<Record<CustomerEditableField, string>>> = {
  customer_short_name: 'Short name',
  customer_full_name: 'Full name',
  currency: 'Currency',
  packaging_version: 'Packaging',
};

export function isCustomerEditableField(key: string): key is CustomerEditableField {
  return (CUSTOMER_EDITABLE_FIELDS as readonly string[]).includes(key);
}
