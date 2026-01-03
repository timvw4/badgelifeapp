// Module de debug pour les modals iOS
// Log les computed styles et bounding boxes pour identifier les problèmes de clipping

/**
 * Log les computed styles et bounding boxes d'un élément modal
 */
export function logModalDebugInfo(modalBackdrop, modalCard) {
  if (!modalBackdrop || !modalCard) return;
  
  const elements = [
    { name: 'html', el: document.documentElement },
    { name: 'body', el: document.body },
    { name: '#app-view', el: document.getElementById('app-view') },
    { name: '.modal-backdrop', el: modalBackdrop },
    { name: '.modal-card', el: modalCard },
  ];
  
  console.group('🔍 DEBUG MODAL - Computed Styles & Bounding Boxes');
  
  elements.forEach(({ name, el }) => {
    if (!el) {
      console.warn(`${name}: élément non trouvé`);
      return;
    }
    
    const computed = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    const parentComputed = parent ? window.getComputedStyle(parent) : null;
    
    console.group(`📦 ${name}`);
    console.log('BoundingBox:', {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
    });
    console.log('Computed Styles:', {
      position: computed.position,
      overflow: computed.overflow,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
      clipPath: computed.clipPath,
      mask: computed.mask,
      transform: computed.transform,
      width: computed.width,
      height: computed.height,
      zIndex: computed.zIndex,
    });
    if (parent) {
      console.log('Parent:', {
        tagName: parent.tagName,
        id: parent.id,
        className: parent.className,
        overflow: parentComputed?.overflow,
        overflowX: parentComputed?.overflowX,
        overflowY: parentComputed?.overflowY,
        transform: parentComputed?.transform,
        clipPath: parentComputed?.clipPath,
        mask: parentComputed?.mask,
      });
    }
    console.groupEnd();
  });
  
  console.groupEnd();
}

/**
 * Wrapper pour ouvrir un modal avec debug
 */
export function openModalWithDebug(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) {
    console.warn(`Modal ${modalId} non trouvé`);
    return;
  }
  
  const modalCard = modal.querySelector('.modal-card');
  
  // Ouvrir le modal
  modal.classList.remove('hidden');
  
  // Log après un court délai pour que le rendu soit terminé
  setTimeout(() => {
    logModalDebugInfo(modal, modalCard);
  }, 100);
}

/**
 * Debug spécifique pour le panneau profil - log tous les parents et leurs styles
 */
export function debugProfilePanel() {
  const panel = document.getElementById('profile-panel');
  if (!panel) {
    console.warn('Profile panel non trouvé');
    return;
  }
  
  const elements = [
    { name: 'html', el: document.documentElement },
    { name: 'body', el: document.body },
    { name: '.page', el: document.querySelector('.page') },
    { name: '#app-view', el: document.getElementById('app-view') },
    { name: '.profile-overlay', el: document.querySelector('.profile-overlay') },
    { name: '#profile-panel', el: panel },
    { name: '.profile-drawer-header', el: panel.querySelector('.profile-drawer-header') },
    { name: '.profile-drawer-content', el: panel.querySelector('.profile-drawer-content') },
  ];
  
  console.group('🔍 DEBUG PROFILE PANEL - Computed Styles & Bounding Boxes');
  console.log('Viewport:', {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
  });
  
  elements.forEach(({ name, el }) => {
    if (!el) {
      console.warn(`${name}: élément non trouvé`);
      return;
    }
    
    const computed = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    
    console.group(`📦 ${name}`);
    console.log('BoundingBox:', {
      x: Math.round(rect.x * 100) / 100,
      y: Math.round(rect.y * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
      left: Math.round(rect.left * 100) / 100,
      right: Math.round(rect.right * 100) / 100,
      top: Math.round(rect.top * 100) / 100,
      bottom: Math.round(rect.bottom * 100) / 100,
    });
    console.log('Computed Styles:', {
      position: computed.position,
      top: computed.top,
      left: computed.left,
      right: computed.right,
      bottom: computed.bottom,
      width: computed.width,
      maxWidth: computed.maxWidth,
      marginLeft: computed.marginLeft,
      marginRight: computed.marginRight,
      paddingLeft: computed.paddingLeft,
      paddingRight: computed.paddingRight,
      overflow: computed.overflow,
      overflowX: computed.overflowX,
      overflowY: computed.overflowY,
      transform: computed.transform,
      clipPath: computed.clipPath,
      mask: computed.mask,
      boxSizing: computed.boxSizing,
    });
    console.groupEnd();
  });
  
  console.groupEnd();
  
  // Vérifier si le panneau est plus étroit que la viewport
  const panelRect = panel.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  if (panelRect.width < viewportWidth) {
    console.warn(`⚠️ PROBLÈME DÉTECTÉ: Le panneau (${panelRect.width}px) est plus étroit que la viewport (${viewportWidth}px)`);
    console.warn(`Différence: ${viewportWidth - panelRect.width}px`);
  }
}

