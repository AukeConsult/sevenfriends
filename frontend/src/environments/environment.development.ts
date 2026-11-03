// Local development: talks to the Firebase emulators, no real project needed.
export const environment = {
  useEmulators: true,
  apiBase: '/api', // proxied to the functions emulator (see proxy.conf.json)
  // Push needs the real Firebase project (a demo project cannot give out push tokens): it is only available on the deployed site.
  vapidKey: '',
  firebase: {
    apiKey: 'demo-key',
    authDomain: 'localhost',
    projectId: 'demo-sevenfriends',
    appId: 'demo-app',
  },
};
