declare module '*?raw' {
  const content: string;
  export default content;
}

/** Vite's `import.meta.glob`, as used by tests that read source files as text. */
interface ImportMeta {
  glob<T = unknown>(pattern: string | string[], options: { query: '?raw'; import: 'default'; eager: true }): Record<string, T>;
}
