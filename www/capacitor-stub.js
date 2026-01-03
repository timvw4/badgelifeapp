// Ce fichier définit un stub Capacitor AVANT que le code natif ne puisse l'appeler
// Il doit être chargé en premier, avant tout autre script

(function() {
  'use strict';
  
  // Vérifier que window existe
  if (typeof window === 'undefined') {
    return;
  }
  
  // Définir Capacitor IMMÉDIATEMENT si il n'existe pas déjà
  if (typeof window.Capacitor === 'undefined') {
    window.Capacitor = {
      triggerEvent: function(name, data) {
        // Fonction de secours qui évite les erreurs
        try {
          console.log('[Capacitor Stub] triggerEvent appelé:', name, data);
        } catch(e) {
          // Ignorer les erreurs de console
        }
        return Promise.resolve();
      },
      isNativePlatform: function() {
        return true;
      },
      Plugins: {},
      getPlatform: function() {
        return 'ios';
      },
      isPluginAvailable: function(name) {
        return false;
      },
      convertFileSrc: function(path) {
        return path;
      },
      // Ajouter d'autres méthodes communes
      addListener: function(pluginName, eventName, callback) {
        return Promise.resolve({ remove: function() {} });
      },
      removeAllListeners: function(pluginName, eventName) {
        return Promise.resolve();
      }
    };
    
    // Marquer que c'est un stub
    window.Capacitor._isStub = true;
    
    console.log('[Capacitor Stub] Capacitor stub initialisé');
  }
})();

