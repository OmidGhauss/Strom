-- Block 5: lead_status_history und lead_notes
--
-- lead_status_history ist unveränderlich – kein updated_at, kein Trigger.
-- Jeder Eintrag ist eine abgeschlossene Tatsache.
--
-- lead_notes sind editierbar (Tippfehler, Ergänzungen) – updated_at mit Trigger.
-- Editierbarkeit ist auf den Autor beschränkt; das ist RLS-Logik (Block 8).

-- ---------------------------------------------------------------------------
-- Tabelle: lead_status_history
--
-- old_status ist nullable: beim allerersten Statuswechsel (NULL → 'new')
-- existiert kein Vorgängerstatus.
--
-- changed_by ist nullable: systemgenerierte Statuswechsel haben keinen
-- menschlichen Urheber. SET NULL stellt sicher, dass der Eintrag erhalten
-- bleibt, wenn ein Profil (theoretisch) entfernt würde.
--
-- Statuswechsel werden ausschließlich durch Anwendungscode erzeugt –
-- kein Datenbank-Trigger, weil changed_by auf SQL-Ebene nicht bekannt ist.
-- ---------------------------------------------------------------------------

CREATE TABLE lead_status_history (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid        NOT NULL,
  old_status  lead_status NULL,
  new_status  lead_status NOT NULL,
  changed_by  uuid        NULL,
  reason      text        NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_lsh_lead
    FOREIGN KEY (lead_id)
    REFERENCES leads(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_lsh_changed_by
    FOREIGN KEY (changed_by)
    REFERENCES profiles(id)
    ON DELETE SET NULL
);

CREATE INDEX idx_lsh_lead_created
  ON lead_status_history (lead_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Tabelle: lead_notes
--
-- created_by ist NOT NULL: eine Notiz hat immer einen menschlichen Autor.
-- RESTRICT verhindert, dass ein Profil entfernt werden kann, solange es
-- Notizen autorisiert hat. Da Profile ohnehin nie gelöscht werden, ist
-- dies ein zusätzlicher Schutz.
-- ---------------------------------------------------------------------------

CREATE TABLE lead_notes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid        NOT NULL,
  created_by  uuid        NOT NULL,
  note        text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fk_ln_lead
    FOREIGN KEY (lead_id)
    REFERENCES leads(id)
    ON DELETE CASCADE,

  CONSTRAINT fk_ln_created_by
    FOREIGN KEY (created_by)
    REFERENCES profiles(id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_ln_lead_created
  ON lead_notes (lead_id, created_at DESC);

CREATE TRIGGER set_lead_notes_updated_at
  BEFORE UPDATE ON lead_notes
  FOR EACH ROW
  EXECUTE FUNCTION trigger_set_updated_at();
