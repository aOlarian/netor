# Netor

Netor is a Windows desktop browser built on Chromium. It keeps browser sessions in separate profiles and offers tab groups, a local vault, and keyboard clipboard slots. Browsing works with a local profile and needs no account on a Netor server.

## Use Netor

1. Download the Windows installer from [Releases](../../releases) and run it.
2. Open the profile bar and create a browser profile. Open a page in two profiles to see that cookies and sessions stay separate.
3. Use tab groups for related pages. Configure a PIN before saving an item to the local vault.

Cloud and AI features require a server or provider configured by the user. The installer is unsigned.

## Build and test

```powershell
npm ci
npm start
npm test
npm run dist
```

The end-to-end tests use separate profiles and local fixture pages. The installer is written to `dist/netor-install.exe`.

## License

[MIT](LICENSE). Chromium and bundled components retain their own licenses.
