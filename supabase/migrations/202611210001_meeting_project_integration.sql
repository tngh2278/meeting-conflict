-- Apply after the existing meeting tables are present. Existing records stay unclassified.
begin;

create table public.meeting_projects (
    project_id uuid primary key default gen_random_uuid(),
    team_id uuid not null references public.teams (team_id) on delete cascade,
    name text not null check (char_length(btrim(name)) between 1 and 100),
    unique (team_id, name),
    unique (team_id, project_id)
);

alter table public.meeting_projects enable row level security;
grant select, insert on public.meeting_projects to authenticated;

create policy meeting_projects_read on public.meeting_projects
    for select to authenticated using (public.is_team_member(team_id));

create policy meeting_projects_create on public.meeting_projects
    for insert to authenticated with check (public.is_team_member(team_id));

alter table public.conflict_candidates
    add column project_id uuid,
    add constraint conflict_candidates_team_project_fkey
        foreign key (team_id, project_id)
        references public.meeting_projects (team_id, project_id);

alter table public.meeting_decisions
    add column project_id uuid references public.meeting_projects (project_id);

-- 검토 완료, 기존 결정 교체, 이력·알림을 한 트랜잭션에서 처리한다.
create function public.apply_meeting_candidate_resolution(
    p_candidate_id uuid,
    p_method text,
    p_reason text,
    p_previous_decision_id uuid default null
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_team_id uuid;
    v_meeting_id uuid;
    v_meeting_status text;
    v_candidate public.conflict_candidates%rowtype;
    v_previous public.meeting_decisions%rowtype;
    v_new_decision_id uuid;
    v_after text;
    v_next_status text;
begin
    if p_method is null or p_method not in ('new', 'keep', 'replace', 'exception', 'hold')
        or nullif(btrim(p_reason), '') is null
        or (p_method = 'new') <> (p_previous_decision_id is null) then
        raise exception '처리 방식, 사유, 비교 대상을 확인해 주세요.' using errcode = '22023';
    end if;

    select c.team_id, c.meeting_id into v_team_id, v_meeting_id
    from public.conflict_candidates c where c.candidate_id = p_candidate_id;

    if not found or not exists (
        select 1 from public.team_members tm
        where tm.team_id = v_team_id and tm.user_id = v_actor
          and tm.role = 'ADMIN' and tm.status = 'ACCEPTED'
    ) then
        raise exception '이 팀의 관리자만 결정을 처리할 수 있습니다.' using errcode = '42501';
    end if;

    -- 같은 회의록의 관리 처리는 순서대로 진행해 완료 상태를 일관되게 갱신한다.
    select m.status into v_meeting_status
    from public.meetings m
    where m.meeting_id = v_meeting_id and m.team_id = v_team_id and m.deleted_at is null
    for update;
    if not found then
        raise exception '처리할 회의록을 찾을 수 없습니다.' using errcode = '22023';
    end if;

    select c.* into v_candidate from public.conflict_candidates c
    where c.candidate_id = p_candidate_id and c.team_id = v_team_id and c.meeting_id = v_meeting_id
    for update;
    if not found or (
        (v_meeting_status = 'submitted' and v_candidate.status = 'confirmed')
        or (v_meeting_status in ('submitted', 'done') and v_candidate.status = 'resolved'
            and v_candidate.resolution = 'hold')
    ) is not true then
        raise exception '더 이상 처리할 수 없는 후보입니다. 화면을 다시 불러와 주세요.' using errcode = '22023';
    end if;

    if p_previous_decision_id is not null then
        select d.* into v_previous
        from public.meeting_decisions d
        join public.meetings m on m.meeting_id = d.meeting_id
        where d.decision_id = p_previous_decision_id
          and m.team_id = v_team_id and m.deleted_at is null
          and d.meeting_id <> v_meeting_id and d.is_active and not d.is_action_item
          and d.project_id = v_candidate.project_id
        for update of d;
        if not found then
            raise exception '같은 프로젝트의 유효한 비교 대상이 아닙니다. 다시 비교해 주세요.' using errcode = '22023';
        end if;
    end if;

    if p_method = 'replace' then
        update public.meeting_decisions set is_active = false where decision_id = v_previous.decision_id;
        update public.tasks set recheck = true
        where team_id = v_team_id and decision_id = v_previous.decision_id;
    end if;

    if p_method in ('new', 'replace', 'exception') then
        insert into public.meeting_decisions (
            meeting_id, project_id, decision_text, assignee_name, assignee_user_id, due_date,
            source_page_number, source_paragraph_number, source_text,
            is_action_item, is_active, is_exception
        ) values (
            v_meeting_id, v_candidate.project_id, v_candidate.decision_text,
            v_candidate.assignee_name, v_candidate.assignee_user_id, v_candidate.due_date,
            v_candidate.source_page_number, v_candidate.source_paragraph_number, v_candidate.source_text,
            false, true, p_method = 'exception'
        ) returning decision_id into v_new_decision_id;
    end if;

    v_after := case p_method
        when 'keep' then v_previous.decision_text
        when 'hold' then '논의 중으로 보류'
        else v_candidate.decision_text
    end;

    update public.conflict_candidates
    set matched_decision_id = v_previous.decision_id,
        status = 'resolved',
        resolution = case when p_method = 'new' then 'replace' else p_method end,
        resolution_reason = btrim(p_reason),
        resolved_by = v_actor,
        resolved_at = now()
    where candidate_id = p_candidate_id;

    insert into public.decision_history (
        team_id, decision_id, new_decision_id, meeting_id, method, before_text, after_text,
        reason, actor_user_id, evidence_page_number, evidence_paragraph_number, evidence_text
    ) values (
        v_team_id, v_previous.decision_id, v_new_decision_id, v_meeting_id, p_method,
        v_previous.decision_text, v_after, btrim(p_reason), v_actor, v_candidate.source_page_number,
        v_candidate.source_paragraph_number, v_candidate.source_text
    );

    if v_candidate.assignee_user_id is not null and v_candidate.assignee_user_id <> v_actor then
        insert into public.notifications (team_id, user_id, type, title, body, decision_id, candidate_id)
        values (
            v_team_id, v_candidate.assignee_user_id, 'result', '결정 처리 결과',
            v_candidate.decision_text || ' — ' || case p_method
                when 'new' then '신규 결정 반영'
                when 'keep' then '기존 결정 유지'
                when 'replace' then '새 결정으로 교체'
                when 'exception' then '예외로 두기'
                when 'hold' then '논의 중으로 보류'
            end,
            coalesce(v_new_decision_id, v_previous.decision_id), p_candidate_id
        );
    end if;

    v_next_status := case when exists (
        select 1 from public.conflict_candidates c
        where c.meeting_id = v_meeting_id and c.status = 'confirmed'
    ) then 'submitted' else 'done' end;
    update public.meetings set status = v_next_status where meeting_id = v_meeting_id;
end;
$$;

revoke all on function public.apply_meeting_candidate_resolution(uuid, text, text, uuid) from public;
grant execute on function public.apply_meeting_candidate_resolution(uuid, text, text, uuid) to authenticated;

commit;
