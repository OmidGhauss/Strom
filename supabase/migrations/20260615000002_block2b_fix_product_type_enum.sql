-- Block 2b: product_type Enum Korrektur
-- Entfernt 'business' aus product_type.
-- 'business' beschreibt ein Kundensegment, nicht eine Energieart –
-- das gehört ausschließlich in customer_type.
--
-- DROP + Recreate ist sicher: kein Table-Column referenziert product_type bisher.

DROP TYPE product_type;

CREATE TYPE product_type AS ENUM (
  'electricity',
  'gas',
  'both'
);
