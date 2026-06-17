'use strict';

const TOKEN_KEY = 'platformApiToken';
const form = document.getElementById('loginForm');
const tokenInput = document.getElementById('token');
const statusEl = document.getElementById('loginStatus');
const clearBtn = document.getElementById('loginClearSession');
const params = new URLSearchParams(window.location.search);
const nextPath = params.get('next') || '/';

function setStatus(text) {
  if (statusEl) statusEl.textContent = text || '';
}

function clearStoredSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  setStatus('Kayıtlı oturum temizlendi. Token girin.');
  if (tokenInput) {
    tokenInput.value = '';
    tokenInput.focus();
  }
}

async function validateToken(token) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ token })
  });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, error: result.error || '' };
}

async function resumeExistingSession() {
  const existing = sessionStorage.getItem(TOKEN_KEY);
  if (!existing) return;

  setStatus('Kayıtlı oturum kontrol ediliyor…');
  try {
    const check = await validateToken(existing);
    if (check.ok) {
      window.location.replace(nextPath);
      return;
    }
    sessionStorage.removeItem(TOKEN_KEY);
    setStatus(check.error || 'Eski oturum geçersiz. Yeni token girin.');
  } catch {
    setStatus('Sunucuya bağlanılamadı. Token ile tekrar deneyin.');
  }
}

if (params.get('logout') === '1') {
  clearStoredSession();
} else {
  resumeExistingSession();
}

clearBtn?.addEventListener('click', (event) => {
  event.preventDefault();
  clearStoredSession();
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus('Token gerekli.');
    return;
  }

  setStatus('Doğrulanıyor…');
  const submitBtn = form.querySelector('button');
  if (submitBtn) submitBtn.disabled = true;

  try {
    const check = await validateToken(token);
    if (!check.ok) {
      setStatus(check.error || 'Giriş başarısız. Token sunucudaki PLATFORM_API_TOKEN ile aynı olmalı.');
      return;
    }

    sessionStorage.setItem(TOKEN_KEY, token);
    window.location.replace(nextPath);
  } catch {
    setStatus('Bağlantı hatası — sunucu yanıt vermiyor.');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});
