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
  full_name: string | null;
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
  customer_type: CustomerType;
  product_type: ProductType;
  status: LeadStatus;
  score: number;
  score_label: LeadScoreLabel;
  assigned_to: string | null;
  privacy_consent: boolean;
  contact_consent: boolean;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  created_at: string;
  updated_at: string;
};

export type Address = {
  id: string;
  lead_id: string;
  address_type: AddressType;
  street: string | null;
  house_number: string | null;
  zip_code: string | null;
  city: string | null;
  country: string;
  created_at: string;
  updated_at: string;
};

export type EnergyDemand = {
  id: string;
  lead_id: string;
  energy_type: EnergyType;
  annual_consumption_kwh: number | null;
  meter_number: string | null;
  hot_water_with_gas: boolean | null;
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
  content: string;
  created_at: string;
  updated_at: string;
};

export type Document = {
  id: string;
  lead_id: string;
  uploaded_by: string | null;
  document_type: DocumentType;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  storage_bucket: string;
  storage_path: string;
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
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Profile, "id" | "auth_user_id" | "created_at">>;
      };
      leads: {
        Row: Lead;
        Insert: Omit<Lead, "id" | "lead_number" | "created_at" | "updated_at">;
        Update: Partial<Omit<Lead, "id" | "lead_number" | "created_at">>;
      };
      addresses: {
        Row: Address;
        Insert: Omit<Address, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Address, "id" | "lead_id" | "created_at">>;
      };
      energy_demands: {
        Row: EnergyDemand;
        Insert: Omit<EnergyDemand, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<EnergyDemand, "id" | "lead_id" | "created_at">>;
      };
      lead_status_history: {
        Row: LeadStatusHistory;
        Insert: Omit<LeadStatusHistory, "id" | "created_at">;
        Update: never;
      };
      lead_notes: {
        Row: LeadNote;
        Insert: Omit<LeadNote, "id" | "created_at" | "updated_at">;
        Update: Partial<Pick<LeadNote, "content">>;
      };
      documents: {
        Row: Document;
        Insert: Omit<Document, "id" | "created_at" | "updated_at">;
        Update: Partial<Pick<Document, "document_type" | "file_name" | "ocr_status" | "ocr_text" | "ocr_processed_at">>;
      };
      offers: {
        Row: Offer;
        Insert: Omit<Offer, "id" | "offer_number" | "created_at" | "updated_at">;
        Update: Partial<Omit<Offer, "id" | "lead_id" | "offer_number" | "created_at">>;
      };
      communications_log: {
        Row: CommunicationLog;
        Insert: Omit<CommunicationLog, "id" | "created_at" | "updated_at">;
        Update: Partial<Pick<CommunicationLog, "status" | "external_id" | "content_summary">>;
      };
      affiliates: {
        Row: Affiliate;
        Insert: Omit<Affiliate, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Affiliate, "id" | "created_at">>;
      };
      affiliate_links: {
        Row: AffiliateLink;
        Insert: Omit<AffiliateLink, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<AffiliateLink, "id" | "affiliate_id" | "created_at">>;
      };
      lead_referrals: {
        Row: LeadReferral;
        Insert: Omit<LeadReferral, "id" | "created_at">;
        Update: never;
      };
    };
    Functions: {
      current_profile_id: { Args: Record<never, never>; Returns: string };
      current_user_role: { Args: Record<never, never>; Returns: UserRole };
      is_admin: { Args: Record<never, never>; Returns: boolean };
      is_manager_or_above: { Args: Record<never, never>; Returns: boolean };
      can_access_lead: { Args: { p_lead_id: string }; Returns: boolean };
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
