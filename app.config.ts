import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Immigration Eagle',
  slug: 'immigration-eagle',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'immigration-eagle',
  icon: './assets/app-icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
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
    edgeToEdgeEnabled: true,
  },
  plugins: ['expo-font',['expo-splash-screen', {image:'./assets/splash-icon.png',imageWidth:180,resizeMode:'contain',backgroundColor:'#061B49'}]],
  web: {bundler:'metro',output:'single',favicon:'./assets/favicon.png',name:'Immigration Eagle',description:'Find your immigration form and choose your next step.'},
  experiments: {baseUrl:process.env.EXPO_BASE_URL || ''},
  extra: {website:'https://coortgroup.github.io/immigration_eagle/',releaseStage:'preview'},
};

export default config;
