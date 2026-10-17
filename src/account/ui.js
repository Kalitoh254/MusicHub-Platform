import { getProfile, updateProfile, getAdminSummary, listAccounts, updateRole, updateStatus, revokeSessions } from './api.js';
import '../styles/account.css';

export function initAccountManagement() {
  const host = document.querySelector('.account-area') || document.querySelector('header');
  if (!host || document.querySelector('#mh-account-open')) return;

  const open = document.createElement('button');
  open.id = 'mh-account-open';
  open.type = 'button';
  open.textContent = 'Profile & Admin';
  open.className = 'mh-account-open';
  host.append(open);

  const panel = document.createElement('section');
  panel.id = 'mh-account-panel';
  panel.className = 'mh-account-panel';
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Profile and account management');
  document.body.append(panel);

  let current = null;
  let adminMode = false;
  const node = (tag, text, cls) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  };
  const field = (labelText, name, value, type = 'text', maxLength = 280) => {
    const wrap = node('label', labelText, 'mh-account-field');
    const input = node('input');
    input.name = name;
    input.type = type;
    input.value = value || '';
    input.maxLength = maxLength;
    if (name === 'avatarUrl') input.placeholder = 'https://…';
    wrap.append(input);
    return wrap;
  };
  const message = text => {
    let el = panel.querySelector('.mh-account-message');
    if (!el) { el = node('p', '', 'mh-account-message'); panel.prepend(el); }
    el.textContent = text;
  };
  const button = (text, fn, cls = '') => {
    const b = node('button', text, cls);
    b.type = 'button';
    b.addEventListener('click', fn);
    return b;
  };

  async function showProfile() {
    panel.replaceChildren();
    panel.append(node('h2', 'Your profile'));
    try {
      const result = await getProfile();
      const p = result.profile;
      current = p;
      panel.append(node('p', `${p.email} · ${p.role}`, 'mh-account-muted'));
      const form = node('form');
      form.append(field('Display name', 'displayName', p.display_name, 'text', 80));
      form.append(field('Handle', 'handle', p.handle, 'text', 24));
      const bioWrap = node('label', 'Bio', 'mh-account-field');
      const bio = node('textarea');
      bio.name = 'bio'; bio.maxLength = 280; bio.value = p.bio || '';
      bioWrap.append(bio); form.append(bioWrap);
      form.append(field('Avatar image URL (HTTPS)', 'avatarUrl', p.avatar_url, 'url', 500));
      const save = node('button', 'Save profile', 'mh-account-primary');
      save.type = 'submit'; form.append(save);
      form.addEventListener('submit', async event => {
        event.preventDefault(); save.disabled = true;
        const data = Object.fromEntries(new FormData(form));
        try { await updateProfile(data); message('Profile saved.'); await showProfile(); }
        catch (e) { message(e.message); }
        finally { save.disabled = false; }
      });
      panel.append(form);
      if (p.role === 'admin') panel.append(button('Open admin console', showAdmin, 'mh-account-primary'));
    } catch (e) {
      panel.append(node('p', 'Sign in to manage your profile. ' + e.message, 'mh-account-message'));
    }
    panel.append(button('Close', () => { panel.hidden = true; }));
  }

  async function showAdmin() {
    panel.replaceChildren(node('h2', 'Admin console'));
    try {
      const { summary } = await getAdminSummary();
      const stats = node('p', `Accounts: ${summary.total_accounts} · Active: ${summary.active_accounts} · Admins: ${summary.active_admins} · New in 7 days: ${summary.new_last_7_days}`, 'mh-account-stats');
      panel.append(stats);
      const searchForm = node('form');
      const search = node('input'); search.placeholder = 'Search accounts'; search.maxLength = 100; search.setAttribute('aria-label', 'Search accounts');
      const find = node('button', 'Search'); find.type = 'submit';
      searchForm.append(search, find); panel.append(searchForm);
      const results = node('div', '', 'mh-account-results'); panel.append(results);
      async function loadAccounts() {
        results.replaceChildren(node('p', 'Loading accounts…'));
        try {
          const { accounts } = await listAccounts(search.value);
          results.replaceChildren();
          for (const account of accounts) {
            const card = node('article', '', 'mh-account-card');
            card.append(node('strong', account.display_name), node('p', account.email));
            card.append(node('p', `@${account.handle || 'no-handle'} · ${account.role} · ${account.disabled_at ? 'Suspended' : 'Active'}`));
            const role = document.createElement('select');
            for (const value of ['user', 'admin']) {
              const option = node('option', value); option.value = value; option.selected = value === account.role; role.append(option);
            }
            role.setAttribute('aria-label', `Role for ${account.email}`);
            const changeRole = button('Save role', async () => {
              changeRole.disabled = true;
              try { await updateRole(account.id, role.value); message('Role updated.'); await loadAccounts(); }
              catch (e) { message(e.message); changeRole.disabled = false; }
            });
            card.append(role, changeRole);
            card.append(button(account.disabled_at ? 'Reactivate account' : 'Suspend account', async () => {
              if (!confirm(`${account.disabled_at ? 'Reactivate' : 'Suspend'} ${account.email}?`)) return;
              try { await updateStatus(account.id, !account.disabled_at); message('Account status updated.'); await loadAccounts(); }
              catch (e) { message(e.message); }
            }));
            card.append(button('Revoke sessions', async () => {
              try { const r = await revokeSessions(account.id); message(`Revoked ${r.revoked} session(s).`); }
              catch (e) { message(e.message); }
            }));
            results.append(card);
          }
          if (!accounts.length) results.append(node('p', 'No matching accounts.'));
        } catch (e) { results.replaceChildren(node('p', e.message)); }
      }
      searchForm.addEventListener('submit', event => { event.preventDefault(); loadAccounts(); });
      await loadAccounts();
    } catch (e) { message(e.message); }
    panel.append(button('Back to profile', showProfile), button('Close', () => { panel.hidden = true; }));
  }

  open.addEventListener('click', async () => {
    panel.hidden = false;
    await showProfile();
  });
  document.addEventListener('musichub:account-changed', () => {
    current = null;
    if (!panel.hidden) showProfile();
  });
}
