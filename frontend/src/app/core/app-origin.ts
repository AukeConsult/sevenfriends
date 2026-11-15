/**
 * The address people are given in links (invite links, friend links, "copy link"): the main address, whatever name this copy of the app
 * was opened on (a PC may use localhost). Only on localhost the links stay local, to test them.
 */
export const APP_ORIGIN = location.hostname === 'localhost' ? location.origin : 'https://sevenfriends.io';
