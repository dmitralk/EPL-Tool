export interface Customer {
  id: number;
  zone: string | null;
  country: string | null;
  customer_type: string | null;
  comment_on_business_model: string | null;
  customer_ref_type_sap: string | null;
  customer_ref_sap: string;
  customer_short_name: string;
  customer_full_name: string;
  currency: 'USD' | 'EUR';
  packaging_version: string;
  price_list_managed_by: string | null;
  customer_spoc: string | null;
  effective: string | null;
  mailing_date: string | null;
  last_price_list_version: string | null;
  last_price_list_id: string | null;
  email_to_customer: string | null;
  email_internal_copy: string | null;
  email_pbp_copy: string | null;
  email_pbp_common: string | null;
}

export interface Product {
  id: number;
  plant: string | null;
  product_type: string;
  rip_code: string;
  product_name: string;
}

export interface StandardEplRow {
  id: number;
  currency: 'USD' | 'EUR';
  product_type: string;
  rip_code: string;
  product_name: string;
  net_price: number;
  unit: string;
}

export interface PackagingRow {
  id: number;
  packaging_version: string;
  product_type: string;
  packaging_name: string;
  price: number | null;
  currency: string;
  unit: string | null;
  sort_order: number;
}

export interface PriceListHeader {
  id: number;
  price_list_id: string;
  customer_ref_sap: string;
  customer_short_name?: string;
  sap_plant: string | null;
  effective: string;
  mailing_date: string;
  price_list_version: string;
  comments_about_changes: string | null;
  price_type: 'Discount' | 'Net Price';
  discount_percent: number | null;
  created_at?: string;
}

export interface PriceListEntry {
  id: number;
  price_list_id: string;
  product_type: string;
  rip_code: string;
  product_name: string;
  net_price: number;
  currency: string;
  unit: string;
}

export interface PriceListFull extends PriceListHeader {
  entries: PriceListEntry[];
}

export interface Unit {
  id: number;
  name: string;
}

export interface AdminEmail {
  id: number;
  email_name: string;
  email: string;
}

export interface CreatePriceListInput {
  customer_ref_sap: string;
  sap_plant: string;
  effective: string;
  mailing_date: string;
  price_list_version: string;
  comments_about_changes: string;
  price_type: 'Discount' | 'Net Price';
  discount_percent: number | null;
  entries: Omit<PriceListEntry, 'id' | 'price_list_id'>[];
}

export interface CombinedEplRow {
  id: number;
  rip_code: string;
  product_type: string;
  product_name: string;
  plant: string | null;
  usd_id: number | null;
  usd_price: number | null;
  usd_unit: string | null;
  eur_id: number | null;
  eur_price: number | null;
  eur_unit: string | null;
}

export interface MigrationResult {
  success: boolean;
  counts: {
    customers: number;
    products: number;
    standardEpl: number;
    packaging: number;
    priceLists: number;
    priceListEntries: number;
    adminEmails: number;
  };
  error?: string;
}

export interface DbOpenResult {
  ok: boolean;
  error?: string;
}
