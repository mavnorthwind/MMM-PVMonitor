# MMM-PVMonitor
Show SolarEdge Inverter data on your Magic Mirror

![Screenshot](Screenshot.JPG)

## Configuration
- siteId: Enter the site ID from the SolarEdge monitoring portal
- ~~apiKey: Enter the apiKey generated in the SolarEdge monitoring portal~~ (Solaredge monitoring API uses OAuth2)
- accessToken: Enter the access token retrieved as described [in the Developer Platform Docs](https://api-docs.solaredge.com/docs/developer-platform/df8kx5j4z9vi0-homeowner-and-self-access-guide#3-run-oauth-against-your-own-account)
- refreshToken: Refresh token to get a new accessToken if the old one expires
- interval: Interval (in ms) between updates. The API allows for 300 requests per day, so plan accordingly

Add these to your MagicMirror's config.js.