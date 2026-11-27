// The POS integration contract. CUPPEE never depends on one POS: each POS gets an adapter that
// turns its webhook / export into NormalizedOrder. Add a new POS by writing one adapter file
// and registering it in ./index.ts.

export type NormalizedItem = {
  name: string;
  qty: number;
  priceHkd: number;     // unit price
  posItemRef?: string;  // POS's own item / SKU id
  modifiers?: string[]; // e.g. ["Oat milk", "Less ice"]
};

export type NormalizedOrder = {
  externalId: string;   // POS order / receipt id, unique per provider
  locationRef: string;  // POS shop id, mapped to cafes.pos_location_ref
  orderedAt: number;    // ms epoch
  totalHkd: number;     // amount paid after discounts
  items: NormalizedItem[];
  /** Anything the POS captured that identifies the member: a scanned card QR, a CUPPEE member id or a phone number. */
  memberRef?: string;
  status: 'paid' | 'refunded' | 'void';
};

export type WebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
};

export interface PosAdapter {
  /** Short id used in URLs and cafes.pos_provider, e.g. "generic", "eats365". */
  readonly name: string;
  /** Check the request really came from the POS (signature, shared secret…). */
  verify(req: WebhookRequest, secret: string): boolean;
  /** Turn one webhook delivery into zero or more orders. */
  parse(req: WebhookRequest): NormalizedOrder[];
}
