-- Native roles can be represented before the full workspace role UI ships.
-- Public invitations remain equal owners; private doors deny lower roles until
-- their own scoped permission is implemented. Move-in admits owner and admin.
DROP TRIGGER dial_equal_operator_role_insert;
DROP TRIGGER dial_equal_operator_role_update;
