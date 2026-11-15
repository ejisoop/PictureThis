// image imports resolve to a URL (Bun's bundler copies the file into the build)
declare module '*.png' {
  const src: string;
  export default src;
}
