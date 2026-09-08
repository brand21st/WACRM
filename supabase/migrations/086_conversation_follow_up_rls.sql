-- Align conversation_follow_ups write policies with conversations
-- (agent+), so a human send or inbox takeover can cancel a pending row.

DROP POLICY IF EXISTS conversation_follow_ups_insert ON conversation_follow_ups;
CREATE POLICY conversation_follow_ups_insert ON conversation_follow_ups
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS conversation_follow_ups_update ON conversation_follow_ups;
CREATE POLICY conversation_follow_ups_update ON conversation_follow_ups
  FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS conversation_follow_ups_delete ON conversation_follow_ups;
CREATE POLICY conversation_follow_ups_delete ON conversation_follow_ups
  FOR DELETE
  USING (is_account_member(account_id, 'agent'));
