// Which way the site is running. Set once at start-up (see boot() in app.js).
//   staticSite = false: the Quietly server is behind this page (accounts, saved progress, optional AI helper).
//   staticSite = true:  the page is just files on a plain web host. No server, so guest mode only, nothing saved.
export const env = { staticSite: false };
