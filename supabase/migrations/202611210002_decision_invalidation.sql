begin;

alter table public.decision_history
    drop constraint decision_history_method_check,
    add constraint decision_history_method_check
        check (method in ('new', 'keep', 'replace', 'exception', 'hold', 'invalidate'));

-- 결정 승인 RPC와 회의록 삭제는 같은 meetings 행의 잠금을 사용한다.
create function public.prevent_deleting_meeting_with_active_decisions() returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if exists (
        select 1 from public.meeting_decisions d
        where d.meeting_id = old.meeting_id and d.is_active and not d.is_action_item
    ) then
        raise exception '유효한 결정이 연결된 회의록은 삭제할 수 없습니다.' using errcode = '23514';
    end if;
    return new;
end;
$$;

create trigger meetings_protect_active_decisions
before update of deleted_at on public.meetings
for each row when (old.deleted_at is null and new.deleted_at is not null)
execute function public.prevent_deleting_meeting_with_active_decisions();

create function public.invalidate_meeting_decision(p_decision_id uuid, p_reason text) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_reason text := btrim(p_reason, E' \t\r\n');
    v_decision record;
begin
    if v_reason is null or v_reason = '' then
        raise exception '무효 처리 사유를 입력해 주세요.' using errcode = '22023';
    end if;

    -- 유효한 결정만 처리하므로 연속 요청에도 이력이 한 번만 저장된다.
    update public.meeting_decisions d
    set is_active = false
    from public.meetings m
    where d.decision_id = p_decision_id and d.meeting_id = m.meeting_id
        and d.is_active and not d.is_action_item and m.deleted_at is null
        and m.team_id = any (public.get_my_admin_team_ids())
    returning d.*, m.team_id into v_decision;

    if not found then
        raise exception '무효 처리할 수 없는 결정입니다. 권한과 결정 상태를 확인해 주세요.' using errcode = '22023';
    end if;

    insert into public.decision_history (
        team_id, decision_id, meeting_id, method, before_text, after_text, reason,
        actor_user_id, evidence_page_number, evidence_paragraph_number, evidence_text
    ) values (
        v_decision.team_id, v_decision.decision_id, v_decision.meeting_id,
        'invalidate', v_decision.decision_text, '무효 처리됨', v_reason, auth.uid(),
        v_decision.source_page_number, v_decision.source_paragraph_number, v_decision.source_text
    );
end;
$$;

revoke all on function public.invalidate_meeting_decision(uuid, text) from public, anon;
grant execute on function public.invalidate_meeting_decision(uuid, text) to authenticated;

commit;
