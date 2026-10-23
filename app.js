/* ==========================================================================
   app.js - 공통 스크립트
   - 모달 열기/닫기 (data-modal-open, data-modal-close, data-modal)
   - 사이드바 모바일 토글
   - 체크박스 토글
   - 비밀번호 보기/숨기기
   - 알림 패널 토글
   - 워크스페이스 드롭다운 토글
   - 충돌 해결 옵션 선택
   - 탭 전환
   ========================================================================== */

(function () {
  'use strict';

  /* ---------- Modal ---------- */
  function openModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('is-open');
    if (!document.querySelector('.modal-overlay.is-open')) {
      document.body.style.overflow = '';
    }
  }
  function closeAllModals() {
    document.querySelectorAll('.modal-overlay.is-open').forEach(el => el.classList.remove('is-open'));
    document.body.style.overflow = '';
  }

  document.addEventListener('click', (e) => {
    const openBtn = e.target.closest('[data-modal-open]');
    if (openBtn) {
      e.preventDefault();
      const id = openBtn.getAttribute('data-modal-open');
      if (openBtn.hasAttribute('data-modal-close')) {
        closeModal(openBtn.getAttribute('data-modal-close'));
      }
      setTimeout(() => openModal(id), 50);
      return;
    }
    const closeBtn = e.target.closest('[data-modal-close]');
    if (closeBtn) {
      e.preventDefault();
      const id = closeBtn.getAttribute('data-modal-close') ||
                 closeBtn.closest('.modal-overlay')?.getAttribute('id');
      if (id) closeModal(id);
      return;
    }
    // overlay 클릭 시 닫기 (auth 모달은 제외)
    if (e.target.classList?.contains('modal-overlay')) {
      const modal = e.target.querySelector('.modal');
      if (modal && !modal.classList.contains('auth-modal')) {
        closeModal(e.target.getAttribute('id'));
      }
    }
  });

  // ESC 키로 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  /* ---------- Sidebar (mobile) ---------- */
  const menuBtn = document.getElementById('menuBtn');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  if (menuBtn && sidebar) {
    function toggleSidebar(force) {
      const open = (force !== undefined) ? force : !sidebar.classList.contains('is-open');
      sidebar.classList.toggle('is-open', open);
      backdrop?.classList.toggle('is-open', open);
      document.body.style.overflow = open ? 'hidden' : '';
    }
    menuBtn.addEventListener('click', () => toggleSidebar());
    backdrop?.addEventListener('click', () => toggleSidebar(false));
    // 사이드바 메뉴 클릭 시 모바일에서 자동 닫기
    sidebar.querySelectorAll('.sidebar-nav a').forEach(a => {
      a.addEventListener('click', () => { if (window.innerWidth <= 768) toggleSidebar(false); });
    });
  }

  /* ---------- Checkbox ---------- */
  document.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-checkbox]');
    if (cb) {
      e.preventDefault();
      cb.classList.toggle('is-checked');
      cb.setAttribute('aria-checked', cb.classList.contains('is-checked'));
    }
  });

  /* ---------- Toggle ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('.toggle');
    if (t) t.classList.toggle('is-on');
  });

  /* ---------- Password visibility ---------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pw-toggle]');
    if (btn) {
      const input = btn.parentElement.querySelector('input');
      if (input) {
        const isPw = input.type === 'password';
        input.type = isPw ? 'text' : 'password';
        btn.innerHTML = isPw
          ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
          : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
      }
    }
  });

  /* ---------- 비밀번호 강도 검사 ---------- */
  const pwInput = document.getElementById('su-pw');
  if (pwInput) {
    pwInput.addEventListener('input', (e) => {
      const v = e.target.value;
      const rules = {
        length:  v.length >= 8,
        letter:  /[a-zA-Z]/.test(v),
        number:  /[0-9]/.test(v),
        special: /[^a-zA-Z0-9]/.test(v),
      };
      document.querySelectorAll('#pw-rules li').forEach(li => {
        const key = li.getAttribute('data-rule');
        li.classList.toggle('ok', rules[key]);
      });
    });
  }

  /* ---------- 알림 패널 토글 ---------- */
  document.addEventListener('click', (e) => {
    const notifBtn = e.target.closest('[data-notif-toggle]');
    const panel = document.getElementById('notifPanel');
    if (!panel) return;
    if (notifBtn) {
      e.stopPropagation();
      panel.classList.toggle('is-open');
      panel.style.display = panel.classList.contains('is-open') ? 'block' : 'none';
    } else if (!panel.contains(e.target)) {
      panel.classList.remove('is-open');
      panel.style.display = 'none';
    }
  });

  /* ---------- 워크스페이스 드롭다운 ---------- */
  document.addEventListener('click', (e) => {
    const wsBtn = e.target.closest('[data-ws-toggle]');
    const dd = document.getElementById('workspaceDropdown');
    if (!dd) return;
    if (wsBtn) {
      e.stopPropagation();
      dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
    } else if (!dd.contains(e.target)) {
      dd.style.display = 'none';
    }
  });

  /* ---------- 충돌 해결 옵션 선택 ---------- */
  document.querySelectorAll('.resolution-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const group = opt.parentElement;
      group.querySelectorAll('.resolution-option').forEach(o => o.classList.remove('is-selected'));
      opt.classList.add('is-selected');
    });
  });

  /* ---------- 탭 전환 ---------- */
  document.querySelectorAll('[data-tabs]').forEach(tabGroup => {
    const tabs = tabGroup.querySelectorAll('.tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        const target = tab.getAttribute('data-tab-target');
        if (target) {
          const parent = tabGroup.parentElement;
          parent.querySelectorAll('[data-tab-panel]').forEach(p => p.classList.add('hidden'));
          const panel = parent.querySelector(`[data-tab-panel="${target}"]`);
          if (panel) panel.classList.remove('hidden');
        }
      });
    });
  });

  /* ---------- 칩 필터 토글 ---------- */
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-chip-toggle]');
    if (chip) chip.classList.toggle('is-active');
  });

  /* ---------- 드롭존 (파일 업로드) ---------- */
  const dz = document.querySelector('[data-dropzone]');
  if (dz) {
    dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('is-dragover'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('is-dragover'));
    dz.addEventListener('drop', (e) => {
      e.preventDefault();
      dz.classList.remove('is-dragover');
      const file = e.dataTransfer.files[0];
      if (file) showFileSelected(file);
    });
    dz.addEventListener('click', () => {
      const input = document.querySelector('[data-file-input]');
      if (input) input.click();
    });
  }
  function showFileSelected(file) {
    const sel = document.querySelector('[data-file-selected]');
    const empty = document.querySelector('[data-dropzone]');
    if (sel) {
      sel.style.display = 'flex';
      const ext = file.name.split('.').pop().toUpperCase().slice(0, 4);
      sel.querySelector('.file-icon').textContent = ext;
      sel.querySelector('.file-name').textContent = file.name;
      const sizeKb = (file.size / 1024).toFixed(1);
      sel.querySelector('.file-meta').textContent = `${sizeKb} KB · 방금 전`;
    }
    if (empty) empty.style.display = 'none';
  }

  // 전역 노출
  window.LJ = { openModal, closeModal, closeAllModals };
})();
