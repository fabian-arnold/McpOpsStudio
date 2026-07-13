# Third-party notices

MCP Ops Studio uses third-party software that remains under its respective
copyright and license terms. The GNU Affero General Public License applies to
MCP Ops Studio itself; it does not replace the licenses of independent
dependencies or supporting infrastructure.

The production dependency set currently contains software offered under MIT,
ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, CC0-1.0, CC-BY-4.0,
MPL-2.0, and LGPL-3.0-or-later terms. In particular:

- DOMPurify is available under MPL-2.0 or Apache-2.0.
- The `sharp` platform package includes Apache-2.0 and LGPL-3.0-or-later
  components.
- `caniuse-lite` contains data available under CC-BY-4.0.

Installed packages include their own license files in `node_modules`. To
produce an inventory for the exact versions resolved by the current lockfile,
run:

```bash
pnpm licenses list --prod
```

Redis, PostgreSQL, Caddy, Node.js, container base images, and other separately
distributed infrastructure components retain their own licenses and notices.
Anyone redistributing an application image or package must preserve all
applicable third-party copyright, attribution, and license notices.
