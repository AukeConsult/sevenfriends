/**
 * Which circles this build of the app serves: `all` = every circle (the website, the installed web app and the Seven Friends app: the person can be in any
 * circle and moves between them). A build made for ONE circle (a separate app with its own name and icon) sets this to that circle type
 * (friends, buddies, work or family). It is sent when the device registers for push, so the server wakes the app made for a circle first and the all-circles
 * app for the other circles (see `devicesFor` in functions/src/push.ts).
 */
export const APP_KIND: 'all' | 'friends' | 'buddies' | 'work' | 'family' = 'all';
