import { renderPetfixShell } from './petfix-shell.js';
import { renderPageGuideBlock } from '../page-guides.js';

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
  shellMode = 'full',
  suppressPageGuide = false
} = {}) {
  const pageGuide = shellMode === 'ops-minimal' || suppressPageGuide ? '' : renderPageGuideBlock(activeItem);
  return renderPetfixShell({
    title,
    activeModule,
    activeItem,
    auth,
    bodyHtml: `${pageGuide}${bodyHtml}`,
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
