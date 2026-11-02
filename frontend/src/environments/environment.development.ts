// Local development: talks to the Firebase emulators, no real project needed.
export const environment = {
  useEmulators: true,
  apiBase: '/api', // proxied to the functions emulator (see proxy.conf.json)
  firebase: {
    apiKey: 'demo-key',
    authDomain: 'localhost',
    projectId: 'demo-sevenfriends',
    appId: 'demo-app',
  },
};
