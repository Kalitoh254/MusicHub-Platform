import {
  register, login, logout, getCurrentAccount,
  resendVerificationCode, verifyEmailCode, googleLogin
} from './api.js';

let googleScriptPromise;
function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!googleScriptPromise) googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google sign-in could not load.'));
    document.head.append(script);
  });
  return googleScriptPromise;
}

export async function initAuthUI() {
  const mount = () => {
    if (document.querySelector('#mh-auth')) return;
    const host = document.querySelector('header') || document.querySelector('nav') || document.body;
    const panel = document.createElement('section');
    panel.id = 'mh-auth';
    panel.className = 'mh-auth';
    panel.innerHTML = `<div class="mh-auth-heading"><strong>MusicHub Account</strong><span id="mh-auth-status" role="status" aria-live="polite">Checking session…</span></div><div id="mh-auth-content"></div>`;
    host.append(panel);
    const status = panel.querySelector('#mh-auth-status');
    const content = panel.querySelector('#mh-auth-content');
    const showMessage = message => { status.textContent = message; };
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
      wrap.append(document.createTextNode(label));
      const input = document.createElement('input');
      Object.assign(input, { name, type, autocomplete, required });
      if (type === 'password') input.minLength = 12;
      if (name === 'displayName') input.maxLength = 80;
      if (name === 'email') input.maxLength = 254;
      if (name === 'code') {
        input.inputMode = 'numeric';
        input.pattern = '[0-9]{6}';
        input.maxLength = 6;
        input.autocomplete = 'one-time-code';
      }
      wrap.append(input);
      return { wrap, input };
    };

    const mountGoogleButton = async () => {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
      if (!clientId) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'mh-auth-google';
      wrapper.style.cssText = 'margin:12px 0;min-height:40px';
      content.prepend(wrapper);
      try {
        await loadGoogleIdentityScript();
        if (!wrapper.isConnected) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            showMessage('Signing in with Google…');
            try {
              const result = await googleLogin(credential);
              renderAccount(result.account);
            } catch (error) { showMessage(error.message); }
          }
        });
        window.google.accounts.id.renderButton(wrapper, {
          theme: 'outline', size: 'large', text: 'continue_with',
          shape: 'rectangular', width: 280
        });
      } catch {
        wrapper.remove();
        showMessage('Google sign-in is unavailable. Email sign-in remains available.');
      }
    };

    const renderForms = (mode = 'login', presetEmail = '') => {
      content.replaceChildren();
      const form = document.createElement('form');
      form.className = 'mh-auth-form';
      const nameField = field('Display name', 'displayName', 'text', 'name');
      const emailField = field('Email address', 'email', 'email', 'email');
      emailField.input.value = presetEmail;
      const passwordField = field('Password', 'password', 'password',
        mode === 'register' ? 'new-password' : 'current-password');
      if (mode === 'register') form.append(nameField.wrap);
      form.append(emailField.wrap, passwordField.wrap);
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = mode === 'register' ? 'Create account' : 'Sign in';
      const switchMode = button(
        mode === 'register' ? 'Already have an account? Sign in' : 'Create a new account',
        () => { showMessage(''); renderForms(mode === 'register' ? 'login' : 'register', emailField.input.value.trim()); },
        'mh-auth-secondary'
      );
      const note = document.createElement('p');
      note.className = 'mh-auth-note';
      note.textContent = mode === 'register'
        ? 'Use a password of at least 12 characters. A six-digit email verification code is required.'
        : 'Verify your email before signing in.';
      form.append(submit);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        submit.disabled = true;
        const email = emailField.input.value.trim();
        showMessage(mode === 'register' ? 'Creating account…' : 'Signing in…');
        try {
          if (mode === 'register') {
            const result = await register(nameField.input.value.trim(), email, passwordField.input.value);
            renderVerification(email, result.verificationEmailSent
              ? 'Account created. Enter the six-digit code sent to your email.'
              : 'Account created, but the email could not be sent. Check your inbox later or request a new code after the cooldown.');
          } else {
            const result = await login(email, passwordField.input.value);
            renderAccount(result.account);
          }
        } catch (error) {
          if (error.code === 'EMAIL_VERIFICATION_REQUIRED') {
            renderVerification(email, 'Verify your email before signing in. Request a code if needed.');
          } else {
            showMessage(error.message);
            submit.disabled = false;
          }
        }
      });
      content.append(form, switchMode, note);
      void mountGoogleButton();
    };

    const renderVerification = (email, message = 'Enter the six-digit code sent to your email.') => {
      content.replaceChildren();
      const intro = document.createElement('p');
      intro.className = 'mh-auth-note';
      intro.textContent = `${message} Code expires after 10 minutes.`;
      const form = document.createElement('form');
      form.className = 'mh-auth-form';
      const emailField = field('Email address', 'email', 'email', 'email');
      emailField.input.value = email;
      const codeField = field('Six-digit verification code', 'code', 'text', 'one-time-code');
      codeField.input.required = true;
      form.append(emailField.wrap, codeField.wrap);
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = 'Verify email';
      form.append(submit);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const enteredEmail = emailField.input.value.trim();
        const code = codeField.input.value.trim();
        if (!/^\d{6}$/.test(code)) {
          showMessage('Enter all six digits of your verification code.');
          return;
        }
        submit.disabled = true;
        showMessage('Verifying email…');
        try {
          await verifyEmailCode(enteredEmail, code);
          showMessage('Email verified. Sign in to continue.');
          renderForms('login', enteredEmail);
        } catch (error) {
          showMessage(error.message);
          submit.disabled = false;
        }
      });
      const resend = button('Resend verification code', async () => {
        resend.disabled = true;
        showMessage('Requesting a new code…');
        try {
          const result = await resendVerificationCode(emailField.input.value.trim());
          showMessage(result.message || 'If the account needs verification, a code will be sent.');
        } catch (error) {
          showMessage(error.message);
        } finally {
          resend.disabled = false;
        }
      }, 'mh-auth-secondary');
      const back = button('Back to sign in', () => renderForms('login', email), 'mh-auth-secondary');
      content.append(intro, form, resend, back);
      showMessage(message);
    };

    const renderAccount = account => {
      if (!account.emailVerified) {
        renderVerification(account.email, 'Email verification is required before signing in.');
        return;
      }
      document.dispatchEvent(new CustomEvent('musichub:account-changed', { detail: account }));
      content.replaceChildren();
      const identity = document.createElement('p');
      identity.className = 'mh-auth-identity';
      identity.textContent = `${account.name} · ${account.email}`;
      const note = document.createElement('p');
      note.className = 'mh-auth-note';
      note.textContent = 'Email verified';
      const signOut = button('Sign out', async () => {
        signOut.disabled = true;
        try {
          await logout();
          document.dispatchEvent(new CustomEvent('musichub:account-changed', { detail: null }));
          showMessage('Signed out successfully.');
          renderForms('login');
        } catch (error) {
          showMessage(error.message);
          signOut.disabled = false;
        }
      });
      content.append(identity, note, signOut);
      showMessage('Signed in');
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
