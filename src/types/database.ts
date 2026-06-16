// Manuell gepflegte DB-Typen auf Basis der Supabase-Migrationen (Block 2–9a).
// Ersetzt bis zur Einrichtung von `supabase gen types typescript` die generierten Typen.

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type UserRole = "employee" | "manager" | "admin";

export type LeadStatus =
  | "new"
  | "in_review"
  | "question_open"
  | "offer_created"
  | "offer_sent"
  | "interested"
  | "contract_prepared"
  | "contract_sent"
  | "completed"
  | "rejected"
  | "unreachable"
  | "follow_up"
  | "disqualified"
  | "lost";

export type ProductType = "electricity" | "gas" | "both";

export type CustomerType =
  | "private"
  | "business"
  | "property_management"
  | "multi_location_company";

export type LeadScoreLabel = "cold" | "warm" | "hot";

export type AddressType = "delivery" | "billing" | "contact";

export type EnergyType = "electricity" | "gas";

export type DocumentType =
  | "invoice"
  | "offer_pdf"
  | "contract_pdf"
  | "cancellation_confirmation"
  | "power_of_attorney"
  | "other";

export type OfferStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "superseded";

export type CommunicationType = "email" | "call" | "sms" | "system";

export type CommunicationDirection = "inbound" | "outbound" | "internal";

export type CommunicationStatus = "pending" | "success" | "failed";

export type AffiliateStatus = "active" | "inactive" | "suspended";

export type AffiliateLinkStatus = "active" | "inactive";

// ---------------------------------------------------------------------------
// Tabellen
// ---------------------------------------------------------------------------

export type Profile = {
  id: string;
  auth_user_id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Lead = {
  id: string;
  lead_number: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  product_type: ProductType;
  customer_type: CustomerType;
  status: LeadStatus;
  score: number;
  score_label: LeadScoreLabel;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  assigned_to: string | null;
  privacy_consent: boolean;
  contact_consent: boolean;
  data_transfer_consent: boolean | null;
  created_at: string;
  updated_at: string;
};

export type Address = {
  id: string;
  lead_id: string;
  address_type: AddressType;
  street: string | null;
  house_number: string | null;
  address_addition: string | null;
  postal_code: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  created_at: string;
  updated_at: string;
};

export type EnergyDemand = {
  id: string;
  lead_id: string;
  energy_type: EnergyType;
  annual_consumption_kwh: number | null;
  consumption_known: boolean | null;
  household_size: number | null;
  living_area_sqm: number | null;
  heating_type: string | null;
  hot_water_with_gas: boolean | null;
  current_provider: string | null;
  current_tariff: string | null;
  monthly_payment: number | null;
  contract_end_date: string | null;
  cancellation_period_known: boolean | null;
  price_guarantee: boolean | null;
  meter_number: string | null;
  market_location_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadStatusHistory = {
  id: string;
  lead_id: string;
  old_status: LeadStatus | null;
  new_status: LeadStatus;
  changed_by: string | null;
  reason: string | null;
  created_at: string;
};

export type LeadNote = {
  id: string;
  lead_id: string;
  created_by: string;
  note: string;
  created_at: string;
  updated_at: string;
};

export type Document = {
  id: string;
  lead_id: string;
  uploaded_by: string | null;
  document_type: DocumentType;
  file_name: string;
  storage_path: string;
  storage_bucket: string;
  mime_type: string | null;
  file_size_bytes: number | null;
  ocr_status: string | null;
  ocr_text: string | null;
  ocr_processed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Offer = {
  id: string;
  lead_id: string;
  energy_demand_id: string | null;
  created_by: string | null;
  parent_offer_id: string | null;
  pdf_document_id: string | null;
  offer_number: string;
  version: number;
  provider_name: string;
  tariff_name: string;
  energy_type: EnergyType;
  monthly_price: number | null;
  annual_price: number | null;
  estimated_savings: number | null;
  status: OfferStatus;
  valid_until: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type CommunicationLog = {
  id: string;
  lead_id: string;
  offer_id: string | null;
  created_by: string | null;
  communication_type: CommunicationType;
  direction: CommunicationDirection;
  subject: string | null;
  content_summary: string | null;
  status: CommunicationStatus;
  external_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Affiliate = {
  id: string;
  name: string;
  email: string;
  status: AffiliateStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AffiliateLink = {
  id: string;
  affiliate_id: string;
  referral_code: string;
  label: string | null;
  status: AffiliateLinkStatus;
  created_at: string;
  updated_at: string;
};

export type LeadReferral = {
  id: string;
  lead_id: string;
  affiliate_link_id: string;
  notes: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Supabase Database-Typ für createClient<Database>()
// ---------------------------------------------------------------------------

export type Database = {
  public: {
    Views: Record<string, never>;
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Profile, "id" | "auth_user_id" | "created_at">>;
        Relationships: never[];
      };
      leads: {
        Row: Lead;
        Insert: Omit<Lead, "id" | "lead_number" | "created_at" | "updated_at">;
        Update: Partial<Omit<Lead, "id" | "lead_number" | "created_at">>;
        Relationships: never[];
      };
      addresses: {
        Row: Address;
        Insert: Omit<Address, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Address, "id" | "lead_id" | "created_at">>;
        Relationships: never[];
      };
      energy_demands: {
        Row: EnergyDemand;
        Insert: Omit<EnergyDemand, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<EnergyDemand, "id" | "lead_id" | "created_at">>;
        Relationships: never[];
      };
      lead_status_history: {
        Row: LeadStatusHistory;
        Insert: Omit<LeadStatusHistory, "id" | "created_at">;
        Update: never;
        Relationships: never[];
      };
      lead_notes: {
        Row: LeadNote;
        Insert: Omit<LeadNote, "id" | "created_at" | "updated_at">;
        Update: Partial<Pick<LeadNote, "note">>;
        Relationships: never[];
      };
      documents: {
        Row: Document;
        Insert: Omit<Document, "id" | "created_at" | "updated_at">;
        Update: Partial<
          Pick<
            Document,
            | "document_type"
            | "file_name"
            | "mime_type"
            | "file_size_bytes"
            | "ocr_status"
            | "ocr_text"
            | "ocr_processed_at"
          >
        >;
        Relationships: never[];
      };
      offers: {
        Row: Offer;
        Insert: Omit<Offer, "id" | "offer_number" | "created_at" | "updated_at">;
        Update: Partial<Omit<Offer, "id" | "lead_id" | "offer_number" | "created_at">>;
        Relationships: never[];
      };
      communications_log: {
        Row: CommunicationLog;
        Insert: Omit<CommunicationLog, "id" | "created_at" | "updated_at">;
        Update: Partial<Pick<CommunicationLog, "status" | "external_id" | "content_summary">>;
        Relationships: never[];
      };
      affiliates: {
        Row: Affiliate;
        Insert: Omit<Affiliate, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Affiliate, "id" | "created_at">>;
        Relationships: never[];
      };
      affiliate_links: {
        Row: AffiliateLink;
        Insert: Omit<AffiliateLink, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<AffiliateLink, "id" | "affiliate_id" | "created_at">>;
        Relationships: never[];
      };
      lead_referrals: {
        Row: LeadReferral;
        Insert: Omit<LeadReferral, "id" | "created_at">;
        Update: never;
        Relationships: never[];
      };
    };
    Functions: {
      current_profile_id: { Args: Record<never, never>; Returns: string };
      current_user_role: { Args: Record<never, never>; Returns: UserRole };
      is_admin: { Args: Record<never, never>; Returns: boolean };
      is_manager_or_above: { Args: Record<never, never>; Returns: boolean };
      can_access_lead: { Args: { p_lead_id: string }; Returns: boolean };
      submit_public_lead: {
        Args: Record<string, unknown>;
        Returns: { lead_id: string; lead_number: string };
      };
    };
    Enums: {
      user_role: UserRole;
      lead_status: LeadStatus;
      product_type: ProductType;
      customer_type: CustomerType;
      lead_score_label: LeadScoreLabel;
      address_type: AddressType;
      energy_type: EnergyType;
      document_type: DocumentType;
      offer_status: OfferStatus;
      communication_type: CommunicationType;
      communication_direction: CommunicationDirection;
      communication_status: CommunicationStatus;
      affiliate_status: AffiliateStatus;
      affiliate_link_status: AffiliateLinkStatus;
    };
  };
};
