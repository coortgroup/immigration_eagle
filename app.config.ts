import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Immigration Eagle',
  slug: 'immigration-eagle',
  owner: 'coortgroup',
  version: '0.1.0',
  runtimeVersion: {policy:'appVersion'},
  updates: {url:'https://u.expo.dev/9fc8959b-6ce7-436b-b512-8d0f7fe2e081'},
  orientation: 'portrait',
  scheme: 'immigration-eagle',
  icon: './assets/app-icon.png',
  userInterfaceStyle: 'light',
  githubUrl: 'https://github.com/coortgroup/immigration_eagle',
  ios: {
    bundleIdentifier: 'com.coortgroup.immigrationeagle',
    supportsTablet: true,
    buildNumber: '1',
    infoPlist: {ITSAppUsesNonExemptEncryption: false},
  },
  android: {
    package: 'com.coortgroup.immigrationeagle',
    versionCode: 1,
    adaptiveIcon: {foregroundImage: './assets/adaptive-icon.png',backgroundColor: '#061B49'},
  },
  plugins: ['expo-font','expo-status-bar',['expo-splash-screen', {image:'./assets/splash-icon.png',imageWidth:180,resizeMode:'contain',backgroundColor:'#061B49'}]],
  web: {bundler:'metro',output:'single',favicon:'./assets/favicon.png',name:'Immigration Eagle',description:'Find your immigration form and choose your next step.'},
  experiments: {baseUrl:process.env.EXPO_BASE_URL || ''},
  extra: {website:'https://coortgroup.github.io/immigration_eagle/',releaseStage:'preview',eas:{projectId:'9fc8959b-6ce7-436b-b512-8d0f7fe2e081'}},
};

export default config;
