// KaTeX ships types only for its main entry; the mhchem contrib module has
// none. This side-effect import registers \ce and \pu macros globally, so a
// bare declaration is enough for strict mode.
declare module "katex/contrib/mhchem";
