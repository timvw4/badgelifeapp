const { CapacitorConfig } = require('@capacitor/cli');

const config = {
  appId: 'com.badgelife.app',
  appName: 'BadgeLife',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https'
  },
  ios: {
    contentInset: 'automatic',
    scrollEnabled: true
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#0f172a",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      iosSpinnerStyle: "small",
      spinnerColor: "#06b6d4",
      iosSplashResourceName: "Splash",
      iosSplashStoryboardName: "LaunchScreen"
    }
  }
};

module.exports = config;

