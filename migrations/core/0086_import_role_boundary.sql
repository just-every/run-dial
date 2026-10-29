-- Native roles can be represented before the full workspace role UI ships.
-- Public invitations remain equal owners; private doors deny lower roles until
-- their own scoped permission is implemented. Move-in admits owner and admin.
-- Existing owners retain equal authority while scoped role management is absent.
DROP TRIGGER dial_equal_operator_role_insert;
DROP TRIGGER dial_equal_operator_role_update;
CREATE TRIGGER dial_equal_operator_role_update BEFORE UPDATE OF role ON oa_operators
 WHEN OLD.role = 'owner' AND NEW.role != 'owner'
 BEGIN SELECT RAISE(ABORT,'dial_equal_operators'); END;
