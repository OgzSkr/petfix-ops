import { PLATFORM_LOGO, PLATFORM_SHORT } from '../brand.js';
import { createPlatformPages } from './pages-platform.js';
import { renderHzlMrktOpsProfitPage as renderHzlMrktOpsProfitPageView } from './nav.js';
import { renderAdminBranchesPage } from './admin-branches-page.js';
import { renderAdminUsersPage } from './admin-users-page.js';

export function createPageViews(auth, runtimeConfig = {}) {
  const platformPages = createPlatformPages(auth, runtimeConfig);

  function renderLoginPage() {
    const authDisabled = !auth.isEnabled();

    return `<!doctype html>
  <html lang="tr">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="robots" content="noindex, nofollow">
      <title>Giriş — ${PLATFORM_SHORT}</title>
      <link rel="stylesheet" href="/assets/panel-tokens.css?v=4">
      <link rel="stylesheet" href="/assets/panel-shell.css?v=10">
    </head>
    <body class="pf-login-page">
      <main class="pf-login-card">
        <a class="pf-login-brand" href="/" aria-label="PetFix">
          <img src="${PLATFORM_LOGO}" alt="PetFix" width="220" height="53" decoding="async">
        </a>
        <h1>Operasyon paneli</h1>
        <p class="pf-login-lead">Devam etmek için platform token girin.</p>
        <form id="loginForm">
          <label for="token">Platform token</label>
          <input id="token" name="token" type="password" autocomplete="current-password" required>
          <button type="submit" class="pf-login-submit">Giriş</button>
        </form>
        <p class="pf-login-status" id="loginStatus"></p>
        <p class="pf-login-footer">
        ${authDisabled
    ? '<a href="/hzlmrktops">Panele git →</a>'
    : '<button type="button" id="loginClearSession">Kayıtlı oturumu temizle</button>'}
        </p>
      </main>
      <script src="/assets/login.js?v=2" defer></script>
    </body>
  </html>`;
  }

  function renderHzlMrktOpsProfitPage() {
    return renderHzlMrktOpsProfitPageView({
      auth,
      productMatchingMode: runtimeConfig.productMatchingMode
    });
  }

  return {
    renderLoginPage,
    renderHzlMrktOpsProfitPage,
    renderAdminBranchesPage: () => renderAdminBranchesPage({ authRequired: auth.isEnabled(), auth }),
    renderAdminUsersPage: () => renderAdminUsersPage({ authRequired: auth.isEnabled(), auth }),
    ...platformPages
  };
}
