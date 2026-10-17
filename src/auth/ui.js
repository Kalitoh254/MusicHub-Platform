import { register, login, logout, getCurrentAccount } from './api.js';

export async function initAuthUI() {
  const mount = () => {
    if (document.querySelector('#mh-auth')) return;

    const host = document.querySelector('header') || document.querySelector('nav') || document.body;
    const panel = document.createElement('section');
    panel.id = 'mh-auth';
    panel.className = 'mh-auth';
    panel.innerHTML = `
      <div class="mh-auth-heading">
        <strong>MusicHub Account</strong>
        <span id="mh-auth-status" role="status" aria-live="polite">Checking session…</span>
      </div>
      <div id="mh-auth-content"></div>
    `;
    host.append(panel);

    const status = panel.querySelector('#mh-auth-status');
    const content = panel.querySelector('#mh-auth-content');

    const showMessage = (message) => { status.textContent = message; };

    const button = (label, action, className = '') => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = label;
      if (className) el.className = className;
      el.addEventListener('click', action);
      return el;
    };

    const field = (label, name, type, autocomplete, required = true) => {
      const wrap = document.createElement('label');
      wrap.className = 'mh-auth-field';
      wrap.textContent = label;
      const input = document.createElement('input');
      input.name = name;
      input.type = type;
      input.autocomplete = autocomplete;
      input.required = required;
      if (type === 'password') input.minLength = 12;
      if (name === 'displayName') input.maxLength = 80;
      if (name === 'email') input.maxLength = 254;
      wrap.append(input);
      return { wrap, input };
    };

    const renderAccount = (account) => {
      content.replaceChildren();
      const identity = document.createElement('p');
      identity.className = 'mh-auth-identity';
      identity.textContent = `${account.name} · ${account.email}`;
      const role = document.createElement('p');
      role.className = 'mh-auth-note';
      role.textContent = account.emailVerified
        ? 'Email verified'
        : 'Email verification will be available once email delivery is configured.';
      const signOut = button('Sign out', async () => {
        signOut.disabled = true;
        try {
          await logout();
          showMessage('Signed out successfully.');
          renderForms('login');
        } catch (error) {
          showMessage(error.message);
          signOut.disabled = false;
        }
      });
      content.append(identity, role, signOut);
      showMessage('Signed in');
    };

    const renderForms = (mode = 'login') => {
      content.replaceChildren();
      const form = document.createElement('form');
      form.className = 'mh-auth-form';
      const nameField = field('Display name', 'displayName', 'text', 'name');
      const emailField = field('Email address', 'email', 'email', 'email');
      const passwordField = field('Password', 'password', 'password',
        mode === 'register' ? 'new-password' : 'current-password');
      if (mode === 'register') form.append(nameField.wrap);
      form.append(emailField.wrap, passwordField.wrap);

      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = mode === 'register' ? 'Create account' : 'Sign in';
      const switchMode = button(
        mode === 'register' ? 'Already have an account? Sign in' : 'Create a new account',
        () => { showMessage(''); renderForms(mode === 'register' ? 'login' : 'register'); },
        'mh-auth-secondary'
      );
      const note = document.createElement('p');
      note.className = 'mh-auth-note';
      note.textContent = mode === 'register'
        ? 'Use a password of at least 12 characters. Email verification and password recovery are not yet enabled.'
        : 'Your session is stored in a secure, HTTP-only cookie.';

      form.append(submit);
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        submit.disabled = true;
        showMessage(mode === 'register' ? 'Creating account…' : 'Signing in…');
        try {
          const result = mode === 'register'
            ? await register(nameField.input.value.trim(), emailField.input.value.trim(), passwordField.input.value)
            : await login(emailField.input.value.trim(), passwordField.input.value);
          renderAccount(result.account);
        } catch (error) {
          showMessage(error.message);
          submit.disabled = false;
        }
      });
      content.append(form, switchMode, note);
    };

    getCurrentAccount()
      .then(({ account }) => renderAccount(account))
      .catch(() => {
        showMessage('Sign in or create an account.');
        renderForms('login');
      });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
}
