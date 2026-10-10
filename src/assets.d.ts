// esbuild bettet .jpg als Data-URL ein (esbuild.config.mjs, Loader "dataurl"); der Import liefert den String.
declare module "*.jpg" {
  const url: string;
  export default url;
}
