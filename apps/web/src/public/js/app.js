function makeCode(value) {
  const clean = String(value || '').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word[0]).join('').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (words.length > 1 && initials.length >= 2) return initials.slice(0, 12);
  return clean.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function bindAutoCode(nameId, codeId) {
  const nameInput = document.getElementById(nameId);
  const codeInput = document.getElementById(codeId);
  if (!nameInput || !codeInput) return;

  let userEditedCode = Boolean(codeInput.value);
  codeInput.addEventListener('input', () => { userEditedCode = true; });
  nameInput.addEventListener('input', () => {
    if (userEditedCode) return;
    codeInput.value = makeCode(nameInput.value);
  });
}

function debounce(fn, wait = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

function sanitizeClientLetters(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6);
}

function setStatusText(targetId, message, ok = null) {
  if (!targetId) return;
  const target = document.getElementById(targetId);
  if (!target) return;
  target.textContent = message;
  target.classList.toggle('ok', ok === true);
  target.classList.toggle('bad', ok === false);
}

function bindClientCodeSuggestions() {
  document.querySelectorAll('[data-client-code-name]').forEach((nameInput) => {
    const codeId = nameInput.dataset.clientCodeName;
    const codeInput = document.getElementById(codeId);
    if (!codeInput) return;

    const statusId = nameInput.dataset.codeStatus || codeInput.dataset.codeStatus;
    let userEditedCode = Boolean(codeInput.value);

    const check = debounce(async () => {
      const excludeClientId = nameInput.dataset.excludeClientId || codeInput.dataset.excludeClientId || '';
      const name = nameInput.value || '';
      const manualCode = userEditedCode ? sanitizeClientLetters(codeInput.value) : '';
      if (userEditedCode) codeInput.value = manualCode;

      if (!name.trim() && !manualCode) {
        setStatusText(statusId, 'Short code must be exactly 6 letters and unique.', null);
        return;
      }

      try {
        const params = new URLSearchParams({ name, shortCode: manualCode, excludeClientId });
        const response = await fetch(`/client-code/suggest?${params.toString()}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.message || 'Unable to check code.');
        if (!userEditedCode || codeInput.value.length < 6) codeInput.value = payload.shortCode || '';
        const valid = /^[A-Z]{6}$/.test(codeInput.value || '') && payload.available;
        setStatusText(statusId, valid ? `${codeInput.value} is available.` : (payload.message || 'Code is not available.'), valid);
      } catch (error) {
        setStatusText(statusId, error.message || 'Unable to check code right now.', false);
      }
    });

    codeInput.addEventListener('input', () => {
      userEditedCode = true;
      codeInput.value = sanitizeClientLetters(codeInput.value);
      if (codeInput.value.length === 6) check();
      else setStatusText(statusId, 'Short code must be exactly 6 letters.', false);
    });

    nameInput.addEventListener('input', () => {
      if (userEditedCode && !codeInput.value) userEditedCode = false;
      if (!userEditedCode) check();
    });

    if (nameInput.value || codeInput.value) check();
  });
}

function bindAvailabilityChecks() {
  document.querySelectorAll('.availability-group').forEach((group) => {
    const parent = group.querySelector('.parent-checkbox');
    const children = [...group.querySelectorAll('.child-checkbox')];
    if (!parent) return;

    const syncParent = () => { parent.checked = children.some((child) => child.checked); };

    parent.addEventListener('change', () => {
      if (!parent.checked) children.forEach((child) => { child.checked = false; });
      if (parent.checked && children.length === 1) children[0].checked = true;
    });

    children.forEach((child) => child.addEventListener('change', syncParent));
    syncParent();
  });
}

function bindFilterLists() {
  document.querySelectorAll('[data-filter-input]').forEach((input) => {
    const key = input.dataset.filterInput;
    const list = document.querySelector(`[data-filter-list="${key}"]`);
    if (!list) return;

    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      list.querySelectorAll('[data-filter-item]').forEach((item) => {
        const text = item.dataset.filterItem || item.textContent.toLowerCase();
        item.hidden = Boolean(query) && !text.includes(query);
      });
    });
  });
}

function prepareClientModal(trigger, modal) {
  const parentIdInput = modal.querySelector('#clientParentId');
  const parentLabel = modal.querySelector('#clientParentLabel');
  const title = modal.querySelector('#clientModalTitle');
  const nameInput = modal.querySelector('#clientName');
  const codeInput = modal.querySelector('#clientShortCode');
  const codeStatus = modal.querySelector('#clientCodeStatus');

  if (!parentIdInput) return;
  const parentId = trigger.dataset.parentId || '';
  const parentName = trigger.dataset.parentName || '';
  parentIdInput.value = parentId;
  if (title) title.textContent = parentId ? 'New child client' : 'New root client';
  if (parentLabel) {
    parentLabel.hidden = !parentId;
    parentLabel.innerHTML = parentId ? `Parent: <strong>${parentName}</strong>` : '';
  }
  if (nameInput) nameInput.value = '';
  if (codeInput) codeInput.value = '';
  if (codeStatus) {
    codeStatus.textContent = 'Short code must be exactly 6 letters and unique.';
    codeStatus.classList.remove('ok', 'bad');
  }
}

function bindModals() {
  document.querySelectorAll('[data-open-modal]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      const modal = document.getElementById(trigger.dataset.openModal);
      if (!modal) return;
      prepareClientModal(trigger, modal);
      const lazyFrame = modal.querySelector('iframe[data-src]');
      if (lazyFrame && !lazyFrame.getAttribute('src')) lazyFrame.setAttribute('src', lazyFrame.dataset.src);
      if (!modal.open && typeof modal.showModal === 'function') modal.showModal();
    });
  });

  document.querySelectorAll('[data-close-modal]').forEach((trigger) => {
    trigger.addEventListener('click', () => trigger.closest('dialog')?.close());
  });

  document.querySelectorAll('dialog.modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) modal.close();
    });
  });
}

function bindSlaRuleBasis() {
  document.querySelectorAll('[data-rule-basis]').forEach((select) => {
    const form = select.closest('form');
    if (!form) return;
    const severityField = form.querySelector('[data-severity-field]');
    const priorityField = form.querySelector('[data-priority-field]');
    const sync = () => {
      const priorityMode = select.value === 'priority';
      if (severityField) severityField.hidden = priorityMode;
      if (priorityField) priorityField.hidden = !priorityMode;
    };
    select.addEventListener('change', sync);
    sync();
  });
}

function bindToggleSections() {
  document.querySelectorAll('[data-toggle-section]').forEach((input) => {
    const syncGroup = () => {
      document.querySelectorAll(`[name="${input.name}"][data-toggle-section]`).forEach((radio) => {
        const section = document.getElementById(radio.dataset.toggleSection);
        if (!section) return;
        const show = radio.checked && radio.value === radio.dataset.toggleValue;
        section.hidden = !show;
      });
    };
    input.addEventListener('change', syncGroup);
    syncGroup();
  });
}

bindAutoCode('organizationName', 'shortCode');
bindClientCodeSuggestions();
bindAvailabilityChecks();
bindFilterLists();
bindModals();
bindSlaRuleBasis();
bindToggleSections();

function timezoneOffsetLabel(zone) {
  try {
    const parts = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'shortOffset', hour: '2-digit' }).formatToParts(new Date());
    return parts.find((part) => part.type === 'timeZoneName')?.value || '';
  } catch { return ''; }
}

function friendlyTimezoneLabel(zone) {
  if (!zone) return '';
  const city = zone === 'UTC' ? 'UTC' : zone.split('/').at(-1).replace(/_/g, ' ');
  const offset = timezoneOffsetLabel(zone);
  return [city, offset, zone].filter(Boolean).join(' · ');
}

function bindTimezoneSelects() {
  const fallback = [
    'Africa/Johannesburg','Africa/Nairobi','Africa/Lagos','America/Chicago','America/Los_Angeles','America/New_York',
    'Asia/Dubai','Asia/Hong_Kong','Asia/Kolkata','Asia/Riyadh','Asia/Singapore','Asia/Tokyo','Australia/Sydney',
    'Europe/Amsterdam','Europe/Berlin','Europe/London','Europe/Paris','Pacific/Auckland','UTC'
  ];
  let zones = fallback;
  try {
    if (typeof Intl.supportedValuesOf === 'function') zones = Intl.supportedValuesOf('timeZone');
  } catch {}

  document.querySelectorAll('[data-timezone-select]').forEach((select) => {
    const selected = String(select.dataset.selectedTimezone || select.value || '').trim();
    const values = [...new Set([selected, ...zones].filter(Boolean))].sort((a,b) => a.localeCompare(b));
    select.innerHTML = '<option value="">Search or choose timezone</option>';
    values.forEach((zone) => {
      const option = document.createElement('option');
      option.value = zone;
      option.textContent = friendlyTimezoneLabel(zone);
      option.selected = zone === selected;
      select.appendChild(option);
    });
    if (!select.previousElementSibling?.matches('[data-timezone-search]')) {
      const search = document.createElement('input');
      search.type = 'search';
      search.placeholder = 'Search city or timezone…';
      search.dataset.timezoneSearch = 'true';
      search.className = 'timezone-search';
      const all = [...select.options].map((option) => ({ value: option.value, text: option.textContent, selected: option.selected }));
      search.addEventListener('input', () => {
        const query = search.value.trim().toLowerCase();
        const current = select.value;
        select.innerHTML = '';
        all.filter((item, index) => index === 0 || !query || item.text.toLowerCase().includes(query) || item.value.toLowerCase().includes(query)).forEach((item) => {
          const option = document.createElement('option');
          option.value = item.value; option.textContent = item.text; option.selected = item.value === current; select.appendChild(option);
        });
        if (current && ![...select.options].some((option) => option.value === current)) {
          const match = all.find((item) => item.value === current);
          if (match) { const option = document.createElement('option'); option.value = match.value; option.textContent = match.text; option.selected = true; select.prepend(option); }
        }
      });
      select.parentNode.insertBefore(search, select);
    }
  });
}

function bindClientGeography() {
  document.querySelectorAll('[data-client-geography]').forEach((group) => {
    const region = group.querySelector('[data-geography-region]');
    const subregion = group.querySelector('[data-geography-subregion]');
    const timezone = group.querySelector('[data-context-timezone]');
    if (!region || !subregion || !timezone) return;
    const allSubregions = [...subregion.options].map((option) => ({
      value: option.value,
      label: option.textContent,
      regionId: option.dataset.regionId || '',
      timezone: option.dataset.timezone || '',
      selected: option.selected
    }));
    const initiallySelectedSubregion = String(subregion.dataset.selectedSubregion || subregion.value || '');
    const initiallySelectedTimezone = String(timezone.dataset.selectedTimezone || timezone.value || '');

    const syncSubregions = () => {
      const regionId = region.value;
      const previous = subregion.value || initiallySelectedSubregion;
      subregion.innerHTML = '<option value="">No subregion</option>';
      allSubregions.filter((item) => item.value && item.regionId === regionId).forEach((item) => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        option.dataset.regionId = item.regionId;
        option.dataset.timezone = item.timezone;
        if (item.value === previous) option.selected = true;
        subregion.appendChild(option);
      });
    };

    const syncTimezones = () => {
      const regionOption = region.selectedOptions[0];
      const subregionOption = subregion.selectedOptions[0];
      const regionId = region.value;
      const candidates = [];
      if (subregion.value && subregionOption?.dataset.timezone) candidates.push(subregionOption.dataset.timezone);
      if (regionOption?.dataset.timezone) candidates.push(regionOption.dataset.timezone);
      allSubregions.filter((item) => item.regionId === regionId && item.timezone).forEach((item) => candidates.push(item.timezone));
      if (initiallySelectedTimezone && regionId) candidates.push(initiallySelectedTimezone);
      const unique = [...new Set(candidates.filter(Boolean))];
      const current = timezone.value || initiallySelectedTimezone;
      timezone.innerHTML = regionId ? '<option value="">Choose timezone</option>' : '<option value="">Select region first</option>';
      unique.forEach((zone) => {
        const option = document.createElement('option');
        option.value = zone;
        option.textContent = friendlyTimezoneLabel(zone);
        option.selected = zone === current;
        timezone.appendChild(option);
      });
      if (unique.length === 1) {
        timezone.value = unique[0];
        timezone.dataset.autoSelected = 'true';
      } else {
        timezone.removeAttribute('data-auto-selected');
      }
      timezone.disabled = !regionId || unique.length <= 1;
      if (timezone.disabled) {
        let hidden = group.querySelector('input[data-timezone-hidden]');
        if (!hidden) {
          hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = timezone.name; hidden.dataset.timezoneHidden = 'true'; group.appendChild(hidden);
        }
        hidden.value = timezone.value || '';
        timezone.removeAttribute('name');
      } else {
        const hidden = group.querySelector('input[data-timezone-hidden]');
        if (hidden) hidden.remove();
        if (!timezone.name) timezone.name = 'timezone';
      }
    };

    region.addEventListener('change', () => { subregion.value = ''; syncSubregions(); syncTimezones(); });
    subregion.addEventListener('change', syncTimezones);
    syncSubregions();
    if (initiallySelectedSubregion) subregion.value = initiallySelectedSubregion;
    syncTimezones();
  });
}

bindTimezoneSelects();
bindClientGeography();


function bindContextualAssignments() {
  const defaultLevelForRole = (role) => {
    if (role === 'clientUser') return 'L1';
    if (role === 'partnerUser') return 'L2';
    return 'L3';
  };
  const roleHint = (role) => {
    if (role === 'clientUser') return 'Client portal access only';
    if (role === 'partnerUser') return 'Partner portal and assigned support scope';
    if (role === 'agentManager') return 'Agent portal with manager access';
    if (role === 'engagementManager') return 'Engagement oversight for this client';
    return 'Agent portal access for this client';
  };

  document.querySelectorAll('[data-assignment-builder]').forEach((builder) => {
    const profile = builder.querySelector('[data-assignment-profile]');
    const rows = [...builder.querySelectorAll('[data-assignment-row]')];

    const syncRow = (row, chooseDefault = false) => {
      const use = row.querySelector('[data-assignment-use]');
      const role = row.querySelector('[data-assignment-role]');
      const levels = [...row.querySelectorAll('[data-assignment-level]')];
      const levelWrap = row.querySelector('[data-assignment-levels]');
      const scopeLabel = row.querySelector('[data-assignment-scope-label]');
      const includeChildren = row.querySelector('[data-assignment-child]');
      const hint = row.querySelector('[data-assignment-role-hint]');
      if (!use || !role) return;

      if (chooseDefault || !levels.some((input) => input.checked)) {
        const target = defaultLevelForRole(role.value);
        levels.forEach((input) => { input.checked = input.value === target; });
      }

      const enabled = use.checked;
      role.disabled = !enabled;
      levels.forEach((input) => { input.disabled = !enabled; });
      if (includeChildren) includeChildren.disabled = !enabled;
      row.classList.toggle('assignment-row-active', enabled);
      if (hint) hint.textContent = roleHint(role.value);

      const clientOnly = role.value === 'clientUser';
      if (levelWrap) levelWrap.hidden = clientOnly;
      if (scopeLabel) {
        scopeLabel.hidden = !clientOnly;
        scopeLabel.textContent = 'Client portal';
      }
    };

    rows.forEach((row) => {
      const use = row.querySelector('[data-assignment-use]');
      const role = row.querySelector('[data-assignment-role]');
      if (!use || !role) return;
      use.addEventListener('change', () => syncRow(row, use.checked));
      role.addEventListener('change', () => syncRow(row, true));
      syncRow(row, false);
    });

    if (profile) {
      profile.addEventListener('change', () => {
        rows.forEach((row) => {
          const use = row.querySelector('[data-assignment-use]');
          const role = row.querySelector('[data-assignment-role]');
          if (!use || !role || use.checked) return;
          role.value = profile.value;
          syncRow(row, true);
        });
        const note = builder.querySelector('.assignment-profile-note strong');
        if (note) note.textContent = profile.selectedOptions[0]?.textContent || 'Selected profile';
      });
    }
  });
}

bindContextualAssignments();

function bindRoleTabs() {
  const buttons = [...document.querySelectorAll('[data-role-filter]')];
  if (!buttons.length) return;
  const search = document.querySelector('[data-filter-input="users"]');
  const apply = () => {
    const active = buttons.find((button) => button.classList.contains('active')) || buttons[0];
    const role = active?.dataset.roleFilter || 'all';
    const query = String(search?.value || '').trim().toLowerCase();
    document.querySelectorAll('[data-user-roles]').forEach((row) => {
      const roles = String(row.dataset.userRoles || '').split(/\s+/).filter(Boolean);
      const text = String(row.dataset.filterItem || row.textContent || '').toLowerCase();
      const roleMatch = role === 'all' || roles.includes(role);
      const searchMatch = !query || text.includes(query);
      row.hidden = !(roleMatch && searchMatch);
    });
  };
  buttons.forEach((button) => button.addEventListener('click', () => {
    button.closest('[data-tab-group]')?.querySelectorAll('[data-role-filter]').forEach((item) => item.classList.toggle('active', item === button));
    apply();
  }));
  search?.addEventListener('input', () => window.setTimeout(apply, 0));
  apply();
}

bindRoleTabs();

function bindAttachmentPicker() {
  document.querySelectorAll('[data-attachment-picker]').forEach((input) => {
    const form = input.closest('form');
    const hidden = form?.querySelector('[data-attachment-names]');
    const list = form?.querySelector('[data-attachment-list]');
    const render = () => {
      const names = [...(input.files || [])].map((file) => file.name).filter(Boolean);
      if (hidden) hidden.value = names.join('||');
      if (list) list.textContent = names.length ? names.join(', ') : 'No files selected.';
    };
    input.addEventListener('change', render);
    render();
  });
}

function bindIncludeChildrenCascade() {
  document.querySelectorAll('[data-assignment-builder]').forEach((builder) => {
    const rows = [...builder.querySelectorAll('[data-assignment-row][data-client-id]')];
    if (!rows.length) return;
    const descendantsOf = (clientId) => rows.filter((row) => String(row.dataset.pathIds || '').split(',').includes(String(clientId)));

    rows.forEach((row) => {
      const include = row.querySelector('[data-assignment-child]');
      const use = row.querySelector('[data-assignment-use]');
      const role = row.querySelector('[data-assignment-role]');
      const levels = [...row.querySelectorAll('[data-assignment-level]')];
      if (!include || !use) return;
      include.addEventListener('change', () => {
        if (!include.checked) return;
        descendantsOf(row.dataset.clientId).forEach((childRow) => {
          const childUse = childRow.querySelector('[data-assignment-use]');
          const childRole = childRow.querySelector('[data-assignment-role]');
          const childLevels = [...childRow.querySelectorAll('[data-assignment-level]')];
          if (childUse) {
            childUse.checked = true;
            childUse.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (role && childRole) childRole.value = role.value;
          levels.forEach((level) => {
            const target = childLevels.find((item) => item.value === level.value);
            if (target) target.checked = level.checked;
          });
          childRow.classList.add('assignment-row-active');
        });
      });
    });
  });
}

bindAttachmentPicker();
bindIncludeChildrenCascade();

function bindTableSearches() {
  document.querySelectorAll('[data-table-search]').forEach((input) => {
    const table = document.getElementById(input.dataset.tableSearch);
    if (!table) return;
    input.addEventListener('input', () => {
      const query = input.value.trim().toLowerCase();
      table.querySelectorAll('tbody tr').forEach((row) => {
        const text = row.dataset.searchText || row.textContent.toLowerCase();
        row.hidden = Boolean(query) && !text.includes(query);
      });
    });
  });
}

function bindIssueTypeTreeControls() {
  const table = document.getElementById('issue-type-table');
  const search = document.querySelector('[data-issue-type-search]');
  if (!table) return;
  const storageKey = 'serviceDesk:issueFamilies:expanded';
  let expanded = new Set();
  try { expanded = new Set(JSON.parse(sessionStorage.getItem(storageKey) || '[]').map(String)); } catch { expanded = new Set(); }

  const save = () => sessionStorage.setItem(storageKey, JSON.stringify([...expanded]));
  const setFamilyCollapsed = (familyId, collapsed, persist = true) => {
    table.querySelectorAll(`[data-family-child="${CSS.escape(String(familyId))}"]`).forEach((row) => {
      row.hidden = collapsed;
      row.dataset.collapsed = collapsed ? 'true' : 'false';
    });
    const toggle = table.querySelector(`[data-family-toggle="${CSS.escape(String(familyId))}"]`);
    if (toggle) {
      toggle.textContent = collapsed ? '▸' : '▾';
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    if (persist) {
      if (collapsed) expanded.delete(String(familyId)); else expanded.add(String(familyId));
      save();
    }
  };

  table.querySelectorAll('[data-family-row]').forEach((row) => setFamilyCollapsed(row.dataset.familyRow, !expanded.has(String(row.dataset.familyRow)), false));
  const openFamily = new URL(window.location.href).searchParams.get('openFamily');
  if (openFamily) {
    setFamilyCollapsed(openFamily, false, true);
    const row = table.querySelector(`[data-family-row="${CSS.escape(openFamily)}"]`);
    window.setTimeout(() => row?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    row?.classList.add('attention-pulse');
    window.setTimeout(() => row?.classList.remove('attention-pulse'), 1500);
  }

  table.querySelectorAll('[data-family-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.familyToggle;
      setFamilyCollapsed(id, expanded.has(String(id)));
    });
  });

  document.querySelectorAll('[data-issue-expand]').forEach((button) => {
    button.addEventListener('click', () => {
      const collapse = button.dataset.issueExpand === 'none';
      document.querySelectorAll('[data-issue-expand]').forEach((item) => item.classList.toggle('active', item === button));
      table.querySelectorAll('[data-family-row]').forEach((row) => setFamilyCollapsed(row.dataset.familyRow, collapse, false));
      expanded = collapse ? new Set() : new Set([...table.querySelectorAll('[data-family-row]')].map((row) => String(row.dataset.familyRow)));
      save();
    });
  });

  if (search) {
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      const familyMatches = new Map();
      table.querySelectorAll('[data-family-row]').forEach((row) => {
        const id = row.dataset.familyRow;
        const match = !query || (row.dataset.searchText || row.textContent.toLowerCase()).includes(query);
        familyMatches.set(id, match);
      });
      table.querySelectorAll('[data-family-child]').forEach((row) => {
        const id = row.dataset.familyChild;
        const match = !query || (row.dataset.searchText || row.textContent.toLowerCase()).includes(query);
        row.hidden = query ? !match : !expanded.has(String(id));
        if (match && query) familyMatches.set(id, true);
      });
      table.querySelectorAll('[data-family-row]').forEach((row) => {
        const id = row.dataset.familyRow;
        row.hidden = !familyMatches.get(id);
        const toggle = table.querySelector(`[data-family-toggle="${CSS.escape(String(id))}"]`);
        if (query && familyMatches.get(id) && toggle) toggle.textContent = '▾';
        if (!query && toggle) toggle.textContent = expanded.has(String(id)) ? '▾' : '▸';
      });
    });
  }
}

bindTableSearches();
bindIssueTypeTreeControls();


function bindOriginVisibilityDefaults() {
  document.querySelectorAll('[data-origin-source]').forEach((source) => {
    const form = source.closest('form');
    const visibility = form?.querySelector('[data-visibility-scope]');
    if (!visibility) return;
    source.addEventListener('change', () => {
      if (source.value === 'client_asked_agent') {
        visibility.value = 'client_visible';
      } else if (source.value === 'partner_observed' && visibility.value === 'client_visible') {
        visibility.value = 'partner_visible';
      } else if (source.value === 'internal_observed' && visibility.value === 'client_visible') {
        visibility.value = 'internal_only';
      }
    });
  });
}

function bindPasswordToggles() {
  document.querySelectorAll('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = button.closest('.password-field')?.querySelector('input');
      if (!input) return;
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      button.textContent = showing ? '👁' : '🙈';
      button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function commentVisibilityLabel(value) {
  if (value === 'partner_visible') return 'Partner note';
  if (value === 'internal_only') return 'Internal';
  return 'Public';
}

function bindAjaxComments() {
  document.querySelectorAll('[data-ajax-comment]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"]');
      const list = document.querySelector('[data-comment-list]');
      if (!list) return form.submit();
      const original = button?.textContent;
      if (button) { button.disabled = true; button.textContent = 'Posting...'; }
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Unable to post comment.');
        const comment = payload.comment || {};
        document.querySelector('[data-empty-comments]')?.remove();
        const attachments = (comment.attachments || []).map((item) => item.fileUrl
          ? `<a href="${escapeHtml(item.fileUrl)}" target="_blank" rel="noreferrer">📎 ${escapeHtml(item.fileName)}</a>`
          : `<span>📎 ${escapeHtml(item.fileName)}</span>`).join('');
        const authorName = comment.author?.name || comment.author?.email || 'User';
        const node = document.createElement('article');
        node.className = `comment-item visibility-${escapeHtml(comment.visibility || 'client_visible')} new-comment`;
        node.innerHTML = `<div class="comment-avatar">${escapeHtml(String(authorName).trim().slice(0, 1).toUpperCase() || 'U')}</div><div class="comment-content"><div class="comment-meta"><strong>${escapeHtml(authorName)}</strong><span>${new Date(comment.createdAt || Date.now()).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span><em>${commentVisibilityLabel(comment.visibility)}</em></div><p>${escapeHtml(comment.body)}</p>${attachments ? `<div class="attachment-list">${attachments}</div>` : ''}</div>`;
        list.prepend(node);
        const countBadge = form.closest('[data-activity-tabs]')?.querySelector('[data-activity-tab="comments"] em');
        if (countBadge) countBadge.textContent = String(Number.parseInt(countBadge.textContent || '0', 10) + 1);
        form.reset();
      } catch (error) {
        alert(error.message || 'Unable to post comment.');
      } finally {
        if (button) { button.disabled = false; button.textContent = original || 'Post update'; }
      }
    });
  });
}

bindPasswordToggles();
bindAjaxComments();
bindOriginVisibilityDefaults();

function bindSlaCardToggles() {
  document.querySelectorAll('[data-sla-card]').forEach((card) => {
    const button = card.querySelector('[data-toggle-sla-card]');
    if (!button) return;
    const key = `serviceDesk:slaCard:${card.dataset.slaCardKey || 'default'}`;
    const apply = (collapsed) => {
      card.classList.toggle('is-collapsed', collapsed);
      button.textContent = collapsed ? 'Expand' : 'Collapse';
      button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    };
    apply(localStorage.getItem(key) === 'collapsed');
    button.addEventListener('click', () => {
      const collapsed = !card.classList.contains('is-collapsed');
      localStorage.setItem(key, collapsed ? 'collapsed' : 'expanded');
      apply(collapsed);
    });
  });
}

bindSlaCardToggles();


function bindSingleOptionSelects() {
  const apply = (select) => {
    if (!select || select.dataset.noAutoLock === 'true') return;
    if (select.disabled && select.dataset.singleOptionLocked !== 'true') return;
    const realOptions = [...select.options].filter((option) => !option.disabled && String(option.value || '').trim() !== '');
    const shouldLock = realOptions.length === 1;
    const existingHidden = select.parentElement?.querySelector(`input[type="hidden"][data-single-option-for="${CSS.escape(select.name || '')}"]`);

    if (shouldLock) {
      select.value = realOptions[0].value;
      select.classList.add('single-option-select');
      select.setAttribute('aria-disabled', 'true');
      select.dataset.singleOptionLocked = 'true';
      select.disabled = true;
      if (select.name && !existingHidden) {
        const hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = select.name;
        hidden.value = select.value;
        hidden.dataset.singleOptionFor = select.name;
        select.insertAdjacentElement('afterend', hidden);
      } else if (existingHidden) {
        existingHidden.value = select.value;
      }
      const label = select.closest('label');
      if (label && !label.querySelector('[data-single-option-note]')) {
        const note = document.createElement('small');
        note.className = 'field-hint single-option-note';
        note.dataset.singleOptionNote = 'true';
        note.textContent = 'Automatically selected — no other option is available.';
        label.appendChild(note);
      }
    } else if (select.dataset.singleOptionLocked === 'true') {
      select.disabled = false;
      select.classList.remove('single-option-select');
      select.removeAttribute('aria-disabled');
      delete select.dataset.singleOptionLocked;
      existingHidden?.remove();
      select.closest('label')?.querySelector('[data-single-option-note]')?.remove();
    }
  };

  const scan = () => document.querySelectorAll('select').forEach(apply);
  scan();
  const observer = new MutationObserver((mutations) => {
    const touched = new Set();
    mutations.forEach((mutation) => {
      const select = mutation.target.closest?.('select') || (mutation.target.tagName === 'SELECT' ? mutation.target : null);
      if (select) touched.add(select);
    });
    touched.forEach(apply);
  });
  document.querySelectorAll('select').forEach((select) => observer.observe(select, { childList: true, subtree: true }));
}

function bindScrollTargets() {
  document.querySelectorAll('[data-scroll-target]').forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      const target = document.querySelector(trigger.dataset.scrollTarget || '');
      if (!target) return;
      event.preventDefault();
      trigger.closest('dialog')?.close();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('attention-pulse');
      window.setTimeout(() => target.classList.remove('attention-pulse'), 1400);
    });
  });
}

bindSingleOptionSelects();
bindScrollTargets();

function bindPostSubmissionGuards() {
  const resetForm = (form) => {
    delete form.dataset.submitting;
    form.classList.remove('is-submitting');
    form.querySelectorAll('[data-submit-was-disabled]').forEach((button) => {
      button.disabled = button.dataset.submitWasDisabled === 'true';
      const originalLabel = button.dataset.submitOriginalLabel || '';
      if (button.tagName === 'INPUT') button.value = originalLabel || button.value;
      else button.textContent = originalLabel || button.textContent;
      delete button.dataset.submitWasDisabled;
      delete button.dataset.submitOriginalLabel;
    });
  };

  document.querySelectorAll('form[method="post"], form[method="POST"]').forEach((form) => {
    if (form.matches('[data-ajax-comment], [data-user-form]')) return;

    form.addEventListener('submit', (event) => {
      if (form.dataset.submitting === 'true') {
        event.preventDefault();
        return;
      }
      if (!form.checkValidity()) return;

      form.dataset.submitting = 'true';
      form.classList.add('is-submitting');
      form.querySelectorAll('button[type="submit"], input[type="submit"]').forEach((button) => {
        button.dataset.submitWasDisabled = String(button.disabled);
        button.dataset.submitOriginalLabel = button.textContent || button.value || '';
        button.disabled = true;
        const waitingLabel = button.dataset.submittingLabel || 'Saving…';
        if (button.tagName === 'INPUT') button.value = waitingLabel;
        else button.textContent = waitingLabel;
      });
    });
  });

  window.addEventListener('pageshow', () => {
    document.querySelectorAll('form[data-submitting="true"]').forEach(resetForm);
  });
}

bindPostSubmissionGuards();


function clearRequestActionQueryFromAddressBar() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('notice') && !url.searchParams.has('error')) return;
  url.searchParams.delete('notice');
  url.searchParams.delete('error');
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

clearRequestActionQueryFromAddressBar();


function bindWorkflowTransitionMatrix() {
  document.querySelectorAll('[data-transition-matrix]').forEach((matrix) => {
    const cells = [...matrix.querySelectorAll('[data-transition-row][data-transition-col]')];
    const clear = () => matrix.querySelectorAll('.matrix-axis-active,.matrix-cell-active').forEach((node) => node.classList.remove('matrix-axis-active','matrix-cell-active'));
    const activate = (cell, sticky = false) => {
      if (!cell) return;
      clear();
      const row = cell.dataset.transitionRow;
      const col = cell.dataset.transitionCol;
      matrix.querySelector(`[data-row-header="${CSS.escape(row)}"]`)?.classList.add('matrix-axis-active');
      matrix.querySelector(`[data-col-header="${CSS.escape(col)}"]`)?.classList.add('matrix-axis-active');
      cell.classList.add('matrix-cell-active');
      if (sticky) matrix.dataset.selectedCell = `${row}__${col}`;
    };
    cells.forEach((cell) => {
      cell.addEventListener('mouseenter', () => activate(cell));
      cell.addEventListener('focusin', () => activate(cell));
      cell.addEventListener('click', () => activate(cell, true));
    });
    matrix.addEventListener('mouseleave', () => {
      const key = matrix.dataset.selectedCell;
      if (!key) return clear();
      const [row,col] = key.split('__');
      activate(matrix.querySelector(`[data-transition-row="${CSS.escape(row)}"][data-transition-col="${CSS.escape(col)}"]`));
    });
  });
}

bindWorkflowTransitionMatrix();


function bindWorkflowLibraryFilters() {
  document.querySelectorAll('[data-workflow-status-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.workflowStatusFilter || 'all';
      const group = button.closest('[data-tab-group]');
      group?.querySelectorAll('[data-workflow-status-filter]').forEach((item) => item.classList.toggle('active', item === button));
      document.querySelectorAll('[data-workflow-status]').forEach((row) => {
        const status = String(row.dataset.workflowStatus || 'active').toLowerCase();
        const searchInput = document.querySelector('[data-filter-input="workflowLibrary"]');
        const search = String(searchInput?.value || '').trim().toLowerCase();
        const text = String(row.dataset.filterItem || row.textContent || '').toLowerCase();
        const matchesSearch = !search || text.includes(search);
        const matchesStatus = target === 'all' || status === target;
        row.hidden = !(matchesSearch && matchesStatus);
      });
    });
  });

  const search = document.querySelector('[data-filter-input="workflowLibrary"]');
  if (search) {
    search.addEventListener('input', () => {
      const active = document.querySelector('[data-workflow-status-filter].active');
      window.setTimeout(() => active?.click(), 0);
    });
  }
}

bindWorkflowLibraryFilters();


function bindUserEditor() {
  const modal = document.getElementById('editUserModal');
  const form = modal?.querySelector('[data-edit-user-form]');
  if (!modal || !form) return;

  const clearAssignments = () => {
    form.querySelectorAll('[data-assignment-row]').forEach((row) => {
      const use = row.querySelector('[data-assignment-use]');
      const role = row.querySelector('[data-assignment-role]');
      const include = row.querySelector('[data-assignment-child]');
      const levels = [...row.querySelectorAll('[data-assignment-level]')];
      if (use) use.checked = false;
      if (role) role.value = 'clientUser';
      if (include) include.checked = false;
      levels.forEach((level) => { level.checked = level.value === 'L1'; });
      use?.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  document.querySelectorAll('[data-edit-user]').forEach((button) => {
    button.addEventListener('click', () => {
      let payload;
      try { payload = JSON.parse(decodeURIComponent(button.dataset.userPayload || '')); }
      catch { return; }

      form.reset();
      clearAssignments();
      form.action = `/admin/users/${encodeURIComponent(payload.id)}`;
      form.querySelector('[data-edit-user-title]').textContent = payload.name || 'Edit user';
      form.querySelector('[data-edit-user-email]').textContent = payload.email || '';
      form.querySelector('[data-edit-user-email-input]').value = payload.email || '';
      const currentEmail = form.querySelector('[data-edit-user-email-current]');
      const pendingEmail = form.querySelector('[data-edit-user-email-pending]');
      const newEmail = form.querySelector('[data-edit-user-new-email]');
      if (currentEmail) currentEmail.textContent = payload.email || '—';
      if (pendingEmail) { pendingEmail.textContent = payload.pendingEmail ? `Verification pending: ${payload.pendingEmail}` : ''; pendingEmail.hidden = !payload.pendingEmail; }
      if (newEmail) newEmail.value = '';
      form.querySelector('[data-edit-user-name]').value = payload.name || '';
      form.querySelector('[data-edit-user-status]').value = payload.status === 'inactive' ? 'inactive' : 'active';
      form.querySelector('[data-edit-user-admin]').checked = Boolean(payload.isTenantAdmin);
      form.querySelector('[data-edit-user-admin]')?.dispatchEvent(new Event('change', { bubbles: true }));
      const errorBox = form.querySelector('[data-form-error]');
      if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }

      (payload.assignments || []).forEach((assignment) => {
        const row = form.querySelector(`[data-assignment-row][data-client-id="${CSS.escape(String(assignment.clientId || ''))}"]`);
        if (!row) return;
        const use = row.querySelector('[data-assignment-use]');
        const role = row.querySelector('[data-assignment-role]');
        const include = row.querySelector('[data-assignment-child]');
        const levels = [...row.querySelectorAll('[data-assignment-level]')];
        if (role) role.value = assignment.role || 'clientUser';
        if (use) use.checked = true;
        if (include) include.checked = Boolean(assignment.includeChildren);
        const selectedLevels = new Set((assignment.supportLevels || []).map(String));
        levels.forEach((level) => { level.checked = selectedLevels.has(level.value); });
        use?.dispatchEvent(new Event('change', { bubbles: true }));
      });

      if (!modal.open && typeof modal.showModal === 'function') modal.showModal();
      window.setTimeout(() => form.querySelector('[data-edit-user-name]')?.focus(), 30);
    });
  });
}

function bindTenantAdminAssignmentRules() {
  document.querySelectorAll('[data-user-form]').forEach((form) => {
    const adminToggle = form.querySelector('input[name="makeTenantAdmin"]');
    const builder = form.querySelector('[data-assignment-builder]');
    if (!adminToggle || !builder) return;
    let note = form.querySelector('[data-admin-assignment-note]');
    if (!note) {
      note = document.createElement('div');
      note.className = 'assignment-admin-note';
      note.dataset.adminAssignmentNote = 'true';
      builder.insertAdjacentElement('beforebegin', note);
    }
    const sync = () => {
      note.hidden = !adminToggle.checked;
      note.textContent = adminToggle.checked
        ? 'Tenant admin access is organization-wide. Client assignments below are optional and are needed only if this person also uses the tenant portal.'
        : '';
      builder.classList.toggle('assignments-optional', adminToggle.checked);
      builder.classList.toggle('assignments-disabled', adminToggle.checked);
      builder.querySelectorAll('input, select, button').forEach((control) => {
        control.disabled = adminToggle.checked;
      });
      builder.setAttribute('aria-disabled', adminToggle.checked ? 'true' : 'false');
    };
    adminToggle.addEventListener('change', sync);
    sync();
  });
}

bindTenantAdminAssignmentRules();

function bindAjaxUserForms() {
  document.querySelectorAll('[data-user-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = form.querySelector('[data-form-error]');
      const submit = form.querySelector('button[type="submit"]');
      const selectedClients = form.querySelectorAll('[data-assignment-use]:checked');
      const tenantAdmin = form.querySelector('input[name="makeTenantAdmin"]')?.checked === true;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      if (!selectedClients.length && !tenantAdmin) {
        if (errorBox) {
          errorBox.textContent = 'Assign at least one client, or enable tenant admin access.';
          errorBox.hidden = false;
        }
        form.querySelector('[data-assignment-builder]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      if (errorBox) { errorBox.hidden = true; errorBox.textContent = ''; }
      const original = submit?.textContent || '';
      if (submit) { submit.disabled = true; submit.textContent = submit.dataset.submittingLabel || 'Saving…'; }
      form.setAttribute('aria-busy', 'true');

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new URLSearchParams(new FormData(form)),
          headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' }
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.message || 'Unable to save this user.');
        window.location.assign(payload.redirect || '/admin/users');
      } catch (error) {
        if (errorBox) {
          errorBox.textContent = error.message || 'Unable to save this user.';
          errorBox.hidden = false;
          errorBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
        if (submit) { submit.disabled = false; submit.textContent = original || 'Save user'; }
        form.removeAttribute('aria-busy');
      }
    });
  });
}

function bindClientDetailTabs() {
  const nav = document.querySelector('[data-client-tabs]');
  if (!nav) return;
  const buttons = [...nav.querySelectorAll('[data-client-tab]')];
  const panels = [...document.querySelectorAll('[data-client-tab-panel]')];
  const activate = (key, updateHash = true) => {
    if (!buttons.some((button) => button.dataset.clientTab === key)) key = 'overview';
    buttons.forEach((button) => button.classList.toggle('active', button.dataset.clientTab === key));
    panels.forEach((panel) => { panel.hidden = panel.dataset.clientTabPanel !== key; });
    if (updateHash && history.replaceState) history.replaceState(null, '', `${location.pathname}${location.search}#${key}`);
  };
  buttons.forEach((button) => button.addEventListener('click', () => activate(button.dataset.clientTab)));
  activate(String(location.hash || '').replace(/^#/, '') || 'overview', false);
}
bindClientDetailTabs();

function bindRequestActivityTabs() {
  document.querySelectorAll('[data-activity-tabs]').forEach((root) => {
    const buttons = [...root.querySelectorAll('[data-activity-tab]')];
    const panels = [...root.querySelectorAll('[data-activity-panel]')];
    const activate = (key) => {
      buttons.forEach((button) => {
        const active = button.dataset.activityTab === key;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      panels.forEach((panel) => { panel.hidden = panel.dataset.activityPanel !== key; });
    };
    buttons.forEach((button) => button.addEventListener('click', () => activate(button.dataset.activityTab)));
    activate(buttons.find((button) => button.classList.contains('active'))?.dataset.activityTab || 'comments');
  });
}
bindRequestActivityTabs();

function openRequestedUserEditor() {
  const params = new URLSearchParams(location.search);
  const edit = params.get('edit');
  if (edit) window.setTimeout(() => document.querySelector(`[data-edit-user][data-user-id="${CSS.escape(edit)}"]`)?.click(), 50);
}
openRequestedUserEditor();

function bindFaqGroupVisibility() {
  const input = document.querySelector('[data-filter-input="faq"]');
  if (!input) return;
  const sync = () => document.querySelectorAll('[data-faq-group]').forEach((group) => {
    const visible = [...group.querySelectorAll('[data-filter-item]')].some((item) => !item.hidden);
    group.hidden = !visible;
  });
  input.addEventListener('input', () => window.setTimeout(sync, 0));
  sync();
}
bindFaqGroupVisibility();

function bindWorkflowBuilderModal() {
  const modal = document.getElementById('workflowBuilderModal');
  const frame = modal?.querySelector('[data-workflow-frame]');
  const loading = modal?.querySelector('[data-workflow-loading]');
  const title = modal?.querySelector('[data-workflow-modal-title]');
  const fullPage = modal?.querySelector('[data-workflow-full-page]');
  const reload = modal?.querySelector('[data-workflow-reload]');
  if (!modal || !frame) return;

  const showLoading = () => {
    if (loading) loading.hidden = false;
    frame.classList.add('is-loading');
  };
  const hideLoading = () => {
    if (loading) loading.hidden = true;
    frame.classList.remove('is-loading');
    frame.dataset.loaded = 'true';
  };
  const loadUrl = (url, force = false) => {
    if (!url) return;
    const current = frame.dataset.baseUrl || '';
    if (!force && current === url && frame.dataset.loaded === 'true') return hideLoading();
    showLoading();
    frame.dataset.baseUrl = url;
    frame.src = force ? `${url}${url.includes('?') ? '&' : '?'}reload=${Date.now()}` : url;
  };

  frame.addEventListener('load', hideLoading);
  document.querySelectorAll('[data-workflow-launch]').forEach((button) => {
    button.addEventListener('click', () => {
      const url = button.dataset.workflowUrl || '';
      const name = button.dataset.workflowName || 'Workflow';
      if (title) title.textContent = name;
      if (fullPage) fullPage.href = url.replace(/\?embed=1(?:&.*)?$/, '');
      if (!modal.open && typeof modal.showModal === 'function') modal.showModal();
      window.requestAnimationFrame(() => loadUrl(url, false));
    });
  });
  reload?.addEventListener('click', () => loadUrl(frame.dataset.baseUrl || '', true));
}

function bindStatusInsertButtons() {
  const modal = document.getElementById('statusModal');
  const form = modal?.querySelector('[data-status-create-form]');
  if (!modal || !form) return;
  const afterInput = form.querySelector('[data-insert-after-status]');
  const beforeInput = form.querySelector('[data-insert-before-status]');
  const context = form.querySelector('[data-status-insert-context]');
  const title = form.querySelector('[data-status-modal-title]');
  const order = form.querySelector('[data-status-display-order]');
  const autoWrap = form.querySelector('[data-auto-connect-wrap]');
  const autoHint = form.querySelector('[data-auto-connect-hint]');
  const autoConnect = form.querySelector('[data-auto-connect]');

  const reset = () => {
    afterInput.value = '';
    beforeInput.value = '';
    if (order) order.value = '';
    if (title) title.textContent = 'New workflow status';
    if (context) context.innerHTML = '<strong>Adding at the end of the workflow.</strong><span>You can reposition it later by editing its display order.</span>';
    if (autoWrap) autoWrap.hidden = true;
    if (autoHint) autoHint.hidden = true;
    if (autoConnect) autoConnect.checked = false;
  };

  document.querySelectorAll('[data-status-add-default]').forEach((button) => button.addEventListener('click', reset));
  document.querySelectorAll('[data-insert-status]').forEach((button) => {
    button.addEventListener('click', () => {
      const afterId = button.dataset.afterStatusId || '';
      const beforeId = button.dataset.beforeStatusId || '';
      const afterName = button.dataset.afterStatusName || 'the current status';
      const beforeName = button.dataset.beforeStatusName || '';
      afterInput.value = afterId;
      beforeInput.value = beforeId;
      if (order) order.value = '';
      if (title) title.textContent = beforeName ? `Insert after ${afterName}` : `Add after ${afterName}`;
      if (context) context.innerHTML = beforeName
        ? `<strong>Insert between ${escapeHtml(afterName)} and ${escapeHtml(beforeName)}.</strong><span>The display order will be calculated automatically.</span>`
        : `<strong>Add after ${escapeHtml(afterName)}.</strong><span>The display order will be calculated automatically.</span>`;
      if (autoWrap) autoWrap.hidden = false;
      if (autoHint) autoHint.hidden = false;
      if (autoConnect) autoConnect.checked = true;
      if (!modal.open && typeof modal.showModal === 'function') modal.showModal();
      window.setTimeout(() => form.querySelector('input[name="name"]')?.focus(), 30);
    });
  });
}

bindUserEditor();
bindAjaxUserForms();
bindWorkflowBuilderModal();
bindStatusInsertButtons();


function bindPasswordFeedback() {
  document.querySelectorAll('[data-password-form]').forEach((form) => {
    const primary = form.querySelector('[data-password-primary]');
    const confirm = form.querySelector('[data-password-confirm]');
    const lengthNode = form.querySelector('[data-password-length]');
    const matchNode = form.querySelector('[data-password-match]');
    if (!primary || !confirm) return;
    const sync = () => {
      const lengthOk = primary.value.length >= 8;
      const matchOk = Boolean(confirm.value) && primary.value === confirm.value;
      if (lengthNode) { lengthNode.textContent = `${lengthOk ? '✓' : '○'} At least 8 characters`; lengthNode.classList.toggle('ok', lengthOk); }
      if (matchNode) {
        matchNode.textContent = `${matchOk ? '✓' : confirm.value ? '✕' : '○'} ${matchOk ? 'Passwords match' : 'Passwords must match'}`;
        matchNode.classList.toggle('ok', matchOk);
        matchNode.classList.toggle('bad', Boolean(confirm.value) && !matchOk);
        matchNode.classList.toggle('match-pop', matchOk);
      }
      confirm.setCustomValidity(confirm.value && !matchOk ? 'Passwords do not match.' : '');
    };
    primary.addEventListener('input', sync);
    confirm.addEventListener('input', sync);
    sync();
  });
}

function bindSetupSlugPreview() {
  const slug = document.getElementById('workspaceSlug');
  const preview = document.querySelector('[data-slug-preview]');
  if (!slug || !preview) return;
  slug.addEventListener('input', () => {
    slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+/, '');
    preview.textContent = slug.value || 'workspace';
  });
}

bindPasswordFeedback();
bindSetupSlugPreview();

function bindRequestWorkbenchStatusLaunchers() {
  document.querySelectorAll('[data-stage-status-launch]').forEach((button) => {
    button.addEventListener('click', () => {
      const stageId = button.dataset.stageStatusLaunch || '';
      const railSelect = document.querySelector(`[data-stage-status-select="${CSS.escape(stageId)}"]`);
      const selected = railSelect?.value || '';
      if (!selected) {
        railSelect?.focus();
        return;
      }
      const modal = document.getElementById(`stageStatus_${stageId}`);
      if (!modal) return;
      const modalSelect = modal.querySelector('select[name="toStatusId"]');
      if (modalSelect) modalSelect.value = selected;
      if (!modal.open && typeof modal.showModal === 'function') modal.showModal();
    });
  });
}

bindRequestWorkbenchStatusLaunchers();
