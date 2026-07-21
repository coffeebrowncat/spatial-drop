// this file is deliberately doing almost nothing - phones just require
// SOME service worker to exist before they'll offer "add to home
// screen", it doesn't need to actually cache anything for our app to
// count as "installable"

self.addEventListener('install', () => {
    console.log('spatial drop service worker installed');
});

self.addEventListener('fetch', () => {
    // intentionally empty - we're not doing offline caching,
    // just satisfying the requirement that one of these exists
});