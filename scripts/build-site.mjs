import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const projectRoot = process.cwd();
const distRoot = join(projectRoot, 'dist');
const clientRoot = join(distRoot, 'client');
const serverRoot = join(distRoot, 'server');
const staticExtensions = new Set(['.html', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.css', '.js', '.wasm']);

await rm(distRoot, { recursive: true, force: true });
await mkdir(clientRoot, { recursive: true });
await mkdir(serverRoot, { recursive: true });

const rootEntries = await readdir(projectRoot, { withFileTypes: true });
for (const entry of rootEntries) {
    const source = join(projectRoot, entry.name);
    const destination = join(clientRoot, entry.name);

    if (entry.isFile() && staticExtensions.has(extname(entry.name).toLowerCase())) {
        await cp(source, destination);
    }

    if (entry.isDirectory() && entry.name === 'libheif') {
        await cp(source, destination, { recursive: true });
    }
}

const worker = `export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        let pathname = url.pathname;

        if (pathname === '/') pathname = '/index.html';
        if (pathname.endsWith('/')) pathname += 'index.html';

        const assetUrl = new URL(pathname, url.origin);
        let response = await env.ASSETS.fetch(new Request(assetUrl, request));

        if (response.status === 404 && !pathname.split('/').pop().includes('.')) {
            assetUrl.pathname = pathname + '.html';
            response = await env.ASSETS.fetch(new Request(assetUrl, request));
        }

        return response;
    }
};
`;

await writeFile(join(serverRoot, 'index.js'), worker, 'utf8');
console.log('Static site build complete.');
