// Tipos del esquema de Supabase.
//
// Escritos a mano y no con `supabase gen types` porque esa generacion exige
// Docker, que no esta disponible en este entorno. El esquema vive en
// supabase/migrations/ — al tocarlo, actualizar este archivo.

export type MemberRole = 'owner' | 'admin' | 'treasurer' | 'viewer';
export type SundayStatus = 'draft' | 'closed';
export type MeetingStatus = 'open' | 'locked';
export type OfferingCountStatus = 'draft' | 'finalized' | 'voided';
export type WeekStatus = 'open' | 'closed';
export type WeekConceptKind = 'income' | 'expense';
export type PurchaseStatus = 'pending' | 'approved' | 'rejected' | 'delivered';
export type PaymentStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type SalePaymentMethod = 'cash' | 'mercadopago';
export type SalesSessionStatus = 'open' | 'closed';

// Las columnas con default (id, created_at, ...) son opcionales al insertar;
// `Req` lista las que si son obligatorias.
type Table<Row, Req extends keyof Row> = {
  Row: Row;
  Insert: Pick<Row, Req> & Partial<Row>;
  Update: Partial<Row>;
  Relationships: [];
};

export type Currency = {
  code: string;
  name: string;
  symbol: string;
  is_active: boolean;
};

export type CurrencyDenomination = {
  id: string;
  currency_code: string;
  value: number;
  is_active: boolean;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  default_currency: string;
  logo_path: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Campus = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  /** Link publico de solicitudes. Uno por campus, regenerable. */
  public_request_token: string;
  default_currency: string;
  timezone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type OrganizationMember = {
  id: string;
  organization_id: string;
  user_id: string;
  campus_id: string | null;
  role: MemberRole;
  invited_by: string | null;
  created_at: string;
};

export type Invitation = {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  campus_id: string | null;
  token: string;
  invited_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
};

export type MeetingTemplate = {
  id: string;
  organization_id: string;
  campus_id: string;
  label: string;
  start_time: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type Sunday = {
  id: string;
  organization_id: string;
  campus_id: string;
  service_date: string;
  status: SundayStatus;
  notes: string | null;
  closed_at: string | null;
  closed_by: string | null;
  acta_pdf_path: string | null;
  created_at: string;
  updated_at: string;
};

export type SundayMeeting = {
  id: string;
  sunday_id: string;
  /** Link del conteo de la ofrenda. */
  public_id: string;
  /** Link de la caja de ventas. Distinto: son dos personas distintas. */
  sales_public_id: string;
  label: string;
  start_time: string;
  sort_order: number;
  status: MeetingStatus;
  created_at: string;
};

export type OfferingCount = {
  id: string;
  meeting_id: string;
  volunteer_name: string | null;
  witness_1_name: string | null;
  witness_2_name: string | null;
  envelopes_count: number;
  notes: string | null;
  status: OfferingCountStatus;
  public_id: string;
  finalized_at: string | null;
  pdf_path: string | null;
  voided_reason: string | null;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
};

export type OfferingCountLine = {
  id: string;
  offering_count_id: string;
  currency_code: string;
  denomination_value: number;
  quantity: number;
  subtotal: number;
};

export type MeetingIncome = {
  id: string;
  meeting_id: string;
  concept: 'mercadopago';
  currency_code: string;
  amount: number;
  reference: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
};

export type Product = {
  id: string;
  organization_id: string;
  name: string;
  price: number;
  currency_code: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type SalesSession = {
  id: string;
  meeting_id: string;
  seller_name: string;
  witness_name: string | null;
  notes: string | null;
  status: SalesSessionStatus;
  closed_at: string | null;
  pdf_path: string | null;
  created_at: string;
  updated_at: string;
};

export type Sale = {
  id: string;
  meeting_id: string;
  /** Caja que la registro. Null = la cargo la tesoreria desde la app. */
  session_id: string | null;
  payment_method: SalePaymentMethod;
  currency_code: string;
  seller_name: string | null;
  notes: string | null;
  created_at: string;
};

export type SaleLine = {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
};

export type WeekConcept = {
  id: string;
  organization_id: string | null;
  code: string;
  name: string;
  allowed_currencies: string[];
  has_movement_count: boolean;
  /** Si el concepto suma o resta al saldo de la semana. */
  kind: WeekConceptKind;
  sort_order: number;
  is_active: boolean;
  created_at: string;
};

export type Team = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PaymentMethod = {
  id: string;
  organization_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PurchaseRequest = {
  id: string;
  organization_id: string;
  campus_id: string;
  team_id: string;
  requester_name: string;
  requester_email: string | null;
  requester_phone: string | null;
  estimated_amount: number | null;
  estimated_currency: string | null;
  status: PurchaseStatus;
  rejection_reason: string | null;
  actual_amount: number | null;
  actual_currency: string | null;
  public_token: string;
  decided_by: string | null;
  decided_at: string | null;
  delivered_by: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseRequestItem = {
  id: string;
  purchase_request_id: string;
  name: string;
  quantity: number;
  unit: string | null;
};

/**
 * Pagos y transferencias. Es la tabla que hasta la 20260903000002 se llamaba
 * `budget_requests`: mismo flujo (pedir, aprobar-y-pagar o rechazar), nombre
 * nuevo. "Presupuesto" ahora es otra cosa — ver `Budget`.
 */
export type PaymentRequest = {
  id: string;
  organization_id: string;
  campus_id: string;
  team_id: string | null;
  requester_name: string;
  requester_email: string | null;
  requester_phone: string | null;
  description: string;
  estimated_amount: number;
  estimated_currency: string | null;
  status: PaymentStatus;
  rejection_reason: string | null;
  payment_method_id: string | null;
  actual_amount: number | null;
  actual_currency: string | null;
  public_token: string;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Un presupuesto presentado. Documentacion y nada mas: no tiene estado
 * porque no hay nada que decidir. Si hay que pagarlo, se genera desde aca
 * una solicitud de pago y queda el vinculo en `payment_request_id`.
 */
export type Budget = {
  id: string;
  organization_id: string;
  campus_id: string;
  team_id: string | null;
  requester_name: string;
  requester_email: string | null;
  requester_phone: string | null;
  description: string;
  estimated_amount: number;
  estimated_currency: string | null;
  payment_request_id: string | null;
  public_token: string;
  created_at: string;
  updated_at: string;
};

/**
 * Pago en efectivo hecho desde la caja del campus. `receipt_number` lo pone
 * un trigger, correlativo por campus: es el numero que va impreso en el
 * recibo que firma el acreedor.
 */
export type CashPayment = {
  id: string;
  organization_id: string;
  campus_id: string;
  receipt_number: number;
  payee_name: string;
  payee_document: string | null;
  concept: string;
  team_id: string | null;
  amount: number;
  currency_code: string;
  paid_on: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Attachment = {
  id: string;
  organization_id: string;
  campus_id: string | null;
  attachable_type: string;
  attachable_id: string;
  kind: string;
  storage_path: string;
  original_filename: string;
  content_type: string;
  uploaded_by: string | null;
  created_at: string;
};

export type MeetingAmountKind = 'offering' | 'sale' | 'income';

/**
 * Fila de la vista `meeting_amounts`: una por reunion, moneda, tipo y medio
 * de pago. `method` es null para la ofrenda (siempre es efectivo contado).
 */
export type MeetingAmount = {
  meeting_id: string;
  sunday_id: string;
  currency_code: string;
  kind: MeetingAmountKind;
  method: string | null;
  amount: number;
};

/** Fila de la vista `week_amounts`: una por semana, tipo y moneda. */
export type WeekAmount = {
  week_id: string;
  kind: WeekConceptKind;
  currency_code: string;
  amount: number;
  movements: number;
};

export type Week = {
  id: string;
  organization_id: string;
  campus_id: string;
  start_date: string;
  end_date: string;
  status: WeekStatus;
  notes: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type WeekEntry = {
  id: string;
  week_id: string;
  concept_id: string;
  currency_code: string;
  amount: number;
  movement_count: number | null;
  entry_date: string | null;
  description: string | null;
  /** De donde salio. Null = lo cargo alguien a mano en el Semanal. */
  source_type: string | null;
  source_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      currencies: Table<Currency, 'code' | 'name' | 'symbol'>;
      currency_denominations: Table<CurrencyDenomination, 'currency_code' | 'value'>;
      organizations: Table<Organization, 'name' | 'slug'>;
      campuses: Table<Campus, 'organization_id' | 'name' | 'slug' | 'default_currency'>;
      organization_members: Table<OrganizationMember, 'organization_id' | 'user_id'>;
      invitations: Table<Invitation, 'organization_id' | 'email' | 'token'>;
      meeting_templates: Table<
        MeetingTemplate,
        'organization_id' | 'campus_id' | 'label' | 'start_time'
      >;
      sundays: Table<Sunday, 'organization_id' | 'campus_id' | 'service_date'>;
      sunday_meetings: Table<SundayMeeting, 'sunday_id' | 'label' | 'start_time'>;
      offering_counts: Table<OfferingCount, 'meeting_id'>;
      offering_count_lines: Table<
        OfferingCountLine,
        'offering_count_id' | 'currency_code' | 'denomination_value' | 'quantity'
      >;
      meeting_incomes: Table<MeetingIncome, 'meeting_id' | 'currency_code' | 'amount'>;
      products: Table<Product, 'organization_id' | 'name' | 'price' | 'currency_code'>;
      meeting_sales_sessions: Table<SalesSession, 'meeting_id' | 'seller_name'>;
      sales: Table<Sale, 'meeting_id' | 'payment_method' | 'currency_code'>;
      sale_lines: Table<
        SaleLine,
        'sale_id' | 'product_id' | 'product_name' | 'quantity' | 'unit_price'
      >;
      teams: Table<Team, 'organization_id' | 'name' | 'slug'>;
      payment_methods: Table<PaymentMethod, 'organization_id' | 'name'>;
      purchase_requests: Table<
        PurchaseRequest,
        'organization_id' | 'campus_id' | 'team_id' | 'requester_name'
      >;
      purchase_request_items: Table<
        PurchaseRequestItem,
        'purchase_request_id' | 'name' | 'quantity'
      >;
      payment_requests: Table<
        PaymentRequest,
        | 'organization_id'
        | 'campus_id'
        | 'requester_name'
        | 'description'
        | 'estimated_amount'
      >;
      budgets: Table<
        Budget,
        | 'organization_id'
        | 'campus_id'
        | 'requester_name'
        | 'description'
        | 'estimated_amount'
      >;
      // `receipt_number` no esta en la lista de obligatorias porque lo pone
      // un trigger, correlativo por campus.
      cash_payments: Table<
        CashPayment,
        | 'organization_id'
        | 'campus_id'
        | 'payee_name'
        | 'concept'
        | 'amount'
        | 'currency_code'
        | 'paid_on'
      >;
      attachments: Table<
        Attachment,
        | 'organization_id'
        | 'attachable_type'
        | 'attachable_id'
        | 'kind'
        | 'storage_path'
        | 'original_filename'
        | 'content_type'
      >;
      week_concepts: Table<WeekConcept, 'code' | 'name'>;
      weeks: Table<Week, 'organization_id' | 'campus_id' | 'start_date' | 'end_date'>;
      week_entries: Table<WeekEntry, 'week_id' | 'concept_id' | 'currency_code' | 'amount'>;
    };
    Views: {
      meeting_amounts: { Row: MeetingAmount; Relationships: [] };
      week_amounts: { Row: WeekAmount; Relationships: [] };
    };
    Functions: {
      create_organization: {
        Args: { p_name: string; p_slug: string; p_timezone?: string; p_currency?: string };
        Returns: string;
      };
      accept_invitation: {
        Args: { p_token: string };
        Returns: string;
      };
      new_request_token: {
        Args: Record<never, never>;
        Returns: string;
      };
      regenerate_campus_token: {
        Args: { p_campus: string };
        Returns: string;
      };
      open_sunday: {
        Args: { p_campus: string; p_date: string };
        Returns: string;
      };
      org_members_with_email: {
        Args: { p_org: string };
        Returns: {
          id: string;
          user_id: string;
          email: string;
          role: MemberRole;
          campus_id: string | null;
          created_at: string;
        }[];
      };
      invitation_preview: {
        Args: { p_token: string };
        Returns: {
          organization_name: string;
          email: string;
          role: MemberRole;
          expires_at: string;
          accepted: boolean;
        }[];
      };
    };
    Enums: {
      member_role: MemberRole;
      sunday_status: SundayStatus;
      meeting_status: MeetingStatus;
      offering_count_status: OfferingCountStatus;
      week_status: WeekStatus;
      week_concept_kind: WeekConceptKind;
      purchase_status: PurchaseStatus;
      payment_status: PaymentStatus;
      sales_session_status: SalesSessionStatus;
    };
    CompositeTypes: Record<never, never>;
  };
};
