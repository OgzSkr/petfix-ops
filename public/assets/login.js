'use strict';

const TOKEN_KEY = 'platformApiToken';
const form = document.getElementById('loginForm');
const tokenInput = document.getElementById('token');
const statusEl = document.getElementById('loginStatus');
const params = new URLSearchParams(window.location.search);
const nextPath = params.get('next') || '/';

if (sessionStorage.getItem(TOKEN_KEY)) {
  window.location.replace(nextPath);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = tokenInput.value.trim();
  if (!token) {
    statusEl.textContent = 'Token gerekli.';
    return;
  }

  statusEl.textContent = 'Doğrulanıyor...';
  form.querySelector('button').disabled = true;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      statusEl.textContent = result.error || 'Giriş başarısız.';
      return;
    }

    sessionStorage.setItem(TOKEN_KEY, token);
    window.location.replace(nextPath);
  } catch {
    statusEl.textContent = 'Bağlantı hatası.';
  } finally {
    form.querySelector('button').disabled = false;
  }
});
