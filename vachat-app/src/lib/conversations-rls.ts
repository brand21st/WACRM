import { ApiError } from '@/lib/api-error';
import { getSupabase } from '@/lib/supabase';
import type { MobileConversation, MobileConversationContact } from '@/types/conversations';

const CONVERSATION_SELECT = '*, contact:contacts(id, phone, name, email, company, avatar_url)';

type RawContact = {
  id: string;
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  avatar_url?: string | null;
};

type RawConversation = {
  id: string;
  status: MobileConversation['status'];
  assigned_agent_id?: string | null;
  last_message_text?: string | null;
  last_message_at?: string | null;
  last_customer_message_at?: string | null;
  unread_count?: number;
  ai_autoreply_disabled?: boolean;
  customer_service_expires_at?: string | null;
  created_at: string;
  updated_at: string;
  contact?: RawContact | RawContact[] | null;
  contact_id?: string;
};

function mapContact(raw: RawContact | RawContact[] | null | undefined): MobileConversationContact | null {
  const contact = Array.isArray(raw) ? raw[0] : raw;
  if (!contact) return null;
  return {
    id: contact.id,
    phone: contact.phone,
    name: contact.name ?? null,
    email: contact.email ?? null,
    company: contact.company ?? null,
    avatar_url: contact.avatar_url ?? null,
    tags: [],
  };
}

function expiresAt(row: RawConversation): string | null {
  if (row.customer_service_expires_at) {
    const date = new Date(row.customer_service_expires_at);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (!row.last_customer_message_at) return null;
  const start = new Date(row.last_customer_message_at).getTime();
  if (Number.isNaN(start)) return null;
  return new Date(start + 24 * 60 * 60 * 1000).toISOString();
}

export function mapConversationRow(row: RawConversation): MobileConversation {
  return {
    id: row.id,
    status: row.status,
    assigned_agent_id: row.assigned_agent_id ?? null,
    last_message_text: row.last_message_text ?? null,
    last_message_at: row.last_message_at ?? null,
    unread_count: row.unread_count ?? 0,
    ai_autoreply_disabled: row.ai_autoreply_disabled === true,
    customer_service_expires_at: expiresAt(row),
    created_at: row.created_at,
    updated_at: row.updated_at,
    contact: mapContact(row.contact),
  };
}

async function loadContact(contactId: string | undefined): Promise<MobileConversationContact | null> {
  if (!contactId) return null;
  const { data, error } = await getSupabase()
    .from('contacts')
    .select('id, phone, name, email, company, avatar_url')
    .eq('id', contactId)
    .maybeSingle();
  if (error || !data) return null;
  return mapContact(data as RawContact);
}

export async function loadConversationViaRls(id: string): Promise<MobileConversation> {
  const supabase = getSupabase();
  const withContact = await supabase
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .eq('id', id)
    .maybeSingle();

  if (!withContact.error && withContact.data) {
    return mapConversationRow(withContact.data as RawConversation);
  }

  const plain = await supabase.from('conversations').select('*').eq('id', id).maybeSingle();
  if (plain.error) throw new Error(plain.error.message);
  if (!plain.data) throw new ApiError(404, 'Conversation not found', 'not_found', 'not_found');

  const row = plain.data as RawConversation;
  const mapped = mapConversationRow(row);
  if (mapped.contact) return mapped;
  return { ...mapped, contact: await loadContact(row.contact_id) };
}

export type ConversationAutoreplyResult = {
  success: boolean;
  paused: boolean;
  conversation: MobileConversation;
};

/** Per-thread AI pause/resume — mirrors POST /api/ai/autoreply/[id]. */
export async function setConversationAutoreplyViaRls(
  conversationId: string,
  body: { paused: boolean; assign_to_me?: boolean },
): Promise<ConversationAutoreplyResult> {
  const supabase = getSupabase();
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) {
    throw new ApiError(401, 'Session expired', 'unauthorized', 'unauthorized');
  }

  const update: Record<string, unknown> = { ai_autoreply_disabled: body.paused };
  if (body.paused) {
    if (body.assign_to_me) update.assigned_agent_id = userId;
  } else {
    update.assigned_agent_id = null;
    update.ai_reply_count = 0;
    update.ai_handoff_summary = null;
  }

  const { error } = await supabase.from('conversations').update(update).eq('id', conversationId);
  if (error) {
    throw new ApiError(500, error.message, 'server', 'server');
  }

  const conversation = await loadConversationViaRls(conversationId);
  return { success: true, paused: body.paused, conversation };
}

export async function loadConversationsViaRls(): Promise<MobileConversation[]> {
  const supabase = getSupabase();
  const withContact = await supabase
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .order('last_message_at', { ascending: false })
    .limit(100);

  if (!withContact.error) {
    return ((withContact.data ?? []) as RawConversation[]).map(mapConversationRow);
  }

  const plain = await supabase
    .from('conversations')
    .select('*')
    .order('last_message_at', { ascending: false })
    .limit(100);
  if (plain.error) throw new Error(plain.error.message);

  const rows = (plain.data ?? []) as RawConversation[];
  return Promise.all(
    rows.map(async (row) => {
      const mapped = mapConversationRow(row);
      if (mapped.contact) return mapped;
      return { ...mapped, contact: await loadContact(row.contact_id) };
    }),
  );
}
