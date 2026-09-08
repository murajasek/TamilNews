import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAP_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'com.genalpha.tamilnews',
  appName: 'Tamil News',
  webDir: 'public',
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          cleartext: serverUrl.startsWith('http://'),
          androidScheme: serverUrl.startsWith('http://') ? 'http' : 'https',
        },
      }
    : {}),
};

export default config;
