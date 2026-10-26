-- Keep conversation history ordered by most recent activity.
create or replace function public.ultron_touch_conversation_on_message()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.conversations
     set updated_at = now()
   where id = new.conversation_id
     and user_id = new.user_id;
  return new;
end;
$$;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.ultron_touch_conversation_on_message();
