import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import path from 'path';
import fs from 'fs';

// Modules that must be copied into the packaged app alongside the asar.
// better-sqlite3/bindings/file-uri-to-path: contain compiled .node binaries.
// xlsx: uses require('fs') internally; bundling via Vite breaks that call.
const NATIVE_MODULES = ['better-sqlite3', 'bindings', 'file-uri-to-path', 'xlsx'];

function copyDirSync(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      // Unpack native .node files from the asar so Electron can load them
      unpack: '**/*.node',
    },
    name: 'EPL Tool',
    executableName: 'epl-tool',
  },
  rebuildConfig: {
    forceRebuild: true,
  },
  makers: [
    new MakerSquirrel({ name: 'EPLTool' }),
    new MakerZIP({}, ['darwin', 'win32']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  hooks: {
    // After Vite builds and copies files to the staging directory, inject native modules
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const nmSrc = path.join(__dirname, 'node_modules');
      const nmDest = path.join(buildPath, 'node_modules');
      fs.mkdirSync(nmDest, { recursive: true });

      for (const mod of NATIVE_MODULES) {
        const src = path.join(nmSrc, mod);
        const dest = path.join(nmDest, mod);
        if (fs.existsSync(src)) {
          copyDirSync(src, dest);
          console.log(`  [native] copied ${mod}`);
        } else {
          console.warn(`  [native] WARNING: ${mod} not found at ${src}`);
        }
      }
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
