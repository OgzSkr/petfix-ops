import { renderPetfixShell } from './petfix-shell.js';

/**
 * Standart PetFix Panel sayfa sarmalayıcısı.
 */
export function wrapPanelPage({
  title,
  activeModule,
  activeItem,
  bodyHtml,
  bodyClass = '',
  auth = null,
  bootstrapVar = '__PANEL__',
  bootstrapData = {},
  stylesheets = [],
  scripts = [],
  topbarActionsHtml = '',
  showBranchSelector = true,
  shellMode = 'full'
} = {}) {
  return renderPetfixShell({
    title,
    activeModule,
    activeItem,
    auth,
    bodyHtml,
    bodyClass,
    bootstrapVar,
    bootstrapData,
    stylesheets,
    scripts,
    topbarActionsHtml,
    showBranchSelector,
    shellMode
  });
}
