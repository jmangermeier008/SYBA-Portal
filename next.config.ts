import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  // Both ship platform-specific binaries / large asset trees that must not be
  // traced and re-bundled by webpack — they are loaded at runtime by the
  // document packet route instead (src/lib/packet-render.ts).
  serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
  // @napi-rs/canvas resolves a per-platform native binary at runtime, so file
  // tracing only ever sees the build machine's own. Vercel builds on Linux and
  // would trace the right one, but pinning it means a macOS-built trace can
  // never ship a deploy that dies with "Cannot find native binding".
  // pdfjs-dist loads its parser core (pdf.worker.mjs) through a
  // runtime-computed dynamic import the tracer cannot follow — without these
  // entries the deployed function is missing the worker and every encrypted
  // PDF falls through to a placeholder page (works locally, fails on Vercel).
  outputFileTracingIncludes: {
    '/api/documents/packet': [
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**/*',
      './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
      './node_modules/pdfjs-dist/standard_fonts/**/*',
      './node_modules/pdfjs-dist/wasm/**/*',
    ],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
