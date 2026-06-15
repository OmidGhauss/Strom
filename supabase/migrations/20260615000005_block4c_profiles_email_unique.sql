-- Block 4c: profiles.email UNIQUE
-- auth.users.email ist in Supabase Auth bereits UNIQUE.
-- profiles.email ist eine Kopie dieses Felds – der Constraint hier
-- bringt die Datenbank in Einklang mit der fachlichen Realität.

ALTER TABLE profiles
  ADD CONSTRAINT uq_profiles_email UNIQUE (email);
